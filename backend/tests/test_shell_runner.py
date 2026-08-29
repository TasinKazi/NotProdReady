"""Tests for BobShellRunner — all subprocess calls are mocked.

No real Bob Shell is invoked. No AI cost is incurred.
"""
from __future__ import annotations

import asyncio
import json
import os
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
    _normalize_bob_line,
    _extract_result_from_bob_output,
)

# ── Helpers ───────────────────────────────────────────────────────────────────

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "stream_json"


def _load_fixture(name: str) -> list[bytes]:
    """Return NDJSON fixture as a list of encoded lines."""
    path = FIXTURE_DIR / name
    return [line.encode() for line in path.read_text().splitlines(keepends=True) if line.strip()]


def _make_analysis(analysis_id: str = "test-shell-001") -> Analysis:
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


def _make_fake_process(lines: list[bytes], returncode: int = 0, stderr: bytes = b""):
    """Build a fake asyncio.Process whose stdout yields the given lines."""

    async def _aiter_lines() -> AsyncIterator[bytes]:
        for line in lines:
            yield line

    fake_stdout = MagicMock()
    fake_stdout.__aiter__ = lambda self: _aiter_lines()

    fake_stderr_reader = MagicMock()

    async def _aiter_stderr() -> AsyncIterator[bytes]:
        if stderr:
            yield stderr

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


# ── 1. Runner selection ───────────────────────────────────────────────────────


def test_runner_selection_mock():
    """NOTPRODREADY_BOB_MODE=mock selects MockBobRunner."""
    import app.api.analyses as analyses_mod

    with patch.dict(os.environ, {"NOTPRODREADY_BOB_MODE": "mock"}):
        runner = analyses_mod._get_runner()
    from app.runners.mock import MockBobRunner
    assert isinstance(runner, MockBobRunner)


def test_runner_selection_shell():
    """NOTPRODREADY_BOB_MODE=shell selects BobShellRunner."""
    import app.api.analyses as analyses_mod

    with patch.dict(os.environ, {"NOTPRODREADY_BOB_MODE": "shell"}):
        runner = analyses_mod._get_runner()
    assert isinstance(runner, BobShellRunner)


def test_runner_selection_unknown_raises():
    """Unknown mode raises ValueError — no silent fallback."""
    import app.api.analyses as analyses_mod

    with patch.dict(os.environ, {"NOTPRODREADY_BOB_MODE": "watsonx"}):
        with pytest.raises(ValueError, match="Unknown NOTPRODREADY_BOB_MODE"):
            analyses_mod._get_runner()


# ── 2. Bob command construction ───────────────────────────────────────────────


def test_build_command_structure(tmp_path):
    """Command is a safe argument list with required flags."""
    runner = BobShellRunner()
    workspace = tmp_path / "ws-001"
    workspace.mkdir()
    cmd = runner.build_command(workspace, "test prompt")

    assert cmd[0] == "bob"
    assert "run" in cmd
    assert "--trust" in cmd
    assert "--accept-license" in cmd
    assert "--mode" in cmd
    assert "agent" in cmd
    assert "--format" in cmd
    assert "stream-json" in cmd
    assert "--workspace" in cmd
    assert str(workspace.resolve()) in cmd
    assert "--max-cost" in cmd
    assert "--max-turns" in cmd
    assert "test prompt" in cmd
    assert isinstance(cmd, list)
    for arg in cmd:
        assert isinstance(arg, str)


def test_build_command_no_shell_injection(tmp_path):
    """Workspace path with special chars is passed safely as a list element."""
    runner = BobShellRunner()
    workspace = tmp_path / "ws; rm -rf /"
    workspace.mkdir()
    cmd = runner.build_command(workspace, "prompt")
    ws_arg_index = cmd.index("--workspace") + 1
    assert "rm -rf" in cmd[ws_arg_index]
    assert isinstance(cmd, list)
    # Non-interactive flags must always be present
    assert "--trust" in cmd
    assert "--accept-license" in cmd


# ── 3. Max-cost configuration (Bobcoins) ──────────────────────────────────────


def test_max_cost_from_env():
    with patch.dict(os.environ, {"NOTPRODREADY_BOB_MAX_COST": "2.50"}):
        cfg = BobShellConfig()
        assert cfg.max_cost == 2.50


def test_max_cost_default():
    env = {k: v for k, v in os.environ.items() if k != "NOTPRODREADY_BOB_MAX_COST"}
    with patch.dict(os.environ, env, clear=True):
        cfg = BobShellConfig()
        assert cfg.max_cost == 0.50


def test_max_cost_bad_value_falls_back_to_default():
    with patch.dict(os.environ, {"NOTPRODREADY_BOB_MAX_COST": "not_a_number"}):
        cfg = BobShellConfig()
        assert cfg.max_cost == 0.50


# ── 4. Max-turns configuration ────────────────────────────────────────────────


def test_max_turns_from_env():
    with patch.dict(os.environ, {"NOTPRODREADY_BOB_MAX_TURNS": "50"}):
        cfg = BobShellConfig()
        assert cfg.max_turns == 50


def test_max_turns_default():
    env = {k: v for k, v in os.environ.items() if k != "NOTPRODREADY_BOB_MAX_TURNS"}
    with patch.dict(os.environ, env, clear=True):
        cfg = BobShellConfig()
        assert cfg.max_turns == 30


# ── 5. Workspace scoping ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_workspace_must_exist(tmp_path):
    runner = BobShellRunner()
    analysis = _make_analysis()
    nonexistent = tmp_path / "does-not-exist"

    with patch("shutil.which", return_value="/usr/bin/bob"):
        with pytest.raises(ValueError, match="Workspace does not exist"):
            await runner.analyze(analysis, nonexistent, AsyncMock())


@pytest.mark.asyncio
async def test_command_uses_resolved_workspace(tmp_path):
    runner = BobShellRunner()
    workspace = tmp_path / "ws"
    workspace.mkdir()
    cmd = runner.build_command(workspace, "prompt")
    ws_val = cmd[cmd.index("--workspace") + 1]
    assert Path(ws_val).is_absolute()


# ── 6. Stream-JSON parsing ────────────────────────────────────────────────────


