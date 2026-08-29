"""Tests for Step 11: Finalization fallback.

No real Bob Shell is invoked.  No AI cost is incurred.

Tests are organised according to the Step 11 spec:
  A  — Primary stream contains valid ReleaseResult → no finalizer called.
  B  — Primary succeeds with task_id but no valid ReleaseResult → task resumed once.
  C  — Finalizer returns valid ReleaseResult → COMPLETED.
  D  — Finalizer returns invalid JSON → FAILED with useful error.
  E  — Finalizer returns valid JSON that does not match ReleaseResult → FAILED.
  F  — No task_id → do not attempt resume; fail clearly.
  G  — Finalizer cost/turn limits included in command.
  H  — Finalizer runs only once (no recursive retry).
  I  — NorthRiver sample repository + runbook reach workspace correctly.
  J  — Existing MockBobRunner tests remain unchanged/passing.

Config tests:
  K  — NOTPRODREADY_BOB_FINALIZE_MAX_COST env var is read correctly.
  L  — NOTPRODREADY_BOB_FINALIZE_MAX_TURNS env var is read correctly.
"""
from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models import Analysis, AnalysisEvent, AnalysisStatus, Decision
from app.runners.config import BobShellConfig
from app.runners.shell import (
    BobExecutableNotFoundError,
    BobProcessError,
    BobResultParseError,
    BobShellRunner,
    BobTimeoutError,
    _FINALIZE_PROMPT,
    _extract_result_from_bob_output,
    _normalize_bob_line,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_analysis(analysis_id: str = "fin-test-001") -> Analysis:
    return Analysis(
        analysis_id=analysis_id,
        application_name="NorthRiver Payments API",
        release_version="v2.4.0",
        environment="Production",
    )


async def _capture_events(runner, analysis, workspace) -> tuple[list[AnalysisEvent], object]:
    events: list[AnalysisEvent] = []

    async def capture(evt: AnalysisEvent) -> None:
        events.append(evt)

    result = await runner.analyze(analysis, workspace, capture)
    return events, result


# Minimal valid ReleaseResult JSON string (used across many tests)
_VALID_RESULT_JSON = json.dumps({
    "analysis_id": "fin-test-001",
    "app": "NorthRiver Payments API",
    "release": "v2.4.0",
    "environment": "Production",
    "decision": "NO-GO",
    "readiness_score": 61,
    "summary": {"blockers": 3, "warnings": 1, "passed": 8},
    "findings": [
        {
            "id": "F-001",
            "category": "runtime",
            "status": "BLOCK",
            "severity": "BLOCK",
            "title": "Runtime compatibility",
            "claim": "Node.js 18",
            "actual": "Node >=20",
            "evidence": [{"type": "file", "source": "package.json",
                          "value": "engines.node = >=20", "file_path": "package.json"}],
            "explanation": "Runtime mismatch.",
            "runbook": "Node.js 18",
            "repository": "Node >=20",
            "evidence_text": "package.json → engines.node",
            "evidence_file": "package.json",
        },
    ],
    "agent_activity": [],
    "metadata": {
        "id": "fin-test-001",
        "duration": "8.2 s",
        "files_inspected": 3,
        "commands_executed": 2,
        "completed_at": "2025-01-14T10:00:00Z",
    },
})


def _make_fake_process(lines: list[bytes], returncode: int = 0, stderr: bytes = b""):
    """Build a fake asyncio.Process whose stdout yields the given NDJSON lines."""
    async def _aiter_lines() -> AsyncIterator[bytes]:
        for line in lines:
            yield line

    fake_stdout = MagicMock()
    fake_stdout.__aiter__ = lambda self: _aiter_lines()

    async def _aiter_stderr() -> AsyncIterator[bytes]:
        if stderr:
            yield stderr

    fake_stderr_reader = MagicMock()
    fake_stderr_reader.__aiter__ = lambda self: _aiter_stderr()

    fake_proc = MagicMock()
    fake_proc.stdout = fake_stdout
    fake_proc.stderr = fake_stderr_reader
    fake_proc.returncode = returncode

    async def _wait():
        return returncode

    fake_proc.wait = _wait
    fake_proc.kill = MagicMock()
    return fake_proc


def _make_fake_process_bytes(stdout_bytes: bytes, returncode: int = 0, stderr: bytes = b""):
    """Build a fake process whose stdout.read() returns the given bytes (for --format json).

    stderr is iterable (for _read_fin_stderr) AND also included when checking
    combined_output for turn-limit / cost-limit strings.
    """
    _stderr_content = stderr

    async def _aiter_stderr() -> AsyncIterator[bytes]:
        if _stderr_content:
            yield _stderr_content

    fake_stderr_reader = MagicMock()
    fake_stderr_reader.__aiter__ = lambda self: _aiter_stderr()

    fake_proc = MagicMock()
    fake_proc.stderr = fake_stderr_reader
    fake_proc.returncode = returncode

    # stdout.read() must be an async method
    async def _read():
        return stdout_bytes

    fake_stdout = MagicMock()
    fake_stdout.read = _read
    fake_proc.stdout = fake_stdout

    async def _wait():
        return returncode

    fake_proc.wait = _wait
    fake_proc.kill = MagicMock()
    return fake_proc


def _primary_lines_no_result_json(task_id: str = "task-fin-001") -> list[bytes]:
    """Primary stream: assistant messages but no valid ReleaseResult anywhere."""
    return [
        b'{"type":"message","role":"user","content":"analyze"}\n',
        b'{"type":"message","role":"assistant","content":[{"type":"text","text":"Reading files..."}]}\n',
        b'{"type":"message","role":"assistant","content":[{"type":"text","text":"Done inspecting."}]}\n',
        (json.dumps({
            "type": "result",
            "status": "success",
            "stats": {
                "task_id": task_id,
                "duration_ms": 5000,
                "session_costs": 0.20,
            },
        }) + "\n").encode(),
    ]


def _primary_lines_with_valid_result(task_id: str = "task-fin-002") -> list[bytes]:
    """Primary stream: last assistant message contains a valid ReleaseResult JSON."""
    return [
        b'{"type":"message","role":"user","content":"analyze"}\n',
        f'{{"type":"message","role":"assistant","content":{json.dumps(_VALID_RESULT_JSON)}}}\n'.encode(),
        (json.dumps({
            "type": "result",
            "status": "success",
            "stats": {
                "task_id": task_id,
                "duration_ms": 5000,
                "session_costs": 0.18,
            },
        }) + "\n").encode(),
    ]


# ── A — Primary stream contains valid ReleaseResult → no finalizer ────────────

@pytest.mark.asyncio
async def test_case_a_valid_result_in_primary_no_finalizer_called(tmp_path):
    """Case A: Primary stream has a valid ReleaseResult — finalization is never started."""
    lines = _primary_lines_with_valid_result("task-case-a")
    analysis = _make_analysis("fin-case-a")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    # Register analysis so task_id write-back works
    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    primary_proc = _make_fake_process(lines, returncode=0)

    finalize_called = False

    async def mock_finalize(*args, **kwargs):
        nonlocal finalize_called
        finalize_called = True
        raise AssertionError("Finalizer must not be called when primary succeeds")

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", return_value=primary_proc):
        runner = BobShellRunner()
        runner._run_finalization_fallback = mock_finalize
        events, result = await _capture_events(runner, analysis, workspace)

    assert not finalize_called, "Finalizer must not be called when primary succeeds"
    assert result.decision == Decision.NO_GO
    assert result.readiness_score == 61

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


# ── B — Primary succeeds with task_id but no valid ReleaseResult → resume once ─

@pytest.mark.asyncio
async def test_case_b_primary_no_result_finalizer_resumed(tmp_path):
    """Case B: Primary completes with task_id but no valid ReleaseResult.
    The finalizer must be invoked exactly once with the same task_id.
    """
    task_id = "task-case-b-001"
    primary_lines = _primary_lines_no_result_json(task_id)
    analysis = _make_analysis("fin-case-b")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    primary_proc = _make_fake_process(primary_lines, returncode=0)
    # Finalizer emits valid ReleaseResult as raw JSON
    fin_proc = _make_fake_process_bytes(
        _VALID_RESULT_JSON.encode(),
        returncode=0,
    )

    call_count = [0]

    async def subprocess_factory(*cmd, **kwargs):
        call_count[0] += 1
        if call_count[0] == 1:
            return primary_proc
        return fin_proc

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=subprocess_factory):
        runner = BobShellRunner()
        events, result = await _capture_events(runner, analysis, workspace)

    # Finalizer was started (two subprocess calls total)
    assert call_count[0] == 2, f"Expected 2 subprocess calls, got {call_count[0]}"
    assert result.decision == Decision.NO_GO

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


