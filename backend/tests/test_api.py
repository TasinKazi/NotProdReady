"""Backend tests for NotProdReady API."""
from __future__ import annotations

import io
import zipfile
import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app


# ── Fixtures ──────────────────────────────────────────────────────────────────


def _make_zip(files: dict[str, str] = None) -> bytes:
    """Build an in-memory ZIP with the given filename→content mapping."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, content in (files or {"package.json": "{}"}).items():
            zf.writestr(name, content)
    return buf.getvalue()


def _make_runbook() -> bytes:
    return b"# Deployment Runbook\n\nNode.js 18\nnpm run production\n"


@pytest.fixture
async def client():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


# ── 1. Health ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_health(client: AsyncClient):
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


# ── 2. POST /api/analyses ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_analysis_with_sample(client: AsyncClient):
    """Use the sample flag — no file upload required."""
    resp = await client.post(
        "/api/analyses",
        data={
            "application_name": "NorthRiver Payments API",
            "release_version": "v2.4.0",
            "environment": "Production",
            "use_sample": "true",
        },
    )
    assert resp.status_code == 202
    body = resp.json()
    assert body["status"] == "QUEUED"
    assert body["analysis_id"].startswith("bob-")


@pytest.mark.asyncio
async def test_create_analysis_with_files(client: AsyncClient):
    """Upload a real (tiny) ZIP and runbook."""
    zip_bytes = _make_zip({"package.json": '{"name":"test"}'})
    runbook_bytes = _make_runbook()

    resp = await client.post(
        "/api/analyses",
        data={
            "application_name": "Test App",
            "release_version": "v1.0.0",
            "environment": "Staging",
        },
        files={
            "repository": ("repo.zip", zip_bytes, "application/zip"),
            "deployment_runbook": ("runbook.md", runbook_bytes, "text/markdown"),
        },
    )
    assert resp.status_code == 202
    body = resp.json()
    assert body["status"] == "QUEUED"


@pytest.mark.asyncio
async def test_create_analysis_missing_files_returns_422(client: AsyncClient):
    """Neither files nor use_sample → 422."""
    resp = await client.post(
        "/api/analyses",
        data={
            "application_name": "Test App",
            "release_version": "v1.0.0",
            "environment": "Production",
        },
    )
    assert resp.status_code == 422


# ── 3. Invalid ZIP ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_invalid_zip_returns_422(client: AsyncClient):
    """Uploading garbage bytes as a ZIP should return 422."""
    resp = await client.post(
        "/api/analyses",
        data={
            "application_name": "Test App",
            "release_version": "v1.0.0",
            "environment": "Production",
        },
        files={
            "repository": ("bad.zip", b"this is not a zip", "application/zip"),
            "deployment_runbook": ("runbook.md", _make_runbook(), "text/markdown"),
        },
    )
    assert resp.status_code == 422


# ── 4. Analysis state retrieval ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_analysis_state(client: AsyncClient):
    """Create an analysis and retrieve its state."""
    create_resp = await client.post(
        "/api/analyses",
        data={
            "application_name": "State Test App",
            "release_version": "v0.1.0",
            "environment": "Staging",
            "use_sample": "true",
        },
    )
    assert create_resp.status_code == 202
    analysis_id = create_resp.json()["analysis_id"]

    state_resp = await client.get(f"/api/analyses/{analysis_id}")
    assert state_resp.status_code == 200
    body = state_resp.json()
    assert body["analysis_id"] == analysis_id
    assert body["application_name"] == "State Test App"
    assert body["status"] in ("QUEUED", "PREPARING", "ANALYZING_DOCUMENT",
                               "INSPECTING_REPOSITORY", "VERIFYING",
                               "SYNTHESIZING", "COMPLETED", "FAILED")


@pytest.mark.asyncio
async def test_get_unknown_analysis_returns_404(client: AsyncClient):
    resp = await client.get("/api/analyses/nonexistent-id")
    assert resp.status_code == 404


# ── 5. MockBobRunner produces expected NO-GO result ────────────────────────────


@pytest.mark.asyncio
async def test_mock_runner_result():
    """Run MockBobRunner directly and verify the NorthRiver result."""
    import asyncio
    from pathlib import Path
    from app.models import Analysis, AnalysisEvent, Decision
    from app.runners.mock import MockBobRunner

    analysis = Analysis(
        analysis_id="test-runner-001",
        application_name="NorthRiver Payments API",
        release_version="v2.4.0",
        environment="Production",
    )
    workspace = Path("/tmp/notprodready-test-runner-001")
    workspace.mkdir(parents=True, exist_ok=True)

    events: list[AnalysisEvent] = []

    async def capture(event: AnalysisEvent):
        events.append(event)

    runner = MockBobRunner()
    result = await runner.analyze(analysis, workspace, capture)

    # Decision must be NO-GO
    assert result.decision == Decision.NO_GO

    # Score is 61
    assert result.readiness_score == 61

    # Summary counts
    assert result.summary.blockers == 3
    assert result.summary.warnings == 1
    assert result.summary.passed == 8

    # Exactly 3 BLOCK findings
    blocks = [f for f in result.findings if f.severity.value == "BLOCK"]
    assert len(blocks) == 3

    # F-001 is runtime compat
    f001 = next(f for f in result.findings if f.id == "F-001")
    assert f001.claim == "Node.js 18"
    assert f001.actual == "Node >=20"

    # Events were emitted
    event_names = [e.event for e in events]
    assert "analysis.started" in event_names
    assert "analysis.completed" in event_names
    assert "finding.detected" in event_names

    # Cleanup
    import shutil
    shutil.rmtree(workspace, ignore_errors=True)