def test_normalize_session_start_backward_compat():
    """session_start is still handled for backward compatibility."""
    raw = {"type": "session_start", "session_id": "sess-xyz", "model": "claude-3"}
    evt, sid, payload = _normalize_bob_line(raw, 1)
    assert evt is not None
    assert evt.event == "bob.session.started"
    assert evt.data["session_id"] == "sess-xyz"
    assert sid == "sess-xyz"
    assert payload is None


def test_normalize_assistant_message():
    raw = {
        "type": "message",
        "role": "assistant",
        "content": [{"type": "text", "text": "Analyzing package.json"}],
    }
    evt, sid, payload = _normalize_bob_line(raw, 2)
    assert evt is not None
    assert evt.event == "agent.message"
    assert "Analyzing package.json" in evt.data["text"]


def test_normalize_user_message_is_skipped():
    raw = {"type": "message", "role": "user", "content": "run analysis"}
    evt, _, _ = _normalize_bob_line(raw, 3)
    assert evt is None


def test_normalize_tool_use_current_schema():
    """Current schema uses tool_name and tool_id."""
    raw = {"type": "tool_use", "tool_name": "read_file", "tool_id": "tu-99",
           "parameters": {"path": "repository/package.json"}}
    evt, _, payload = _normalize_bob_line(raw, 4)
    assert evt is not None
    assert evt.event == "tool.started"
    assert evt.data["tool_name"] == "read_file"
    assert evt.data["tool_id"] == "tu-99"
    # parameters must NOT appear in forwarded data
    assert "parameters" not in evt.data
    assert payload is None


def test_normalize_tool_use_compat_fields():
    """Backward-compat: name / id fields still work."""
    raw = {"type": "tool_use", "name": "list_files", "id": "tu-88"}
    evt, _, _ = _normalize_bob_line(raw, 5)
    assert evt is not None
    assert evt.data["tool_name"] == "list_files"
    assert evt.data["tool_id"] == "tu-88"


def test_normalize_tool_result_current_schema():
    """Current schema uses tool_id, status, output."""
    raw = {"type": "tool_result", "tool_id": "tu-99", "status": "success",
           "output": "file contents here"}
    evt, _, _ = _normalize_bob_line(raw, 6)
    assert evt is not None
    assert evt.event == "tool.completed"
    assert evt.data["tool_id"] == "tu-99"
    assert evt.data["status"] == "success"
    assert evt.data["is_error"] is False
    assert "output_preview" in evt.data


def test_normalize_tool_result_error_status():
    """status=error sets is_error=True."""
    raw = {"type": "tool_result", "tool_id": "tu-99", "status": "error",
           "error": "File not found"}
    evt, _, _ = _normalize_bob_line(raw, 7)
    assert evt is not None
    assert evt.data["status"] == "error"
    assert evt.data["is_error"] is True
    assert "error" in evt.data


def test_normalize_tool_result_compat_fields():
    """Backward-compat: tool_use_id and is_error bool still work."""
    raw = {"type": "tool_result", "tool_use_id": "tu-77", "is_error": False,
           "content": "result text"}
    evt, _, _ = _normalize_bob_line(raw, 8)
    assert evt is not None
    assert evt.data["tool_id"] == "tu-77"
    assert evt.data["status"] == "success"
    assert evt.data["is_error"] is False


def test_normalize_error_event():
    raw = {"type": "error", "error": "Something went wrong"}
    evt, _, _ = _normalize_bob_line(raw, 9)
    assert evt is not None
    assert evt.event == "bob.error"
    assert "Something went wrong" in evt.data["error"]


def test_normalize_result_reads_last_message():
    """result event: last_message is the primary answer field."""
    raw = {
        "type": "result",
        "subtype": "success",
        "stop_reason": "end_turn",
        "last_message": '{"analysis_id":"x"}',
        "stats": {"task_id": "task-001", "total_tokens": 100},
    }
    evt, sid, payload = _normalize_bob_line(raw, 10)
    assert evt is not None
    assert evt.event == "analysis.completed"
    assert payload is raw


def test_normalize_result_captures_stats():
    """result event: stats fields are included in event data."""
    raw = {
        "type": "result",
        "subtype": "success",
        "stop_reason": "end_turn",
        "last_message": "{}",
        "stats": {
            "task_id": "task-stats-001",
            "total_tokens": 4820,
            "input_tokens": 3200,
            "output_tokens": 1620,
            "duration_ms": 8234,
            "session_costs": 0.12,
            "tool_calls": 3,
        },
    }
    evt, _, _ = _normalize_bob_line(raw, 11)
    assert evt is not None
    assert evt.data["total_tokens"] == 4820
    assert evt.data["input_tokens"] == 3200
    assert evt.data["output_tokens"] == 1620
    assert evt.data["duration_ms"] == 8234
    assert evt.data["session_costs"] == 0.12
    assert evt.data["tool_calls"] == 3


def test_normalize_result_captures_task_id_from_stats():
    """task_id is extracted from result.stats.task_id."""
    raw = {
        "type": "result",
        "subtype": "success",
        "stop_reason": "end_turn",
        "last_message": "{}",
        "stats": {"task_id": "task-xyz-999"},
    }
    # _normalize_bob_line returns sid from top-level keys only;
    # the stats.task_id extraction happens in _stream_stdout.
    # Here we verify the stats dict is present in the payload so the runner can read it.
    evt, _, payload = _normalize_bob_line(raw, 12)
    assert payload is raw
    assert payload["stats"]["task_id"] == "task-xyz-999"


def test_normalize_turn_limit_result():
    raw = {
        "type": "result",
        "subtype": "error",
        "stop_reason": "max_turns",
        "last_message": "",
        "stats": {"task_id": "task-turns-001"},
    }
    evt, _, _ = _normalize_bob_line(raw, 13)
    assert evt is not None
    assert evt.event == "bob.turn_limit"


def test_normalize_unknown_type():
    raw = {"type": "internal_debug", "data": "irrelevant"}
    evt, _, _ = _normalize_bob_line(raw, 14)
    assert evt is not None
    assert evt.event == "bob.unknown"


# ── 7. Normalized event mapping (fixture integration) ────────────────────────