@pytest.mark.asyncio
async def test_case_b_resume_uses_same_task_id(tmp_path):
    """Case B: The resume command must use the task_id from the primary run."""
    task_id = "task-check-resume-id"
    primary_lines = _primary_lines_no_result_json(task_id)
    analysis = _make_analysis("fin-case-b2")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    primary_proc = _make_fake_process(primary_lines, returncode=0)
    fin_proc = _make_fake_process_bytes(_VALID_RESULT_JSON.encode(), returncode=0)

    captured_cmds: list[list] = []
    call_count = [0]

    async def subprocess_factory(*cmd, **kwargs):
        captured_cmds.append(list(cmd))
        call_count[0] += 1
        if call_count[0] == 1:
            return primary_proc
        return fin_proc

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=subprocess_factory):
        runner = BobShellRunner()
        await _capture_events(runner, analysis, workspace)

    assert len(captured_cmds) == 2
    fin_cmd = captured_cmds[1]
    assert "--resume" in fin_cmd
    resume_idx = fin_cmd.index("--resume")
    assert fin_cmd[resume_idx + 1] == task_id, (
        f"Expected resume task_id={task_id!r}, got {fin_cmd[resume_idx + 1]!r}"
    )

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


# ── C — Finalizer returns valid ReleaseResult → COMPLETED ─────────────────────

@pytest.mark.asyncio
async def test_case_c_finalizer_valid_result_analysis_completed(tmp_path):
    """Case C: Finalizer returns valid ReleaseResult → analysis COMPLETED."""
    task_id = "task-case-c-001"
    primary_lines = _primary_lines_no_result_json(task_id)
    analysis = _make_analysis("fin-case-c")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    primary_proc = _make_fake_process(primary_lines, returncode=0)
    # Finalizer returns valid result wrapped in a Bob JSON response
    fin_output = json.dumps({"last_message": _VALID_RESULT_JSON})
    fin_proc = _make_fake_process_bytes(fin_output.encode(), returncode=0)

    call_count = [0]

    async def subprocess_factory(*cmd, **kwargs):
        call_count[0] += 1
        return primary_proc if call_count[0] == 1 else fin_proc

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=subprocess_factory):
        runner = BobShellRunner()
        events, result = await _capture_events(runner, analysis, workspace)

    assert result is not None
    assert result.decision == Decision.NO_GO
    assert result.readiness_score == 61

    event_names = [e.event for e in events]
    assert "analysis.completed" in event_names

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


# ── D — Finalizer returns invalid JSON → FAILED with useful error ─────────────

@pytest.mark.asyncio
async def test_case_d_finalizer_invalid_json_raises_parse_error(tmp_path):
    """Case D: Finalizer returns invalid JSON → BobResultParseError with useful message."""
    task_id = "task-case-d-001"
    primary_lines = _primary_lines_no_result_json(task_id)
    analysis = _make_analysis("fin-case-d")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    primary_proc = _make_fake_process(primary_lines, returncode=0)
    # Finalizer returns non-parseable text
    fin_proc = _make_fake_process_bytes(b"not json at all", returncode=0)

    call_count = [0]

    async def subprocess_factory(*cmd, **kwargs):
        call_count[0] += 1
        return primary_proc if call_count[0] == 1 else fin_proc

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=subprocess_factory):
        runner = BobShellRunner()
        with pytest.raises(BobResultParseError) as exc_info:
            await _capture_events(runner, analysis, workspace)

    error_str = str(exc_info.value)
    assert error_str, "Error message must not be empty"
    # The error must mention finalization failure
    assert any(
        kw in error_str.lower()
        for kw in ("finalization", "final", "generation failed", "rele")
    ), f"Error not informative enough: {error_str!r}"

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


# ── E — Finalizer returns valid JSON that does not match ReleaseResult → FAILED

@pytest.mark.asyncio
async def test_case_e_finalizer_wrong_schema_raises_parse_error(tmp_path):
    """Case E: Finalizer returns valid JSON that does not match ReleaseResult schema → FAILED."""
    task_id = "task-case-e-001"
    primary_lines = _primary_lines_no_result_json(task_id)
    analysis = _make_analysis("fin-case-e")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    primary_proc = _make_fake_process(primary_lines, returncode=0)
    # Valid JSON but wrong schema
    wrong_json = json.dumps({"not": "a release result", "missing": "required fields"})
    fin_proc = _make_fake_process_bytes(wrong_json.encode(), returncode=0)

    call_count = [0]

    async def subprocess_factory(*cmd, **kwargs):
        call_count[0] += 1
        return primary_proc if call_count[0] == 1 else fin_proc

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=subprocess_factory):
        runner = BobShellRunner()
        with pytest.raises(BobResultParseError):
            await _capture_events(runner, analysis, workspace)

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


# ── F — No task_id → do not attempt resume; fail clearly ─────────────────────

@pytest.mark.asyncio
async def test_case_f_no_task_id_no_resume_clear_error(tmp_path):
    """Case F: No task_id was captured → finalizer is NOT started; error mentions task_id."""
    # Primary stream has no task_id in stats
    primary_lines = [
        b'{"type":"message","role":"assistant","content":[{"type":"text","text":"done"}]}\n',
        b'{"type":"result","status":"success","stats":{"duration_ms":3000}}\n',
        # No task_id in stats
    ]
    analysis = _make_analysis("fin-case-f")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    primary_proc = _make_fake_process(primary_lines, returncode=0)

    subprocess_calls = [0]

    async def subprocess_factory(*cmd, **kwargs):
        subprocess_calls[0] += 1
        return primary_proc

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=subprocess_factory):
        runner = BobShellRunner()
        with pytest.raises(BobResultParseError) as exc_info:
            await _capture_events(runner, analysis, workspace)

    # Only one subprocess call (primary only, no finalization)
    assert subprocess_calls[0] == 1, (
        f"Expected only primary subprocess, got {subprocess_calls[0]} calls"
    )
    # Error must mention task_id
    error_str = str(exc_info.value).lower()
    assert "task_id" in error_str or "task" in error_str or "no task" in error_str, (
        f"Error should mention task_id. Got: {exc_info.value!r}"
    )

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


# ── G — Finalizer cost/turn limits included in command ────────────────────────

