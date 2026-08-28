"""MockBobRunner — simulates the NorthRiver Payments API analysis.

Emits the same sequence of events the real BobShellRunner will produce,
at a compressed cadence suitable for local development.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path

from app.models import (
    AgentStep,
    AgentStepStatus,
    Analysis,
    AnalysisEvent,
    AnalysisMetadata,
    Decision,
    Evidence,
    EvidenceType,
    Finding,
    FindingSeverity,
    ReadinessSummary,
    ReleaseResult,
)
from app.runners.base import BobRunner, EmitFn

# ── Timing constants ──────────────────────────────────────────────────────────

_STEP_DELAY = 0.35  # seconds between event emissions


# ── Mock result data (matches NorthRiver sample) ──────────────────────────────

_MOCK_FINDINGS: list[Finding] = [
    Finding(
        id="F-001",
        category="runtime",
        status=FindingSeverity.BLOCK,
        severity=FindingSeverity.BLOCK,
        title="Runtime compatibility",
        claim="Node.js 18",
        actual="Node >=20",
        evidence=[
            Evidence(
                type=EvidenceType.FILE,
                source="package.json",
                value="engines.node = '>=20'",
                file_path="package.json",
            )
        ],
        explanation=(
            "The deployment runbook specifies Node.js 18, but the repository "
            "declares engines.node >=20. The runtime is incompatible with the "
            "deployed application."
        ),
        recommendation="Update production runtime and deployment documentation to Node.js 20+.",
        runbook="Node.js 18",
        repository="Node >=20",
        evidence_text="package.json → engines.node",
        evidence_file="package.json",
    ),
    Finding(
        id="F-002",
        category="deployment",
        status=FindingSeverity.BLOCK,
        severity=FindingSeverity.BLOCK,
        title="Deployment command",
        claim="npm run production",
        actual="npm start",
        evidence=[
            Evidence(
                type=EvidenceType.FILE,
                source="package.json",
                value="scripts.start = 'node server.js'  (no 'production' script)",
                file_path="package.json",
            )
        ],
        explanation=(
            "The runbook instructs the operator to run 'npm run production', "
            "but this script does not exist in package.json. The correct "
            "command is 'npm start'."
        ),
        recommendation="Update the runbook to use 'npm start' as the deployment command.",
        runbook="npm run production",
        repository="npm start",
        evidence_text="package.json → scripts",
        evidence_file="package.json",
    ),
    Finding(
        id="F-003",
        category="configuration",
        status=FindingSeverity.BLOCK,
        severity=FindingSeverity.BLOCK,
        title="Environment configuration",
        claim="Deployment configuration is complete",
        actual="PAYMENTS_API_KEY is required but undocumented",
        evidence=[
            Evidence(
                type=EvidenceType.PATTERN,
                source="src/services/paymentService.js",
                value="process.env.PAYMENTS_API_KEY",
                file_path="src/services/paymentService.js",
            ),
            Evidence(
                type=EvidenceType.ABSENCE,
                source=".env.example",
                value="PAYMENTS_API_KEY not listed",
                file_path=".env.example",
            ),
        ],
        explanation=(
            "PAYMENTS_API_KEY is referenced in paymentService.js but is absent "
            "from both .env.example and the deployment runbook. The service will "
            "fail at runtime without this key."
        ),
        missing="PAYMENTS_API_KEY",
        evidence_text=(
            "Referenced in src/services/paymentService.js but absent "
            "from .env.example and deployment runbook."
        ),
        evidence_file="src/services/paymentService.js",
    ),
    Finding(
        id="F-004",
        category="rollback",
        status=FindingSeverity.WARN,
        severity=FindingSeverity.WARN,
        title="Rollback readiness",
        claim="Release is rollback-ready",
        actual="Migration exists without rollback artifact",
        evidence=[
            Evidence(
                type=EvidenceType.FILE,
                source="migrations/002_add_payment_status.sql",
                value="Forward migration present; no rollback SQL found",
                file_path="migrations/002_add_payment_status.sql",
            )
        ],
        explanation=(
            "migrations/002_add_payment_status.sql applies a schema change, "
            "but no corresponding rollback script was found."
        ),
        migration="migrations/002_add_payment_status.sql",
        evidence_text="No rollback artifact found.",
        evidence_file="migrations/002_add_payment_status.sql",
    ),
    # ── 8 PASS findings ───────────────────────────────────────────────────────
    Finding(
        id="F-005",
        category="health",
        status=FindingSeverity.PASS,
        severity=FindingSeverity.PASS,
        title="Health-check endpoint",
        claim="GET /health returns 200",
        actual="Endpoint found and correct",
        evidence=[Evidence(type=EvidenceType.FILE, source="src/routes/health.js", value="router.get('/health', ...)", file_path="src/routes/health.js")],
        explanation="Health check endpoint is present and correctly implemented.",
    ),
    Finding(
        id="F-006",
        category="documentation",
        status=FindingSeverity.PASS,
        severity=FindingSeverity.PASS,
        title="OpenAPI spec",
        claim="OpenAPI spec present and parseable",
        actual="Valid spec found",
        evidence=[Evidence(type=EvidenceType.FILE, source="openapi.yaml", value="openapi: 3.0.0", file_path="openapi.yaml")],
        explanation="OpenAPI specification is present and well-formed.",
    ),
    Finding(
        id="F-007",
        category="container",
        status=FindingSeverity.PASS,
        severity=FindingSeverity.PASS,
        title="Dockerfile",
        claim="Dockerfile present",
        actual="Dockerfile found",
        evidence=[Evidence(type=EvidenceType.FILE, source="Dockerfile", value="FROM node:20-alpine", file_path="Dockerfile")],
        explanation="Dockerfile is present.",
    ),
    Finding(
        id="F-008",
        category="container",
        status=FindingSeverity.PASS,
        severity=FindingSeverity.PASS,
        title=".dockerignore",
        claim=".dockerignore present",
        actual=".dockerignore found",
        evidence=[Evidence(type=EvidenceType.FILE, source=".dockerignore", value="node_modules", file_path=".dockerignore")],
        explanation=".dockerignore is present.",
    ),
    Finding(
        id="F-009",
        category="ci",
        status=FindingSeverity.PASS,
        severity=FindingSeverity.PASS,
        title="CI workflow",
        claim="CI workflow present",
        actual=".github/workflows/deploy.yml found",
        evidence=[Evidence(type=EvidenceType.FILE, source=".github/workflows/deploy.yml", value="on: push", file_path=".github/workflows/deploy.yml")],
        explanation="CI deployment workflow is present.",
    ),
    Finding(
        id="F-010",
        category="security",
        status=FindingSeverity.PASS,
        severity=FindingSeverity.PASS,
        title="Dependency audit",
        claim="No critical CVEs",
        actual="Audit passed",
        evidence=[Evidence(type=EvidenceType.COMMAND, source="npm audit", value="found 0 critical")],
        explanation="Dependency audit found no critical vulnerabilities.",
    ),
    Finding(
        id="F-011",
        category="security",
        status=FindingSeverity.PASS,
        severity=FindingSeverity.PASS,
        title="Secrets scan",
        claim="No hardcoded credentials",
        actual="Scan passed",
        evidence=[Evidence(type=EvidenceType.COMMAND, source="secrets scan", value="0 findings")],
        explanation="No hardcoded credentials detected.",
    ),
    Finding(
        id="F-012",
        category="documentation",
        status=FindingSeverity.PASS,
        severity=FindingSeverity.PASS,
        title="README",
        claim="README present",
        actual="README.md found",
        evidence=[Evidence(type=EvidenceType.FILE, source="README.md", value="# NorthRiver Payments API", file_path="README.md")],
        explanation="README is present.",
    ),
]

_MOCK_AGENT_STEPS: list[AgentStep] = [
    AgentStep(id="A-001", timestamp="", action="read_file", target="deployment-runbook.md", result="Parsed Node.js version, deploy command, env requirements.", status=AgentStepStatus.OK),
    AgentStep(id="A-002", timestamp="", action="read_file", target="package.json", result="Extracted engines.node and scripts entries.", status=AgentStepStatus.OK),
    AgentStep(id="A-003", timestamp="", action="grep", target="src/services/paymentService.js", result="Found PAYMENTS_API_KEY reference; absent from .env.example.", status=AgentStepStatus.ERROR),
    AgentStep(id="A-004", timestamp="", action="list_files", target="migrations/", result="Found 002_add_payment_status.sql. No corresponding rollback file.", status=AgentStepStatus.WARN),
    AgentStep(id="A-005", timestamp="", action="grep", target=".env.example", result="Scanned all environment variable declarations.", status=AgentStepStatus.OK),
    AgentStep(id="A-006", timestamp="", action="read_file", target=".github/workflows/deploy.yml", result="Confirmed CI node version matrix does not cover Node 18.", status=AgentStepStatus.OK),
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class MockBobRunner(BobRunner):
    """Simulates the NorthRiver analysis without invoking the real Bob shell."""

    async def analyze(
        self,
        analysis: Analysis,
        workspace: Path,
        emit_event: EmitFn,
    ) -> ReleaseResult:
        start_time = datetime.now(timezone.utc)
        seq = 0

        async def emit(event: str, data: dict) -> None:
            nonlocal seq
            seq += 1
            await emit_event(AnalysisEvent(event=event, data=data, sequence=seq))
            await asyncio.sleep(_STEP_DELAY)

        # ── 1. Started ────────────────────────────────────────────────────────
        await emit("analysis.started", {
            "analysis_id": analysis.analysis_id,
            "application_name": analysis.application_name,
            "release_version": analysis.release_version,
            "environment": analysis.environment,
        })

        # ── 2. Document analysis ──────────────────────────────────────────────
        await emit("document.analysis.started", {"file": "deployment-runbook.md"})

        await emit("document.requirement.found", {
            "type": "runtime",
            "key": "node_version",
            "value": "Node.js 18",
            "source": "deployment-runbook.md",
        })

        await emit("document.requirement.found", {
            "type": "deploy_command",
            "key": "start_command",
            "value": "npm run production",
            "source": "deployment-runbook.md",
        })

        await emit("document.analysis.completed", {
            "requirements_found": 2,
            "file": "deployment-runbook.md",
        })

        # ── 3. Repository analysis ────────────────────────────────────────────
        await emit("repository.analysis.started", {"path": "repository/"})

        for filename in [
            "package.json",
            ".env.example",
            "src/services/paymentService.js",
            "migrations/002_add_payment_status.sql",
        ]:
            await emit("repository.file.inspected", {"file": filename})

        # ── 4. Findings ───────────────────────────────────────────────────────
        for finding in _MOCK_FINDINGS:
            if finding.severity in (FindingSeverity.BLOCK, FindingSeverity.WARN):
                await emit("finding.detected", {
                    "finding_id": finding.id,
                    "title": finding.title,
                    "severity": finding.severity.value,
                    "claim": finding.claim,
                    "actual": finding.actual,
                })

        # ── 5. Verification ───────────────────────────────────────────────────
        await emit("verification.started", {})
        await emit("verification.completed", {
            "blockers": 3,
            "warnings": 1,
            "passed": 8,
        })

        # ── 6. Synthesizing ───────────────────────────────────────────────────
        await emit("analysis.synthesizing", {"decision": "NO-GO", "score": 61})

        # ── 7. Completed ──────────────────────────────────────────────────────
        end_time = datetime.now(timezone.utc)
        duration_s = (end_time - start_time).total_seconds()

        # Stamp agent step timestamps
        stamped_steps: list[AgentStep] = []
        for i, step in enumerate(_MOCK_AGENT_STEPS):
            stamped_steps.append(
                step.model_copy(
                    update={"timestamp": f"{start_time.isoformat()}"}
                )
            )

        result = ReleaseResult(
            analysis_id=analysis.analysis_id,
            app=analysis.application_name,
            release=analysis.release_version,
            environment=analysis.environment,
            decision=Decision.NO_GO,
            readiness_score=61,
            summary=ReadinessSummary(blockers=3, warnings=1, passed=8),
            findings=_MOCK_FINDINGS,
            agent_activity=stamped_steps,
            metadata=AnalysisMetadata(
                id=analysis.analysis_id,
                duration=f"{duration_s:.1f} s",
                files_inspected=23,
                commands_executed=6,
                completed_at=end_time.isoformat(),
            ),
            support_message=(
                "Release blockers were found between the deployment runbook "
                "and the actual application."
            ),
        )

        await emit("analysis.completed", {
            "analysis_id": analysis.analysis_id,
            "decision": "NO-GO",
            "score": 61,
        })

        return result