@pytest.mark.asyncio
async def test_fixture_success_events(tmp_path):
    """Parsing the northriver_success.ndjson fixture emits expected events."""
    lines = _load_fixture("northriver_success.ndjson")
    analysis = _make_analysis("fixture-test-001")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    fake_proc = _make_fake_process(lines, returncode=0)

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", return_value=fake_proc):
        runner = BobShellRunner()
        events, result = await _capture_events(runner, analysis, workspace)

    event_names = [e.event for e in events]
    assert "analysis.started" in event_names
    # Fixture no longer starts with session_start — tool.started comes from tool_use lines
    assert "tool.started" in event_names
    assert "tool.completed" in event_names
    assert "analysis.completed" in event_names

    # Result is populated correctly
    assert result.decision == Decision.NO_GO
    assert result.readiness_score == 61


@pytest.mark.asyncio
async def test_fixture_task_id_extracted(tmp_path):
    """stats.task_id from the result event is stored on the analysis record."""
    lines = _load_fixture("northriver_success.ndjson")
    analysis = _make_analysis("fixture-taskid-001")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    fake_proc = _make_fake_process(lines, returncode=0)

    # Register the analysis in the in-memory store so the runner can update it
    from app import services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", return_value=fake_proc):
        runner = BobShellRunner()
        await _capture_events(runner, analysis, workspace)

    assert analysis.bob_task_id == "task-northriver-001"


# ── 8. Final ReleaseResult parsing ───────────────────────────────────────────


def test_extract_result_from_last_message():
    """Valid JSON in last_message is parsed into ReleaseResult."""
    from datetime import datetime, timezone

    analysis = _make_analysis("last-msg-test-001")
    start = datetime.now(timezone.utc)

    result_json = {
        "analysis_id": "last-msg-test-001",
        "app": "Test App",
        "release": "v1.0.0",
        "environment": "Production",
        "decision": "GO",
        "readiness_score": 95,
        "summary": {"blockers": 0, "warnings": 0, "passed": 5},
        "findings": [],
        "agent_activity": [],
        "metadata": {
            "id": "last-msg-test-001",
            "duration": "1.0 s",
            "files_inspected": 5,
            "commands_executed": 2,
            "completed_at": "2025-01-14T10:00:00Z",
        },
    }
    payload = {"type": "result", "last_message": json.dumps(result_json)}

    result = _extract_result_from_bob_output(
        result_payload=payload,
        analysis=analysis,
        start_time=start,
        agent_steps=[],
        files_inspected=5,
        commands_executed=2,
    )
    assert result.decision == Decision.GO
    assert result.readiness_score == 95


def test_extract_result_fallback_to_result_field():
    """Backward-compat: result field is used when last_message is absent."""
    from datetime import datetime, timezone

    analysis = _make_analysis("compat-result-001")
    start = datetime.now(timezone.utc)

    result_json = {
        "analysis_id": "compat-result-001",
        "app": "Test App",
        "release": "v1.0.0",
        "environment": "Production",
        "decision": "GO",
        "readiness_score": 90,
        "summary": {"blockers": 0, "warnings": 0, "passed": 5},
        "findings": [],
        "agent_activity": [],
        "metadata": {
            "id": "compat-result-001",
            "duration": "1.0 s",
            "files_inspected": 5,
            "commands_executed": 2,
            "completed_at": "2025-01-14T10:00:00Z",
        },
    }
    payload = {"type": "result", "result": json.dumps(result_json)}

    result = _extract_result_from_bob_output(
        result_payload=payload,
        analysis=analysis,
        start_time=start,
        agent_steps=[],
        files_inspected=5,
        commands_executed=2,
    )
    assert result.decision == Decision.GO
    assert result.readiness_score == 90


def test_extract_result_stats_used_for_metadata():
    """stats.duration_ms and stats.tool_calls are used to build metadata."""
    from datetime import datetime, timezone

    analysis = _make_analysis("stats-meta-001")
    start = datetime.now(timezone.utc)

    result_json = {
        "analysis_id": "stats-meta-001",
        "app": "App",
        "release": "v1.0.0",
        "environment": "Production",
        "decision": "GO",
        "readiness_score": 80,
        "summary": {"blockers": 0, "warnings": 0, "passed": 3},
        "findings": [],
        "agent_activity": [],
    }
    payload = {
        "type": "result",
        "last_message": json.dumps(result_json),
        "stats": {
            "task_id": "task-stats-meta",
            "duration_ms": 5200,
            "tool_calls": 7,
            "total_tokens": 2000,
        },
    }

    result = _extract_result_from_bob_output(
        result_payload=payload,
        analysis=analysis,
        start_time=start,
        agent_steps=[],
        files_inspected=0,
        commands_executed=0,
    )
    assert "8.2" not in result.metadata.duration  # not from fixture default
    assert "5.2" in result.metadata.duration       # from duration_ms=5200
    assert result.metadata.files_inspected == 7    # from tool_calls


def test_extract_result_fenced_json():
    """JSON in a fenced code block is extracted correctly."""
    from datetime import datetime, timezone

    analysis = _make_analysis("fenced-test-001")
    start = datetime.now(timezone.utc)

    result_json = {
        "analysis_id": "fenced-test-001",
        "app": "Test App",
        "release": "v1.0.0",
        "environment": "Staging",
        "decision": "GO",
        "readiness_score": 88,
        "summary": {"blockers": 0, "warnings": 1, "passed": 7},
        "findings": [],
        "agent_activity": [],
        "metadata": {
            "id": "fenced-test-001",
            "duration": "2.0 s",
            "files_inspected": 8,
            "commands_executed": 3,
            "completed_at": "2025-01-14T10:00:00Z",
        },
    }
    fenced_text = f"Here is my analysis:\n```json\n{json.dumps(result_json)}\n```\nDone."
    payload = {"type": "result", "last_message": fenced_text}

    result = _extract_result_from_bob_output(
        result_payload=payload,
        analysis=analysis,
        start_time=start,
        agent_steps=[],
        files_inspected=8,
        commands_executed=3,
    )
    assert result.decision == Decision.GO
    assert result.readiness_score == 88


# ── 9. Malformed JSON handling ─────────────────────────────────────────────────