def test_case_g_finalize_command_includes_cost_and_turn_limits(tmp_path):
    """Case G: build_finalize_command includes --max-cost and --max-turns."""
    workspace = tmp_path / "ws"
    workspace.mkdir()
    runner = BobShellRunner()

    # total_cost_ceiling = primary(0.50) + budget(0.25)
    # total_turn_ceiling = primary(12) + additional(1)
    cmd = runner.build_finalize_command(
        "task-g-001", workspace, total_cost_ceiling=0.75, total_turn_ceiling=13
    )

    assert "--max-cost" in cmd, "--max-cost must be in finalize command"
    assert "--max-turns" in cmd, "--max-turns must be in finalize command"

    cost_val = float(cmd[cmd.index("--max-cost") + 1])
    turns_val = int(cmd[cmd.index("--max-turns") + 1])

    assert cost_val == 0.75, f"Expected ceiling 0.75, got {cost_val}"
    assert turns_val == 13, f"Expected turn ceiling 13, got {turns_val}"


def test_case_g_finalize_command_ceiling_is_additive(tmp_path):
    """Case G: --max-cost in the finalize command is primary_cost + budget, not just budget.

    This prevents Bob from being immediately blocked by its own prior spend.
    If primary spent 0.50 and budget is 0.25, ceiling must be 0.75, not 0.25.
    """
    workspace = tmp_path / "ws"
    workspace.mkdir()

    with patch.dict(os.environ, {"NOTPRODREADY_BOB_FINALIZE_MAX_COST": "0.25"}):
        runner = BobShellRunner()
        primary_spend = 0.50
        budget = runner._cfg.finalize_max_cost  # 0.25
        ceiling = primary_spend + budget         # 0.75

        cmd = runner.build_finalize_command(
            "task-g-ceil", workspace, total_cost_ceiling=ceiling, total_turn_ceiling=13
        )

    cost_val = float(cmd[cmd.index("--max-cost") + 1])
    assert cost_val == 0.75, (
        f"Ceiling must be primary_spend + budget = 0.75, got {cost_val}. "
        "A ceiling of 0.25 would immediately hit the limit."
    )


def test_case_g_finalize_command_uses_finalize_config(tmp_path):
    """Case G: finalize_max_turns is read from config (not primary limits)."""
    workspace = tmp_path / "ws"
    workspace.mkdir()

    with patch.dict(os.environ, {
        "NOTPRODREADY_BOB_FINALIZE_MAX_TURNS": "1",
        "NOTPRODREADY_BOB_MAX_TURNS": "50",
    }):
        runner = BobShellRunner()
        cmd = runner.build_finalize_command(
            "task-g-002", workspace, total_cost_ceiling=0.75, total_turn_ceiling=1
        )

    turns_val = int(cmd[cmd.index("--max-turns") + 1])
    assert turns_val == 1


def test_case_g_finalize_command_uses_format_json(tmp_path):
    """Case G: finalization uses --format json (not stream-json)."""
    workspace = tmp_path / "ws"
    workspace.mkdir()
    runner = BobShellRunner()

    cmd = runner.build_finalize_command(
        "task-g-003", workspace, total_cost_ceiling=0.75, total_turn_ceiling=13
    )

    assert "--format" in cmd
    fmt_idx = cmd.index("--format")
    assert cmd[fmt_idx + 1] == "json", (
        f"Finalize must use --format json, got {cmd[fmt_idx + 1]!r}"
    )


def test_case_g_finalize_command_uses_resume_flag(tmp_path):
    """Case G: finalization uses --resume <task_id>."""
    workspace = tmp_path / "ws"
    workspace.mkdir()
    runner = BobShellRunner()

    cmd = runner.build_finalize_command(
        "task-xyz-abc", workspace, total_cost_ceiling=0.75, total_turn_ceiling=13
    )

    assert "--resume" in cmd
    resume_idx = cmd.index("--resume")
    assert cmd[resume_idx + 1] == "task-xyz-abc"


def test_case_g_finalize_command_no_mode_flag(tmp_path):
    """Case G: finalize command does NOT include --mode (resume, not a new task)."""
    workspace = tmp_path / "ws"
    workspace.mkdir()
    runner = BobShellRunner()
    cmd = runner.build_finalize_command(
        "task-g-005", workspace, total_cost_ceiling=0.75, total_turn_ceiling=13
    )
    # --mode agent is only for fresh analysis tasks; resume doesn't need it
    assert "--mode" not in cmd, (
        "Finalize command must not include --mode (resume resumes existing task)"
    )


@pytest.mark.asyncio
async def test_case_g_finalize_ceiling_uses_primary_cost_from_stats(tmp_path):
    """Case G (end-to-end): --max-cost in finalize cmd = primary session_costs + budget.

    The primary result event carries session_costs=0.48.  With a finalize budget
    of 0.25 the ceiling passed to Bob must be 0.73, not 0.25.
    """
    task_id = "task-g-e2e-cost"
    # Primary stream: no valid ReleaseResult, but session_costs in stats
    primary_lines = [
        b'{"type":"message","role":"assistant","content":[{"type":"text","text":"done"}]}\n',
        (json.dumps({
            "type": "result",
            "status": "success",
            "stats": {
                "task_id": task_id,
                "duration_ms": 9000,
                "session_costs": 0.48,
            },
        }) + "\n").encode(),
    ]
    analysis = _make_analysis("fin-g-e2e-cost")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    primary_proc = _make_fake_process(primary_lines, returncode=0)
    fin_proc = _make_fake_process_bytes(_VALID_RESULT_JSON.encode(), returncode=0)

    captured_cmds: list[list] = []
    call_count = [0]

    async def subprocess_factory(*cmd, **kwargs):
        captured_cmds.append(list(cmd))
        call_count[0] += 1
        if call_count[0] == 1:
            return primary_proc
        return fin_proc

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=subprocess_factory), \
         patch.dict(os.environ, {"NOTPRODREADY_BOB_FINALIZE_MAX_COST": "0.25"}):
        runner = BobShellRunner()
        await _capture_events(runner, analysis, workspace)

    assert len(captured_cmds) == 2
    fin_cmd = captured_cmds[1]
    cost_val = float(fin_cmd[fin_cmd.index("--max-cost") + 1])
    # Must be 0.48 (primary) + 0.25 (budget) = 0.73, not 0.25
    assert abs(cost_val - 0.73) < 0.0001, (
        f"Expected ceiling 0.73 (0.48 primary + 0.25 budget), got {cost_val}"
    )

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


# ── H — Finalizer runs only once (no recursive retry) ────────────────────────

@pytest.mark.asyncio
async def test_case_h_finalizer_runs_at_most_once(tmp_path):
    """Case H: Even when finalizer fails, there is NO second finalization attempt."""
    task_id = "task-case-h-001"
    primary_lines = _primary_lines_no_result_json(task_id)
    analysis = _make_analysis("fin-case-h")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    primary_proc = _make_fake_process(primary_lines, returncode=0)
    # Finalizer returns bad JSON every time
    fin_proc_bad = _make_fake_process_bytes(b"not valid json", returncode=0)

    call_count = [0]

    async def subprocess_factory(*cmd, **kwargs):
        call_count[0] += 1
        if call_count[0] == 1:
            return primary_proc
        return fin_proc_bad

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=subprocess_factory):
        runner = BobShellRunner()
        with pytest.raises(BobResultParseError):
            await _capture_events(runner, analysis, workspace)

    # Exactly 2 calls total: primary + one finalization attempt
    assert call_count[0] == 2, (
        f"Expected exactly 2 subprocess calls (primary + one finalizer). "
        f"Got {call_count[0]}."
    )

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


