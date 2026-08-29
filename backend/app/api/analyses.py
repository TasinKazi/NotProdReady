"""Analysis API router."""
from __future__ import annotations

import asyncio
import json
import os
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from app import services
from app.models import (
    Analysis,
    AnalysisCreatedResponse,
    AnalysisEvent,
    AnalysisStatus,
    AnalysisStatusResponse,
    ReleaseResult,
)
from app.runners.base import BobRunner

router = APIRouter(prefix="/api/analyses", tags=["analyses"])


# ── Runner selection ──────────────────────────────────────────────────────────


def _get_runner() -> BobRunner:
    """Select runner based on NOTPRODREADY_BOB_MODE.

    mock  — MockBobRunner (default): deterministic NorthRiver demo, no AI cost.
    shell — BobShellRunner: invokes IBM Bob Shell as a subprocess.

    Any other value raises ValueError immediately — no silent fallback to mock.
    """
    mode = os.environ.get("NOTPRODREADY_BOB_MODE", "mock").lower()
    if mode == "mock":
        from app.runners.mock import MockBobRunner
        return MockBobRunner()
    if mode == "shell":
        from app.runners.shell import BobShellRunner
        return BobShellRunner()
    raise ValueError(
        f"Unknown NOTPRODREADY_BOB_MODE: '{mode}'. "
        "Valid values: 'mock' (default), 'shell'."
    )


# ── Background task ───────────────────────────────────────────────────────────


async def _run_analysis(analysis: Analysis) -> None:
    from app import services as svc

    workspace = svc.create_workspace(analysis.analysis_id)
    runner = _get_runner()

    try:
        svc.update_status(analysis.analysis_id, AnalysisStatus.PREPARING)

        # Copy the project-level .bob/ configuration into the workspace so
        # BobShellRunner can invoke the NotProdReady skill.  This is a no-op
        # for MockBobRunner (which never reads .bob/) but is required for shell
        # mode.  We copy for both modes so the workspace structure is identical
        # in all cases and failures surface early rather than at Bob invocation.
        from app.runners.shell import BobShellRunner as _BSR
        if isinstance(runner, _BSR):
            svc.copy_bob_config_to_workspace(workspace)

        async def emit(event: AnalysisEvent) -> None:
            await svc.publish(analysis.analysis_id, event)
            # Update analysis status from prominent events
            status_map = {
                "analysis.started": AnalysisStatus.PREPARING,
                "document.analysis.started": AnalysisStatus.ANALYZING_DOCUMENT,
                "repository.analysis.started": AnalysisStatus.INSPECTING_REPOSITORY,
                "verification.started": AnalysisStatus.VERIFYING,
                "analysis.synthesizing": AnalysisStatus.SYNTHESIZING,
            }
            if event.event in status_map:
                svc.update_status(analysis.analysis_id, status_map[event.event])

        result = await runner.analyze(analysis, workspace, emit)
        svc.store_result(analysis.analysis_id, result)

        # Sentinel so SSE subscribers know to stop
        await svc.publish(
            analysis.analysis_id,
            AnalysisEvent(event="__done__", data={}, sequence=-1),
        )
    except Exception as exc:  # noqa: BLE001
        # str(exc) can be empty for bare exception subclasses — fall back to
        # the class name so Analysis.error is never an empty string.
        error_msg = str(exc) or type(exc).__name__
        svc.store_error(analysis.analysis_id, error_msg)
        await svc.publish(
            analysis.analysis_id,
            AnalysisEvent(
                event="analysis.failed",
                data={"error": error_msg},
                sequence=-1,
            ),
        )
        await svc.publish(
            analysis.analysis_id,
            AnalysisEvent(event="__done__", data={}, sequence=-1),
        )


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post("", response_model=AnalysisCreatedResponse, status_code=202)
async def create_analysis(
    background_tasks: BackgroundTasks,
    repository: Optional[UploadFile] = File(None),
    deployment_runbook: Optional[UploadFile] = File(None),
    application_name: str = Form(...),
    release_version: str = Form(...),
    environment: str = Form(...),
    use_sample: bool = Form(False),
) -> AnalysisCreatedResponse:
    """Accept files (or sample flag) and queue an analysis."""
    from app import services as svc

    # When using the NorthRiver sample, real files are not required
    if not use_sample:
        if repository is None:
            raise HTTPException(status_code=422, detail="repository file is required")
        if deployment_runbook is None:
            raise HTTPException(status_code=422, detail="deployment_runbook file is required")

    analysis = svc.create_analysis(application_name, release_version, environment)
    workspace = svc.create_workspace(analysis.analysis_id)

    if repository is not None:
        repo_bytes = await repository.read()
        filename = repository.filename or "repository.zip"
        if filename.lower().endswith((".zip", ".tgz", ".tar.gz")):
            try:
                svc.extract_zip_safely(repo_bytes, workspace / "repository")
            except (ValueError, Exception) as exc:
                svc.cleanup_workspace(analysis.analysis_id)
                raise HTTPException(
                    status_code=422,
                    detail=f"Invalid or unsafe ZIP archive: {exc}",
                ) from exc
        else:
            (workspace / "repository" / filename).write_bytes(repo_bytes)

    if deployment_runbook is not None:
        runbook_bytes = await deployment_runbook.read()
        runbook_name = deployment_runbook.filename or "runbook"
        (workspace / "documents" / runbook_name).write_bytes(runbook_bytes)

    # Load NorthRiver sample files when no real files were uploaded
    if use_sample and repository is None and deployment_runbook is None:
        try:
            svc.load_northriver_sample(workspace)
        except FileNotFoundError as exc:
            svc.cleanup_workspace(analysis.analysis_id)
            raise HTTPException(
                status_code=500,
                detail=f"Sample fixture unavailable: {exc}",
            ) from exc

    background_tasks.add_task(_run_analysis, analysis)

    return AnalysisCreatedResponse(
        analysis_id=analysis.analysis_id,
        status=AnalysisStatus.QUEUED,
    )


