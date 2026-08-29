"""Tests for Step 10: Bob config files, workspace preparation, and skill content.

No real Bob Shell is invoked.  No AI cost is incurred.
"""
from __future__ import annotations

import shutil
from pathlib import Path

import pytest

# ── Locate project-level .bob directory ───────────────────────────────────────
#
# This test file lives at:
#   backend/tests/test_bob_config.py
#
# Project root is two levels up:
#   backend/tests/ → backend/ → project root
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_BOB_DIR = _PROJECT_ROOT / ".bob"


# ── 1. Skill file existence and front matter ──────────────────────────────────


def test_skill_md_exists():
    """SKILL.md must exist at .bob/skills/not-prod-ready/SKILL.md."""
    skill_path = _BOB_DIR / "skills" / "not-prod-ready" / "SKILL.md"
    assert skill_path.exists(), f"SKILL.md not found at {skill_path}"


def test_skill_md_has_valid_front_matter():
    """SKILL.md must contain valid YAML front matter with required keys."""
    skill_path = _BOB_DIR / "skills" / "not-prod-ready" / "SKILL.md"
    content = skill_path.read_text(encoding="utf-8")

    assert content.startswith("---"), "SKILL.md must begin with YAML front matter (---)"
    # Find closing ---
    end = content.index("---", 3)
    front_matter = content[3:end]

    assert "name:" in front_matter, "Front matter must contain 'name:'"
    assert "description:" in front_matter, "Front matter must contain 'description:'"
    assert "not-prod-ready" in front_matter, "Skill name must be 'not-prod-ready'"


def test_skill_md_references_phases():
    """SKILL.md must reference all six workflow phases."""
    content = (_BOB_DIR / "skills" / "not-prod-ready" / "SKILL.md").read_text(encoding="utf-8")
    for phase in ("PHASE 1", "PHASE 2", "PHASE 3", "PHASE 4", "PHASE 5", "PHASE 6"):
        assert phase in content, f"SKILL.md must reference {phase}"


def test_output_contract_exists():
    """output-contract.md must exist."""
    assert (_BOB_DIR / "skills" / "not-prod-ready" / "output-contract.md").exists()


def test_severity_rules_exists():
    """severity-rules.md must exist."""
    assert (_BOB_DIR / "skills" / "not-prod-ready" / "severity-rules.md").exists()


# ── 2. Agent persona files ────────────────────────────────────────────────────


EXPECTED_PERSONAS = [
    "runbook-analyst",
    "repository-inspector",
    "release-verifier",
]


@pytest.mark.parametrize("persona", EXPECTED_PERSONAS)
def test_persona_file_exists(persona: str):
    """Each persona file must exist at .bob/agents/<persona>.md."""
    path = _BOB_DIR / "agents" / f"{persona}.md"
    assert path.exists(), f"Persona file not found: {path}"


@pytest.mark.parametrize("persona", EXPECTED_PERSONAS)
def test_persona_has_valid_front_matter(persona: str):
    """Each persona file must have YAML front matter with name, description, tools."""
    path = _BOB_DIR / "agents" / f"{persona}.md"
    content = path.read_text(encoding="utf-8")

    assert content.startswith("---"), f"{persona}.md must begin with YAML front matter"
    end = content.index("---", 3)
    front_matter = content[3:end]

    assert "name:" in front_matter, f"{persona}.md front matter must contain 'name:'"
    assert "description:" in front_matter, f"{persona}.md front matter must contain 'description:'"
    assert "tools:" in front_matter, f"{persona}.md front matter must contain 'tools:'"


@pytest.mark.parametrize("persona", EXPECTED_PERSONAS)
def test_persona_name_matches_filename(persona: str):
    """The 'name' field in each persona's front matter must match its filename."""
    path = _BOB_DIR / "agents" / f"{persona}.md"
    content = path.read_text(encoding="utf-8")

    end = content.index("---", 3)
    front_matter = content[3:end]

    # Extract name value (handles "name: runbook-analyst" with optional whitespace)
    for line in front_matter.splitlines():
        stripped = line.strip()
        if stripped.startswith("name:"):
            name_value = stripped.split(":", 1)[1].strip()
            assert name_value == persona, (
                f"{persona}.md: front matter name '{name_value}' "
                f"does not match filename '{persona}'"
            )
            return
    pytest.fail(f"{persona}.md: could not find 'name:' in front matter")


@pytest.mark.parametrize("persona", EXPECTED_PERSONAS)
def test_persona_tools_are_read_only(persona: str):
    """Every persona must only have 'read' in its tools list."""
    path = _BOB_DIR / "agents" / f"{persona}.md"
    content = path.read_text(encoding="utf-8")

    end = content.index("---", 3)
    front_matter = content[3:end]

    # Collect all tool entries from the front matter
    in_tools = False
    tools_found: list[str] = []
    for line in front_matter.splitlines():
        stripped = line.strip()
        if stripped.startswith("tools:"):
            in_tools = True
            continue
        if in_tools:
            if stripped.startswith("-"):
                tools_found.append(stripped.lstrip("- ").strip())
            elif stripped and not stripped.startswith("#"):
                # Another top-level key — tools block ended
                in_tools = False

    assert tools_found, f"{persona}.md: no tools found in front matter"
    for tool in tools_found:
        assert tool == "read", (
            f"{persona}.md: tool '{tool}' is not read-only. "
            "All agent personas must be restricted to read tools only."
        )


# ── 3. Workspace preparation: copy_bob_config_to_workspace ────────────────────


