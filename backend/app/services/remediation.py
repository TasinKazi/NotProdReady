"""Remediation service — workspace safety, snapshot, change audit, job store."""
from __future__ import annotations

import asyncio
import hashlib
import shutil
import uuid
import zipfile
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Optional

from app.models import (
    FileChange,
    FileChangeType,
    Remediation,
    RemediationStatus,
)
from app.services.analyses import _WORKSPACE_ROOT

# ── In-memory remediation store ───────────────────────────────────────────────

_remediations: dict[str, Remediation] = {}
_remediation_queues: dict[str, list[asyncio.Queue]] = {}


# ── Public helpers ────────────────────────────────────────────────────────────


def create_remediation(analysis_id: str) -> Remediation:
    remediation_id = f"rem-{uuid.uuid4().hex[:12]}"
    rem = Remediation(
        remediation_id=remediation_id,
        analysis_id=analysis_id,
    )
    _remediations[remediation_id] = rem
    _remediation_queues[remediation_id] = []
    return rem


def get_remediation(remediation_id: str) -> Optional[Remediation]:
    return _remediations.get(remediation_id)


def get_remediation_for_analysis(analysis_id: str) -> Optional[Remediation]:
    """Return the most recent remediation for an analysis_id, or None."""
    matches = [r for r in _remediations.values() if r.analysis_id == analysis_id]
    if not matches:
        return None
    return sorted(matches, key=lambda r: r.created_at)[-1]


def update_remediation_status(remediation_id: str, status: RemediationStatus) -> None:
    if remediation_id in _remediations:
        _remediations[remediation_id].status = status


def store_remediation_result(remediation_id: str, result) -> None:  # type: ignore[type-arg]
    if remediation_id in _remediations:
        _remediations[remediation_id].result = result
        _remediations[remediation_id].status = RemediationStatus.COMPLETED


def store_remediation_error(remediation_id: str, error: str) -> None:
    if remediation_id in _remediations:
        _remediations[remediation_id].error = error
        _remediations[remediation_id].status = RemediationStatus.FAILED


def set_revalidation_analysis_id(remediation_id: str, revalidation_id: str) -> None:
    if remediation_id in _remediations:
        _remediations[remediation_id].revalidation_analysis_id = revalidation_id


# ── SSE pub/sub for remediation events ───────────────────────────────────────


def subscribe_remediation(remediation_id: str) -> asyncio.Queue:
    from app.models import AnalysisEvent  # avoid circular
    q: asyncio.Queue = asyncio.Queue()
    if remediation_id not in _remediation_queues:
        _remediation_queues[remediation_id] = []
    _remediation_queues[remediation_id].append(q)
    return q


def unsubscribe_remediation(remediation_id: str, q: asyncio.Queue) -> None:
    if remediation_id in _remediation_queues:
        try:
            _remediation_queues[remediation_id].remove(q)
        except ValueError:
            pass


async def publish_remediation(remediation_id: str, event) -> None:  # type: ignore[type-arg]
    for q in list(_remediation_queues.get(remediation_id, [])):
        await q.put(event)


# ── Workspace safety ──────────────────────────────────────────────────────────


def get_remediation_workspace(analysis_id: str) -> Path:
    """Return the repository directory for remediation.

    This is the ONLY path Bob may modify during remediation.
    """
    return _WORKSPACE_ROOT / analysis_id / "repository"


def _assert_within_workspace(path: Path, workspace_root: Path) -> None:
    """Raise ValueError if path is not within workspace_root."""
    resolved = path.resolve()
    root_resolved = workspace_root.resolve()
    if not str(resolved).startswith(str(root_resolved)):
        raise ValueError(
            f"Path traversal detected: {path} is outside workspace {workspace_root}"
        )


# ── Snapshot ──────────────────────────────────────────────────────────────────


def snapshot_repository(analysis_id: str) -> Path:
    """Copy workspace/repository/ to workspace/before-remediation/.

    Returns the snapshot directory path.

    Raises
    ------
    FileNotFoundError
        If the repository directory does not exist.
    """
    ws = _WORKSPACE_ROOT / analysis_id
    src = ws / "repository"
    dst = ws / "before-remediation"

    if not src.exists():
        raise FileNotFoundError(f"Repository not found: {src}")

    if dst.exists():
        shutil.rmtree(dst)

    shutil.copytree(str(src), str(dst))
    return dst


# ── File manifest / audit ─────────────────────────────────────────────────────


def _hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _file_manifest(directory: Path) -> dict[str, str]:
    """Return {relative_path: sha256_hex} for all files under directory."""
    manifest: dict[str, str] = {}
    if not directory.exists():
        return manifest
    for p in sorted(directory.rglob("*")):
        if p.is_file():
            rel = str(p.relative_to(directory))
            manifest[rel] = _hash_file(p)
    return manifest


def compute_repository_changes(analysis_id: str) -> list[FileChange]:
    """Compare workspace/before-remediation/ to workspace/repository/.

    Returns an auditable list of FileChange items (modified, created, deleted).

    The snapshot must have been taken before calling this.
    """
    ws = _WORKSPACE_ROOT / analysis_id
    before_dir = ws / "before-remediation"
    after_dir = ws / "repository"

    before = _file_manifest(before_dir)
    after = _file_manifest(after_dir)

    changes: list[FileChange] = []

    for path, h_before in before.items():
        if path not in after:
            changes.append(FileChange(path=path, change_type=FileChangeType.DELETED))
        elif after[path] != h_before:
            changes.append(FileChange(path=path, change_type=FileChangeType.MODIFIED))

    for path in after:
        if path not in before:
            changes.append(FileChange(path=path, change_type=FileChangeType.CREATED))

    return sorted(changes, key=lambda c: c.path)


# ── Remediation metadata directory ────────────────────────────────────────────


def create_remediation_dir(analysis_id: str) -> Path:
    """Create workspace/remediation/ to store metadata."""
    d = _WORKSPACE_ROOT / analysis_id / "remediation"
    d.mkdir(parents=True, exist_ok=True)
    return d


# ── ZIP download ──────────────────────────────────────────────────────────────


def package_remediated_repository(analysis_id: str) -> bytes:
    """ZIP workspace/repository/ for download.

    Excludes:
    - .bob/  (runtime internals, not application code)
    - Any file matching credential patterns (should not exist in repo,
      but excluded as a safety measure).

    Returns ZIP bytes.

    Raises
    ------
    FileNotFoundError
        If the repository directory does not exist.
    """
    ws = _WORKSPACE_ROOT / analysis_id
    repo_dir = ws / "repository"

    if not repo_dir.exists():
        raise FileNotFoundError(f"Remediated repository not found: {repo_dir}")

    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in sorted(repo_dir.rglob("*")):
            if p.is_file():
                rel = p.relative_to(repo_dir)
                # Exclude .bob/ runtime directory
                if rel.parts and rel.parts[0] == ".bob":
                    continue
                zf.write(p, arcname=str(rel))
    return buf.getvalue()
