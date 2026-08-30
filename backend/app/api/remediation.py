"""Remediation API router — Step 12."""
from __future__ import annotations

import asyncio
import io
import json
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import StreamingResponse

from app import services
from app.models import (
    Analysis,
    AnalysisCreatedResponse,
    AnalysisEvent,
    AnalysisStatus,
    Decision,
    Remediation,
    RemediationCreatedResponse,
    RemediationStatus,
    RemediationStatusResponse,
)
import app.services.remediation as rem_svc

router = APIRouter(prefix="/api/analyses", tags=["remediation"])


# ── Runner selection ──────────────────────────────────────────────────────────


def _get_remediation_runner():
    mode = os.environ.get("NOTPRODREADY_BOB_MODE", "mock").lower()
    if mode == "mock":
        from app.runners.mock_remediation import MockRemediationRunner
        return MockRemediationRunner()
    if mode == "shell":
        from app.runners.shell_remediation import BobShellRemediationRunner
        return BobShellRemediationRunner()
    raise ValueError(f"Unknown NOTPRODREADY_BOB_MODE: '{mode}'.")


# ── Background task ───────────────────────────────────────────────────────────


async def _run_remediation(analysis: Analysis, remediation: Remediation) -> None:
    """Background task: snapshot → Bob remediation → audit → store."""
    remediation_id = remediation.remediation_id
    analysis_id = analysis.analysis_id

    workspace = services.get_workspace(analysis_id)
    runner = _get_remediation_runner()

    try:
        rem_svc.update_remediation_status(remediation_id, RemediationStatus.SNAPSHOTTING)
        await rem_svc.publish_remediation(
            remediation_id,
            AnalysisEvent(event="remediation.snapshotting", data={}, sequence=1),
        )

        # Safety: snapshot before any changes
        rem_svc.snapshot_repository(analysis_id)

        rem_svc.update_remediation_status(remediation_id, RemediationStatus.REMEDIATING)

        seq_ref = [1]

        async def emit(event: AnalysisEvent) -> None:
            seq_ref[0] += 1
            event = event.model_copy(update={"sequence": seq_ref[0]})
            await rem_svc.publish_remediation(remediation_id, event)

        result = await runner.remediate(analysis, workspace, emit)

        # Audit: compute actual file changes from filesystem diff
        rem_svc.update_remediation_status(remediation_id, RemediationStatus.AUDITING)
        await rem_svc.publish_remediation(
            remediation_id,
            AnalysisEvent(event="remediation.auditing", data={}, sequence=seq_ref[0] + 1),
        )

        actual_changes = rem_svc.compute_repository_changes(analysis_id)
        # Replace Bob's self-reported files_changed with the audit-verified list
        # (keeps reported findings_addressed/not_addressed from Bob)
        audited_result = result.model_copy(update={"files_changed": actual_changes})

        # Write remediation metadata
        rem_dir = rem_svc.create_remediation_dir(analysis_id)
        (rem_dir / "result.json").write_text(
            audited_result.model_dump_json(indent=2), encoding="utf-8"
        )

        rem_svc.store_remediation_result(remediation_id, audited_result)

        await rem_svc.publish_remediation(
            remediation_id,
            AnalysisEvent(
                event="remediation.done",
                data={
                    "findings_addressed": len(audited_result.findings_addressed),
                    "files_changed": len(audited_result.files_changed),
                },
                sequence=seq_ref[0] + 2,
            ),
        )
        await rem_svc.publish_remediation(
            remediation_id,
            AnalysisEvent(event="__done__", data={}, sequence=-1),
        )

    except Exception as exc:  # noqa: BLE001
        error_msg = str(exc) or type(exc).__name__
        rem_svc.store_remediation_error(remediation_id, error_msg)
        await rem_svc.publish_remediation(
            remediation_id,
            AnalysisEvent(event="remediation.failed", data={"error": error_msg}, sequence=-1),
        )
        await rem_svc.publish_remediation(
            remediation_id,
            AnalysisEvent(event="__done__", data={}, sequence=-1),
        )


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post("/{analysis_id}/remediate", response_model=RemediationCreatedResponse, status_code=202)
async def start_remediation(
    analysis_id: str,
    background_tasks: BackgroundTasks,
) -> RemediationCreatedResponse:
    """Start a remediation job for a completed NO-GO analysis."""
    analysis = services.get_analysis(analysis_id)
    if analysis is None:
        raise HTTPException(status_code=404, detail="Analysis not found")

    if analysis.status != AnalysisStatus.COMPLETED:
        raise HTTPException(
            status_code=409,
            detail="Remediation can only be started for a completed analysis.",
        )

    result = services.get_result(analysis_id)
    if result is None:
        raise HTTPException(status_code=409, detail="Analysis result not available.")

    if result.decision == Decision.GO:
        raise HTTPException(
            status_code=409,
            detail="Analysis result is GO — remediation is not required.",
        )

    remediation = rem_svc.create_remediation(analysis_id)
    background_tasks.add_task(_run_remediation, analysis, remediation)

    return RemediationCreatedResponse(
        remediation_id=remediation.remediation_id,
        analysis_id=analysis_id,
        status=RemediationStatus.QUEUED,
    )


