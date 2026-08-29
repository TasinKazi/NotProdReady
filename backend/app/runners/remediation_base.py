"""Abstract base for remediation runners."""
from __future__ import annotations

import abc
from collections.abc import Callable, Awaitable
from pathlib import Path

from app.models import Analysis, AnalysisEvent, ReleaseResult, RemediationResult

RemitEmitFn = Callable[[AnalysisEvent], Awaitable[None]]


class RemediationRunner(abc.ABC):
    """Abstract base for remediation runners."""

    @abc.abstractmethod
    async def remediate(
        self,
        analysis: Analysis,
        workspace: Path,
        emit_event: RemitEmitFn,
    ) -> RemediationResult:
        """Run Bob remediation, emit events, return the RemediationResult."""
        ...