@pytest.mark.asyncio
async def test_case_h_no_recursive_retry_on_validation_error(tmp_path):
    """Case H: BobResultParseError from finalizer propagates; no third subprocess."""
    task_id = "task-case-h2-001"
    primary_lines = _primary_lines_no_result_json(task_id)
    analysis = _make_analysis("fin-case-h2")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    primary_proc = _make_fake_process(primary_lines, returncode=0)
    # Finalizer returns valid-schema-but-wrong JSON
    wrong_json = json.dumps({"status": "incomplete"})
    fin_proc = _make_fake_process_bytes(wrong_json.encode(), returncode=0)

    call_count = [0]

    async def subprocess_factory(*cmd, **kwargs):
        call_count[0] += 1
        if call_count[0] == 1:
            return primary_proc
        return fin_proc

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=subprocess_factory):
        runner = BobShellRunner()
        with pytest.raises(BobResultParseError):
            await _capture_events(runner, analysis, workspace)

    assert call_count[0] == 2, (
        f"Expected 2 total calls (primary + single finalizer). Got {call_count[0]}."
    )

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


# ── I — NorthRiver sample → workspace ─────────────────────────────────────────

def test_case_i_northriver_sample_populates_repository(tmp_path):
    """Case I: NorthRiver sample places files under workspace/repository/."""
    from app.services.analyses import load_northriver_sample

    workspace = tmp_path / "ws"
    workspace.mkdir()
    (workspace / "repository").mkdir()
    (workspace / "documents").mkdir()

    load_northriver_sample(workspace)

    repo_dir = workspace / "repository"
    doc_dir = workspace / "documents"

    assert repo_dir.exists(), "repository/ must exist after sample load"
    assert doc_dir.exists(), "documents/ must exist after sample load"

    # At least one file must be in the repository
    repo_files = list(repo_dir.iterdir())
    assert repo_files, "repository/ must contain at least one file"


def test_case_i_northriver_sample_has_runbook(tmp_path):
    """Case I: NorthRiver sample places deployment-runbook.md under workspace/documents/."""
    from app.services.analyses import load_northriver_sample

    workspace = tmp_path / "ws"
    workspace.mkdir()
    (workspace / "repository").mkdir()
    (workspace / "documents").mkdir()

    load_northriver_sample(workspace)

    runbook = workspace / "documents" / "deployment-runbook.md"
    assert runbook.exists(), (
        f"deployment-runbook.md must be present at {runbook}"
    )


def test_case_i_northriver_sample_runbook_mentions_environment(tmp_path):
    """Case I: The runbook fixture contains environment information."""
    from app.services.analyses import load_northriver_sample

    workspace = tmp_path / "ws"
    workspace.mkdir()
    (workspace / "repository").mkdir()
    (workspace / "documents").mkdir()

    load_northriver_sample(workspace)

    runbook = workspace / "documents" / "deployment-runbook.md"
    content = runbook.read_text(encoding="utf-8")
    # The runbook must contain something about the target environment
    assert any(
        kw.lower() in content.lower()
        for kw in ("production", "environment", "deploy")
    ), "Runbook must mention Production environment"


def test_case_i_northriver_sample_workspace_has_correct_structure(tmp_path):
    """Case I: Workspace after sample load has repository/ and documents/ subtrees."""
    from app.services.analyses import load_northriver_sample

    workspace = tmp_path / "ws-struct"
    workspace.mkdir()
    for sub in ("repository", "documents", "bob", "output"):
        (workspace / sub).mkdir()

    load_northriver_sample(workspace)

    assert (workspace / "repository").is_dir()
    assert (workspace / "documents").is_dir()
    # documents must have deployment-runbook.md
    assert (workspace / "documents" / "deployment-runbook.md").exists()


def test_case_i_northriver_sample_missing_fixture_raises(tmp_path, monkeypatch):
    """Case I: FileNotFoundError if the fixture directory is missing."""
    import app.services.analyses as svc_mod

    workspace = tmp_path / "ws"
    workspace.mkdir()

    monkeypatch.setattr(svc_mod, "_NORTHRIVER_FIXTURE", tmp_path / "nonexistent-fixture")

    with pytest.raises(FileNotFoundError, match="NorthRiver sample fixture not found"):
        svc_mod.load_northriver_sample(workspace)


# ── J — Existing MockBobRunner tests remain unchanged/passing ─────────────────

@pytest.mark.asyncio
async def test_case_j_mock_runner_still_produces_northriver_nogo():
    """Case J: MockBobRunner still produces the expected NorthRiver NO-GO result."""
    import shutil as _shutil
    from app.models import Analysis, AnalysisEvent, Decision
    from app.runners.mock import MockBobRunner

    analysis = Analysis(
        analysis_id="step11-mock-check",
        application_name="NorthRiver Payments API",
        release_version="v2.4.0",
        environment="Production",
    )
    workspace = Path("/tmp/notprodready-step11-mock")
    workspace.mkdir(parents=True, exist_ok=True)

    events: list[AnalysisEvent] = []

    async def capture(e: AnalysisEvent) -> None:
        events.append(e)

    runner = MockBobRunner()
    result = await runner.analyze(analysis, workspace, capture)

    assert result.decision == Decision.NO_GO
    assert result.readiness_score == 61
    assert result.summary.blockers == 3
    assert result.summary.warnings == 1
    assert result.summary.passed == 8

    event_names = [e.event for e in events]
    assert "analysis.started" in event_names
    assert "analysis.completed" in event_names

    _shutil.rmtree(workspace, ignore_errors=True)


# ── K — NOTPRODREADY_BOB_FINALIZE_MAX_COST env var ───────────────────────────

def test_case_k_finalize_max_cost_from_env():
    with patch.dict(os.environ, {"NOTPRODREADY_BOB_FINALIZE_MAX_COST": "0.10"}):
        cfg = BobShellConfig()
        assert cfg.finalize_max_cost == 0.10


def test_case_k_finalize_max_cost_default():
    env = {k: v for k, v in os.environ.items()
           if k != "NOTPRODREADY_BOB_FINALIZE_MAX_COST"}
    with patch.dict(os.environ, env, clear=True):
        cfg = BobShellConfig()
        assert cfg.finalize_max_cost == 0.25


def test_case_k_finalize_max_cost_invalid_falls_back():
    with patch.dict(os.environ, {"NOTPRODREADY_BOB_FINALIZE_MAX_COST": "oops"}):
        cfg = BobShellConfig()
        assert cfg.finalize_max_cost == 0.25


# ── L — NOTPRODREADY_BOB_FINALIZE_MAX_TURNS env var ─────────────────────────

def test_case_l_finalize_max_turns_from_env():
    with patch.dict(os.environ, {"NOTPRODREADY_BOB_FINALIZE_MAX_TURNS": "2"}):
        cfg = BobShellConfig()
        assert cfg.finalize_max_turns == 2


def test_case_l_finalize_max_turns_default():
    env = {k: v for k, v in os.environ.items()
           if k != "NOTPRODREADY_BOB_FINALIZE_MAX_TURNS"}
    with patch.dict(os.environ, env, clear=True):
        cfg = BobShellConfig()
        assert cfg.finalize_max_turns == 1


def test_case_l_finalize_max_turns_invalid_falls_back():
    with patch.dict(os.environ, {"NOTPRODREADY_BOB_FINALIZE_MAX_TURNS": "bad"}):
        cfg = BobShellConfig()
        assert cfg.finalize_max_turns == 1


# ── Finalize prompt test ──────────────────────────────────────────────────────

def test_finalize_prompt_does_not_invoke_analysis():
    """_FINALIZE_PROMPT must not request a new analysis — it is a resume-only prompt."""
    prompt = _FINALIZE_PROMPT
    assert "JSON" in prompt, "_FINALIZE_PROMPT must mention JSON"
    assert "analysis already completed" in prompt, (
        "_FINALIZE_PROMPT must reference the already-completed analysis"
    )
    # Must not open with "analyze the repository" as a direct instruction.
    # Negations like "do not re-analyze the repository" are acceptable.
    lower = prompt.lower()
    assert not (lower.startswith("analyze") or "please analyze" in lower), (
        "_FINALIZE_PROMPT must not start with an analysis instruction"
    )


