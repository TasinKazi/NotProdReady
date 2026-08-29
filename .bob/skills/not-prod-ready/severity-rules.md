# Severity Rules

## BLOCK

Assign BLOCK when the mismatch will **prevent** a successful deployment or cause
immediate runtime failure. Every BLOCK must be supported by concrete file or
command evidence.

Examples:
- The declared runtime version is incompatible with the application's `engines` field.
- A deployment script named in the runbook does not exist in `package.json`.
- A required environment variable is referenced in source code but absent from
  `.env.example` **and** the deployment runbook.

Unsupported BLOCK findings are **forbidden**.

## WARN

Assign WARN when the issue is a real risk but does not guarantee deployment failure.

Examples:
- A database migration file exists with no corresponding rollback artifact.
- A documented port differs from the application default, but the app accepts
  PORT via environment variable.

## PASS

Assign PASS when:
- The runbook claim matches repository reality.
- The field is undocumented in the runbook and no mismatch can be proven.
- The verifier returned REJECTED for a candidate finding.

## Scope

Only these four categories are in scope for this workflow:

1. **Runtime / configuration** — Node.js / Python / Java version, base image
2. **Deployment commands** — start, build, migration scripts
3. **Environment variables** — required vars documented vs. actually used
4. **Migration / rollback** — forward migrations with no rollback artifact

Do not flag:
- Security vulnerabilities or CVEs
- Code quality or style issues
- API contract changes
- Dependency versions (unless they directly affect runtime compatibility)
- CI/CD pipeline configuration
- Cloud infrastructure settings
