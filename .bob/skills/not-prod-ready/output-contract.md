# Output Contract

The canonical ReleaseResult must be written to:

`output/release-result.json`

This artifact is the PRIMARY machine-readable output consumed by NotProdReady.

Requirements:

- File must contain one raw JSON object.
- No Markdown.
- No code fences.
- No prose before or after the JSON.
- The object must validate against the schema below.
- The final assistant message must contain the exact same JSON object.

The BobShellRunner reads `output/release-result.json` first.

Assistant-message parsing exists only as a compatibility fallback if the artifact
is unexpectedly unavailable.
If the artifact is unavailable, the BobShellRunner may fall back to parsing
assistant messages for a valid ReleaseResult.

---

## Required JSON shape

```
{
  "analysis_id": "<string — use the analysis_id from the workspace if known, otherwise omit>",
  "app": "<string — application name>",
  "release": "<string — release version>",
  "environment": "<string — environment name>",
  "decision": "GO" | "NO-GO",
  "readiness_score": <integer 0–100>,
  "support_message": "<string — one sentence summarising the decision>",
  "summary": {
    "blockers": <integer>,
    "warnings": <integer>,
    "passed": <integer>
  },
  "findings": [
    {
      "id": "<string — e.g. F-001>",
      "category": "<string — one of: runtime, deployment, configuration, rollback>",
      "status": "BLOCK" | "WARN" | "PASS",
      "severity": "BLOCK" | "WARN" | "PASS",
      "title": "<string — short human-readable title>",
      "claim": "<string — what the runbook states>",
      "actual": "<string — what the repository actually requires>",
      "evidence": [
        {
          "type": "file" | "command" | "pattern" | "absence",
          "source": "<string — filename or command>",
          "value": "<string — the specific value found>",
          "file_path": "<string | null — relative path within workspace>",
          "command": "<string | null — command used if type=command>"
        }
      ],
      "explanation": "<string — why this is a finding>",
      "recommendation": "<string | null — how to fix it>",
      "runbook": "<string | null — runbook claim value, for UI display>",
      "repository": "<string | null — repository actual value, for UI display>",
      "missing": "<string | null — name of missing env var, if applicable>",
      "migration": "<string | null — migration file path, if applicable>",
      "evidence_text": "<string | null — flat summary for UI display>",
      "evidence_file": "<string | null — primary evidence file for UI display>"
    }
  ],
  "agent_activity": [
    {
      "id": "<string — e.g. A-001>",
      "timestamp": "<ISO 8601 string>",
      "action": "<string — tool name used>",
      "target": "<string — file or path inspected>",
      "result": "<string — brief outcome>",
      "status": "ok" | "warn" | "error"
    }
  ],
  "metadata": {
    "id": "<string — same as analysis_id>",
    "duration": "<string — e.g. '14.3 s'>",
    "files_inspected": <integer>,
    "commands_executed": <integer>,
    "completed_at": "<ISO 8601 string>"
  }
}
```

---

## Minimal valid example

This is the smallest JSON the parser will accept (omitting optional fields):

```json
{"analysis_id":"abc-001","app":"My App","release":"v1.0.0","environment":"Production","decision":"GO","readiness_score":95,"summary":{"blockers":0,"warnings":0,"passed":5},"findings":[{"id":"P-001","category":"runtime","status":"PASS","severity":"PASS","title":"Runtime version matches","claim":"Node 20","actual":"Node 20","evidence":[{"type":"file","source":"package.json","value":"engines.node = 20","file_path":"package.json"}],"explanation":"Runtime matches runbook."}],"agent_activity":[],"metadata":{"id":"abc-001","duration":"3.1 s","files_inspected":4,"commands_executed":0,"completed_at":"2025-01-14T10:00:00Z"}}
```

---

## Field notes

- `status` and `severity` must be identical values (both present for API compatibility).
- `evidence` must have at least one entry per finding.
- `agent_activity` may be populated from your tool call log or left as `[]` — the backend will fill it in from the stream if empty.
- `metadata` may be omitted — the backend will synthesise it from runtime stats if absent.
- `readiness_score` formula: `max(0, min(100, 100 - (blockers × 20) - (warnings × 5)))`
- The `findings` array must include ALL findings: BLOCK, WARN, and PASS.
- PASS findings require minimal evidence — a single file entry is sufficient.