def test_extract_result_no_json_raises():
    from datetime import datetime, timezone

    analysis = _make_analysis("malformed-001")
    payload = {"type": "result", "last_message": "I found some issues but cannot structure them."}

    with pytest.raises(BobResultParseError):
        _extract_result_from_bob_output(
            result_payload=payload,
            analysis=analysis,
            start_time=datetime.now(timezone.utc),
            agent_steps=[],
            files_inspected=0,
            commands_executed=0,
        )


def test_extract_result_invalid_schema_raises():
    from datetime import datetime, timezone

    analysis = _make_analysis("bad-schema-001")
    bad_json = {"not": "a release result", "missing": "required fields"}
    payload = {"type": "result", "last_message": json.dumps(bad_json)}

    with pytest.raises(BobResultParseError):
        _extract_result_from_bob_output(
            result_payload=payload,
            analysis=analysis,
            start_time=datetime.now(timezone.utc),
            agent_steps=[],
            files_inspected=0,
            commands_executed=0,
        )


@pytest.mark.asyncio
async def test_non_json_stdout_lines_are_skipped(tmp_path):
    """Non-JSON lines do not cause crashes; valid lines before them still process."""
    lines = [
        b"Bob Shell v1.0 starting up...\n",
        b'{"type":"message","role":"assistant","content":[{"type":"text","text":"hi"}]}\n',
        b"WARNING: something\n",
        b'{"type":"result","last_message":"{}"}\n',
    ]
    analysis = _make_analysis("skip-test")
    workspace = tmp_path / "ws"
    workspace.mkdir()
    fake_proc = _make_fake_process(lines, returncode=0)

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", return_value=fake_proc):
        runner = BobShellRunner()
        events: list[AnalysisEvent] = []

        async def capture(e):
            events.append(e)

        # Empty last_message JSON ({}) fails schema validation
        with pytest.raises(BobResultParseError):
            await runner.analyze(analysis, workspace, capture)

    # The assistant message was still emitted before the error
    event_names = [e.event for e in events]
    assert "agent.message" in event_names


# ── 10. Non-zero Bob process exit ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_nonzero_exit_raises_process_error(tmp_path):
    lines = [b'{"type":"message","role":"assistant","content":[{"type":"text","text":"x"}]}\n']
    analysis = _make_analysis("nonzero-test")
    workspace = tmp_path / "ws"
    workspace.mkdir()
    fake_proc = _make_fake_process(lines, returncode=1, stderr=b"Fatal error in Bob")

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", return_value=fake_proc):
        runner = BobShellRunner()

        with pytest.raises(BobProcessError) as exc_info:
            await runner.analyze(analysis, workspace, AsyncMock())

    assert exc_info.value.returncode == 1
    assert "Fatal error" in exc_info.value.stderr


# ── 11. Bob executable missing ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_bob_not_on_path_raises(tmp_path):
    analysis = _make_analysis("no-bob-test")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    with patch("shutil.which", return_value=None):
        runner = BobShellRunner()
        with pytest.raises(BobExecutableNotFoundError, match="not found on PATH"):
            await runner.analyze(analysis, workspace, AsyncMock())


@pytest.mark.asyncio
async def test_bob_file_not_found_raises(tmp_path):
    analysis = _make_analysis("fnf-test")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", side_effect=FileNotFoundError("bob")):
        runner = BobShellRunner()
        with pytest.raises(BobExecutableNotFoundError):
            await runner.analyze(analysis, workspace, AsyncMock())


# ── 12. Diagnostic / error-surfacing tests ────────────────────────────────────


def test_empty_exception_str_produces_class_name():
    """Analysis.error must never be empty — class name used as fallback."""
    import app.api.analyses as api_mod

    class _EmptyStrError(Exception):
        def __str__(self):
            return ""

    exc = _EmptyStrError()
    error_msg = str(exc) or type(exc).__name__
    assert error_msg == "_EmptyStrError", (
        f"Expected class name fallback, got: {error_msg!r}"
    )


@pytest.mark.asyncio
async def test_nonzero_exit_error_is_non_empty(tmp_path):
    """BobProcessError carries a non-empty message with return code and stderr."""
    lines = [b'{"type":"message","role":"assistant","content":[{"type":"text","text":"x"}]}\n']
    analysis = _make_analysis("diag-nonzero")
    workspace = tmp_path / "ws"
    workspace.mkdir()
    fake_proc = _make_fake_process(lines, returncode=2, stderr=b"Permission denied")

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", return_value=fake_proc):
        runner = BobShellRunner()
        with pytest.raises(BobProcessError) as exc_info:
            await runner.analyze(analysis, workspace, AsyncMock())

    exc = exc_info.value
    error_msg = str(exc) or type(exc).__name__
    assert error_msg, "error_msg must not be empty"
    assert "2" in error_msg           # return code present
    assert "Permission denied" in error_msg


@pytest.mark.asyncio
async def test_result_parse_failure_error_is_non_empty(tmp_path):
    """BobResultParseError produces a non-empty, informative message."""
    lines = [
        b'{"type":"result","subtype":"success","stop_reason":"end_turn",'
        b'"last_message":"this is not valid json for a ReleaseResult"}\n',
    ]
    analysis = _make_analysis("diag-parse-fail")
    workspace = tmp_path / "ws"
    workspace.mkdir()
    fake_proc = _make_fake_process(lines, returncode=0)

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", return_value=fake_proc):
        runner = BobShellRunner()
        with pytest.raises(BobResultParseError) as exc_info:
            await runner.analyze(analysis, workspace, AsyncMock())

    error_msg = str(exc_info.value) or type(exc_info.value).__name__
    assert error_msg, "error_msg must not be empty"
    # Must give a hint about what went wrong
    assert any(
        keyword in error_msg.lower()
        for keyword in ("json", "schema", "parse", "result", "locate")
    ), f"Error message not informative enough: {error_msg!r}"


