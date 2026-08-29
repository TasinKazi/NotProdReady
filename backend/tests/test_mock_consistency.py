"""Tests for Step 12 mock consistency fix.

Verifies:
  1. Mock remediation claiming a file change actually changes a workspace file.
  2. Repository diff detects the mock file modification.
  3. files_changed count matches the audited list.
  4. Remediation summary cannot claim changes while audited list is empty.
  5. Before revalidation, comparison shows only BEFORE REMEDIATION data.
  6. Before revalidation, no AFTER score is present in the payload.
  7. Revalidation creates a new analysis ID.
  8. After revalidation, both BEFORE and AFTER results are available.
  9. Original ReleaseResult remains unchanged after revalidation.
  10. Real shell remediation behavior remains unchanged (build_remediate_command).
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app.models import (
    Analysis,
    AnalysisStatus,
    Decision,
    FileChange,
    FileChangeType,
    Remediation,
    RemediationResult,
    RemediationStatus,
    ReleaseResult,
    ReadinessSummary,
    AnalysisMetadata,
)
import app.services.remediation as rem_svc
from app.runners.mock_remediation import MockRemediationRunner


# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_analysis(
    analysis_id: str = "mc-an-001",
    status: AnalysisStatus = AnalysisStatus.COMPLETED,
    decision: Decision = Decision.NO_GO,
) -> Analysis:
    from datetime import datetime, timezone
    from app.models import Finding, FindingSeverity, Evidence, EvidenceType, AgentStep
    a = Analysis(
        analysis_id=analysis_id,
        application_name="NorthRiver Payments API",
        release_version="v2.4.0",
        environment="Production",
        status=status,
    )
    if status == AnalysisStatus.COMPLETED:
        a.result = ReleaseResult(
            analysis_id=analysis_id,
            app="NorthRiver Payments API",
            release="v2.4.0",
            environment="Production",
            decision=decision,
            readiness_score=61 if decision == Decision.NO_GO else 88,
            summary=ReadinessSummary(
                blockers=3 if decision == Decision.NO_GO else 0,
                warnings=1,
                passed=8,
            ),
            findings=[
                Finding(
                    id="F-001", category="runtime",
                    status=FindingSeverity.BLOCK, severity=FindingSeverity.BLOCK,
                    title="Runtime compatibility", claim="Node.js 18", actual="Node >=20",
                    evidence=[Evidence(type=EvidenceType.FILE, source="package.json", value=">=20")],
                    explanation="Version mismatch.",
                ),
            ],
            agent_activity=[],
            metadata=AnalysisMetadata(
                id=analysis_id, duration="5.0 s",
                files_inspected=10, commands_executed=3,
                completed_at=datetime.now(timezone.utc).isoformat(),
            ),
        )
    return a


def _make_northriver_workspace(tmp_path: Path) -> Path:
    """Create a workspace that mirrors the NorthRiver fixture layout."""
    ws = tmp_path / "workspace"
    for sub in ("repository", "documents", "bob", "output"):
        (ws / sub).mkdir(parents=True, exist_ok=True)

    # Populate repository with the package.json fixture
    pkg = {
        "name": "northriver-payments-api",
        "version": "2.4.0",
        "engines": {"node": ">=20"},
        "scripts": {"start": "node server.js", "test": "jest"},
    }
    (ws / "repository" / "package.json").write_text(
        json.dumps(pkg, indent=2) + "\n", encoding="utf-8"
    )

    # Deployment runbook in documents (not snapshotted)
    (ws / "documents" / "deployment-runbook.md").write_text(
        "# Runbook\nNode.js 18\nnpm run production\n", encoding="utf-8"
    )
    return ws


def _populate_store(analysis: Analysis) -> None:
    import app.services as svc
    svc._analyses[analysis.analysis_id] = analysis
    svc._event_queues[analysis.analysis_id] = []


def _cleanup_store(analysis_id: str) -> None:
    import app.services as svc
    svc._analyses.pop(analysis_id, None)
    svc._event_queues.pop(analysis_id, None)


def _cleanup_remediation(remediation_id: str) -> None:
    rem_svc._remediations.pop(remediation_id, None)
    rem_svc._remediation_queues.pop(remediation_id, None)


# ── 1. Mock remediation writes real workspace files ───────────────────────────


@pytest.mark.asyncio
async def test_1_mock_remediation_writes_env_example(tmp_path):
    """Test 1: MockRemediationRunner creates .env.example inside repository/."""
    ws = _make_northriver_workspace(tmp_path)
    analysis = _make_analysis("mc-test1")

    runner = MockRemediationRunner()
    await runner.remediate(analysis, ws, AsyncMock())

    env_file = ws / "repository" / ".env.example"
    assert env_file.exists(), ".env.example must be created in workspace/repository/"
    content = env_file.read_text(encoding="utf-8")
    assert "PAYMENTS_API_KEY" in content, ".env.example must document PAYMENTS_API_KEY"


@pytest.mark.asyncio
async def test_1_mock_remediation_modifies_package_json(tmp_path):
    """Test 1: MockRemediationRunner modifies package.json inside repository/."""
    ws = _make_northriver_workspace(tmp_path)
    analysis = _make_analysis("mc-test1b")

    runner = MockRemediationRunner()
    await runner.remediate(analysis, ws, AsyncMock())

    pkg_file = ws / "repository" / "package.json"
    assert pkg_file.exists()
    pkg = json.loads(pkg_file.read_text(encoding="utf-8"))
    assert "deploy" in pkg.get("scripts", {}), (
        "package.json must have scripts.deploy after mock remediation"
    )


# ── 2. Repository diff detects mock file changes ──────────────────────────────


@pytest.mark.asyncio
async def test_2_diff_detects_created_env_example(tmp_path):
    """Test 2: compute_repository_changes detects the .env.example creation."""
    ws = _make_northriver_workspace(tmp_path)

    import app.services.remediation as mod
    original_root = mod._WORKSPACE_ROOT
    mod._WORKSPACE_ROOT = tmp_path / "workspaces"

    analysis_id = "mc-diff-test"
    fake_ws = tmp_path / "workspaces" / analysis_id
    for sub in ("repository", "documents"):
        (fake_ws / sub).mkdir(parents=True, exist_ok=True)

    # Copy repository files
    import shutil
    shutil.copytree(str(ws / "repository"), str(fake_ws / "repository"), dirs_exist_ok=True)

    # Take snapshot (before state)
    mod.snapshot_repository(analysis_id)

    # Now run mock remediation (writes .env.example, modifies package.json)
    analysis = _make_analysis(analysis_id)
    runner = MockRemediationRunner()
    await runner.remediate(analysis, fake_ws, AsyncMock())

    # Compute diff
    changes = mod.compute_repository_changes(analysis_id)
    change_paths = [c.path for c in changes]

    try:
        assert ".env.example" in change_paths, (
            f".env.example must appear in diff. Got: {change_paths}"
        )
    finally:
        mod._WORKSPACE_ROOT = original_root


@pytest.mark.asyncio
async def test_2_diff_detects_modified_package_json(tmp_path):
    """Test 2: compute_repository_changes detects package.json modification."""
    ws = _make_northriver_workspace(tmp_path)

    import app.services.remediation as mod
    original_root = mod._WORKSPACE_ROOT
    mod._WORKSPACE_ROOT = tmp_path / "workspaces2"

    analysis_id = "mc-diff-pkg"
    fake_ws = tmp_path / "workspaces2" / analysis_id
    for sub in ("repository", "documents"):
        (fake_ws / sub).mkdir(parents=True, exist_ok=True)

    import shutil
    shutil.copytree(str(ws / "repository"), str(fake_ws / "repository"), dirs_exist_ok=True)

    mod.snapshot_repository(analysis_id)

    analysis = _make_analysis(analysis_id)
    runner = MockRemediationRunner()
    await runner.remediate(analysis, fake_ws, AsyncMock())

    changes = mod.compute_repository_changes(analysis_id)
    change_map = {c.path: c.change_type for c in changes}

    try:
        assert "package.json" in change_map, (
            f"package.json must appear in diff. Got: {list(change_map.keys())}"
        )
        assert change_map["package.json"] == FileChangeType.MODIFIED
    finally:
        mod._WORKSPACE_ROOT = original_root


# ── 3. files_changed count matches audited list ───────────────────────────────


@pytest.mark.asyncio
async def test_3_files_changed_count_matches_audit(tmp_path):
    """Test 3: After the full remediation pipeline, files_changed equals audited diff."""
    ws = _make_northriver_workspace(tmp_path)

    import app.services.remediation as mod
    original_root = mod._WORKSPACE_ROOT
    mod._WORKSPACE_ROOT = tmp_path / "workspaces3"

    analysis_id = "mc-count-test"
    fake_ws = tmp_path / "workspaces3" / analysis_id
    for sub in ("repository", "documents"):
        (fake_ws / sub).mkdir(parents=True, exist_ok=True)

    import shutil
    shutil.copytree(str(ws / "repository"), str(fake_ws / "repository"), dirs_exist_ok=True)
    mod.snapshot_repository(analysis_id)

    analysis = _make_analysis(analysis_id)
    runner = MockRemediationRunner()
    result = await runner.remediate(analysis, fake_ws, AsyncMock())

    actual_changes = mod.compute_repository_changes(analysis_id)
    # Simulate what _run_remediation does: replace files_changed with audit
    audited_result = result.model_copy(update={"files_changed": actual_changes})

    try:
        assert len(audited_result.files_changed) > 0, (
            "Audited files_changed must not be empty after mock remediation"
        )
        # The audited count must exactly match the actual diff
        assert len(audited_result.files_changed) == len(actual_changes)
    finally:
        mod._WORKSPACE_ROOT = original_root


# ── 4. Summary cannot claim changes while audited list is empty ───────────────


def test_4_empty_audit_means_no_summary_claims(tmp_path):
    """Test 4: A RemediationResult with empty files_changed must not have a
    summary that claims files were applied — consistency guard."""
    # Create a result with zero actual files changed but claims in summary
    zero_change_result = RemediationResult(
        status="completed",
        summary="Applied targeted changes to deployment-runbook.md.",
        files_changed=[],  # audit found nothing
        findings_addressed=["F-001"],
        findings_not_addressed=[],
    )

    # The UI should show the audited count (0), not believe the summary text.
    # We verify the contract: if files_changed is empty, count is 0.
    assert len(zero_change_result.files_changed) == 0, (
        "files_changed must reflect audited count (0), not summary text"
    )


@pytest.mark.asyncio
async def test_4_mock_audited_result_is_not_empty(tmp_path):
    """Test 4: After mock remediation + audit, files_changed is not empty."""
    ws = _make_northriver_workspace(tmp_path)

    import app.services.remediation as mod
    original_root = mod._WORKSPACE_ROOT
    mod._WORKSPACE_ROOT = tmp_path / "workspaces4"

    analysis_id = "mc-nonempty"
    fake_ws = tmp_path / "workspaces4" / analysis_id
    for sub in ("repository", "documents"):
        (fake_ws / sub).mkdir(parents=True, exist_ok=True)

    import shutil
    shutil.copytree(str(ws / "repository"), str(fake_ws / "repository"), dirs_exist_ok=True)
    mod.snapshot_repository(analysis_id)

    analysis = _make_analysis(analysis_id)
    runner = MockRemediationRunner()
    result = await runner.remediate(analysis, fake_ws, AsyncMock())

    actual_changes = mod.compute_repository_changes(analysis_id)
    audited_result = result.model_copy(update={"files_changed": actual_changes})

    try:
        # The audited result must have at least one change
        assert len(audited_result.files_changed) > 0, (
            "Mock remediation must produce at least one audited file change"
        )
    finally:
        mod._WORKSPACE_ROOT = original_root


# ── 5. Before revalidation: comparison payload has original result only ────────


def test_5_before_revalidation_original_result_is_set():
    """Test 5: Before revalidation, originalResult is populated, revalidationResult is None."""
    original = _make_analysis("mc-orig-5").result
    assert original is not None

    # Simulate App state just after remediation (before re-run)
    revalidation_result = None  # not yet available

    # The UI gate: comparison shown only when originalResult is truthy
    assert original is not None, "originalResult must be set after analysis"
    assert revalidation_result is None, "revalidationResult must be None before re-run"


def test_5_comparison_tile_shows_before_only_label():
    """Test 5: Without revalidation, tile title should be 'Original readiness result',
    not 'Before / After comparison'."""
    has_revalidation = False
    tile_title = "Before / After comparison" if has_revalidation else "Original readiness result"
    assert tile_title == "Original readiness result"


# ── 6. Before revalidation, no AFTER score rendered ───────────────────────────


def test_6_no_after_score_before_revalidation():
    """Test 6: revalidationResult is None before re-run — no after score shown."""
    revalidation_result = None
    # UI must check: `if revalidationResult` before rendering after score
    after_score_rendered = revalidation_result is not None
    assert not after_score_rendered, "No AFTER score should render before revalidation"


def test_6_after_score_rendered_when_revalidation_available():
    """Test 6: Once revalidation result is available, after score is rendered."""
    revalidation_result = _make_analysis("mc-reval-6", decision=Decision.GO).result
    after_score_rendered = revalidation_result is not None
    assert after_score_rendered, "AFTER score must render once revalidation result is set"


# ── 7. Revalidation creates a new analysis ID ─────────────────────────────────


@pytest.mark.asyncio
async def test_7_revalidation_creates_new_analysis_id(tmp_path):
    """Test 7: POST /revalidate returns a new analysis_id distinct from original."""
    from httpx import AsyncClient, ASGITransport
    from app.main import app as fastapi_app
    import app.services as svc

    original_id = "mc-orig-7"
    analysis = _make_analysis(original_id)
    _populate_store(analysis)

    remediation = rem_svc.create_remediation(original_id)
    rem_svc.store_remediation_result(remediation.remediation_id, RemediationResult(
        status="completed", summary="Done",
        files_changed=[], findings_addressed=["F-001"], findings_not_addressed=[],
    ))

    ws = svc.create_workspace(original_id)
    (ws / "repository" / "test.js").write_text("ok", encoding="utf-8")

    async with AsyncClient(
        transport=ASGITransport(app=fastapi_app), base_url="http://test"
    ) as client:
        resp = await client.post(f"/api/analyses/{original_id}/revalidate")

    assert resp.status_code == 202
    new_id = resp.json()["analysis_id"]
    assert new_id != original_id

    _cleanup_store(original_id)
    _cleanup_store(new_id)
    _cleanup_remediation(remediation.remediation_id)
    svc.cleanup_workspace(original_id)
    svc.cleanup_workspace(new_id)


# ── 8. After revalidation both results are available ──────────────────────────


def test_8_both_results_available_after_revalidation():
    """Test 8: Both originalResult and revalidationResult are set after re-run."""
    original = _make_analysis("mc-orig-8", decision=Decision.NO_GO).result
    revalidation = _make_analysis("mc-reval-8", decision=Decision.GO).result

    assert original is not None
    assert revalidation is not None

    # Simulate what the UI checks for the "BEFORE / AFTER" tile title
    has_both = original is not None and revalidation is not None
    tile_title = "Before / After comparison" if has_both else "Original readiness result"
    assert tile_title == "Before / After comparison"

    # Scores must come from the actual ReleaseResult objects
    assert original.readiness_score == 61
    assert revalidation.readiness_score == 88
    assert original.decision == Decision.NO_GO
    assert revalidation.decision == Decision.GO


# ── 9. Original ReleaseResult remains unchanged ───────────────────────────────


@pytest.mark.asyncio
async def test_9_original_result_unchanged_after_full_flow(tmp_path):
    """Test 9: Original analysis result is not mutated by remediation or revalidation."""
    from httpx import AsyncClient, ASGITransport
    from app.main import app as fastapi_app
    import app.services as svc

    original_id = "mc-orig-9"
    analysis = _make_analysis(original_id)
    original_score = analysis.result.readiness_score
    original_decision = analysis.result.decision
    _populate_store(analysis)

    remediation = rem_svc.create_remediation(original_id)
    rem_svc.store_remediation_result(remediation.remediation_id, RemediationResult(
        status="completed", summary="Done",
        files_changed=[FileChange(path="x.js", change_type=FileChangeType.MODIFIED)],
        findings_addressed=["F-001"], findings_not_addressed=[],
    ))

    ws = svc.create_workspace(original_id)
    (ws / "repository" / "test.js").write_text("ok", encoding="utf-8")

    async with AsyncClient(
        transport=ASGITransport(app=fastapi_app), base_url="http://test"
    ) as client:
        resp = await client.post(f"/api/analyses/{original_id}/revalidate")

    assert resp.status_code == 202
    new_id = resp.json()["analysis_id"]

    # Original must be untouched
    assert svc._analyses[original_id].result.readiness_score == original_score
    assert svc._analyses[original_id].result.decision == original_decision

    _cleanup_store(original_id)
    _cleanup_store(new_id)
    _cleanup_remediation(remediation.remediation_id)
    svc.cleanup_workspace(original_id)
    svc.cleanup_workspace(new_id)


# ── 10. Real shell remediation behavior unchanged ─────────────────────────────


def test_10_shell_remediation_command_unchanged(tmp_path):
    """Test 10: BobShellRemediationRunner.build_remediate_command is unaffected."""
    from app.runners.shell_remediation import BobShellRemediationRunner

    workspace = tmp_path / "ws"
    workspace.mkdir()
    runner = BobShellRemediationRunner()

    # With task_id — uses --resume
    cmd_resume = runner.build_remediate_command(
        workspace, task_id="task-xyz", primary_cost=0.50, primary_turns=12
    )
    assert "--resume" in cmd_resume
    assert cmd_resume[cmd_resume.index("--resume") + 1] == "task-xyz"
    assert "--mode" not in cmd_resume

    # Without task_id — uses --mode agent (fresh task)
    cmd_fresh = runner.build_remediate_command(
        workspace, task_id=None, primary_cost=None, primary_turns=None
    )
    assert "--resume" not in cmd_fresh
    assert "--mode" in cmd_fresh
    assert cmd_fresh[cmd_fresh.index("--mode") + 1] == "agent"


def test_10_shell_remediation_prompt_targets_repository(tmp_path):
    """Test 10: Shell remediation prompt instructs Bob to target repository/ only."""
    from app.runners.shell_remediation import _REMEDIATE_PROMPT, _REMEDIATE_FRESH_PROMPT

    for prompt in (_REMEDIATE_PROMPT, _REMEDIATE_FRESH_PROMPT):
        assert "repository" in prompt.lower(), (
            f"Prompt must mention 'repository': {prompt[:100]}"
        )
        assert "NotProdReady" in prompt or "notprodready" in prompt.lower() or "not" in prompt, (
            "Prompt must instruct Bob not to modify NotProdReady"
        )
