# ⚖️ NotProdReady — Judge's Quick Guide

Welcome IBM Dev Day Hackathon judges! Follow these five steps to experience NotProdReady's complete release-readiness workflow.

---

### Step 1: Open the live application

Visit [https://notprodready.onrender.com](https://notprodready.onrender.com) and enter a valid email address to access the NotProdReady workspace.

### Step 2: Load the competition sample

Open **Analyze a release**, select **Load competition sample**, and then select **Analyze with IBM Bob**.

The sample automatically loads the **NorthRiver Payments API v2.4.0** repository and its production deployment runbook.

### Step 3: Watch the multi-agent IBM Bob workflow

Follow the live agent activity as structured evidence flows through three specialized agents:

- **Runbook Analyst Agent** extracts runtime, command, environment-variable, migration, and rollback requirements.
- **Repository Inspector Agent** compares those requirements with evidence from the repository.
- **Release Verifier Agent** independently challenges candidate WARN and BLOCK findings.

The main IBM Bob agent uses the verified findings to produce an evidence-backed **GO** or **NO-GO** release decision.

### Step 4: Review the release-readiness decision

On the results page, review the readiness score and open the four result views:

- **Overview** — final GO or NO-GO decision and release summary
- **Findings** — confirmed blockers, warnings, passed checks, and recommended actions
- **Evidence** — documented claims compared with repository evidence
- **Agent Activity** — traceable activity from the IBM Bob agents

The NorthRiver sample demonstrates a **NO-GO** decision caused by confirmed mismatches between the deployment runbook and repository.

### Step 5: Ask Bob to remediate and download the repository

Select **Ask Bob to remediate**. IBM Bob applies targeted corrections only to an isolated copy of the repository while preserving the original upload and analysis.

When remediation finishes:

- Review every file IBM Bob created, modified, or deleted.
- Review which confirmed findings were addressed.
- Select **Download remediated repository** to download the corrected ZIP archive.

---

## IBM Bob implementation evidence

| Component | Repository location |
|---|---|
| Bob-native Skill | [`.bob/skills/not-prod-ready/SKILL.md`](./.bob/skills/not-prod-ready/SKILL.md) |
| Runbook Analyst Agent | [`.bob/agents/runbook-analyst.md`](./.bob/agents/runbook-analyst.md) |
| Repository Inspector Agent | [`.bob/agents/repository-inspector.md`](./.bob/agents/repository-inspector.md) |
| Release Verifier Agent | [`.bob/agents/release-verifier.md`](./.bob/agents/release-verifier.md) |
| ReleaseResult contract | [`.bob/skills/not-prod-ready/output-contract.md`](./.bob/skills/not-prod-ready/output-contract.md) |
| Bob analysis runner | [`backend/app/runners/shell.py`](./backend/app/runners/shell.py) |
| Bob remediation runner | [`backend/app/runners/shell_remediation.py`](./backend/app/runners/shell_remediation.py) |
| IBM Bob task-session summaries | [`bob_sessions/`](./bob_sessions/) |

> The `BOB_API_KEY` is supplied only through the deployment environment. No API key or credential is stored in this repository.