def test_finalize_command_prompt_is_finalize_not_analysis(tmp_path):
    """build_finalize_command uses _FINALIZE_PROMPT, not _BOB_PROMPT."""
    from app.runners.shell import _BOB_PROMPT

    workspace = tmp_path / "ws"
    workspace.mkdir()
    runner = BobShellRunner()
    cmd = runner.build_finalize_command(
        "task-prompt-check", workspace, total_cost_ceiling=0.75, total_turn_ceiling=13
    )

    # The prompt (last element) must be the finalization prompt
    assert cmd[-1] == _FINALIZE_PROMPT
    assert cmd[-1] != _BOB_PROMPT, (
        "Finalize command must use _FINALIZE_PROMPT, not _BOB_PROMPT"
    )


# ── Synthesizing event emitted during fallback ────────────────────────────────

@pytest.mark.asyncio
async def test_synthesizing_event_emitted_during_fallback(tmp_path):
    """analysis.synthesizing event must be emitted when finalization fallback is triggered."""
    task_id = "task-synth-event-001"
    primary_lines = _primary_lines_no_result_json(task_id)
    analysis = _make_analysis("fin-synth-event")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    primary_proc = _make_fake_process(primary_lines, returncode=0)
    fin_proc = _make_fake_process_bytes(_VALID_RESULT_JSON.encode(), returncode=0)

    call_count = [0]

    async def subprocess_factory(*cmd, **kwargs):
        call_count[0] += 1
        return primary_proc if call_count[0] == 1 else fin_proc

    events: list[AnalysisEvent] = []

    async def capture(evt: AnalysisEvent) -> None:
        events.append(evt)

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=subprocess_factory):
        runner = BobShellRunner()
        await runner.analyze(analysis, workspace, capture)

    event_names = [e.event for e in events]
    assert "analysis.synthesizing" in event_names, (
        f"analysis.synthesizing must be emitted during fallback. "
        f"Got events: {event_names}"
    )

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


# ── Primary-cost safety tests (A–E) ──────────────────────────────────────────
# Verify that the finalization fallback handles session_costs edge-cases safely.

def _primary_lines_with_stats(task_id: str, stats: dict) -> list[bytes]:
    """Primary lines that carry arbitrary stats (no valid ReleaseResult)."""
    return [
        b'{"type":"message","role":"assistant","content":[{"type":"text","text":"done"}]}\n',
        (json.dumps({
            "type": "result",
            "status": "success",
            "stats": {"task_id": task_id, **stats},
        }) + "\n").encode(),
    ]


@pytest.mark.asyncio
async def test_primary_cost_zero_finalizer_runs(tmp_path):
    """A. session_costs = 0.0 (explicit) → finalizer is allowed to run."""
    task_id = "task-cost-zero"
    analysis = _make_analysis("cost-zero")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    primary_lines = _primary_lines_with_stats(task_id, {"session_costs": 0.0})
    primary_proc = _make_fake_process(primary_lines, returncode=0)
    fin_proc = _make_fake_process_bytes(_VALID_RESULT_JSON.encode(), returncode=0)

    call_count = [0]

    async def subprocess_factory(*cmd, **kwargs):
        call_count[0] += 1
        return primary_proc if call_count[0] == 1 else fin_proc

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=subprocess_factory):
        runner = BobShellRunner()
        result = await runner.analyze(analysis, workspace, AsyncMock())

    assert call_count[0] == 2, "Finalizer must run when session_costs is explicitly 0.0"
    assert result.decision == Decision.NO_GO

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


@pytest.mark.asyncio
async def test_primary_cost_zero_ceiling_is_budget_only(tmp_path):
    """A. session_costs = 0.0 → --max-cost in finalize cmd = 0.0 + budget."""
    task_id = "task-cost-zero-ceil"
    analysis = _make_analysis("cost-zero-ceil")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    primary_lines = _primary_lines_with_stats(task_id, {"session_costs": 0.0})
    primary_proc = _make_fake_process(primary_lines, returncode=0)
    fin_proc = _make_fake_process_bytes(_VALID_RESULT_JSON.encode(), returncode=0)

    captured_cmds: list[list] = []
    call_count = [0]

    async def subprocess_factory(*cmd, **kwargs):
        captured_cmds.append(list(cmd))
        call_count[0] += 1
        return primary_proc if call_count[0] == 1 else fin_proc

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=subprocess_factory), \
         patch.dict(os.environ, {"NOTPRODREADY_BOB_FINALIZE_MAX_COST": "0.25"}):
        runner = BobShellRunner()
        await runner.analyze(analysis, workspace, AsyncMock())

    fin_cmd = captured_cmds[1]
    cost_val = float(fin_cmd[fin_cmd.index("--max-cost") + 1])
    assert abs(cost_val - 0.25) < 0.0001, (
        f"With session_costs=0.0 ceiling must equal budget 0.25, got {cost_val}"
    )

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


@pytest.mark.asyncio
async def test_primary_cost_missing_skips_finalizer(tmp_path):
    """B. session_costs missing → finalizer NOT invoked; explicit error."""
    task_id = "task-cost-missing"
    analysis = _make_analysis("cost-missing")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    # stats dict has no session_costs key at all
    primary_lines = _primary_lines_with_stats(task_id, {"duration_ms": 5000})
    primary_proc = _make_fake_process(primary_lines, returncode=0)

    subprocess_calls = [0]

    async def subprocess_factory(*cmd, **kwargs):
        subprocess_calls[0] += 1
        return primary_proc

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=subprocess_factory):
        runner = BobShellRunner()
        with pytest.raises(BobResultParseError) as exc_info:
            await runner.analyze(analysis, workspace, AsyncMock())

    assert subprocess_calls[0] == 1, "Finalizer subprocess must NOT be started"
    assert "primary session cost is unavailable" in str(exc_info.value), (
        f"Expected unavailability message, got: {exc_info.value!r}"
    )

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


@pytest.mark.asyncio
async def test_primary_cost_null_skips_finalizer(tmp_path):
    """C. session_costs = null → finalizer NOT invoked; explicit error."""
    task_id = "task-cost-null"
    analysis = _make_analysis("cost-null")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    # session_costs explicitly set to None (JSON null)
    primary_lines = _primary_lines_with_stats(task_id, {"session_costs": None})
    primary_proc = _make_fake_process(primary_lines, returncode=0)

    subprocess_calls = [0]

    async def subprocess_factory(*cmd, **kwargs):
        subprocess_calls[0] += 1
        return primary_proc

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=subprocess_factory):
        runner = BobShellRunner()
        with pytest.raises(BobResultParseError) as exc_info:
            await runner.analyze(analysis, workspace, AsyncMock())

    assert subprocess_calls[0] == 1, "Finalizer must NOT start when session_costs is null"
    assert "primary session cost is unavailable" in str(exc_info.value), (
        f"Expected unavailability message, got: {exc_info.value!r}"
    )

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


@pytest.mark.asyncio
async def test_primary_cost_malformed_skips_finalizer(tmp_path):
    """D. session_costs malformed (string) → finalizer NOT invoked; explicit error."""
    task_id = "task-cost-malformed"
    analysis = _make_analysis("cost-malformed")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    # session_costs is a string — non-numeric
    primary_lines = _primary_lines_with_stats(task_id, {"session_costs": "unknown"})
    primary_proc = _make_fake_process(primary_lines, returncode=0)

    subprocess_calls = [0]

    async def subprocess_factory(*cmd, **kwargs):
        subprocess_calls[0] += 1
        return primary_proc

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=subprocess_factory):
        runner = BobShellRunner()
        with pytest.raises(BobResultParseError) as exc_info:
            await runner.analyze(analysis, workspace, AsyncMock())

    assert subprocess_calls[0] == 1, "Finalizer must NOT start when session_costs is malformed"
    assert "primary session cost is unavailable" in str(exc_info.value), (
        f"Expected unavailability message, got: {exc_info.value!r}"
    )

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


