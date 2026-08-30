"""BobShellRunner — invokes the real IBM Bob Shell as an async subprocess.

Security notes
--------------
* Bob is run with cwd = workspace root. It never receives an absolute path
  constructed from user input; workspace paths are generated internally.
* The user-supplied application_name / release_version are embedded in the
  --prompt argument only, not in shell commands. The command is built as a
  Python list (no shell=True), preventing injection.
* Secrets in environment variables are NOT forwarded to the subprocess by
  default (the subprocess inherits the process environment; for production
  this class should be updated to run Bob inside an isolated container/sandbox).

PRODUCTION NOTE
---------------
This implementation assumes a trusted operator environment (hackathon).
For production, analysis jobs should run inside isolated containers with
a read-only repository mount and no network access to internal systems.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

from pydantic import ValidationError

from app.models import (
    AgentStep,
    AgentStepStatus,
    Analysis,
    AnalysisEvent,
    AnalysisMetadata,
    Evidence,
    EvidenceType,
    Finding,
    FindingSeverity,
    Decision,
    ReadinessSummary,
    ReleaseResult,
)
from app.runners.base import BobRunner, EmitFn
from app.runners.config import bob_shell_config

# ── Errors ────────────────────────────────────────────────────────────────────


class BobExecutableNotFoundError(RuntimeError):
    """Raised when the Bob binary cannot be located."""


class BobProcessError(RuntimeError):
    """Raised when Bob exits with a non-zero code."""

    def __init__(self, returncode: int, stderr: str) -> None:
        self.returncode = returncode
        self.stderr = stderr
        super().__init__(f"Bob exited with code {returncode}: {stderr[:500]}")


class BobTimeoutError(RuntimeError):
    """Raised when Bob exceeds the configured wall-clock timeout."""


class BobResultParseError(RuntimeError):
    """Raised when the final result cannot be parsed into ReleaseResult."""


# ── Helpers ───────────────────────────────────────────────────────────────────


def _sanitize(text: str) -> str:
    """Return a sanitized version of text safe for logging.

    Strips any line that looks like it contains a secret (key=value patterns
    where the key name suggests a credential).  Truncates to 800 chars.
    """
    import re
    # Blank out lines that look like credential assignments
    _SECRET_RE = re.compile(
        r"(?i)(api[_-]?key|secret|password|token|credential|auth)\s*[=:]\s*\S+",
    )
    lines = text.splitlines()
    sanitized = "\n".join(
        "[REDACTED]" if _SECRET_RE.search(line) else line
        for line in lines
    )
    return sanitized[:800]


# ── Bob prompts ───────────────────────────────────────────────────────────────

_BOB_PROMPT = (
    "$not-prod-ready "
    "Analyze the repository and deployment documentation in this workspace. "
    "When analysis is complete, write the final ReleaseResult JSON to "
    "output/release-result.json exactly as required by the output contract. "
    "Do not modify repository/ or documents/. "
    "After writing the artifact, your final assistant message must contain "
    "the exact same raw JSON object with no prose or code fences."
)

_FINALIZE_PROMPT = (
    "Using the analysis already completed in this task, return ONLY the "
    "final ReleaseResult JSON. "
    "Do not re-analyze the repository. "
    "Do not execute commands. "
    "Do not spawn subagents. "
    "No Markdown or prose."
)


# ── Stream-JSON event normalizer ──────────────────────────────────────────────
# Maps raw Bob Shell event types to the AnalysisEvent model used by the frontend.
# Bob Shell emits NDJSON lines; each line is a JSON object with a "type" key.
#
# Current documented stream-json event types and their frontend mapping:
#
#   Bob type          → AnalysisEvent.event
#   ─────────────────────────────────────────
#   message           → agent.message
#   tool_use          → tool.started
#   tool_result       → tool.completed
#   error             → bob.error
#   result            → analysis.completed  (final result carrier)
#
# session_start is handled for backward compatibility but is not part of the
# current documented schema. cost_warning and turn_limit remain for robustness.
#
# Any unrecognised type is forwarded as bob.unknown with its raw payload
# stripped of any PII/secrets.

_BOB_TYPE_MAP: dict[str, str] = {
    "session_start": "bob.session.started",   # backward compat
    "message": "agent.message",
    "tool_use": "tool.started",
    "tool_result": "tool.completed",
    "error": "bob.error",
    "result": "analysis.completed",  # default; overridden for error/limit subtypes below
    "cost_warning": "bob.cost_warning",
    "turn_limit": "bob.turn_limit",
}


def _normalize_bob_line(
    raw: dict,
    sequence: int,
) -> tuple[Optional[AnalysisEvent], Optional[str], Optional[dict]]:
    """Normalize one parsed Bob JSON line.

    Returns
    -------
    (AnalysisEvent | None, session_or_task_id | None, raw_result_payload | None)

    * AnalysisEvent — forwarded to SSE if not None
    * session_or_task_id — Bob session/task ID if discovered in this line
    * raw_result_payload — the raw Bob result dict if this line carries the
      final answer (used for ReleaseResult parsing)
    """
    bob_type = raw.get("type", "unknown")
    session_id: Optional[str] = None
    result_payload: Optional[dict] = None

    # ── Extract session / task ID from any line that carries it ───────────────
    for key in ("session_id", "task_id", "id"):
        val = raw.get(key)
        if isinstance(val, str) and val:
            session_id = val
            break

    # ── Map event type ────────────────────────────────────────────────────────
    event_name = _BOB_TYPE_MAP.get(bob_type, "bob.unknown")

    # ── Build normalised data payload (safe subset only) ──────────────────────
    data: dict = {"bob_type": bob_type, "sequence": sequence}

    if bob_type == "session_start":
        data["session_id"] = raw.get("session_id", "")
        data["model"] = raw.get("model", "")

    elif bob_type == "message":
        # Only forward assistant role text; skip user messages
        role = raw.get("role", "")
        if role == "assistant":
            content = raw.get("content", "")
            if isinstance(content, list):
                # Extract plain text from content blocks
                text_parts = [
                    b.get("text", "") for b in content
                    if isinstance(b, dict) and b.get("type") == "text"
                ]
                content = " ".join(text_parts)
            data["role"] = role
            data["text"] = str(content)[:2000]  # truncate for SSE safety
        else:
            return None, session_id, None  # skip non-assistant messages

    elif bob_type == "tool_use":
        # Current schema fields: tool_name, tool_id, parameters
        # Backward-compat aliases:  name → tool_name,  id → tool_id
        data["tool_name"] = raw.get("tool_name") or raw.get("name", "")
        data["tool_id"] = raw.get("tool_id") or raw.get("id", "")
        # Do NOT forward parameters — may contain file path / content

    elif bob_type == "tool_result":
        # Current schema fields: tool_id, status, output, error
        # Backward-compat aliases: tool_use_id → tool_id,  is_error → derive status
        tool_id = raw.get("tool_id") or raw.get("tool_use_id", "")
        data["tool_id"] = tool_id
        # Derive status: prefer explicit "status" field, fall back to is_error bool
        raw_status = raw.get("status")
        if raw_status is not None:
            data["status"] = str(raw_status)
            data["is_error"] = raw_status == "error"
        else:
            is_err = bool(raw.get("is_error", False))
            data["status"] = "error" if is_err else "success"
            data["is_error"] = is_err
        # Include truncated output for debugging (never forwarded to frontend users)
        output = raw.get("output", raw.get("content", ""))
        if output:
            data["output_preview"] = str(output)[:200]
        if raw.get("error"):
            data["error"] = str(raw["error"])[:200]

    elif bob_type == "error":
        data["error"] = str(raw.get("error", raw.get("message", "")))[:500]

    elif bob_type == "result":
        # Final result line — extract the raw payload for ReleaseResult parsing
        result_payload = raw
        data["subtype"] = raw.get("subtype", "")
        # Bob 2.0.1 uses top-level "status" field; older versions use "stop_reason"
        stop_reason = raw.get("stop_reason", "") or raw.get("status", "")
        data["stop_reason"] = stop_reason
        # Flag turn / cost limit exhaustion
        if stop_reason in ("max_turns", "turn_limit"):
            event_name = "bob.turn_limit"
        elif stop_reason in ("cost_limit", "max_cost"):
            event_name = "bob.cost_limit"
        # Capture stats when available
        stats = raw.get("stats", {})
        if stats:
            for stat_key in ("total_tokens", "input_tokens", "output_tokens",
                             "duration_ms", "session_costs", "tool_calls"):
                val = stats.get(stat_key)
                if val is not None:
                    data[stat_key] = val

    elif bob_type in ("cost_warning", "turn_limit"):
        data["value"] = raw.get("value", raw.get("turns", raw.get("cost", "")))

    else:
        # Unknown type — forward a minimal sanitised summary
        data["bob_type"] = bob_type

    return AnalysisEvent(event=event_name, data=data, sequence=sequence), session_id, result_payload


# ── ReleaseResult extraction ──────────────────────────────────────────────────

import re as _re

_FENCED_JSON_RE = _re.compile(r"```(?:json)?\s*(\{.*?})\s*```", _re.DOTALL)
_BARE_JSON_RE   = _re.compile(r"(\{.*})",                         _re.DOTALL)


def _flatten_content(content) -> str:
    """Extract plain text from a Bob content value (string or block list)."""
    if isinstance(content, list):
        parts = [
            b.get("text", "") for b in content
            if isinstance(b, dict) and b.get("type") == "text"
        ]
        return "\n".join(parts)
    return str(content) if content is not None else ""


# ── ReleaseResult normalization ───────────────────────────────────────────────
# Bob's output may use different casings or aliases for enum values.
# Normalize before schema validation so that legitimate variations are accepted
# without weakening the schema itself.

# FindingSeverity aliases: normalize to canonical uppercase values.
_SEVERITY_ALIASES: dict[str, str] = {
    "pass": "PASS", "passed": "PASS", "ok": "PASS", "info": "PASS",
    "warn": "WARN", "warning": "WARN", "caution": "WARN",
    "block": "BLOCK", "blocker": "BLOCK", "error": "BLOCK", "fail": "BLOCK",
    "failed": "BLOCK", "critical": "BLOCK",
}

# Decision aliases: normalize to canonical values.
_DECISION_ALIASES: dict[str, str] = {
    "go": "GO",
    "no_go": "NO-GO", "no-go": "NO-GO", "nogo": "NO-GO", "no go": "NO-GO",
}

# AgentStepStatus aliases
_STEP_STATUS_ALIASES: dict[str, str] = {
    "ok": "ok", "success": "ok", "pass": "ok", "passed": "ok",
    "warn": "warn", "warning": "warn",
    "error": "error", "fail": "error", "failed": "error",
}


def _normalize_finding(raw: dict) -> dict:
    """Normalize a single finding dict to match the Finding schema.

    Handles:
    - severity/status case normalization
    - missing required fields (defaults to safe values)
    - extra revalidation-only fields (resolution_status etc.) are stripped
      since they don't belong in FindingSeverity
    """
    out = dict(raw)
    # Normalize severity
    for field in ("severity", "status"):
        val = out.get(field)
        if isinstance(val, str):
            normalized = _SEVERITY_ALIASES.get(val.lower())
            if normalized:
                out[field] = normalized
            elif val.upper() in ("PASS", "WARN", "BLOCK"):
                out[field] = val.upper()
            else:
                # Unknown value — default to BLOCK rather than fail silently
                log.warning(
                    "ReleaseResult normalize: unknown severity %r for finding %r — defaulting to BLOCK",
                    val, out.get("id", "?"),
                )
                out[field] = "BLOCK"
    # Ensure status mirrors severity when one is missing
    if "severity" in out and "status" not in out:
        out["status"] = out["severity"]
    elif "status" in out and "severity" not in out:
        out["severity"] = out["status"]
    # evidence must be a list
    if not isinstance(out.get("evidence"), list):
        out["evidence"] = []
    # Required string fields
    for key in ("id", "category", "title", "claim", "actual", "explanation"):
        if not isinstance(out.get(key), str):
            out[key] = str(out.get(key, ""))
    return out


def _normalize_agent_step(raw: dict) -> dict:
    """Normalize a single agent_activity step."""
    out = dict(raw)
    status = out.get("status", "ok")
    if isinstance(status, str):
        normalized = _STEP_STATUS_ALIASES.get(status.lower())
        if normalized:
            out["status"] = normalized
        elif status not in ("ok", "warn", "error"):
            out["status"] = "ok"
    for key in ("id", "timestamp", "action", "target", "result"):
        if not isinstance(out.get(key), str):
            out[key] = str(out.get(key, ""))
    return out


def _normalize_release_result_dict(raw: dict) -> dict:
    """Normalize a raw dict that should represent a ReleaseResult.

    Handles common Bob output variations:
    - Lowercase severity/decision enums
    - Alternate decision spellings (NO_GO, NOGO)
    - Numeric strings where numbers are expected (readiness_score)
    - Missing optional arrays defaulted to []
    - Nested finding normalization
    - Nested agent_activity normalization

    Does NOT invent required data fields (app, release, etc.) — those
    are injected upstream by the caller with .setdefault().
    """
    out = dict(raw)

    # Normalize decision
    decision = out.get("decision")
    if isinstance(decision, str):
        normalized = _DECISION_ALIASES.get(decision.strip().lower())
        if normalized:
            out["decision"] = normalized
        elif decision.upper() in ("GO", "NO-GO"):
            out["decision"] = decision.upper()

    # Normalize readiness_score: accept numeric strings
    score = out.get("readiness_score")
    if isinstance(score, str):
        try:
            out["readiness_score"] = int(score)
        except (ValueError, TypeError):
            try:
                out["readiness_score"] = int(float(score))
            except (ValueError, TypeError):
                pass  # leave as-is; Pydantic will report the real error

    # Normalize findings
    findings = out.get("findings")
    if isinstance(findings, list):
        out["findings"] = [
            _normalize_finding(f) if isinstance(f, dict) else f
            for f in findings
        ]
    elif findings is None:
        out["findings"] = []

    # Normalize agent_activity
    activity = out.get("agent_activity")
    if isinstance(activity, list):
        out["agent_activity"] = [
            _normalize_agent_step(s) if isinstance(s, dict) else s
            for s in activity
        ]
    elif activity is None:
        out["agent_activity"] = []

    # Normalize summary counts: accept string numbers
    summary = out.get("summary")
    if isinstance(summary, dict):
        norm_summary = dict(summary)
        for key in ("blockers", "warnings", "passed"):
            val = norm_summary.get(key)
            if isinstance(val, str):
                try:
                    norm_summary[key] = int(val)
                except (ValueError, TypeError):
                    pass
        out["summary"] = norm_summary

    return out


def _try_parse_release_result(
    candidate: str,
    analysis: Analysis,
    result_payload: dict,
    start_time: datetime,
    agent_steps: list[AgentStep],
    files_inspected: int,
    commands_executed: int,
    end_time: datetime,
    duration_s: float,
) -> Optional[ReleaseResult]:
    """Try to extract, normalize, and validate a ReleaseResult from a text candidate.

    Returns a validated ReleaseResult on success, or None if the candidate
    does not contain a parseable, schema-valid ReleaseResult.

    Never raises — callers iterate over candidates and pick the first success.
    Logs the exact Pydantic ValidationError fields in development so the schema
    mismatch can be diagnosed without exposing secrets to users.
    """
    text = candidate.strip()
    if not text:
        return None

    # Locate a JSON object in the text using three strategies in priority order:
    # 1. Direct parse (candidate is pure JSON)
    # 2. Fenced code block  ```json { ... } ```
    # 3. First bare { ... } block in the text
    parsed_json: Optional[dict] = None

    try:
        parsed_json = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        pass

    if parsed_json is None:
        m = _FENCED_JSON_RE.search(text)
        if m:
            try:
                parsed_json = json.loads(m.group(1))
            except (json.JSONDecodeError, ValueError):
                pass

    if parsed_json is None:
        m = _BARE_JSON_RE.search(text)
        if m:
            try:
                parsed_json = json.loads(m.group(1))
            except (json.JSONDecodeError, ValueError):
                pass

    if not isinstance(parsed_json, dict):
        return None

    # The backend analysis record is authoritative.
    # This is especially important during revalidation, where Bob may accidentally
    # reuse metadata from the original analysis.
    parsed_json["analysis_id"] = analysis.analysis_id
    parsed_json["app"] = analysis.application_name
    parsed_json["release"] = analysis.release_version
    parsed_json["environment"] = analysis.environment

    # Synthesise metadata from result stats when absent
    stats = result_payload.get("stats", {}) or {}
    if "metadata" not in parsed_json:
        duration_str = (
            f"{stats['duration_ms'] / 1000:.1f} s"
            if stats.get("duration_ms")
            else f"{duration_s:.1f} s"
        )
        parsed_json["metadata"] = {
            "id": analysis.analysis_id,
            "duration": duration_str,
            "files_inspected": stats.get("tool_calls", files_inspected),
            "commands_executed": stats.get("tool_calls", commands_executed),
            "completed_at": end_time.isoformat(),
        }

    if "agent_activity" not in parsed_json:
        parsed_json["agent_activity"] = [s.model_dump() for s in agent_steps]

    # ── Normalize before validation ───────────────────────────────────────────
    # This handles legitimate Bob output variations (case differences, numeric
    # strings, etc.) without weakening the schema.
    parsed_json = _normalize_release_result_dict(parsed_json)

    try:
        return ReleaseResult.model_validate(parsed_json)
    except ValidationError as exc:
        # Log every field error for development diagnosis.
        # These logs are server-side only — never sent to the browser.
        for err in exc.errors():
            log.warning(
                "ReleaseResult validation failed: path=%s | expected=%s | received=%r",
                " → ".join(str(p) for p in err.get("loc", [])),
                err.get("type", "?"),
                err.get("input"),
            )
        return None
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "ReleaseResult parse error (non-validation): %s: %s",
            type(exc).__name__, _sanitize(str(exc)[:300]),
        )
        return None



def _load_release_result_artifact(
    workspace: Path,
    analysis: Analysis,
    result_payload: Optional[dict],
    start_time: datetime,
    agent_steps: list[AgentStep],
    files_inspected: int,
    commands_executed: int,
) -> Optional[ReleaseResult]:
    """Load the canonical ReleaseResult artifact written by Bob.

    output/release-result.json is the primary result transport.
    Assistant-message parsing remains only as a fallback.
    """
    artifact = workspace / "output" / "release-result.json"

    if not artifact.is_file():
        log.warning(
            "BOB RESULT ARTIFACT: %s was not created",
            artifact,
        )
        return None

    try:
        text = artifact.read_text(encoding="utf-8").strip()
    except OSError as exc:
        log.error(
            "BOB RESULT ARTIFACT: could not read %s: %s",
            artifact,
            _sanitize(str(exc)),
        )
        return None

    if not text:
        log.error("BOB RESULT ARTIFACT: artifact is empty")
        return None

    end_time = datetime.now(timezone.utc)
    duration_s = (end_time - start_time).total_seconds()

    result = _try_parse_release_result(
        candidate=text,
        analysis=analysis,
        result_payload=result_payload or {},
        start_time=start_time,
        agent_steps=agent_steps,
        files_inspected=files_inspected,
        commands_executed=commands_executed,
        end_time=end_time,
        duration_s=duration_s,
    )

    if result is None:
        log.error(
            "BOB RESULT ARTIFACT: release-result.json did not validate"
        )
        return None

    log.info(
        "BOB RESULT ARTIFACT: validated %s | decision=%s | score=%s",
        artifact,
        result.decision.value,
        result.readiness_score,
    )

    return result


def _extract_result_from_bob_output(
    result_payload: dict,
    analysis: Analysis,
    start_time: datetime,
    agent_steps: list[AgentStep],
    files_inspected: int,
    commands_executed: int,
    assistant_messages: Optional[list[str]] = None,
) -> ReleaseResult:
    """Select the best candidate text and validate it as a ReleaseResult.

    Candidate priority order:
        1. result.last_message   — present in some Bob versions; wins if valid.
        2. result.result         — legacy compat field.
        3. result.content        — legacy fallback field on the result event.
        4. assistant messages    — searched in REVERSE chronological order so
                                   the final assistant turn (most likely to hold
                                   the structured answer) is tried first.

    For each candidate the parser:
        - tries direct JSON parse
        - tries fenced-code-block extraction
        - tries first bare { ... } block
        - validates the result against the ReleaseResult Pydantic schema

    Only a candidate that fully validates is accepted.
    Prose messages, progress updates, and unrelated JSON are silently skipped.

    Raises BobResultParseError if no candidate validates.
    """
    end_time = datetime.now(timezone.utc)
    duration_s = (end_time - start_time).total_seconds()

    kwargs = dict(
        analysis=analysis,
        result_payload=result_payload,
        start_time=start_time,
        agent_steps=agent_steps,
        files_inspected=files_inspected,
        commands_executed=commands_executed,
        end_time=end_time,
        duration_s=duration_s,
    )

    # ── Build candidate list in priority order ────────────────────────────────
    # Candidates from the result event itself (legacy / alternate schemas)
    for field in ("last_message", "result", "content"):
        raw = result_payload.get(field)
        if raw:
            text = _flatten_content(raw)
            if text.strip():
                result = _try_parse_release_result(text, **kwargs)
                if result is not None:
                    return result

    # ── Scan assistant messages newest-first ──────────────────────────────────
    msgs = list(assistant_messages or [])
    for text in reversed(msgs):
        result = _try_parse_release_result(text, **kwargs)
        if result is not None:
            return result

    # ── Nothing validated ─────────────────────────────────────────────────────
    has_last_msg = bool(result_payload.get("last_message")
                        or result_payload.get("result")
                        or result_payload.get("content"))
    raise BobResultParseError(
        f"Bob completed but no assistant message contained a valid ReleaseResult. "
        f"(candidates examined: {len(msgs)}, "
        f"result.last_message present: {has_last_msg})"
    )


# ── BobShellRunner ────────────────────────────────────────────────────────────


class BobShellRunner(BobRunner):
    """Invokes IBM Bob Shell as an async subprocess and streams its output.

    Runner selection:
        NOTPRODREADY_BOB_MODE=shell

    Bob command template (built as a list — no shell=True):
        bob run
            --mode agent
            --format stream-json
            --workspace <workspace_path>
            --max-cost <NOTPRODREADY_BOB_MAX_COST>
            --max-turns <NOTPRODREADY_BOB_MAX_TURNS>
            "<prompt>"

    PRODUCTION NOTE: Run this inside an isolated container. The subprocess
    inherits the process environment; harden appropriately before production use.
    """

    def __init__(self, config=None) -> None:
        self._cfg = config or bob_shell_config

    # ── Public interface ──────────────────────────────────────────────────────

    def build_command(self, workspace: Path, prompt: str) -> list[str]:
        """Return the Bob Shell command as a safe argument list.

        Uses an argument list (not a shell string) so there is no injection risk
        from workspace paths or the prompt string.
        """
        return [
            self._cfg.executable,
            "run",
            "--trust",
            "--accept-license",
            "--mode", "agent",
            "--format", "stream-json",
            "--workspace", str(workspace.resolve()),
            "--max-cost", str(self._cfg.max_cost),
            "--max-turns", str(self._cfg.max_turns),
            prompt,
        ]

    def build_finalize_command(
        self,
        task_id: str,
        workspace: Path,
        total_cost_ceiling: float,
        total_turn_ceiling: Optional[int],
    ) -> list[str]:
        """Return the finalization command that resumes an existing Bob task.

        Uses --resume <task_id> so Bob does not rerun the full analysis.
        Uses --format json (not stream-json) because we only need one final
        machine-readable response with no streaming.

        total_cost_ceiling is primary_spend + finalize_budget.  Passing the
        sum means Bob won't be blocked by its own prior spend on the task.

        total_turn_ceiling is primary_turns + finalize_additional_turns when
        result.stats.num_turns was available from the primary run.  When it is
        None, --max-turns is omitted entirely and the command is constrained
        instead with --mode ask / --disable-subagents / --disable-mcp /
        --disable-tool-groups execute so the finalizer cannot do expensive
        work beyond serialising the already-completed analysis.
        """
        cmd = [
            self._cfg.executable,
            "run",
            "--resume", task_id,
            "--trust",
            "--accept-license",
            "--format", "json",
            "--workspace", str(workspace.resolve()),
            "--max-cost", str(round(total_cost_ceiling, 4)),
        ]
        if total_turn_ceiling is not None:
            cmd += ["--max-turns", str(total_turn_ceiling)]
        else:
            # num_turns unavailable — constrain the resume to the cheapest
            # possible mode so it can only emit the already-finished result.
            cmd += [
                "--mode", "ask",
                "--disable-subagents",
                "--disable-mcp",
                "--disable-tool-groups", "execute",
            ]
        cmd.append(_FINALIZE_PROMPT)
        return cmd

    async def _run_finalization_fallback(
        self,
        analysis: Analysis,
        workspace: Path,
        task_id: str,
        primary_cost: float,
        primary_turns: Optional[int],
        primary_result_payload: dict,
        primary_agent_steps: list,
        primary_files_inspected: int,
        primary_commands_executed: int,
        primary_start_time: datetime,
        emit_event,
        seq_ref: list,
    ) -> ReleaseResult:
        """Resume the existing Bob task for one turn to get a ReleaseResult.

        This is called ONLY when the primary run succeeded (exit 0, result
        event received) but no assistant message validated as ReleaseResult.

        Never called recursively — one attempt only.

        primary_cost is the spend already recorded by the primary run
        (result.stats.session_costs).  The finalization cost ceiling is:
            primary_cost + cfg.finalize_max_cost
        so the resumed task is never immediately blocked by its own cost history.

        primary_turns is the turn count from result.stats.num_turns, or None
        when that field was absent/invalid.  When known, the turn ceiling is:
            primary_turns + cfg.finalize_max_turns
        When unknown, --max-turns is omitted and the command is constrained
        with --mode ask / --disable-subagents / --disable-mcp /
        --disable-tool-groups execute instead.

        Raises BobResultParseError if the finalization turn also fails.
        """
        cfg = self._cfg
        total_cost_ceiling = primary_cost + cfg.finalize_max_cost
        total_turn_ceiling: Optional[int] = (
            primary_turns + cfg.finalize_max_turns
            if primary_turns is not None
            else None
        )
        if total_turn_ceiling is not None:
            log.info(
                "BOB FINALIZE: resuming task_id=%s"
                " | primary_cost=%.4f | finalize_budget=%.4f | total_cost_ceiling=%.4f"
                " | primary_turns=%d | finalize_turns=%d | total_turn_ceiling=%d",
                task_id,
                primary_cost, cfg.finalize_max_cost, total_cost_ceiling,
                primary_turns, cfg.finalize_max_turns, total_turn_ceiling,
            )
        else:
            log.info(
                "BOB FINALIZE: resuming task_id=%s (num_turns unavailable — constraint mode)"
                " | primary_cost=%.4f | finalize_budget=%.4f | total_cost_ceiling=%.4f",
                task_id, primary_cost, cfg.finalize_max_cost, total_cost_ceiling,
            )

        cmd = self.build_finalize_command(task_id, workspace, total_cost_ceiling, total_turn_ceiling)
        # Log command flags only (no prompt content)
        log.info("  finalize command flags: %s", cmd[:-1])

        async def emit(event_name: str, data: dict) -> None:
            seq_ref[0] += 1
            await emit_event(AnalysisEvent(event=event_name, data=data, sequence=seq_ref[0]))

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(workspace),
            )
        except (FileNotFoundError, OSError) as exc:
            raise BobExecutableNotFoundError(
                f"Could not start Bob Shell for finalization: {exc}"
            ) from exc

        log.info("  finalize subprocess started (pid %s)", proc.pid)

        finalize_stderr_lines: list[str] = []
        finalize_assistant_messages: list[str] = []
        finalize_result_payload: Optional[dict] = None

        async def _read_fin_stderr() -> None:
            assert proc.stderr is not None
            async for line in proc.stderr:
                finalize_stderr_lines.append(line.decode(errors="replace").rstrip())

        stderr_task = asyncio.create_task(_read_fin_stderr())

        assert proc.stdout is not None

        # For --format json, Bob emits a single JSON object (not NDJSON).
        # We read all stdout then parse it.  Guard with the finalization timeout
        # (reuse the primary timeout — the finalizer should be much faster).
        try:
            stdout_bytes = await asyncio.wait_for(
                proc.stdout.read(),
                timeout=cfg.timeout_seconds,
            )
        except asyncio.TimeoutError:
            proc.kill()
            stderr_task.cancel()
            await proc.wait()
            raise BobTimeoutError(
                "Bob finalization turn exceeded the timeout."
            )
        finally:
            try:
                await stderr_task
            except asyncio.CancelledError:
                pass

        return_code = await proc.wait()
        fin_stderr_text = "\n".join(finalize_stderr_lines)
        log.info("BOB FINALIZE: exited with code %s", return_code)

        if return_code != 0:
            log.error(
                "BOB FINALIZE: non-zero exit %s | stderr: %s",
                return_code, _sanitize(fin_stderr_text[:500]),
            )
            raise BobProcessError(return_code, fin_stderr_text)

        # ── Parse --format json output ────────────────────────────────────────
        # Bob --format json emits a JSON object with a "last_message" or similar
        # field.  Try to parse as a full Bob result object first, then fall back
        # to treating the entire stdout as a ReleaseResult candidate.
        stdout_str = stdout_bytes.decode(errors="replace").strip()
        combined_output = stdout_str + "\n" + fin_stderr_text
        log.info(
            "BOB FINALIZE: stdout length=%d chars", len(stdout_str)
        )

        # ── Detect limit-reached conditions before ReleaseResult parsing ─────
        # These produce a specific, actionable message rather than a generic
        # schema-validation failure.
        if "Maximum turns limit reached" in combined_output:
            log.error("BOB FINALIZE: turn limit reached during finalization")
            raise BobResultParseError(
                "Bob finalization stopped because the configured turn limit was reached."
            )
        if "cost limit" in combined_output.lower() or "maximum cost" in combined_output.lower():
            log.error("BOB FINALIZE: cost limit reached during finalization")
            raise BobResultParseError(
                "Bob finalization stopped because the configured cost limit was reached."
            )

        end_time = datetime.now(timezone.utc)
        duration_s = (end_time - primary_start_time).total_seconds()

        kwargs = dict(
            analysis=analysis,
            result_payload=primary_result_payload,
            start_time=primary_start_time,
            agent_steps=primary_agent_steps,
            files_inspected=primary_files_inspected,
            commands_executed=primary_commands_executed,
            end_time=end_time,
            duration_s=duration_s,
        )

        # Strategy 1: stdout is a Bob result JSON object with last_message / result
        fin_json: Optional[dict] = None
        try:
            fin_json = json.loads(stdout_str)
        except (json.JSONDecodeError, ValueError):
            pass

        if isinstance(fin_json, dict):
            # Try Bob result wrapper fields
            for field in ("last_message", "result", "content"):
                raw = fin_json.get(field)
                if raw:
                    text = _flatten_content(raw)
                    if text.strip():
                        candidate = _try_parse_release_result(text, **kwargs)
                        if candidate is not None:
                            log.info("BOB FINALIZE: valid ReleaseResult from field %r", field)
                            return candidate
            # Try the whole object as a ReleaseResult (Bob might emit the JSON directly)
            candidate = _try_parse_release_result(stdout_str, **kwargs)
            if candidate is not None:
                log.info("BOB FINALIZE: valid ReleaseResult from raw stdout JSON")
                return candidate

        # Strategy 2: stdout is raw ReleaseResult JSON (no wrapper)
        if stdout_str:
            candidate = _try_parse_release_result(stdout_str, **kwargs)
            if candidate is not None:
                log.info("BOB FINALIZE: valid ReleaseResult from raw stdout text")
                return candidate

        log.error(
            "BOB FINALIZE: no valid ReleaseResult in finalization output | "
            "stdout_preview=%r | stderr=%r",
            stdout_str[:300], _sanitize(fin_stderr_text[:200]),
        )
        raise BobResultParseError(
            "Bob analysis completed, but final ReleaseResult generation failed. "
            f"Finalization output did not validate against ReleaseResult schema. "
            f"stderr: {_sanitize(fin_stderr_text[:200])}"
        )

    async def analyze(
        self,
        analysis: Analysis,
        workspace: Path,
        emit_event: EmitFn,
    ) -> ReleaseResult:
        """Run Bob Shell against the workspace and stream events back.

        Raises
        ------
        BobExecutableNotFoundError
            If the bob binary is not on PATH / not executable.
        BobProcessError
            If Bob exits with a non-zero return code.
        BobTimeoutError
            If Bob exceeds the configured wall-clock timeout.
        BobResultParseError
            If Bob's final output cannot be parsed into ReleaseResult.
        """
        cfg = self._cfg
        start_time = datetime.now(timezone.utc)

        # ── 1. Locate executable ──────────────────────────────────────────────
        executable = shutil.which(cfg.executable)
        if executable is None:
            raise BobExecutableNotFoundError(
                f"Bob Shell executable '{cfg.executable}' not found on PATH. "
                "Install Bob Shell or set NOTPRODREADY_BOB_EXECUTABLE to its full path."
            )

        # ── 2. Validate workspace is within our workspaces root ───────────────
        resolved_ws = workspace.resolve()
        if not resolved_ws.exists():
            raise ValueError(f"Workspace does not exist: {resolved_ws}")

        # Never allow an artifact from an earlier/original analysis to be reused
        # during revalidation.
        result_artifact = resolved_ws / "output" / "release-result.json"
        result_artifact.parent.mkdir(parents=True, exist_ok=True)
        result_artifact.unlink(missing_ok=True)

        # ── 3. Build command ──────────────────────────────────────────────────
        cmd = self.build_command(workspace, _BOB_PROMPT)

        # ── DIAGNOSTIC: pre-launch summary (no secrets, no prompt content) ────
        log.info("BOB RUNNER: shell")
        log.info("  executable   : %s  (resolved: %s)", cfg.executable, executable)
        log.info("  workspace    : %s", resolved_ws)
        log.info("  max_cost     : %s Bobcoins", cfg.max_cost)
        log.info("  max_turns    : %s", cfg.max_turns)
        log.info("  timeout      : %s s", cfg.timeout_seconds)
        log.info("  BOB_API_KEY  : %s", "set" if os.environ.get("BOB_API_KEY") else "NOT SET")
        # Log command flags only — positional prompt argument (last element) omitted
        safe_cmd = cmd[:-1]  # everything except the prompt
        log.info("  command flags: %s", safe_cmd)

        # ── 4. Emit started event ─────────────────────────────────────────────
        # seq_ref is a one-element list so _run_finalization_fallback can share
        # the sequence counter without a closure over a nonlocal.
        seq_ref = [0]

        async def emit(event_name: str, data: dict) -> None:
            seq_ref[0] += 1
            await emit_event(AnalysisEvent(event=event_name, data=data, sequence=seq_ref[0]))

        await emit("analysis.started", {
            "analysis_id": analysis.analysis_id,
            "application_name": analysis.application_name,
            "release_version": analysis.release_version,
            "environment": analysis.environment,
        })

        # ── 5. Start subprocess ───────────────────────────────────────────────
        log.info("  starting subprocess ...")
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(workspace),
            )
        except FileNotFoundError as exc:
            log.error("BOB SUBPROCESS: %s — %s", type(exc).__name__, _sanitize(str(exc)))
            raise BobExecutableNotFoundError(
                f"Bob Shell executable not found: {exc}"
            ) from exc
        except OSError as exc:
            log.error("BOB SUBPROCESS: %s — %s", type(exc).__name__, _sanitize(str(exc)))
            raise BobExecutableNotFoundError(
                f"Could not start Bob Shell process: {exc}"
            ) from exc
        log.info("  subprocess started (pid %s)", proc.pid)

        # ── 6. Stream stdout line-by-line ─────────────────────────────────────
        agent_steps: list[AgentStep] = []
        files_inspected = 0
        commands_executed = 0
        bob_session_id: Optional[str] = None
        bob_task_id: Optional[str] = None
        result_payload: Optional[dict] = None
        stderr_lines: list[str] = []

        async def _read_stderr() -> None:
            """Collect stderr in the background so it doesn't block stdout."""
            assert proc.stderr is not None
            async for line in proc.stderr:
                stderr_lines.append(line.decode(errors="replace").rstrip())

        stderr_task = asyncio.create_task(_read_stderr())

        assert proc.stdout is not None

        assistant_messages: list[str] = []

        async def _stream_stdout() -> None:
            nonlocal bob_session_id, bob_task_id, result_payload
            nonlocal files_inspected, commands_executed

            async for raw_line in proc.stdout:
                line_str = raw_line.decode(errors="replace").strip()
                if not line_str:
                    continue

                # Parse the JSON line
                try:
                    raw_obj = json.loads(line_str)
                except json.JSONDecodeError as exc:
                    # Non-JSON line (startup banner, etc.)
                    log.debug(
                        "BOB STREAM: non-JSON line skipped (%s: %s) — preview: %r",
                        type(exc).__name__, _sanitize(str(exc)), line_str[:120],
                    )
                    continue

                if not isinstance(raw_obj, dict):
                    continue

                # Normalise → AnalysisEvent
                bob_type_preview = raw_obj.get("type", "unknown")
                try:
                    evt, sid, rpayload = _normalize_bob_line(raw_obj, seq_ref[0] + 1)
                except Exception as exc:  # noqa: BLE001
                    log.error(
                        "BOB STREAM: normalisation failed for event type %r — %s: %s",
                        bob_type_preview, type(exc).__name__, _sanitize(str(exc)),
                    )
                    continue

                # Collect assistant messages in arrival order.
                # All are kept — _extract_result_from_bob_output searches newest-first.
                bob_type = raw_obj.get("type")
                if bob_type == "message" and raw_obj.get("role") == "assistant":
                    text = _flatten_content(raw_obj.get("content", "")).strip()
                    if text:
                        assistant_messages.append(text)

                # Capture session/task ID
                if bob_type == "session_start":
                    # backward compat — session_start carries session_id
                    if sid:
                        bob_session_id = sid
                elif bob_type == "result":
                    # task_id lives under stats.task_id in the current schema
                    stats = raw_obj.get("stats", {})
                    task_id_from_stats = stats.get("task_id") if isinstance(stats, dict) else None
                    if task_id_from_stats:
                        bob_task_id = str(task_id_from_stats)
                    elif sid:
                        # fallback: top-level id field on the result line
                        bob_task_id = sid

                # Capture tool calls for the agent activity log
                if bob_type == "tool_use":
                    # current schema: tool_name / tool_id; compat: name / id
                    tool_name = raw_obj.get("tool_name") or raw_obj.get("name", "tool")
                    tool_id = raw_obj.get("tool_id") or raw_obj.get("id", "")
                    commands_executed += 1
                    # Rough heuristic: read/list tools count as file inspections
                    if any(kw in tool_name for kw in ("read", "list", "view", "cat")):
                        files_inspected += 1
                    agent_steps.append(AgentStep(
                        id=f"BOB-{tool_id or str(commands_executed).zfill(4)}",
                        timestamp=datetime.now(timezone.utc).isoformat(),
                        action=tool_name,
                        target="",  # parameters sanitised — not forwarded
                        result="",  # filled in when tool_result arrives
                        status=AgentStepStatus.OK,
                    ))

                elif bob_type == "tool_result":
                    # current schema: status field; compat: is_error bool
                    raw_status = raw_obj.get("status")
                    if raw_status is not None:
                        is_error = (raw_status == "error")
                    else:
                        is_error = bool(raw_obj.get("is_error", False))
                    if agent_steps:
                        agent_steps[-1] = agent_steps[-1].model_copy(
                            update={
                                "status": AgentStepStatus.ERROR if is_error else AgentStepStatus.OK,
                                "result": str(raw_obj.get("output", raw_obj.get("content", "")))[:200],
                            }
                        )

                # Capture result payload
                if rpayload is not None:
                    result_payload = rpayload

                # Forward normalised event (skip None — filtered out internally)
                if evt is not None:
                    seq_ref[0] = evt.sequence
                    await emit_event(evt)

        try:
            await asyncio.wait_for(_stream_stdout(), timeout=cfg.timeout_seconds)
        except asyncio.TimeoutError:
            proc.kill()
            stderr_task.cancel()
            await proc.wait()
            raise BobTimeoutError(
                f"Bob Shell exceeded the {cfg.timeout_seconds}s timeout."
            )
        finally:
            # If stderr_task was cancelled above it will raise CancelledError
            # here — suppress it so the BobTimeoutError propagates cleanly.
            try:
                await stderr_task
            except asyncio.CancelledError:
                pass

        # ── 7. Wait for process exit ──────────────────────────────────────────
        return_code = await proc.wait()
        stderr_text = "\n".join(stderr_lines)
        log.info("BOB PROCESS: exited with code %s", return_code)

        if return_code != 0:
            last_event_type = (
                agent_steps[-1].action if agent_steps else "none"
            )
            log.error(
                "BOB PROCESS: non-zero exit %s | last tool: %s | stderr: %s",
                return_code, last_event_type, _sanitize(stderr_text[:500]),
            )
            raise BobProcessError(return_code, stderr_text)

        # ── 8. Store session / task IDs on the Analysis object ────────────────
        # We write directly to the in-memory record through the service.
        from app import services as svc
        rec = svc.get_analysis(analysis.analysis_id)
        if rec is not None:
            rec.bob_session_id = bob_session_id
            rec.bob_task_id = bob_task_id

        # ── 9. Parse final result ─────────────────────────────────────────────

        # ── 9A. Primary result source: output/release-result.json ─────────────
        artifact_result = _load_release_result_artifact(
            workspace=resolved_ws,
            analysis=analysis,
            result_payload=result_payload,
            start_time=start_time,
            agent_steps=agent_steps,
            files_inspected=files_inspected,
            commands_executed=commands_executed,
        )

        if artifact_result is not None:
            await emit(
                "analysis.completed",
                {
                    "analysis_id": analysis.analysis_id,
                    "decision": artifact_result.decision.value,
                    "score": artifact_result.readiness_score,
                },
            )
            return artifact_result

        # Artifact unavailable/invalid.
        # Fall through to the legacy assistant-message parser below.
        log.warning(
            "BOB RESULT: canonical artifact unavailable; "
            "falling back to assistant-message parsing"
        )

        if result_payload is None:
            log.error(
                "BOB RESULT: no 'result' event received | tool calls: %s | stderr: %s",
                len(agent_steps), _sanitize(stderr_text[:300]),
            )
            raise BobResultParseError(
                "Bob Shell produced no 'result' event. "
                f"stderr: {stderr_text[:500]}"
            )

        has_last_message = bool(
            result_payload.get("last_message")
            or result_payload.get("result")
            or result_payload.get("content")
        )
        log.info(
            "BOB RESULT: parsing result payload | has_last_message=%s"
            " | assistant_messages=%d",
            has_last_message, len(assistant_messages),
        )
        try:
            result = _extract_result_from_bob_output(
                result_payload=result_payload,
                analysis=analysis,
                start_time=start_time,
                agent_steps=agent_steps,
                files_inspected=files_inspected,
                commands_executed=commands_executed,
                assistant_messages=assistant_messages,
            )
        except BobResultParseError as primary_exc:
            log.error(
                "BOB RESULT: parse failed — %s: %s | has_last_message=%s"
                " | assistant_messages=%d",
                type(primary_exc).__name__, _sanitize(str(primary_exc)[:500]),
                has_last_message, len(assistant_messages),
            )
            # ── Finalization fallback ─────────────────────────────────────────
            # Conditions: primary completed (exit 0, result event), task_id known
            if not bob_task_id:
                log.error(
                    "BOB FALLBACK: skipped — no task_id captured from primary run"
                )
                raise BobResultParseError(
                    "Bob analysis completed, but no task_id was captured. "
                    "Cannot attempt finalization fallback. "
                    f"Original error: {primary_exc}"
                ) from primary_exc

            # Extract primary spend from result stats so the finalization
            # ceiling is primary_spend + incremental_budget (not just budget).
            #
            # We deliberately do NOT default to 0.0 when the value is absent:
            # a missing cost means we cannot safely compute the ceiling and must
            # refuse to run the finalizer rather than risk an immediate cost-limit
            # block (if primary actually spent >0) or an unconstrained resume.
            # Only an explicit numeric value — including 0.0 — is accepted.
            _sentinel = object()
            primary_cost: float | object = _sentinel
            if isinstance(result_payload, dict):
                stats = result_payload.get("stats") or {}
                raw_cost = stats.get("session_costs", _sentinel)
                if raw_cost is not _sentinel:
                    # Value was present — validate it is numeric
                    if isinstance(raw_cost, (int, float)) and not isinstance(raw_cost, bool):
                        primary_cost = float(raw_cost)
                    # else: present but non-numeric → leave as sentinel → error below

            if primary_cost is _sentinel:
                log.error(
                    "BOB FALLBACK: skipped — primary session cost unavailable"
                    " | task_id=%s",
                    bob_task_id,
                )
                raise BobResultParseError(
                    "Cannot safely calculate Bob finalization cost ceiling because "
                    "primary session cost is unavailable."
                ) from primary_exc

            # Extract primary turn count from result.stats.num_turns only.
            # We do NOT infer it from assistant_messages, tool calls, token
            # counts, or any other proxy — those are not reliable measures of
            # Bob's internal turn counter.  When num_turns is unavailable the
            # finalizer still runs, but --max-turns is omitted and the command
            # is constrained instead (--mode ask / --disable-subagents / etc.).
            primary_turns: Optional[int] = None
            if isinstance(result_payload, dict):
                stats_t = result_payload.get("stats") or {}
                raw_turns = stats_t.get("num_turns")
                if raw_turns is not None:
                    if isinstance(raw_turns, (int, float)) and not isinstance(raw_turns, bool):
                        primary_turns = int(raw_turns)
                        # Clamp negatives to zero (should not happen, but be safe)
                        if primary_turns < 0:
                            primary_turns = None
                    # else: present but non-numeric/bool → leave as None

            if primary_turns is not None:
                log.info(
                    "BOB FALLBACK: initiating finalization for task_id=%s"
                    " | primary_cost=%.4f | primary_turns=%d",
                    bob_task_id, primary_cost, primary_turns,
                )
            else:
                log.info(
                    "BOB FALLBACK: initiating finalization for task_id=%s"
                    " | primary_cost=%.4f | primary_turns=unavailable (constraint mode)",
                    bob_task_id, primary_cost,
                )
            await emit("analysis.synthesizing", {
                "detail": "Synthesizing release decision",
            })
            try:
                result = await self._run_finalization_fallback(
                    analysis=analysis,
                    workspace=workspace,
                    task_id=bob_task_id,
                    primary_cost=primary_cost,
                    primary_turns=primary_turns,
                    primary_result_payload=result_payload,
                    primary_agent_steps=agent_steps,
                    primary_files_inspected=files_inspected,
                    primary_commands_executed=commands_executed,
                    primary_start_time=start_time,
                    emit_event=emit_event,
                    seq_ref=seq_ref,
                )
            except BobResultParseError as fin_exc:
                log.error(
                    "BOB FALLBACK: finalization also failed — %s: %s",
                    type(fin_exc).__name__, _sanitize(str(fin_exc)[:500]),
                )
                raise fin_exc from primary_exc
            except Exception as fin_exc:
                log.error(
                    "BOB FALLBACK: unexpected error — %s: %s",
                    type(fin_exc).__name__, _sanitize(str(fin_exc)[:300]),
                )
                raise BobResultParseError(
                    "Bob analysis completed, but final ReleaseResult generation failed. "
                    f"Finalization error: {type(fin_exc).__name__}: {fin_exc}"
                ) from fin_exc

        await emit("analysis.completed", {
            "analysis_id": analysis.analysis_id,
            "decision": result.decision.value,
            "score": result.readiness_score,
        })

        return result