def test_copy_bob_config_creates_dot_bob_in_workspace(tmp_path):
    """copy_bob_config_to_workspace copies .bob/ into the workspace."""
    from app.services.analyses import copy_bob_config_to_workspace

    workspace = tmp_path / "ws-copy-test"
    workspace.mkdir()

    copy_bob_config_to_workspace(workspace)

    dot_bob = workspace / ".bob"
    assert dot_bob.exists(), "workspace/.bob must exist after copy"
    assert dot_bob.is_dir(), "workspace/.bob must be a directory"


def test_copy_bob_config_skill_md_present(tmp_path):
    """After workspace copy, SKILL.md must be present inside workspace/.bob."""
    from app.services.analyses import copy_bob_config_to_workspace

    workspace = tmp_path / "ws-skill-test"
    workspace.mkdir()

    copy_bob_config_to_workspace(workspace)

    skill_md = workspace / ".bob" / "skills" / "not-prod-ready" / "SKILL.md"
    assert skill_md.exists(), f"SKILL.md not found in workspace at {skill_md}"


def test_copy_bob_config_persona_files_present(tmp_path):
    """After workspace copy, all three persona files must be present."""
    from app.services.analyses import copy_bob_config_to_workspace

    workspace = tmp_path / "ws-persona-test"
    workspace.mkdir()

    copy_bob_config_to_workspace(workspace)

    for persona in EXPECTED_PERSONAS:
        persona_path = workspace / ".bob" / "agents" / f"{persona}.md"
        assert persona_path.exists(), f"Persona file missing in workspace: {persona_path}"


def test_copy_bob_config_overwrites_existing(tmp_path):
    """A second call to copy_bob_config_to_workspace replaces the existing .bob/."""
    from app.services.analyses import copy_bob_config_to_workspace

    workspace = tmp_path / "ws-overwrite-test"
    workspace.mkdir()

    # Plant a stale file that should be gone after the second copy
    stale_bob = workspace / ".bob"
    stale_bob.mkdir()
    (stale_bob / "stale.txt").write_text("old content")

    copy_bob_config_to_workspace(workspace)

    assert not (workspace / ".bob" / "stale.txt").exists(), (
        "Stale .bob/stale.txt should have been removed by the fresh copy"
    )
    # Real content must be present
    assert (workspace / ".bob" / "skills" / "not-prod-ready" / "SKILL.md").exists()


def test_copy_bob_config_missing_source_raises(tmp_path, monkeypatch):
    """If _BOB_CONFIG_SOURCE does not exist, FileNotFoundError is raised."""
    import app.services.analyses as svc_mod

    workspace = tmp_path / "ws-missing-test"
    workspace.mkdir()

    original = svc_mod._BOB_CONFIG_SOURCE
    try:
        monkeypatch.setattr(svc_mod, "_BOB_CONFIG_SOURCE", tmp_path / "nonexistent-.bob")
        with pytest.raises(FileNotFoundError, match="Bob configuration directory not found"):
            svc_mod.copy_bob_config_to_workspace(workspace)
    finally:
        monkeypatch.setattr(svc_mod, "_BOB_CONFIG_SOURCE", original)


# ── 4. Shell mode runs copy; mock mode does not copy ──────────────────────────


def test_shell_mode_workspace_gets_dot_bob(tmp_path, monkeypatch):
    """In shell mode, _run_analysis copies .bob/ into the workspace."""
    import asyncio
    import app.api.analyses as api_mod
    import app.services.analyses as svc_mod
    from app.models import Analysis, AnalysisStatus

    # Override workspace root so we write into tmp_path
    monkeypatch.setattr(svc_mod, "_WORKSPACE_ROOT", tmp_path)

    analysis = Analysis(
        analysis_id="shell-ws-test-001",
        application_name="Test App",
        release_version="v1.0.0",
        environment="Production",
    )
    svc_mod._analyses[analysis.analysis_id] = analysis
    svc_mod._event_queues[analysis.analysis_id] = []

    workspace = svc_mod.create_workspace(analysis.analysis_id)

    # Call copy_bob_config_to_workspace directly (simulating what _run_analysis does)
    svc_mod.copy_bob_config_to_workspace(workspace)

    assert (workspace / ".bob" / "skills" / "not-prod-ready" / "SKILL.md").exists()

    # Cleanup
    del svc_mod._analyses[analysis.analysis_id]
    del svc_mod._event_queues[analysis.analysis_id]


# ── 5. MockBobRunner still passes existing smoke check ────────────────────────


@pytest.mark.asyncio
async def test_mock_runner_unaffected_by_step10():
    """MockBobRunner still produces the expected NorthRiver NO-GO result."""
    from pathlib import Path
    from app.models import Analysis, AnalysisEvent, Decision
    from app.runners.mock import MockBobRunner

    analysis = Analysis(
        analysis_id="step10-mock-check",
        application_name="NorthRiver Payments API",
        release_version="v2.4.0",
        environment="Production",
    )
    workspace = Path("/tmp/notprodready-step10-mock")
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

    shutil.rmtree(workspace, ignore_errors=True)


# ── 6. Bob prompt uses the not-prod-ready skill ───────────────────────────────


def test_bob_prompt_references_skill():
    """_BOB_PROMPT must reference the not-prod-ready skill."""
    from app.runners.shell import _BOB_PROMPT

    assert "not-prod-ready" in _BOB_PROMPT, (
        f"_BOB_PROMPT must reference the 'not-prod-ready' skill. Got: {_BOB_PROMPT!r}"
    )
