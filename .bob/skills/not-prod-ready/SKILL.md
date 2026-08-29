---
name: not-prod-ready
description: Validate release readiness by comparing deployment documentation against application evidence before production deployment.
---

# NotProdReady — Release Readiness Workflow

You are analyzing whether a software release is safe to deploy to production.

The workspace contains:

```
documents/        ← deployment documentation (runbook, etc.)
repository/       ← application source code
output/           ← write your final JSON result here
```

Execute the following phases in order.

---

## PHASE 1 — RUNBOOK UNDERSTANDING

Spawn one **Explore (read-only)** subagent using the `runbook-analyst` persona.

Scope it to `documents/` only.

Task: extract these deployment claims as concise structured JSON:

```json
{
  "runtime": null,
  "startup_command": null,
  "build_command": null,
  "port": null,
  "env_vars": [],
  "migration_instructions": null,
  "rollback_instructions": null
}
```

Rules:
- Do not inspect source code.
- Do not recommend fixes.
- Return `null` for any field not documented.
- Return compact JSON only — no prose.

---

## PHASE 2 — REPOSITORY REALITY

Spawn one **Explore (read-only)** subagent using the `repository-inspector` persona.

Scope it to `repository/` and pass the Phase 1 JSON claims.

Task: for each claim, find the actual value in the repository.

Files to inspect (inspect only those relevant to the claims):

- `package.json`
- `Dockerfile` / `docker-compose*.yml`
- `.env.example`
- Application config files
- Source files only where targeted evidence of environment variable usage is needed
- `migrations/` directory listing
- Deployment scripts

Return a JSON array:

```json
[
  {
    "claim_key": "runtime",
    "claim_value": "...",
    "actual_value": "...",
    "source": "package.json",
    "evidence": "engines.node = '>=20'"
  }
]
```

Rules:
- Inspect the minimum set of files needed to evaluate the claims.
- Prefer parallel reads for independent files.
- Do not perform a broad code review.
- Do not look for security issues, CVEs, or style problems.
- Stay within the four MVP categories: runtime, deployment commands, environment variables, migrations/rollback.

---

## PHASE 3 — COMPARE

You (the main agent) compare Phase 1 claims against Phase 2 actuals.

For each comparison, assign a candidate severity:

| Severity | Meaning |
|----------|---------|
| BLOCK    | Confirmed mismatch that will prevent a successful deployment |
| WARN     | Risk that may cause problems but does not guarantee failure |
| PASS     | Claim matches reality or is not applicable |

Do **not** send PASS findings to Phase 4.

MVP categories only:
1. Runtime / configuration
2. Deployment commands
3. Environment variables
4. Migration / rollback

---

## PHASE 4 — CONDITIONAL VERIFICATION

**Only execute this phase if candidate WARN or BLOCK findings exist.**

Spawn one **Explore (read-only)** subagent using the `release-verifier` persona.

Send it:
- The candidate WARN/BLOCK findings only (not the entire conversation).
- The specific evidence file paths already identified.

The verifier returns for each candidate:

- `CONFIRMED` — finding is real and supported by evidence
- `REJECTED` — finding is a false positive
- `INSUFFICIENT_EVIDENCE` — cannot confirm or deny

Only `CONFIRMED` findings may become final BLOCK or WARN findings.
`REJECTED` findings become PASS.
`INSUFFICIENT_EVIDENCE` findings become WARN.

---

## PHASE 5 — SAFE EXECUTION

You may execute a command only when it provides meaningful evidence that static analysis cannot provide.

Permitted examples:
- Verify that an npm script name exists: `npm run <script> --dry-run`
- Run a safe, non-destructive test: `npm test` (if fast and safe)

**Never:**
- Deploy or start servers
- Execute migrations
- Delete or modify files
- Access production infrastructure or credentials
- Run any destructive command

Prefer static evidence when sufficient.

---

## PHASE 6 — FINAL DECISION

Compute the readiness score:

```
score = 100 - (blockers × 20) - (warnings × 5)
score = max(0, min(100, score))
```

Decision rule:
- **NO-GO**: one or more confirmed BLOCK findings
- **GO**: no confirmed BLOCK findings

**Output rule — CRITICAL:**

Your final assistant message must contain **only** the JSON object described in the output contract.

- No prose before the JSON.
- No prose after the JSON.
- No Markdown code fences.
- No explanation.

The exact required schema is in `.bob/skills/not-prod-ready/output-contract.md`.

---

## FINAL RESPONSE REQUIREMENT

**This block overrides everything else.**

When the analysis is complete your very last message **must** be a single raw JSON
object and nothing else.

✗ WRONG — the parser will reject this:
```
Here is the analysis result:
{"decision": "NO-GO", ...}
The release is not ready.
```

✓ CORRECT — the parser will accept this:
```
{"decision":"NO-GO","readiness_score":61,...}
```

Rules — all are mandatory:
1. The message begins with `{` and ends with `}`.
2. No characters appear before the opening `{`.
3. No characters appear after the closing `}`.
4. No Markdown code fences (no triple backticks).
5. No explanatory prose anywhere in the message.
6. The JSON must satisfy every field in the output contract schema.
