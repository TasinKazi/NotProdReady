"""MockRemediationRunner — deterministic remediation demo without real Bob.

Writes real file changes into workspace/repository/ so the auditing
mechanism (compute_repository_changes) detects actual diffs.

Changes applied:
  - workspace/repository/.env.example  CREATED   — documents PAYMENTS_API_KEY
  - workspace/repository/package.json  MODIFIED  — adds runbook reference comment

These correspond to NorthRiver findings F-003 (missing env var) and
F-001/F-002 (Node.js / deployment command mismatch documented for ops).

The documents/deployment-runbook.md lives outside repository/ and is
intentionally NOT touched by the mock — it is the operator's runbook and
the real analysis context; Bob would update it in shell mode if needed.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

from app.models import (
    Analysis,
    AnalysisEvent,
    RemediationResult,
)
from app.runners.remediation_base import RemediationRunner, RemitEmitFn

_STEP_DELAY = 0.30

# ── Deterministic file contents written by mock remediation ──────────────────

_ENV_EXAMPLE_CONTENT = """\
# NorthRiver Payments API — environment variables
# Copy to .env and fill in real values before deployment.

# Server
PORT=3000
NODE_ENV=production

# Database
DATABASE_URL=postgresql://user:pass@localhost/northriver

# Payments (REQUIRED — service will not start without this)
PAYMENTS_API_KEY=<your-payments-gateway-api-key>
"""

_PACKAGE_JSON_RUNBOOK_COMMENT = (
    "  /* deployment: use 'npm start' — see deployment-runbook.md */"
)


class MockRemediationRunner(RemediationRunner):
    """Simulates Bob remediation for the NorthRiver demo without real Bob cost.

    Writes deterministic changes into workspace/repository/ so the
    filesystem audit detects real diffs.
    """

    async def remediate(
        self,
        analysis: Analysis,
        workspace: Path,
        emit_event: RemitEmitFn,
    ) -> RemediationResult:
        seq = 0

        async def emit(event: str, data: dict) -> None:
            nonlocal seq
            seq += 1
            await emit_event(AnalysisEvent(event=event, data=data, sequence=seq))
            await asyncio.sleep(_STEP_DELAY)

        await emit("remediation.started", {
            "analysis_id": analysis.analysis_id,
            "application_name": analysis.application_name,
            "release_version": analysis.release_version,
            "environment": analysis.environment,
        })

        await emit("remediation.reviewing", {
            "detail": "Reviewing confirmed BLOCK and WARN findings",
        })

        repo_dir = workspace / "repository"

        # ── Change 1: create .env.example documenting PAYMENTS_API_KEY (F-003) ─
        env_example = repo_dir / ".env.example"
        env_written = False
        if repo_dir.exists():
            try:
                env_example.write_text(_ENV_EXAMPLE_CONTENT, encoding="utf-8")
                env_written = True
                await emit("remediation.file.changed", {
                    "file": ".env.example",
                    "detail": "Created .env.example documenting PAYMENTS_API_KEY (F-003)",
                })
            except Exception:  # noqa: BLE001
                pass

        # ── Change 2: annotate package.json with deployment command note (F-001/F-002) ─
        pkg_json = repo_dir / "package.json"
        pkg_written = False
        if pkg_json.exists():
            try:
                raw = pkg_json.read_text(encoding="utf-8")
                pkg = json.loads(raw)
                # Add a scripts.deploy entry pointing to the correct command
                if "deploy" not in pkg.get("scripts", {}):
                    pkg.setdefault("scripts", {})["deploy"] = "npm start"
                    pkg_json.write_text(
                        json.dumps(pkg, indent=2, ensure_ascii=False) + "\n",
                        encoding="utf-8",
                    )
                    pkg_written = True
                    await emit("remediation.file.changed", {
                        "file": "package.json",
                        "detail": (
                            "Added scripts.deploy = 'npm start' to align with "
                            "Node.js 20+ runtime and correct deployment command (F-001, F-002)"
                        ),
                    })
            except Exception:  # noqa: BLE001
                pass

        await emit("remediation.validating", {
            "detail": "Validating modified files",
        })

        await emit("remediation.completed", {
            "findings_addressed": 3,
            # file count will be overwritten by audited diff — emit as informational
            "files_changed": int(env_written) + int(pkg_written),
        })

        # Return Bob's self-reported result.
        # The API layer replaces files_changed with the audited filesystem diff.
        findings_addressed = ["F-001", "F-002", "F-003"]
        findings_not_addressed = ["F-004"]

        # Build preliminary list; will be overridden by audit in _run_remediation
        from app.models import FileChange, FileChangeType
        preliminary_changes: list[FileChange] = []
        if env_written:
            preliminary_changes.append(
                FileChange(path=".env.example", change_type=FileChangeType.CREATED)
            )
        if pkg_written:
            preliminary_changes.append(
                FileChange(path="package.json", change_type=FileChangeType.MODIFIED)
            )

        return RemediationResult(
            status="completed",
            summary=(
                "Applied targeted changes to the repository: "
                "created .env.example documenting the required PAYMENTS_API_KEY "
                "environment variable (F-003), and added a scripts.deploy entry "
                "to package.json confirming the correct deployment command "
                "(F-001, F-002)."
            ),
            files_changed=preliminary_changes,
            findings_addressed=findings_addressed,
            findings_not_addressed=findings_not_addressed,
            notes=(
                "F-004 (rollback readiness) requires a database rollback SQL script — "
                "not addressed as this requires application-specific knowledge."
            ),
        )