@router.get("/{analysis_id}/remediation", response_model=RemediationStatusResponse)
async def get_remediation_status(analysis_id: str) -> RemediationStatusResponse:
    """Get the current remediation status for an analysis."""
    analysis = services.get_analysis(analysis_id)
    if analysis is None:
        raise HTTPException(status_code=404, detail="Analysis not found")

    remediation = rem_svc.get_remediation_for_analysis(analysis_id)
    if remediation is None:
        raise HTTPException(status_code=404, detail="No remediation found for this analysis")

    return RemediationStatusResponse(
        remediation_id=remediation.remediation_id,
        analysis_id=remediation.analysis_id,
        status=remediation.status,
        created_at=remediation.created_at,
        error=remediation.error,
        result=remediation.result,
        revalidation_analysis_id=remediation.revalidation_analysis_id,
    )


@router.get("/{analysis_id}/remediation/events")
async def stream_remediation_events(analysis_id: str) -> StreamingResponse:
    """SSE stream for remediation progress."""
    analysis = services.get_analysis(analysis_id)
    if analysis is None:
        raise HTTPException(status_code=404, detail="Analysis not found")

    remediation = rem_svc.get_remediation_for_analysis(analysis_id)
    if remediation is None:
        raise HTTPException(status_code=404, detail="No remediation found for this analysis")

    if remediation.status in (RemediationStatus.COMPLETED, RemediationStatus.FAILED):
        async def _replay():
            yield "event: done\ndata: {}\n\n"
        return StreamingResponse(_replay(), media_type="text/event-stream")

    q = rem_svc.subscribe_remediation(remediation.remediation_id)

    async def _event_generator():
        try:
            while True:
                try:
                    event: AnalysisEvent = await asyncio.wait_for(q.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield "event: ping\ndata: {}\n\n"
                    continue

                if event.event == "__done__":
                    yield "event: done\ndata: {}\n\n"
                    break

                payload = json.dumps({
                    "event": event.event,
                    "data": event.data,
                    "sequence": event.sequence,
                })
                yield f"event: message\ndata: {payload}\n\n"
        finally:
            rem_svc.unsubscribe_remediation(remediation.remediation_id, q)

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.post("/{analysis_id}/revalidate", response_model=AnalysisCreatedResponse, status_code=202)
async def start_revalidation(
    analysis_id: str,
    background_tasks: BackgroundTasks,
) -> AnalysisCreatedResponse:
    """Start a fresh readiness analysis using the remediated workspace.

    Creates a new Analysis record (new analysis_id) so the original result
    is never overwritten.
    """
    from app.api.analyses import _run_analysis

    analysis = services.get_analysis(analysis_id)
    if analysis is None:
        raise HTTPException(status_code=404, detail="Original analysis not found")

    remediation = rem_svc.get_remediation_for_analysis(analysis_id)
    if remediation is None:
        raise HTTPException(status_code=404, detail="No remediation found — cannot revalidate")

    if remediation.status != RemediationStatus.COMPLETED:
        raise HTTPException(
            status_code=409,
            detail="Remediation is not yet complete.",
        )

    # Create a new analysis record — do NOT reuse analysis_id
    new_analysis = services.create_analysis(
        application_name=analysis.application_name,
        release_version=analysis.release_version,
        environment=analysis.environment,
    )
    new_analysis.original_analysis_id = analysis_id
    new_analysis.remediation_id = remediation.remediation_id

    # Reuse the remediated workspace by symlinking/copying the workspace root
    # Use the ORIGINAL workspace (already remediated in-place at repository/)
    original_ws = services.get_workspace(analysis_id)
    new_ws = services.get_workspace(new_analysis.analysis_id)

    # Copy the remediated workspace content to the new analysis workspace
    import shutil as _shutil
    for sub in ("repository", "documents", ".bob", "bob"):
        src = original_ws / sub
        dst = new_ws / sub
        if src.exists():
            if dst.exists():
                _shutil.rmtree(str(dst))
            _shutil.copytree(str(src), str(dst))
    # Create output dir
    (new_ws / "output").mkdir(parents=True, exist_ok=True)

    # Record the revalidation on the remediation record
    rem_svc.set_revalidation_analysis_id(remediation.remediation_id, new_analysis.analysis_id)

    background_tasks.add_task(_run_analysis, new_analysis)

    return AnalysisCreatedResponse(
        analysis_id=new_analysis.analysis_id,
        status=AnalysisStatus.QUEUED,
    )


@router.get("/{analysis_id}/remediation/download")
async def download_remediated_repository(analysis_id: str) -> StreamingResponse:
    """Download the remediated repository as a ZIP.

    Excludes .bob/ runtime internals and any credential files.
    """
    analysis = services.get_analysis(analysis_id)
    if analysis is None:
        raise HTTPException(status_code=404, detail="Analysis not found")

    remediation = rem_svc.get_remediation_for_analysis(analysis_id)
    if remediation is None or remediation.status != RemediationStatus.COMPLETED:
        raise HTTPException(
            status_code=409,
            detail="Remediation not complete — no ZIP available.",
        )

    try:
        zip_bytes = rem_svc.package_remediated_repository(analysis_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    filename = f"{analysis_id}-remediated.zip"
    return StreamingResponse(
        io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