@router.get("/{analysis_id}", response_model=AnalysisStatusResponse)
async def get_analysis_status(analysis_id: str) -> AnalysisStatusResponse:
    from app import services as svc

    analysis = svc.get_analysis(analysis_id)
    if analysis is None:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return AnalysisStatusResponse(
        analysis_id=analysis.analysis_id,
        application_name=analysis.application_name,
        release_version=analysis.release_version,
        environment=analysis.environment,
        status=analysis.status,
        created_at=analysis.created_at,
        error=analysis.error,
    )


@router.get("/{analysis_id}/events")
async def stream_events(analysis_id: str) -> StreamingResponse:
    from app import services as svc

    analysis = svc.get_analysis(analysis_id)
    if analysis is None:
        raise HTTPException(status_code=404, detail="Analysis not found")

    q = svc.subscribe(analysis_id)

    async def event_generator():
        try:
            while True:
                try:
                    event: AnalysisEvent = await asyncio.wait_for(q.get(), timeout=30.0)
                except asyncio.TimeoutError:
                    # Send keep-alive comment
                    yield ": keep-alive\n\n"
                    continue

                if event.event == "__done__":
                    yield f"event: done\ndata: {{}}\n\n"
                    break

                payload = json.dumps({"event": event.event, "data": event.data, "sequence": event.sequence})
                yield f"event: message\ndata: {payload}\n\n"
        finally:
            svc.unsubscribe(analysis_id, q)

    # If analysis is already complete, check for a cached result
    if analysis.status == AnalysisStatus.COMPLETED:
        async def replay():
            yield "event: done\ndata: {}\n\n"
        return StreamingResponse(replay(), media_type="text/event-stream")

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get("/{analysis_id}/result", response_model=ReleaseResult)
async def get_result(analysis_id: str) -> ReleaseResult:
    from app import services as svc

    analysis = svc.get_analysis(analysis_id)
    if analysis is None:
        raise HTTPException(status_code=404, detail="Analysis not found")

    if analysis.status == AnalysisStatus.FAILED:
        raise HTTPException(
            status_code=422,
            detail=f"Analysis failed: {analysis.error}",
        )

    result = svc.get_result(analysis_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Result not yet available")

    return result