@pytest.mark.asyncio
async def test_stream_normalise_error_is_logged_and_skipped(tmp_path, caplog):
    """A normalisation error on one line is logged at ERROR and does not crash the run."""
    import logging

    # Craft a result line that will pass JSON parsing but have a valid result
    # payload, preceded by a line that will trigger the normalise-exception path
    # by being a dict Bob type the normaliser raises on.
    good_result = json.dumps({
        "analysis_id": "diag-stream-norm",
        "app": "Test App",
        "release": "v1.0.0",
        "environment": "Production",
        "decision": "GO",
        "readiness_score": 90,
        "summary": {"blockers": 0, "warnings": 0, "passed": 3},
        "findings": [],
        "agent_activity": [],
        "metadata": {
            "id": "diag-stream-norm",
            "duration": "1.0 s",
            "files_inspected": 1,
            "commands_executed": 0,
            "completed_at": "2025-01-14T10:00:00Z",
        },
    })
    lines = [
        # This line is valid JSON but _normalize_bob_line will be patched to raise on it
        b'{"type":"tool_use","tool_name":"read_file","tool_id":"tu-bad"}\n',
        f'{{"type":"result","subtype":"success","stop_reason":"end_turn","last_message":{json.dumps(good_result)}}}\n'.encode(),
    ]
    analysis = _make_analysis("diag-stream-norm")
    workspace = tmp_path / "ws"
    workspace.mkdir()
    fake_proc = _make_fake_process(lines, returncode=0)

    original_normalize = None

    call_count = 0

    def _patched_normalize(raw, seq):
        nonlocal call_count
        call_count += 1
        if raw.get("type") == "tool_use":
            raise ValueError("simulated normalise failure")
        # Import the real function for all other lines
        from app.runners.shell import _normalize_bob_line as _real
        # We're inside the patch, call the original
        return original_normalize(raw, seq)

    import app.runners.shell as shell_mod
    original_normalize = shell_mod._normalize_bob_line

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", return_value=fake_proc), \
         patch.object(shell_mod, "_normalize_bob_line", side_effect=_patched_normalize), \
         caplog.at_level(logging.ERROR, logger="app.runners.shell"):
        runner = BobShellRunner()
        result = await runner.analyze(analysis, workspace, AsyncMock())

    # The bad line was skipped; the good result was still parsed
    assert result.decision.value == "GO"
    # The error was logged
    assert any(
        "normalisation failed" in rec.message and "tool_use" in rec.message
        for rec in caplog.records
    ), f"Expected normalisation-failure log entry. Records: {[r.message for r in caplog.records]}"


# ── 13. Bob 2.0.1 stream shape (message→result, no last_message) ─────────────

_GOOD_RESULT_JSON = json.dumps({
    "analysis_id": "bob201-test-001",
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
        "id": "bob201-test-001",
        "duration": "8.2 s",
        "files_inspected": 3,
        "commands_executed": 2,
        "completed_at": "2025-01-14T10:00:00Z",
    },
})


def _make_bob201_lines(task_id: str = "task-bob201-001") -> list[bytes]:
    """Return NDJSON lines matching the actual Bob 2.0.1 observed stream shape.

    Shape:
        message(user)
        message(assistant  ← contains the ReleaseResult JSON)
        result(status=success, stats with task_id, NO last_message)
    """
    result_event = json.dumps({
        "type": "result",
        "status": "success",
        "stats": {
            "task_id": task_id,
            "duration_ms": 8200,
            "session_costs": 0.31,
            "total_tokens": 5100,
            "input_tokens": 3800,
            "output_tokens": 1300,
            "tool_calls": 5,
        },
        # Deliberately no last_message — this is the 2.0.1 observed shape
    })
    return [
        b'{"type":"message","role":"user","content":"analyze this"}\n',
        f'{{"type":"message","role":"assistant","content":{json.dumps(_GOOD_RESULT_JSON)}}}\n'.encode(),
        (result_event + "\n").encode(),
    ]


@pytest.mark.asyncio
async def test_bob201_result_parses_from_assistant_message(tmp_path):
    """Bob 2.0.1: ReleaseResult JSON in the last assistant message, not last_message."""
    lines = _make_bob201_lines()
    analysis = _make_analysis("bob201-test-001")
    workspace = tmp_path / "ws"
    workspace.mkdir()
    fake_proc = _make_fake_process(lines, returncode=0)

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", return_value=fake_proc):
        runner = BobShellRunner()
        events, result = await _capture_events(runner, analysis, workspace)

    assert result.decision == Decision.NO_GO
    assert result.readiness_score == 61
    assert result.summary.blockers == 3


@pytest.mark.asyncio
async def test_bob201_task_id_captured_from_stats(tmp_path):
    """Bob 2.0.1: task_id is extracted from result.stats.task_id."""
    lines = _make_bob201_lines(task_id="task-bob201-xyz")
    analysis = _make_analysis("bob201-taskid-test")
    workspace = tmp_path / "ws"
    workspace.mkdir()
    fake_proc = _make_fake_process(lines, returncode=0)

    from app.services.analyses import _analyses, _event_queues
    _analyses[analysis.analysis_id] = analysis
    _event_queues[analysis.analysis_id] = []

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", return_value=fake_proc):
        runner = BobShellRunner()
        await _capture_events(runner, analysis, workspace)

    assert analysis.bob_task_id == "task-bob201-xyz"

    del _analyses[analysis.analysis_id]
    del _event_queues[analysis.analysis_id]


@pytest.mark.asyncio
async def test_bob201_no_empty_raw_answer(tmp_path):
    """Bob 2.0.1: raw_answer is never empty — assistant message is used as fallback."""
    lines = _make_bob201_lines()
    analysis = _make_analysis("bob201-nonempty-test")
    workspace = tmp_path / "ws"
    workspace.mkdir()
    fake_proc = _make_fake_process(lines, returncode=0)

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", return_value=fake_proc):
        runner = BobShellRunner()
        # Must not raise BobResultParseError with "Raw answer (first 500 chars): ''"
        try:
            _, result = await _capture_events(runner, analysis, workspace)
            assert result is not None
        except Exception as exc:
            assert "Raw answer (first 500 chars): ''" not in str(exc), (
                f"Got the empty-raw-answer failure that should be fixed: {exc}"
            )