@pytest.mark.asyncio
async def test_primary_cost_normal_ceiling_is_sum(tmp_path):
    """E. session_costs = 0.50, budget = 0.25 → --max-cost 0.75."""
    task_id = "task-cost-normal"
    analysis = _make_analysis("cost-normal")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    primary_lines = _primary_lines_with_stats(task_id, {"session_costs": 0.50})
    primary_proc = _make_fake_process(primary_lines, returncode=0)
    fin_proc = _make_fake_process_bytes(_VALID_RESULT_JSON.encode(), returncode=0)

    captured_cmds: list[list] = []
    call_count = [0]

    async def subprocess_factory(*cmd, **kwargs):
        captured_cmds.append(list(cmd))
        call_count[0] += 1
        return primary_proc if call_count[0] == 1 else fin_proc

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=subprocess_factory), \
         patch.dict(os.environ, {"NOTPRODREADY_BOB_FINALIZE_MAX_COST": "0.25"}):
        runner = BobShellRunner()
        result = await runner.analyze(analysis, workspace, AsyncMock())

    assert len(captured_cmds) == 2
    fin_cmd = captured_cmds[1]
    cost_val = float(fin_cmd[fin_cmd.index("--max-cost") + 1])
    assert abs(cost_val - 0.75) < 0.0001, (
        f"Expected 0.50 + 0.25 = 0.75, got {cost_val}"
    )
    assert result.decision == Decision.NO_GO

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


# ── Turn-ceiling tests (A–E from Step 11 fix spec) ───────────────────────────

def _primary_lines_with_turns(task_id: str, num_turns: int, session_costs: float = 0.30) -> list[bytes]:
    """Primary lines with num_turns in stats and the given number of assistant messages."""
    lines: list[bytes] = []
    for i in range(num_turns):
        lines.append(
            (json.dumps({
                "type": "message",
                "role": "assistant",
                "content": [{"type": "text", "text": f"step {i+1}"}],
            }) + "\n").encode()
        )
    lines.append(
        (json.dumps({
            "type": "result",
            "status": "success",
            "stats": {
                "task_id": task_id,
                "num_turns": num_turns,
                "session_costs": session_costs,
                "duration_ms": 5000,
            },
        }) + "\n").encode()
    )
    return lines


@pytest.mark.asyncio
async def test_turn_ceiling_a_primary12_additional1_gives_13(tmp_path):
    """A. primary_turns=12, additional=1 → --max-turns 13."""
    task_id = "task-turn-a"
    analysis = _make_analysis("turn-a")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    primary_lines = _primary_lines_with_turns(task_id, num_turns=12)
    primary_proc = _make_fake_process(primary_lines, returncode=0)
    fin_proc = _make_fake_process_bytes(_VALID_RESULT_JSON.encode(), returncode=0)

    captured_cmds: list[list] = []
    call_count = [0]

    async def subprocess_factory(*cmd, **kwargs):
        captured_cmds.append(list(cmd))
        call_count[0] += 1
        return primary_proc if call_count[0] == 1 else fin_proc

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=subprocess_factory), \
         patch.dict(os.environ, {"NOTPRODREADY_BOB_FINALIZE_MAX_TURNS": "1"}):
        runner = BobShellRunner()
        await _capture_events(runner, analysis, workspace)

    assert len(captured_cmds) == 2
    fin_cmd = captured_cmds[1]
    turns_val = int(fin_cmd[fin_cmd.index("--max-turns") + 1])
    assert turns_val == 13, (
        f"Expected 12 primary + 1 additional = 13, got {turns_val}"
    )

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


@pytest.mark.asyncio
async def test_turn_ceiling_b_primary4_additional2_gives_6(tmp_path):
    """B. primary_turns=4, additional=2 → --max-turns 6."""
    task_id = "task-turn-b"
    analysis = _make_analysis("turn-b")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    primary_lines = _primary_lines_with_turns(task_id, num_turns=4)
    primary_proc = _make_fake_process(primary_lines, returncode=0)
    fin_proc = _make_fake_process_bytes(_VALID_RESULT_JSON.encode(), returncode=0)

    captured_cmds: list[list] = []
    call_count = [0]

    async def subprocess_factory(*cmd, **kwargs):
        captured_cmds.append(list(cmd))
        call_count[0] += 1
        return primary_proc if call_count[0] == 1 else fin_proc

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=subprocess_factory), \
         patch.dict(os.environ, {"NOTPRODREADY_BOB_FINALIZE_MAX_TURNS": "2"}):
        runner = BobShellRunner()
        await _capture_events(runner, analysis, workspace)

    assert len(captured_cmds) == 2
    fin_cmd = captured_cmds[1]
    turns_val = int(fin_cmd[fin_cmd.index("--max-turns") + 1])
    assert turns_val == 6, (
        f"Expected 4 primary + 2 additional = 6, got {turns_val}"
    )

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


@pytest.mark.asyncio
async def test_turn_ceiling_c_primary0_additional1_gives_1(tmp_path):
    """C. primary_turns explicitly 0, additional=1 → --max-turns 1."""
    task_id = "task-turn-c"
    analysis = _make_analysis("turn-c")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    # 0 assistant messages, num_turns=0 in stats
    primary_lines = _primary_lines_with_turns(task_id, num_turns=0)
    primary_proc = _make_fake_process(primary_lines, returncode=0)
    fin_proc = _make_fake_process_bytes(_VALID_RESULT_JSON.encode(), returncode=0)

    captured_cmds: list[list] = []
    call_count = [0]

    async def subprocess_factory(*cmd, **kwargs):
        captured_cmds.append(list(cmd))
        call_count[0] += 1
        return primary_proc if call_count[0] == 1 else fin_proc

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=subprocess_factory), \
         patch.dict(os.environ, {"NOTPRODREADY_BOB_FINALIZE_MAX_TURNS": "1"}):
        runner = BobShellRunner()
        await _capture_events(runner, analysis, workspace)

    assert len(captured_cmds) == 2
    fin_cmd = captured_cmds[1]
    turns_val = int(fin_cmd[fin_cmd.index("--max-turns") + 1])
    assert turns_val == 1, (
        f"Expected 0 primary + 1 additional = 1, got {turns_val}"
    )

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


@pytest.mark.asyncio
async def test_turn_ceiling_c_num_turns_absent_no_max_turns_in_cmd(tmp_path):
    """C. num_turns absent from stats → --max-turns must NOT appear in finalize command."""
    task_id = "task-turn-absent"
    analysis = _make_analysis("turn-absent")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    # Many assistant messages, but NO num_turns in stats
    primary_lines = [
        b'{"type":"message","role":"assistant","content":[{"type":"text","text":"a"}]}\n',
        b'{"type":"message","role":"assistant","content":[{"type":"text","text":"b"}]}\n',
        b'{"type":"message","role":"assistant","content":[{"type":"text","text":"c"}]}\n',
        (json.dumps({
            "type": "result",
            "status": "success",
            "stats": {
                "task_id": task_id,
                "session_costs": 0.20,
                # no num_turns — must NOT be inferred from assistant messages
            },
        }) + "\n").encode(),
    ]
    primary_proc = _make_fake_process(primary_lines, returncode=0)
    fin_proc = _make_fake_process_bytes(_VALID_RESULT_JSON.encode(), returncode=0)

    captured_cmds: list[list] = []
    call_count = [0]

    async def subprocess_factory(*cmd, **kwargs):
        captured_cmds.append(list(cmd))
        call_count[0] += 1
        return primary_proc if call_count[0] == 1 else fin_proc

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=subprocess_factory):
        runner = BobShellRunner()
        await _capture_events(runner, analysis, workspace)

    assert len(captured_cmds) == 2
    fin_cmd = captured_cmds[1]
    assert "--max-turns" not in fin_cmd, (
        f"--max-turns must NOT appear when num_turns is unavailable. cmd={fin_cmd}"
    )
    # Must not use assistant-message count (3) as a turn proxy
    for arg in fin_cmd:
        if arg.isdigit() and int(arg) in (3, 4):
            # If 3 or 4 appears as --max-turns value that would be wrong;
            # but since --max-turns is absent entirely this is just a guard.
            pass

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


