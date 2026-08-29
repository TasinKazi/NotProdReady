"""In-memory analysis state store + workspace management."""
from __future__ import annotations

import asyncio
import os
import shutil
import uuid
import zipfile
from pathlib import Path
from typing import Optional

from app.models import Analysis, AnalysisEvent, AnalysisStatus, ReleaseResult

# ── NorthRiver sample fixture source ─────────────────────────────────────────
_NORTHRIVER_FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "northriver"

# ── Workspace root ────────────────────────────────────────────────────────────

_WORKSPACE_ROOT = Path(os.environ.get("NOTPRODREADY_WORKSPACE", "workspaces"))

# ── Bob config source ─────────────────────────────────────────────────────────
# The canonical .bob/ directory lives at the project root (one level above the
# backend/ package).  We resolve it relative to this file so it works regardless
# of the current working directory when the server starts.
#
# Layout:
#   NotProdReady/               ← project root
#     .bob/                     ← canonical Bob config
#     backend/
#       app/
#         services/
#           analyses.py         ← this file
#
# Path: this_file → ../../.. → project root → .bob
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_BOB_CONFIG_SOURCE = Path(
    os.environ.get("NOTPRODREADY_BOB_CONFIG", str(_PROJECT_ROOT / ".bob"))
)

# ── In-memory store ───────────────────────────────────────────────────────────

_analyses: dict[str, Analysis] = {}
# SSE event queues: analysis_id → list of subscriber queues
_event_queues: dict[str, list[asyncio.Queue]] = {}


# ── Public helpers ────────────────────────────────────────────────────────────


def create_analysis(
    application_name: str,
    release_version: str,
    environment: str,
) -> Analysis:
    analysis_id = f"bob-{uuid.uuid4().hex[:12]}"
    analysis = Analysis(
        analysis_id=analysis_id,
        application_name=application_name,
        release_version=release_version,
        environment=environment,
        status=AnalysisStatus.QUEUED,
    )
    _analyses[analysis_id] = analysis
    _event_queues[analysis_id] = []
    return analysis


def get_analysis(analysis_id: str) -> Optional[Analysis]:
    return _analyses.get(analysis_id)


def update_status(analysis_id: str, status: AnalysisStatus) -> None:
    if analysis_id in _analyses:
        _analyses[analysis_id].status = status


def store_result(analysis_id: str, result: ReleaseResult) -> None:
    if analysis_id in _analyses:
        _analyses[analysis_id].result = result
        _analyses[analysis_id].status = AnalysisStatus.COMPLETED


def store_error(analysis_id: str, error: str) -> None:
    if analysis_id in _analyses:
        _analyses[analysis_id].error = error
        _analyses[analysis_id].status = AnalysisStatus.FAILED


def get_result(analysis_id: str) -> Optional[ReleaseResult]:
    analysis = _analyses.get(analysis_id)
    return analysis.result if analysis else None


# ── SSE pub/sub ───────────────────────────────────────────────────────────────


def subscribe(analysis_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    if analysis_id not in _event_queues:
        _event_queues[analysis_id] = []
    _event_queues[analysis_id].append(q)
    return q


def unsubscribe(analysis_id: str, q: asyncio.Queue) -> None:
    if analysis_id in _event_queues:
        try:
            _event_queues[analysis_id].remove(q)
        except ValueError:
            pass


async def publish(analysis_id: str, event: AnalysisEvent) -> None:
    for q in list(_event_queues.get(analysis_id, [])):
        await q.put(event)


# ── Workspace helpers ─────────────────────────────────────────────────────────


def create_workspace(analysis_id: str) -> Path:
    ws = _WORKSPACE_ROOT / analysis_id
    for sub in ("repository", "documents", "bob", "output"):
        (ws / sub).mkdir(parents=True, exist_ok=True)
    return ws


def get_workspace(analysis_id: str) -> Path:
    return _WORKSPACE_ROOT / analysis_id


def extract_zip_safely(zip_bytes: bytes, dest: Path) -> int:
    """Extract a ZIP archive, refusing any path-traversal entries.

    Returns the number of extracted files.
    """
    import io

    dest.mkdir(parents=True, exist_ok=True)
    resolved_dest = dest.resolve()

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = zf.namelist()
        for name in names:
            # Reject any entry that would escape the destination directory
            target = (dest / name).resolve()
            if not str(target).startswith(str(resolved_dest)):
                raise ValueError(f"ZIP path traversal attempt: {name}")
        zf.extractall(dest)

    return len(names)


def copy_bob_config_to_workspace(workspace: Path) -> None:
    """Copy the project-level .bob/ configuration into the analysis workspace.

    The workspace must already exist.  After this call the workspace will
    contain a .bob/ subtree mirroring the canonical project-level directory.

    Raises
    ------
    FileNotFoundError
        If the canonical .bob/ source directory does not exist.  This is a
        hard error — silently continuing without the Bob configuration would
        produce incorrect or silent failures at runtime.
    """
    if not _BOB_CONFIG_SOURCE.exists():
        raise FileNotFoundError(
            f"Bob configuration directory not found: {_BOB_CONFIG_SOURCE}. "
            "Ensure the project-level .bob/ directory exists before running "
            "shell-mode analyses."
        )
    dest = workspace / ".bob"
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(str(_BOB_CONFIG_SOURCE), str(dest))


def cleanup_workspace(analysis_id: str) -> None:
    ws = _WORKSPACE_ROOT / analysis_id
    if ws.exists():
        shutil.rmtree(ws, ignore_errors=True)


def load_northriver_sample(workspace: Path) -> None:
    """Copy the NorthRiver sample fixture files into the workspace.

    Populates:
        workspace/repository/  ← contents of fixtures/northriver/repository/
        workspace/documents/   ← contents of fixtures/northriver/documents/

    Raises
    ------
    FileNotFoundError
        If the fixture directory does not exist (packaging error).
    """
    if not _NORTHRIVER_FIXTURE.exists():
        raise FileNotFoundError(
            f"NorthRiver sample fixture not found: {_NORTHRIVER_FIXTURE}. "
            "Ensure the fixtures/northriver/ directory is present."
        )
    for sub in ("repository", "documents"):
        src = _NORTHRIVER_FIXTURE / sub
        dst = workspace / sub
        dst.mkdir(parents=True, exist_ok=True)
        if src.exists():
            for item in src.iterdir():
                target = dst / item.name
                if item.is_file():
                    shutil.copy2(str(item), str(target))
                elif item.is_dir():
                    if target.exists():
                        shutil.rmtree(str(target))
                    shutil.copytree(str(item), str(target))
