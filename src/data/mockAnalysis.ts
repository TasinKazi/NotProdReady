export type Severity = 'BLOCK' | 'WARN' | 'PASS'

export interface Finding {
  id: string
  title: string
  severity: Severity
  runbook?: string
  repository?: string
  missing?: string
  migration?: string
  evidence: string
  evidenceFile?: string
  recommendation?: string
  detail?: string
}

export interface AgentStep {
  id: string
  timestamp: string
  action: string
  target: string
  result: string
  status: 'ok' | 'warn' | 'error'
}

export interface AnalysisMeta {
  id: string
  duration: string
  filesInspected: number
  commandsExecuted: number
  completedAt: string
}

export interface MockAnalysis {
  app: string
  release: string
  environment: string
  decision: 'NO-GO' | 'GO'
  readiness: { score: number }
  summary: { blockers: number; warnings: number; passed: number }
  findings: Finding[]
  agentActivity: AgentStep[]
  analysis: AnalysisMeta
}

export const mockAnalysis: MockAnalysis = {
  app: 'NorthRiver Payments API',
  release: 'v2.4.0',
  environment: 'Production',
  decision: 'NO-GO',
  readiness: { score: 61 },
  summary: { blockers: 3, warnings: 1, passed: 8 },
  findings: [
    // ── Blockers ─────────────────────────────────────────────
    {
      id: 'F-001',
      title: 'Runtime compatibility',
      severity: 'BLOCK',
      runbook: 'Node.js 18',
      repository: 'Node >=20',
      evidence: 'package.json → engines.node',
      evidenceFile: 'package.json',
      recommendation: 'Update production runtime and documentation to Node.js 20+.',
    },
    {
      id: 'F-002',
      title: 'Deployment command',
      severity: 'BLOCK',
      runbook: 'npm run production',
      repository: 'npm start',
      evidence: 'package.json → scripts',
      evidenceFile: 'package.json',
    },
    {
      id: 'F-003',
      title: 'Environment configuration',
      severity: 'BLOCK',
      missing: 'PAYMENTS_API_KEY',
      evidence:
        'Referenced in src/services/paymentService.js but absent from .env.example and deployment runbook.',
      evidenceFile: 'src/services/paymentService.js',
    },
    // ── Warnings ─────────────────────────────────────────────
    {
      id: 'F-004',
      title: 'Rollback readiness',
      severity: 'WARN',
      migration: 'migrations/002_add_payment_status.sql',
      evidence: 'No rollback artifact found.',
      evidenceFile: 'migrations/002_add_payment_status.sql',
    },
    // ── Passed ───────────────────────────────────────────────
    {
      id: 'P-001',
      title: 'Health-check endpoint responding',
      severity: 'PASS',
      evidence: 'GET /health returned 200 OK.',
      evidenceFile: 'src/routes/health.js',
    },
    {
      id: 'P-002',
      title: 'OpenAPI specification present and parseable',
      severity: 'PASS',
      evidence: 'openapi.yaml parsed without errors.',
      evidenceFile: 'openapi.yaml',
    },
    {
      id: 'P-003',
      title: 'Dockerfile present',
      severity: 'PASS',
      evidence: 'Dockerfile found at repository root.',
      evidenceFile: 'Dockerfile',
    },
    {
      id: 'P-004',
      title: '.dockerignore present',
      severity: 'PASS',
      evidence: '.dockerignore found at repository root.',
      evidenceFile: '.dockerignore',
    },
    {
      id: 'P-005',
      title: 'CI workflow present',
      severity: 'PASS',
      evidence: '.github/workflows/deploy.yml found and parseable.',
      evidenceFile: '.github/workflows/deploy.yml',
    },
    {
      id: 'P-006',
      title: 'Dependency audit — no critical CVEs',
      severity: 'PASS',
      evidence: 'npm audit returned 0 critical vulnerabilities.',
    },
    {
      id: 'P-007',
      title: 'Secrets scan — no hardcoded credentials',
      severity: 'PASS',
      evidence: 'No hardcoded API keys, passwords, or tokens detected.',
    },
    {
      id: 'P-008',
      title: 'README present',
      severity: 'PASS',
      evidence: 'README.md found at repository root.',
      evidenceFile: 'README.md',
    },
  ],
  agentActivity: [
    {
      id: 'A-001',
      timestamp: '2026-08-29T10:03:58Z',
      action: 'read_file',
      target: 'deployment-runbook.md',
      result: 'Parsed Node.js version, deploy command, env requirements.',
      status: 'ok',
    },
    {
      id: 'A-002',
      timestamp: '2026-08-29T10:04:03Z',
      action: 'read_file',
      target: 'package.json',
      result: 'Extracted engines.node and scripts entries.',
      status: 'ok',
    },
    {
      id: 'A-003',
      timestamp: '2026-08-29T10:04:07Z',
      action: 'grep',
      target: 'src/services/paymentService.js',
      result: 'Found PAYMENTS_API_KEY reference; absent from .env.example.',
      status: 'error',
    },
    {
      id: 'A-004',
      timestamp: '2026-08-29T10:04:11Z',
      action: 'list_files',
      target: 'migrations/',
      result: 'Found 002_add_payment_status.sql. No corresponding rollback file.',
      status: 'warn',
    },
    {
      id: 'A-005',
      timestamp: '2026-08-29T10:04:14Z',
      action: 'grep',
      target: '.env.example',
      result: 'Scanned all environment variable declarations.',
      status: 'ok',
    },
    {
      id: 'A-006',
      timestamp: '2026-08-29T10:04:21Z',
      action: 'read_file',
      target: '.github/workflows/deploy.yml',
      result: 'Confirmed CI node version matrix does not cover Node 18.',
      status: 'ok',
    },
  ],
  analysis: {
    id: 'bob-analysis-20260829-100421',
    duration: '23.4 s',
    filesInspected: 23,
    commandsExecuted: 6,
    completedAt: '2026-08-29T10:04:21Z',
  },
}