@pytest.mark.asyncio
async def test_turn_ceiling_e_bob_returns_turn_limit_message(tmp_path):
    """E. Bob returns 'Maximum turns limit reached' → specific turn-limit error."""
    task_id = "task-turn-limit-msg"
    analysis = _make_analysis("turn-limit-msg")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    primary_lines = _primary_lines_no_result_json(task_id)
    primary_proc = _make_fake_process(primary_lines, returncode=0)
    # Finalizer stdout contains the turn-limit message
    fin_output = b"Maximum turns limit reached: 1\n"
    fin_proc = _make_fake_process_bytes(fin_output, returncode=0)

    call_count = [0]

    async def subprocess_factory(*cmd, **kwargs):
        call_count[0] += 1
        return primary_proc if call_count[0] == 1 else fin_proc

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=subprocess_factory):
        runner = BobShellRunner()
        with pytest.raises(BobResultParseError) as exc_info:
            await _capture_events(runner, analysis, workspace)

    error_str = str(exc_info.value)
    assert "turn limit" in error_str.lower(), (
        f"Expected turn-limit-specific error, got: {error_str!r}"
    )
    assert "schema" not in error_str.lower(), (
        f"Error must NOT say 'schema', got: {error_str!r}"
    )

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


@pytest.mark.asyncio
async def test_turn_ceiling_e_turn_limit_in_stderr(tmp_path):
    """E variant. 'Maximum turns limit reached' in stderr → same turn-limit error."""
    task_id = "task-turn-limit-stderr"
    analysis = _make_analysis("turn-limit-stderr")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    primary_lines = _primary_lines_no_result_json(task_id)
    primary_proc = _make_fake_process(primary_lines, returncode=0)
    # Turn-limit message in stderr, empty stdout
    fin_proc = _make_fake_process_bytes(
        b"",
        returncode=0,
        stderr=b"Maximum turns limit reached: 1\n",
    )

    call_count = [0]

    async def subprocess_factory(*cmd, **kwargs):
        call_count[0] += 1
        return primary_proc if call_count[0] == 1 else fin_proc

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=subprocess_factory):
        runner = BobShellRunner()
        with pytest.raises(BobResultParseError) as exc_info:
            await _capture_events(runner, analysis, workspace)

    assert "turn limit" in str(exc_info.value).lower()

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


@pytest.mark.asyncio
async def test_turn_ceiling_f_cost_calculation_preserved(tmp_path):
    """F. Additive cost calculation is preserved with the turn fix in place."""
    task_id = "task-turn-f-cost"
    analysis = _make_analysis("turn-f-cost")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    # 5 turns, session_costs=0.40
    primary_lines = _primary_lines_with_turns(task_id, num_turns=5, session_costs=0.40)
    primary_proc = _make_fake_process(primary_lines, returncode=0)
    fin_proc = _make_fake_process_bytes(_VALID_RESULT_JSON.encode(), returncode=0)

    captured_cmds: list[list] = []
    call_count = [0]

    async def subprocess_factory(*cmd, **kwargs):
        captured_cmds.append(list(cmd))
        call_count[0] += 1
        return primary_proc if call_count[0] == 1 else fin_proc

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=subprocess_factory), \
         patch.dict(os.environ, {
             "NOTPRODREADY_BOB_FINALIZE_MAX_COST": "0.25",
             "NOTPRODREADY_BOB_FINALIZE_MAX_TURNS": "1",
         }):
        runner = BobShellRunner()
        await _capture_events(runner, analysis, workspace)

    fin_cmd = captured_cmds[1]
    cost_val = float(fin_cmd[fin_cmd.index("--max-cost") + 1])
    turns_val = int(fin_cmd[fin_cmd.index("--max-turns") + 1])

    assert abs(cost_val - 0.65) < 0.0001, f"Expected 0.40 + 0.25 = 0.65, got {cost_val}"
    assert turns_val == 6, f"Expected 5 + 1 = 6, got {turns_val}"

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


# ── Turn-ceiling tests: absent/null/malformed/constraint (new spec A–I) ───────

def _primary_lines_with_stat_turns_value(task_id: str, turns_value, session_costs: float = 0.20) -> list[bytes]:
    """Primary lines carrying an arbitrary turns value (may be None/string/etc.)."""
    stats: dict = {
        "task_id": task_id,
        "session_costs": session_costs,
        "duration_ms": 3000,
    }
    if turns_value is not _ABSENT:
        stats["num_turns"] = turns_value
    return [
        b'{"type":"message","role":"assistant","content":[{"type":"text","text":"x"}]}\n',
        (json.dumps({
            "type": "result",
            "status": "success",
            "stats": stats,
        }) + "\n").encode(),
    ]

# Sentinel for "key not present at all"
class _AbsentType:
    pass
_ABSENT = _AbsentType()


def _primary_lines_no_num_turns(task_id: str, assistant_count: int = 1, session_costs: float = 0.20) -> list[bytes]:
    """Primary stream without num_turns in stats; assistant_count messages included."""
    lines = [
        (json.dumps({
            "type": "message",
            "role": "assistant",
            "content": [{"type": "text", "text": f"msg {i}"}],
        }) + "\n").encode()
        for i in range(assistant_count)
    ]
    lines.append(
        (json.dumps({
            "type": "result",
            "status": "success",
            "stats": {
                "task_id": task_id,
                "session_costs": session_costs,
                # no num_turns
            },
        }) + "\n").encode()
    )
    return lines


@pytest.mark.asyncio
async def test_new_c_num_turns_absent_omits_max_turns(tmp_path):
    """New C. num_turns key absent → --max-turns NOT in finalize cmd."""
    task_id = "task-nc-absent"
    analysis = _make_analysis("nc-absent")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    primary_proc = _make_fake_process(_primary_lines_no_num_turns(task_id), returncode=0)
    fin_proc = _make_fake_process_bytes(_VALID_RESULT_JSON.encode(), returncode=0)

    captured_cmds: list[list] = []
    call_count = [0]

    async def factory(*cmd, **kwargs):
        captured_cmds.append(list(cmd))
        call_count[0] += 1
        return primary_proc if call_count[0] == 1 else fin_proc

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=factory):
        runner = BobShellRunner()
        await _capture_events(runner, analysis, workspace)

    assert len(captured_cmds) == 2
    assert "--max-turns" not in captured_cmds[1], (
        f"--max-turns must not appear when num_turns absent. cmd={captured_cmds[1]}"
    )

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