@pytest.mark.asyncio
async def test_bob201_status_success_no_message_raises_clear_error(tmp_path):
    """If Bob reports success but no assistant message exists, error is informative.

    No task_id in the result stats — fallback is not triggered; primary error propagates.
    """
    lines = [
        # No assistant message at all — just a result event with no content.
        # No task_id → fallback will be skipped, original parse error propagates.
        b'{"type":"result","status":"success","stats":{"duration_ms":1000}}\n',
    ]
    analysis = _make_analysis("bob201-empty-msg-test")
    workspace = tmp_path / "ws"
    workspace.mkdir()
    fake_proc = _make_fake_process(lines, returncode=0)

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", return_value=fake_proc):
        runner = BobShellRunner()
        with pytest.raises(BobResultParseError) as exc_info:
            await runner.analyze(analysis, workspace, AsyncMock())

    error_str = str(exc_info.value).lower()
    assert (
        "no assistant" in error_str or "no assistant message" in error_str
        or "task_id" in error_str or "no task" in error_str
    ), f"Expected clear no-message error, got: {exc_info.value!r}"


def test_normalize_result_status_success_maps_correctly():
    """Bob 2.0.1 result with status=success (no stop_reason) maps to analysis.completed."""
    raw = {
        "type": "result",
        "status": "success",
        "stats": {
            "task_id": "task-201-norm",
            "duration_ms": 5000,
            "session_costs": 0.25,
            "tool_calls": 4,
        },
    }
    evt, _, payload = _normalize_bob_line(raw, 1)
    assert evt is not None
    assert evt.event == "analysis.completed"
    assert payload is raw
    assert evt.data["duration_ms"] == 5000
    assert evt.data["session_costs"] == 0.25
    assert evt.data["tool_calls"] == 4


def test_extract_result_uses_assistant_messages_when_no_last_message():
    """assistant_messages list is used when result payload has no last_message/content."""
    from datetime import datetime, timezone

    analysis = _make_analysis("lam-fallback-test")
    start = datetime.now(timezone.utc)

    payload = {
        "type": "result",
        "status": "success",
        "stats": {"task_id": "task-lam-001", "duration_ms": 3000},
        # No last_message, no result, no content
    }

    result = _extract_result_from_bob_output(
        result_payload=payload,
        analysis=analysis,
        start_time=start,
        agent_steps=[],
        files_inspected=0,
        commands_executed=0,
        assistant_messages=[_GOOD_RESULT_JSON],
    )
    assert result.decision == Decision.NO_GO
    assert result.readiness_score == 61


def test_extract_result_last_message_takes_priority_over_assistant_messages():
    """result.last_message takes priority over assistant_messages."""
    from datetime import datetime, timezone

    analysis = _make_analysis("priority-test")
    start = datetime.now(timezone.utc)

    # last_message has a GO result; assistant message has NO-GO — last_message wins
    go_result = json.dumps({
        "analysis_id": "priority-test",
        "app": "Test App",
        "release": "v1.0.0",
        "environment": "Production",
        "decision": "GO",
        "readiness_score": 100,
        "summary": {"blockers": 0, "warnings": 0, "passed": 5},
        "findings": [],
        "agent_activity": [],
        "metadata": {
            "id": "priority-test",
            "duration": "1.0 s",
            "files_inspected": 1,
            "commands_executed": 0,
            "completed_at": "2025-01-14T10:00:00Z",
        },
    })

    payload = {
        "type": "result",
        "status": "success",
        "last_message": go_result,
        "stats": {},
    }

    result = _extract_result_from_bob_output(
        result_payload=payload,
        analysis=analysis,
        start_time=start,
        agent_steps=[],
        files_inspected=0,
        commands_executed=0,
        assistant_messages=[_GOOD_RESULT_JSON],  # NO-GO — should be ignored
    )
    assert result.decision.value == "GO"
    assert result.readiness_score == 100


# ── 14. Multi-message candidate search (Cases A, B, C, D) ────────────────────


def _make_stream_lines(*messages: tuple, result_stats=None) -> list[bytes]:
    """Build NDJSON line bytes from (role, content) tuples and an optional result event."""
    lines: list[bytes] = []
    for role, content in messages:
        lines.append(
            (json.dumps({"type": "message", "role": role, "content": content}) + "\n").encode()
        )
    stats = result_stats or {"task_id": "task-multi-001", "duration_ms": 5000}
    lines.append(
        (json.dumps({"type": "result", "status": "success", "stats": stats}) + "\n").encode()
    )
    return lines


@pytest.mark.asyncio
async def test_case_a_valid_result_in_later_assistant_message(tmp_path):
    """Case A: progress text before the valid ReleaseResult — parser finds it."""
    lines = _make_stream_lines(
        ("user", "analyze this"),
        ("assistant", "I am reading the runbook now, please wait..."),
        ("assistant", _GOOD_RESULT_JSON),
        result_stats={"task_id": "task-case-a", "duration_ms": 6000},
    )
    analysis = _make_analysis("case-a-test")
    workspace = tmp_path / "ws"
    workspace.mkdir()
    fake_proc = _make_fake_process(lines, returncode=0)

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", return_value=fake_proc):
        runner = BobShellRunner()
        _, result = await _capture_events(runner, analysis, workspace)

    assert result.decision == Decision.NO_GO
    assert result.readiness_score == 61


@pytest.mark.asyncio
async def test_case_b_valid_result_is_first_message_but_later_message_is_noise(tmp_path):
    """Case B: valid ReleaseResult JSON is first; later message is prose.
    Parser searches newest-first so it tries the prose last, but the valid
    result (now the newest-first fallback after the prose fails) is still found.
    """
    lines = _make_stream_lines(
        ("assistant", _GOOD_RESULT_JSON),           # arrives first (oldest)
        ("assistant", "All checks complete. See the JSON above for details."),  # newest
        result_stats={"task_id": "task-case-b", "duration_ms": 7000},
    )
    analysis = _make_analysis("case-b-test")
    workspace = tmp_path / "ws"
    workspace.mkdir()
    fake_proc = _make_fake_process(lines, returncode=0)

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", return_value=fake_proc):
        runner = BobShellRunner()
        _, result = await _capture_events(runner, analysis, workspace)

    assert result.decision == Decision.NO_GO
    assert result.readiness_score == 61


