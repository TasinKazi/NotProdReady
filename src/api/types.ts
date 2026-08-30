/**
 * API types mirroring the backend Pydantic models.
 * These are the shapes returned by the FastAPI backend.
 */

export type AnalysisStatus =
  | 'QUEUED'
  | 'PREPARING'
  | 'ANALYZING_DOCUMENT'
  | 'INSPECTING_REPOSITORY'
  | 'VERIFYING'
  | 'SYNTHESIZING'
  | 'COMPLETED'
  | 'FAILED'

export type FindingSeverity = 'PASS' | 'WARN' | 'BLOCK'
export type Decision = 'GO' | 'NO-GO'
export type EvidenceType = 'file' | 'command' | 'pattern' | 'absence'

export interface ApiEvidence {
  type: EvidenceType
  source: string
  value: string
  file_path?: string
  command?: string
}

export interface ApiFinding {
  id: string
  category: string
  status: FindingSeverity
  severity: FindingSeverity
  title: string
  claim: string
  actual: string
  evidence: ApiEvidence[]
  explanation: string
  recommendation?: string
  // Legacy UI-compat fields populated by backend
  runbook?: string
  repository?: string
  missing?: string
  migration?: string
  evidence_text?: string
  evidence_file?: string
}

export interface ApiAgentStep {
  id: string
  timestamp: string
  action: string
  target: string
  result: string
  status: 'ok' | 'warn' | 'error'
}

export interface ApiAnalysisMetadata {
  id: string
  duration: string
  files_inspected: number
  commands_executed: number
  completed_at: string
}

export interface ApiReadinessSummary {
  blockers: number
  warnings: number
  passed: number
}

export interface ApiReleaseResult {
  analysis_id: string
  app: string
  release: string
  environment: string
  decision: Decision
  readiness_score: number
  summary: ApiReadinessSummary
  findings: ApiFinding[]
  agent_activity: ApiAgentStep[]
  metadata: ApiAnalysisMetadata
  support_message?: string
}

export type RemediationStatus =
  | 'QUEUED'
  | 'SNAPSHOTTING'
  | 'REMEDIATING'
  | 'AUDITING'
  | 'COMPLETED'
  | 'FAILED'

export type FileChangeType = 'modified' | 'created' | 'deleted'

export interface ApiFileChange {
  path: string
  change_type: FileChangeType
}

export interface ApiRemediationResult {
  status: string
  summary: string
  files_changed: ApiFileChange[]
  findings_addressed: string[]
  findings_not_addressed: string[]
  notes?: string
}

export interface RemediationCreatedResponse {
  remediation_id: string
  analysis_id: string
  status: RemediationStatus
}

export interface RemediationStatusResponse {
  remediation_id: string
  analysis_id: string
  status: RemediationStatus
  created_at: string
  error?: string
  result?: ApiRemediationResult
  revalidation_analysis_id?: string
}

export interface AnalysisCreatedResponse {
  analysis_id: string
  status: AnalysisStatus
}

export interface AnalysisStatusResponse {
  analysis_id: string
  application_name: string
  release_version: string
  environment: string
  status: AnalysisStatus
  created_at: string
  error?: string
  // Populated for COMPLETED analyses
  decision?: string
  readiness_score?: number
  blockers?: number
}

/** A normalized SSE message payload. */
export interface SseMessage {
  event: string
  data: Record<string, unknown>
  sequence: number
}
