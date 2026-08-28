from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field


# ── Enumerations ─────────────────────────────────────────────────────────────


class AnalysisStatus(str, Enum):
    QUEUED = "QUEUED"
    PREPARING = "PREPARING"
    ANALYZING_DOCUMENT = "ANALYZING_DOCUMENT"
    INSPECTING_REPOSITORY = "INSPECTING_REPOSITORY"
    VERIFYING = "VERIFYING"
    SYNTHESIZING = "SYNTHESIZING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class FindingSeverity(str, Enum):
    PASS = "PASS"
    WARN = "WARN"
    BLOCK = "BLOCK"


class Decision(str, Enum):
    GO = "GO"
    NO_GO = "NO-GO"


class EvidenceType(str, Enum):
    FILE = "file"
    COMMAND = "command"
    PATTERN = "pattern"
    ABSENCE = "absence"


# ── Evidence ─────────────────────────────────────────────────────────────────


class Evidence(BaseModel):
    type: EvidenceType
    source: str
    value: str
    file_path: Optional[str] = None
    command: Optional[str] = None


# ── Finding ───────────────────────────────────────────────────────────────────


class Finding(BaseModel):
    id: str
    category: str
    status: FindingSeverity
    severity: FindingSeverity  # alias for UI compat
    title: str
    claim: str
    actual: str
    evidence: list[Evidence]
    explanation: str
    recommendation: Optional[str] = None

    # UI-compat optional fields (mapped from claim/actual)
    runbook: Optional[str] = None
    repository: Optional[str] = None
    missing: Optional[str] = None
    migration: Optional[str] = None
    evidence_text: Optional[str] = None  # flat string for legacy UI
    evidence_file: Optional[str] = None  # primary evidence file for legacy UI


# ── Agent step (for activity log) ─────────────────────────────────────────────


class AgentStepStatus(str, Enum):
    OK = "ok"
    WARN = "warn"
    ERROR = "error"


class AgentStep(BaseModel):
    id: str
    timestamp: str
    action: str
    target: str
    result: str
    status: AgentStepStatus


# ── Analysis metadata ─────────────────────────────────────────────────────────


class AnalysisMetadata(BaseModel):
    id: str
    duration: str
    files_inspected: int
    commands_executed: int
    completed_at: str


# ── Release result ────────────────────────────────────────────────────────────


class ReadinessSummary(BaseModel):
    blockers: int
    warnings: int
    passed: int


class ReleaseResult(BaseModel):
    analysis_id: str
    app: str
    release: str
    environment: str
    decision: Decision
    readiness_score: int
    summary: ReadinessSummary
    findings: list[Finding]
    agent_activity: list[AgentStep]
    metadata: AnalysisMetadata
    support_message: Optional[str] = None


# ── Analysis (in-memory record) ───────────────────────────────────────────────


class Analysis(BaseModel):
    analysis_id: str
    application_name: str
    release_version: str
    environment: str
    status: AnalysisStatus = AnalysisStatus.QUEUED
    created_at: datetime = Field(default_factory=datetime.utcnow)
    workspace_path: Optional[str] = None
    result: Optional[ReleaseResult] = None
    error: Optional[str] = None


# ── API request / response ────────────────────────────────────────────────────


class AnalysisCreatedResponse(BaseModel):
    analysis_id: str
    status: AnalysisStatus


class AnalysisStatusResponse(BaseModel):
    analysis_id: str
    application_name: str
    release_version: str
    environment: str
    status: AnalysisStatus
    created_at: datetime
    error: Optional[str] = None


# ── SSE event ─────────────────────────────────────────────────────────────────


class AnalysisEvent(BaseModel):
    event: str
    data: dict[str, Any] = Field(default_factory=dict)
    sequence: int = 0