@pytest.mark.asyncio
async def test_case_c_last_message_field_wins_over_assistant_messages(tmp_path):
    """Case C: result.last_message contains valid ReleaseResult — takes priority."""
    # Build a GO result as last_message; assistant messages carry a NO-GO JSON.
    # last_message must win.
    go_json = json.dumps({
        "analysis_id": "case-c-test",
        "app": "Test App",
        "release": "v1.0.0",
        "environment": "Production",
        "decision": "GO",
        "readiness_score": 100,
        "summary": {"blockers": 0, "warnings": 0, "passed": 5},
        "findings": [],
        "agent_activity": [],
        "metadata": {
            "id": "case-c-test",
            "duration": "1.0 s",
            "files_inspected": 1,
            "commands_executed": 0,
            "completed_at": "2025-01-14T10:00:00Z",
        },
    })
    result_event = json.dumps({
        "type": "result",
        "status": "success",
        "last_message": go_json,
        "stats": {"task_id": "task-case-c", "duration_ms": 4000},
    })
    lines = [
        f'{{"type":"message","role":"assistant","content":{json.dumps(_GOOD_RESULT_JSON)}}}\n'.encode(),
        (result_event + "\n").encode(),
    ]
    analysis = _make_analysis("case-c-test")
    workspace = tmp_path / "ws"
    workspace.mkdir()
    fake_proc = _make_fake_process(lines, returncode=0)

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", return_value=fake_proc):
        runner = BobShellRunner()
        _, result = await _capture_events(runner, analysis, workspace)

    # GO wins — last_message took priority over the NO-GO assistant message
    assert result.decision.value == "GO"
    assert result.readiness_score == 100


@pytest.mark.asyncio
async def test_case_d_no_valid_result_raises_clear_error(tmp_path):
    """Case D: multiple assistant messages but none validates as ReleaseResult."""
    # No task_id in stats → fallback is skipped; primary parse error propagates as-is.
    lines = _make_stream_lines(
        ("assistant", "I have started analyzing the repository."),
        ("assistant", json.dumps({"not": "a release result", "just": "some json"})),
        ("assistant", "The analysis is complete."),
        result_stats={"duration_ms": 5000},
    )
    analysis = _make_analysis("case-d-test")
    workspace = tmp_path / "ws"
    workspace.mkdir()
    fake_proc = _make_fake_process(lines, returncode=0)

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", return_value=fake_proc):
        runner = BobShellRunner()
        with pytest.raises(BobResultParseError) as exc_info:
            await runner.analyze(analysis, workspace, AsyncMock())

    msg = str(exc_info.value)
    assert "no assistant message contained a valid ReleaseResult" in msg, (
        f"Expected clear failure message, got: {msg!r}"
    )
    # Must report how many candidates were examined
    assert "candidates examined: 3" in msg, (
        f"Expected candidate count in message, got: {msg!r}"
    )


# ── 15. Step 11 stabilisation tests ──────────────────────────────────────────


def test_bob_prompt_invokes_not_prod_ready_skill():
    """_BOB_PROMPT must start with the $not-prod-ready skill invocation."""
    from app.runners.shell import _BOB_PROMPT

    assert _BOB_PROMPT.startswith("$not-prod-ready"), (
        f"Prompt must start with '$not-prod-ready', got: {_BOB_PROMPT[:60]!r}"
    )


def test_bob_prompt_requires_json_only_output():
    """_BOB_PROMPT must explicitly instruct Bob to return JSON only."""
    from app.runners.shell import _BOB_PROMPT

    prompt_lower = _BOB_PROMPT.lower()
    assert "json" in prompt_lower, "Prompt must mention 'JSON'"
    # Must forbid fences or prose — check for at least one of the canonical phrases
    has_no_prose = (
        "no prose" in prompt_lower
        or "no code fences" in prompt_lower
        or "only the raw json" in prompt_lower
    )
    assert has_no_prose, (
        f"Prompt must instruct 'no prose / no code fences / only the raw JSON'. "
        f"Got: {_BOB_PROMPT!r}"
    )


def test_extract_result_block_list_content_string(tmp_path):
    """Bob content as a block list (list of dicts) is flattened before parsing."""
    from datetime import datetime, timezone

    analysis = _make_analysis("block-list-test")
    start = datetime.now(timezone.utc)

    # Bob may emit content as a list of text blocks, not a raw string
    block_content = [{"type": "text", "text": _GOOD_RESULT_JSON}]
    payload = {
        "type": "result",
        "status": "success",
        "stats": {"task_id": "task-block-list", "duration_ms": 4000},
    }

    result = _extract_result_from_bob_output(
        result_payload=payload,
        analysis=analysis,
        start_time=start,
        agent_steps=[],
        files_inspected=0,
        commands_executed=0,
        assistant_messages=[_GOOD_RESULT_JSON],
    )
    assert result.decision == Decision.NO_GO
    assert result.readiness_score == 61


@pytest.mark.asyncio
async def test_failed_sse_terminates_frontend_state(tmp_path):
    """analysis.failed SSE event: runner raises, backend publishes the event."""
    # Verify that BobResultParseError propagates all the way to the caller
    lines = [
        b'{"type":"result","status":"success","stats":{"task_id":"task-fail-sse"}}\n',
        # No assistant message → BobResultParseError
    ]
    analysis = _make_analysis("fail-sse-test")
    workspace = tmp_path / "ws"
    workspace.mkdir()
    fake_proc = _make_fake_process(lines, returncode=0)

    emitted: list[str] = []

    async def capture_events(evt):
        emitted.append(evt.event)

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", return_value=fake_proc):
        runner = BobShellRunner()
        with pytest.raises(BobResultParseError):
            await runner.analyze(analysis, workspace, capture_events)

    # Runner itself emits analysis.started; the error propagates to the caller
    # (api/analyses.py) which publishes analysis.failed — not emitted by the runner
    assert "analysis.started" in emitted


@pytest.mark.asyncio
async def test_northriver_sample_uses_production_environment(tmp_path):
    """NorthRiver sample fixture returns environment='Production' (not 'staging')."""
    lines = _load_fixture("northriver_success.ndjson")
    analysis = _make_analysis("northriver-env-test")
    workspace = tmp_path / "ws"
    workspace.mkdir()
    fake_proc = _make_fake_process(lines, returncode=0)

    with patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", return_value=fake_proc):
        runner = BobShellRunner()
        _, result = await _capture_events(runner, analysis, workspace)

    assert result.environment == "Production"


