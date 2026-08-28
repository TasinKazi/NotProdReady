from __future__ import annotations

import abc
import asyncio
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Callable, Awaitable

from app.models import Analysis, AnalysisEvent, ReleaseResult

EmitFn = Callable[[AnalysisEvent], Awaitable[None]]


class BobRunner(abc.ABC):
    """Abstract base for analysis runners.

    Implement this for each backend (mock, shell, …).
    """

    @abc.abstractmethod
    async def analyze(
        self,
        analysis: Analysis,
        workspace: Path,
        emit_event: EmitFn,
    ) -> ReleaseResult:
        """Run analysis, emit SSE events as work progresses, return the final result."""
        ...