@pytest.mark.asyncio
async def test_new_d_num_turns_null_omits_max_turns(tmp_path):
    """New D. num_turns = null → --max-turns NOT in finalize cmd."""
    task_id = "task-nd-null"
    analysis = _make_analysis("nd-null")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    # num_turns: null  → parsed as None in Python
    primary_lines = [
        b'{"type":"message","role":"assistant","content":[{"type":"text","text":"x"}]}\n',
        (json.dumps({
            "type": "result",
            "status": "success",
            "stats": {
                "task_id": task_id,
                "session_costs": 0.20,
                "num_turns": None,
            },
        }) + "\n").encode(),
    ]
    primary_proc = _make_fake_process(primary_lines, returncode=0)
    fin_proc = _make_fake_process_bytes(_VALID_RESULT_JSON.encode(), returncode=0)

    captured_cmds: list[list] = []
    call_count = [0]

    async def factory(*cmd, **kwargs):
        captured_cmds.append(list(cmd))
        call_count[0] += 1
        return primary_proc if call_count[0] == 1 else fin_proc

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=factory):
        runner = BobShellRunner()
        await _capture_events(runner, analysis, workspace)

    assert len(captured_cmds) == 2
    assert "--max-turns" not in captured_cmds[1], (
        f"--max-turns must not appear when num_turns is null. cmd={captured_cmds[1]}"
    )

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


@pytest.mark.asyncio
async def test_new_e_num_turns_malformed_omits_max_turns(tmp_path):
    """New E. num_turns = string → --max-turns NOT in finalize cmd."""
    task_id = "task-ne-mal"
    analysis = _make_analysis("ne-mal")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    primary_lines = [
        b'{"type":"message","role":"assistant","content":[{"type":"text","text":"x"}]}\n',
        (json.dumps({
            "type": "result",
            "status": "success",
            "stats": {
                "task_id": task_id,
                "session_costs": 0.20,
                "num_turns": "many",
            },
        }) + "\n").encode(),
    ]
    primary_proc = _make_fake_process(primary_lines, returncode=0)
    fin_proc = _make_fake_process_bytes(_VALID_RESULT_JSON.encode(), returncode=0)

    captured_cmds: list[list] = []
    call_count = [0]

    async def factory(*cmd, **kwargs):
        captured_cmds.append(list(cmd))
        call_count[0] += 1
        return primary_proc if call_count[0] == 1 else fin_proc

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=factory):
        runner = BobShellRunner()
        await _capture_events(runner, analysis, workspace)

    assert len(captured_cmds) == 2
    assert "--max-turns" not in captured_cmds[1], (
        f"--max-turns must not appear for malformed num_turns. cmd={captured_cmds[1]}"
    )

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


@pytest.mark.asyncio
async def test_new_f_100_assistant_messages_no_inferred_turn_count(tmp_path):
    """F. 100 assistant messages with no num_turns → NO --max-turns (no inference)."""
    task_id = "task-nf-100"
    analysis = _make_analysis("nf-100")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    primary_proc = _make_fake_process(
        _primary_lines_no_num_turns(task_id, assistant_count=100),
        returncode=0,
    )
    fin_proc = _make_fake_process_bytes(_VALID_RESULT_JSON.encode(), returncode=0)

    captured_cmds: list[list] = []
    call_count = [0]

    async def factory(*cmd, **kwargs):
        captured_cmds.append(list(cmd))
        call_count[0] += 1
        return primary_proc if call_count[0] == 1 else fin_proc

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=factory):
        runner = BobShellRunner()
        await _capture_events(runner, analysis, workspace)

    assert len(captured_cmds) == 2
    fin_cmd = captured_cmds[1]
    assert "--max-turns" not in fin_cmd, (
        f"--max-turns must never be inferred from 100 assistant messages. cmd={fin_cmd}"
    )
    # Verify 100 (or 101) does not appear as a turn argument
    if "--max-turns" in fin_cmd:
        turns_val = int(fin_cmd[fin_cmd.index("--max-turns") + 1])
        assert turns_val not in (100, 101), (
            f"--max-turns {turns_val} looks like an inferred value from assistant messages"
        )

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


@pytest.mark.asyncio
async def test_new_g_fallback_runs_at_most_once_without_num_turns(tmp_path):
    """G. Even without num_turns, fallback executes at most once."""
    task_id = "task-ng-once"
    analysis = _make_analysis("ng-once")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    primary_proc = _make_fake_process(_primary_lines_no_num_turns(task_id), returncode=0)
    # Finalizer fails with bad JSON — must not retry
    fin_proc = _make_fake_process_bytes(b"bad output", returncode=0)

    call_count = [0]

    async def factory(*cmd, **kwargs):
        call_count[0] += 1
        return primary_proc if call_count[0] == 1 else fin_proc

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=factory):
        runner = BobShellRunner()
        with pytest.raises(BobResultParseError):
            await _capture_events(runner, analysis, workspace)

    assert call_count[0] == 2, (
        f"Expected exactly 2 subprocess calls (primary + one fallback). Got {call_count[0]}."
    )

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


@pytest.mark.asyncio
async def test_new_h_additive_cost_ceiling_preserved_without_num_turns(tmp_path):
    """H. Additive cost ceiling still applied when num_turns is unavailable."""
    task_id = "task-nh-cost"
    analysis = _make_analysis("nh-cost")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    primary_proc = _make_fake_process(_primary_lines_no_num_turns(task_id, session_costs=0.42), returncode=0)
    fin_proc = _make_fake_process_bytes(_VALID_RESULT_JSON.encode(), returncode=0)

    captured_cmds: list[list] = []
    call_count = [0]

    async def factory(*cmd, **kwargs):
        captured_cmds.append(list(cmd))
        call_count[0] += 1
        return primary_proc if call_count[0] == 1 else fin_proc

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=factory), \
         patch.dict(os.environ, {"NOTPRODREADY_BOB_FINALIZE_MAX_COST": "0.25"}):
        runner = BobShellRunner()
        await _capture_events(runner, analysis, workspace)

    assert len(captured_cmds) == 2
    fin_cmd = captured_cmds[1]
    cost_val = float(fin_cmd[fin_cmd.index("--max-cost") + 1])
    assert abs(cost_val - 0.67) < 0.0001, (
        f"Expected 0.42 + 0.25 = 0.67, got {cost_val}"
    )

    del svc._analyses[analysis.analysis_id]
    del svc._event_queues[analysis.analysis_id]


def test_new_i_constraint_flags_present_when_no_num_turns(tmp_path):
    """I. When total_turn_ceiling is None, build_finalize_command includes constraint flags."""
    workspace = tmp_path / "ws"
    workspace.mkdir()
    runner = BobShellRunner()

    cmd = runner.build_finalize_command(
        "task-ni-constraint", workspace, total_cost_ceiling=0.75, total_turn_ceiling=None
    )

    assert "--max-turns" not in cmd, "--max-turns must be absent when turn ceiling is None"
    assert "--mode" in cmd
    mode_val = cmd[cmd.index("--mode") + 1]
    assert mode_val == "ask", f"Expected --mode ask, got {mode_val!r}"
    assert "--disable-subagents" in cmd
    assert "--disable-mcp" in cmd
    assert "--disable-tool-groups" in cmd
    dg_val = cmd[cmd.index("--disable-tool-groups") + 1]
    assert dg_val == "execute", f"Expected execute, got {dg_val!r}"


def test_new_i_no_constraint_flags_when_num_turns_known(tmp_path):
    """I inverse. When total_turn_ceiling is set, constraint flags must NOT appear."""
    workspace = tmp_path / "ws"
    workspace.mkdir()
    runner = BobShellRunner()

    cmd = runner.build_finalize_command(
        "task-ni-known", workspace, total_cost_ceiling=0.75, total_turn_ceiling=13
    )

    assert "--max-turns" in cmd
    assert cmd[cmd.index("--max-turns") + 1] == "13"
    assert "--disable-subagents" not in cmd
    assert "--disable-mcp" not in cmd
    assert "--disable-tool-groups" not in cmd
    # --mode must not appear (run, not ask)
    assert "--mode" not in cmd