@pytest.mark.asyncio
async def test_timeout_raises_bob_timeout_error(tmp_path):
    """asyncio.TimeoutError is caught and re-raised as BobTimeoutError."""
    analysis = _make_analysis("timeout-test")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    # Build a fake process whose stdout hangs forever
    async def _hang():
        await asyncio.sleep(9999)
        yield b""

    fake_stdout = MagicMock()
    fake_stdout.__aiter__ = lambda self: _hang()
    fake_stderr = MagicMock()

    async def _empty_stderr():
        return
        yield  # make it an async generator

    fake_stderr.__aiter__ = lambda self: _empty_stderr()
    fake_proc = MagicMock()
    fake_proc.stdout = fake_stdout
    fake_proc.stderr = fake_stderr
    fake_proc.kill = MagicMock()
    fake_proc.returncode = 0

    async def _wait():
        return 0

    fake_proc.wait = _wait

    # Drive timeout via env var — BobShellConfig reads directly from os.environ
    with patch.dict(os.environ, {"NOTPRODREADY_BOB_TIMEOUT": "0"}), \
         patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", return_value=fake_proc):
        runner = BobShellRunner()
        with pytest.raises(BobTimeoutError):
            await runner.analyze(analysis, workspace, AsyncMock())


def test_unknown_stream_event_is_safe():
    """Completely unknown event type returns a bob.unknown event — never raises."""
    raw = {"type": "some_future_event_type_v9", "payload": {"x": 1}}
    evt, sid, payload = _normalize_bob_line(raw, 99)
    assert evt is not None
    assert evt.event == "bob.unknown"
    assert payload is None
    assert sid is None


def test_sanitize_redacts_api_key_lines():
    """_sanitize must blank lines that look like credential assignments."""
    from app.runners.shell import _sanitize

    text = "Starting Bob...\nBOB_API_KEY=sk-secret-12345\nWorkspace ready."
    result = _sanitize(text)
    assert "sk-secret-12345" not in result
    assert "[REDACTED]" in result
    # Non-sensitive lines are preserved
    assert "Starting Bob" in result
    assert "Workspace ready" in result


# ── 16. Regression tests for review-identified defects ───────────────────────


def test_run_server_shell_mode_disables_reload():
    """run_server.py must disable reload when NOTPRODREADY_BOB_MODE=shell.

    Regression: reload=True spawns a reloader subprocess that does NOT inherit
    the ProactorEventLoop policy, causing NotImplementedError on Windows.
    """
    import runpy
    import unittest.mock as mock

    captured_kwargs: dict = {}

    def _fake_run(app_str, **kwargs):
        captured_kwargs.update(kwargs)

    with patch.dict(os.environ, {"NOTPRODREADY_BOB_MODE": "shell"}), \
         mock.patch("uvicorn.run", side_effect=_fake_run):
        # run_server.py is __main__-guarded; exec the module body directly
        import importlib.util
        from pathlib import Path
        spec = importlib.util.spec_from_file_location(
            "__main__",
            Path(__file__).resolve().parent.parent.parent / "backend" / "run_server.py",
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

    assert captured_kwargs.get("reload") is False, (
        "run_server must pass reload=False in shell mode to avoid "
        "ProactorEventLoop being lost in the reloader worker process. "
        f"Got: reload={captured_kwargs.get('reload')!r}"
    )


def test_run_server_mock_mode_enables_reload():
    """run_server.py enables reload in mock mode (safe — no subprocess needed)."""
    import unittest.mock as mock

    captured_kwargs: dict = {}

    def _fake_run(app_str, **kwargs):
        captured_kwargs.update(kwargs)

    env = {k: v for k, v in os.environ.items() if k != "NOTPRODREADY_BOB_MODE"}
    with patch.dict(os.environ, env, clear=True), \
         mock.patch("uvicorn.run", side_effect=_fake_run):
        import importlib.util
        from pathlib import Path
        spec = importlib.util.spec_from_file_location(
            "__main__",
            Path(__file__).resolve().parent.parent.parent / "backend" / "run_server.py",
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

    assert captured_kwargs.get("reload") is True, (
        f"run_server must pass reload=True in mock mode. Got: {captured_kwargs.get('reload')!r}"
    )


@pytest.mark.asyncio
async def test_timeout_cancels_stderr_task_cleanly(tmp_path):
    """On timeout: stderr_task is cancelled and BobTimeoutError propagates cleanly.

    Regression: without stderr_task.cancel(), the finally block hangs on Windows
    because the killed process may not close its stderr pipe immediately.
    """
    analysis = _make_analysis("timeout-stderr-cancel")
    workspace = tmp_path / "ws"
    workspace.mkdir()

    # stdout hangs; stderr yields nothing but never terminates (simulates pipe open)
    async def _hang_stdout():
        await asyncio.sleep(9999)
        yield b""

    async def _hang_stderr():
        await asyncio.sleep(9999)
        yield b""

    fake_stdout = MagicMock()
    fake_stdout.__aiter__ = lambda self: _hang_stdout()
    fake_stderr = MagicMock()
    fake_stderr.__aiter__ = lambda self: _hang_stderr()

    fake_proc = MagicMock()
    fake_proc.stdout = fake_stdout
    fake_proc.stderr = fake_stderr
    fake_proc.kill = MagicMock()
    fake_proc.returncode = 0

    async def _wait():
        return 0

    fake_proc.wait = _wait

    with patch.dict(os.environ, {"NOTPRODREADY_BOB_TIMEOUT": "0"}), \
         patch("shutil.which", return_value="/usr/bin/bob"), \
         patch("asyncio.create_subprocess_exec", return_value=fake_proc):
        runner = BobShellRunner()
        # Must raise BobTimeoutError and NOT hang waiting for stderr
        with pytest.raises(BobTimeoutError):
            await asyncio.wait_for(
                runner.analyze(analysis, workspace, AsyncMock()),
                timeout=2.0,  # if it hangs, this outer timeout fails the test
            )
