"""BobShellRemediationRunner — invokes real IBM Bob for remediation.

Uses --resume <task_id> when available so Bob retains analysis context.
Falls back to a fresh task when no task_id was captured.

Safety notes
------------
* Only workspace/repository/ is targeted — never the NotProdReady source.
* The prompt instructs Bob to modify ONLY the workspace repository copy.
* Secrets are never forwarded in the structured output.
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

from pydantic import ValidationError

from app.models import (
    Analysis,
    AnalysisEvent,
    FileChange,
    FileChangeType,
    RemediationResult,
)
from app.runners.config import bob_shell_config
from app.runners.remediation_base import RemediationRunner, RemitEmitFn
from app.runners.shell import (
    BobExecutableNotFoundError,
    BobProcessError,
    BobResultParseError,
    BobTimeoutError,
    _sanitize,
)

log = logging.getLogger(__name__)

# ── Prompt ────────────────────────────────────────────────────────────────────

_REMEDIATE_PROMPT = (
    "Using the release analysis already completed in this task, address the "
    "confirmed BLOCK and WARN findings by modifying ONLY the files under "
    "the workspace repository/ directory. "
    "Do NOT modify the NotProdReady application source code. "
    "Do NOT remove tests to make checks pass. "
    "Do NOT invent refactors unrelated to the confirmed findings. "
    "Do NOT echo credential values. "
    "Preserve application behaviour. "
    "Document every file you change. "
    "When all targeted changes are complete, stop and return ONLY one JSON object "
    "with these exact keys: "
    "status (string), summary (string), files_changed (array of {path, change_type}), "
    "findings_addressed (array of finding IDs), findings_not_addressed (array of finding IDs), "
    "notes (string or null). "
    "No prose, no Markdown, no code fences."
)

_REMEDIATE_FRESH_PROMPT = (
    "$not-prod-ready "
    "Analyze the repository and deployment documentation in this workspace. "
    "After analysis, address ALL confirmed BLOCK and WARN findings by modifying "
    "ONLY the files under the workspace repository/ directory. "
    "Do NOT modify the NotProdReady application source code. "
    "Do NOT remove tests to make checks pass. "
    "Do NOT invent refactors unrelated to the confirmed findings. "
    "Do NOT echo credential values. "
    "Preserve application behaviour. "
    "Document every file you change. "
    "When all targeted changes are complete, stop and return ONLY one JSON object "
    "with these exact keys: "
    "status (string), summary (string), files_changed (array of {path, change_type}), "
    "findings_addressed (array of finding IDs), findings_not_addressed (array of finding IDs), "
    "notes (string or null). "
    "No prose, no Markdown, no code fences."
)


class BobShellRemediationRunner(RemediationRunner):
    """Runs Bob remediation via the shell, optionally resuming an existing task."""

    def __init__(self, config=None) -> None:
        self._cfg = config or bob_shell_config

    def build_remediate_command(
        self,
        workspace: Path,
        task_id: Optional[str],
        primary_cost: Optional[float],
        primary_turns: Optional[int],
    ) -> list[str]:
        """Build the Bob command for remediation.

        If task_id is available, uses --resume to preserve analysis context.
        If not, starts a fresh task with the combined analysis+remediation prompt.
        """
        cfg = self._cfg

        if task_id:
            # Resume the existing analysis task to retain context
            total_cost = (primary_cost or 0.0) + cfg.remediate_max_cost
            cmd = [
                cfg.executable,
                "run",
                "--resume", task_id,
                "--trust",
                "--accept-license",
                "--format", "json",
                "--workspace", str(workspace.resolve()),
                "--max-cost", str(round(total_cost, 4)),
            ]
            if primary_turns is not None:
                cmd += ["--max-turns", str(primary_turns + cfg.remediate_max_turns)]
            else:
                # num_turns unknown — add constraint flags
                cmd += [
                    "--disable-subagents",
                    "--disable-mcp",
                ]
            cmd.append(_REMEDIATE_PROMPT)
        else:
            # No task_id — fresh task with combined prompt
            cmd = [
                cfg.executable,
                "run",
                "--trust",
                "--accept-license",
                "--mode", "agent",
                "--format", "json",
                "--workspace", str(workspace.resolve()),
                "--max-cost", str(cfg.remediate_max_cost),
                "--max-turns", str(cfg.remediate_max_turns),
                _REMEDIATE_FRESH_PROMPT,
            ]
        return cmd

    async def remediate(
        self,
        analysis: Analysis,
        workspace: Path,
        emit_event: RemitEmitFn,
    ) -> RemediationResult:
        """Run Bob remediation and return a RemediationResult.

        Uses --resume <task_id> when the analysis captured a Bob task_id,
        otherwise starts a fresh analysis+remediation task.
        """
        cfg = self._cfg

        executable = shutil.which(cfg.executable)
        if executable is None:
            raise BobExecutableNotFoundError(
                f"Bob executable '{cfg.executable}' not found on PATH."
            )

        seq_ref = [0]

        async def emit(event_name: str, data: dict) -> None:
            seq_ref[0] += 1
            await emit_event(AnalysisEvent(event=event_name, data=data, sequence=seq_ref[0]))

        await emit("remediation.started", {
            "analysis_id": analysis.analysis_id,
            "application_name": analysis.application_name,
            "release_version": analysis.release_version,
            "environment": analysis.environment,
        })

        # Resolve Bob task context from the analysis record
        task_id: Optional[str] = analysis.bob_task_id
        primary_cost: Optional[float] = None
        primary_turns: Optional[int] = None

        # Retrieve primary cost from analysis result metadata if available
        if analysis.result is not None:
            # We don't store session_costs in ReleaseResult but we can use a safe default
            pass  # primary_cost stays None → fresh cost ceiling = remediate budget

        cmd = self.build_remediate_command(
            workspace, task_id, primary_cost, primary_turns
        )
        log.info("BOB REMEDIATE: starting | task_id=%s | workspace=%s", task_id, workspace)
        log.info("  command flags: %s", cmd[:-1])

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(workspace),
            )
        except (FileNotFoundError, OSError) as exc:
            raise BobExecutableNotFoundError(
                f"Could not start Bob for remediation: {exc}"
            ) from exc

        await emit("remediation.reviewing", {
            "detail": "IBM Bob is reviewing findings and applying targeted changes",
        })

        stderr_lines: list[str] = []

        async def _read_stderr() -> None:
            assert proc.stderr is not None
            async for line in proc.stderr:
                stderr_lines.append(line.decode(errors="replace").rstrip())

        stderr_task = asyncio.create_task(_read_stderr())

        assert proc.stdout is not None
        try:
            stdout_bytes = await asyncio.wait_for(
                proc.stdout.read(),
                timeout=cfg.timeout_seconds,
            )
        except asyncio.TimeoutError:
            proc.kill()
            stderr_task.cancel()
            await proc.wait()
            raise BobTimeoutError("Bob remediation exceeded the timeout.")
        finally:
            try:
                await stderr_task
            except asyncio.CancelledError:
                pass

        return_code = await proc.wait()
        stderr_text = "\n".join(stderr_lines)

        if return_code != 0:
            log.error("BOB REMEDIATE: exit %s | stderr: %s", return_code, _sanitize(stderr_text[:500]))
            raise BobProcessError(return_code, stderr_text)

        stdout_str = stdout_bytes.decode(errors="replace").strip()
        log.info("BOB REMEDIATE: stdout length=%d", len(stdout_str))

        await emit("remediation.validating", {
            "detail": "Validating remediation output",
        })

        # Parse Bob's remediation output
        result = _parse_remediation_output(stdout_str, stderr_text)
        await emit("remediation.completed", {
            "findings_addressed": len(result.findings_addressed),
            "files_changed": len(result.files_changed),
        })
        return result


def _parse_remediation_output(stdout_str: str, stderr_text: str) -> RemediationResult:
    """Parse Bob's remediation JSON output into a RemediationResult.

    Tries:
    1. stdout as Bob wrapper with last_message/result field
    2. stdout as raw RemediationResult JSON
    3. Fallback with empty changes (partial output)
    """
    import re

    _FENCED = re.compile(r"```(?:json)?\s*(\{.*?})\s*```", re.DOTALL)
    _BARE = re.compile(r"(\{.*})", re.DOTALL)

    def _extract_json(text: str) -> Optional[dict]:
        try:
            return json.loads(text)
        except (json.JSONDecodeError, ValueError):
            pass
        m = _FENCED.search(text)
        if m:
            try:
                return json.loads(m.group(1))
            except (json.JSONDecodeError, ValueError):
                pass
        m = _BARE.search(text)
        if m:
            try:
                return json.loads(m.group(1))
            except (json.JSONDecodeError, ValueError):
                pass
        return None

    def _dict_to_result(d: dict) -> Optional[RemediationResult]:
        try:
            # Normalise files_changed entries
            raw_files = d.get("files_changed", [])
            files: list[FileChange] = []
            for f in raw_files:
                if isinstance(f, dict):
                    ct = f.get("change_type", "modified")
                    try:
                        ct_enum = FileChangeType(ct)
                    except ValueError:
                        ct_enum = FileChangeType.MODIFIED
                    files.append(FileChange(path=str(f.get("path", "")), change_type=ct_enum))
            return RemediationResult(
                status=str(d.get("status", "completed")),
                summary=str(d.get("summary", "")),
                files_changed=files,
                findings_addressed=[str(x) for x in d.get("findings_addressed", [])],
                findings_not_addressed=[str(x) for x in d.get("findings_not_addressed", [])],
                notes=d.get("notes"),
            )
        except (ValidationError, Exception):  # noqa: BLE001
            return None

    # Strategy 1: Bob wrapper
    outer = _extract_json(stdout_str)
    if isinstance(outer, dict):
        for field in ("last_message", "result", "content"):
            raw = outer.get(field)
            if raw:
                text = raw if isinstance(raw, str) else json.dumps(raw)
                inner = _extract_json(text)
                if isinstance(inner, dict):
                    r = _dict_to_result(inner)
                    if r is not None:
                        return r
        # Try the whole object
        r = _dict_to_result(outer)
        if r is not None:
            return r

    # Strategy 2: raw JSON
    if stdout_str:
        d = _extract_json(stdout_str)
        if isinstance(d, dict):
            r = _dict_to_result(d)
            if r is not None:
                return r

    raise BobResultParseError(
        "Bob remediation completed but output did not validate as RemediationResult. "
        f"stderr: {_sanitize(stderr_text[:200])}"
    )
