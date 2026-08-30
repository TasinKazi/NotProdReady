/**
 * API client for the NotProdReady FastAPI backend.
 * All fetch calls are centralized here — no direct fetch in UI components.
 */

import type {
  AnalysisCreatedResponse,
  AnalysisStatusResponse,
  ApiReleaseResult,
  RemediationCreatedResponse,
  RemediationStatusResponse,
  SseMessage,
} from './types'

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = await res.json()
      detail = body?.detail ?? detail
    } catch {
      // ignore
    }
    throw new Error(detail)
  }
  return res.json() as Promise<T>
}

// ── Analyses ──────────────────────────────────────────────────────────────────

/**
 * POST /api/analyses
 *
 * Pass `useSample: true` to run the NorthRiver sample without uploading files.
 */
export async function createAnalysis(params: {
  applicationName: string
  releaseVersion: string
  environment: string
  repository?: File
  deploymentRunbook?: File
  useSample?: boolean
}): Promise<AnalysisCreatedResponse> {
  const form = new FormData()
  form.append('application_name', params.applicationName)
  form.append('release_version', params.releaseVersion)
  form.append('environment', params.environment)
  form.append('use_sample', params.useSample ? 'true' : 'false')

  if (params.repository) {
    form.append('repository', params.repository)
  }
  if (params.deploymentRunbook) {
    form.append('deployment_runbook', params.deploymentRunbook)
  }

  const res = await fetch(`${BASE_URL}/api/analyses`, {
    method: 'POST',
    body: form,
  })
  return handleResponse<AnalysisCreatedResponse>(res)
}

/**
 * GET /api/analyses  (list all analyses)
 */
export async function listAnalyses(): Promise<AnalysisStatusResponse[]> {
  const res = await fetch(`${BASE_URL}/api/analyses`)
  return handleResponse<AnalysisStatusResponse[]>(res)
}

/**
 * GET /api/analyses/{analysis_id}
 */
export async function getAnalysisStatus(
  analysisId: string,
): Promise<AnalysisStatusResponse> {
  const res = await fetch(`${BASE_URL}/api/analyses/${analysisId}`)
  return handleResponse<AnalysisStatusResponse>(res)
}

/**
 * GET /api/analyses/{analysis_id}/result
 */
export async function getAnalysisResult(
  analysisId: string,
): Promise<ApiReleaseResult> {
  const res = await fetch(`${BASE_URL}/api/analyses/${analysisId}/result`)
  return handleResponse<ApiReleaseResult>(res)
}

/**
 * GET /api/analyses/{analysis_id}/events  (SSE)
 *
 * Opens a Server-Sent Events connection.
 * Calls onMessage for each parsed message event.
 * Calls onDone when the server signals completion.
 * Calls onError on connection or parse failure.
 * Returns a cleanup function that closes the EventSource.
 */
export function subscribeToEvents(
  analysisId: string,
  callbacks: {
    onMessage: (msg: SseMessage) => void
    onDone: () => void
    onError: (err: string) => void
  },
): () => void {
  const url = `${BASE_URL}/api/analyses/${analysisId}/events`
  const es = new EventSource(url)

  // 'done' received — any subsequent onerror is just the normal TCP close.
  let completed = false
  // Count consecutive errors. EventSource auto-reconnects; only surface a
  // warning to the UI after 3 consecutive failures so a single blip doesn't
  // break the progress screen. Do NOT close the EventSource on first error.
  let errorCount = 0

  es.addEventListener('message', (e) => {
    errorCount = 0  // reset on any successful frame
    try {
      const parsed = JSON.parse(e.data) as SseMessage
      callbacks.onMessage(parsed)
    } catch {
      // ignore parse errors silently
    }
  })

  // Named 'ping' event sent every 15 s by the backend to keep the connection
  // alive through proxies and browser idle timeouts.
  es.addEventListener('ping', () => { errorCount = 0 })

  es.addEventListener('done', () => {
    completed = true
    es.close()
    callbacks.onDone()
  })

  es.onerror = () => {
    if (completed) return           // normal close after 'done' — ignore
    errorCount += 1
    // Let EventSource auto-reconnect for transient errors.
    // Only notify the UI after repeated failures.
    if (errorCount >= 3) {
      callbacks.onError('SSE connection error')
    }
  }

  return () => {
    completed = true  // suppress onerror during cleanup
    es.close()
  }
}

// ── Remediation ───────────────────────────────────────────────────────────────

/**
 * POST /api/analyses/{analysis_id}/remediate
 *
 * Starts a remediation job for a completed NO-GO analysis.
 */
export async function startRemediation(
  analysisId: string,
): Promise<RemediationCreatedResponse> {
  const res = await fetch(`${BASE_URL}/api/analyses/${analysisId}/remediate`, {
    method: 'POST',
  })
  return handleResponse<RemediationCreatedResponse>(res)
}

/**
 * GET /api/analyses/{analysis_id}/remediation
 */
export async function getRemediationStatus(
  analysisId: string,
): Promise<RemediationStatusResponse> {
  const res = await fetch(`${BASE_URL}/api/analyses/${analysisId}/remediation`)
  return handleResponse<RemediationStatusResponse>(res)
}

/**
 * GET /api/analyses/{analysis_id}/remediation/events  (SSE)
 */
export function subscribeToRemediationEvents(
  analysisId: string,
  callbacks: {
    onMessage: (msg: SseMessage) => void
    onDone: () => void
    onError: (err: string) => void
  },
): () => void {
  const url = `${BASE_URL}/api/analyses/${analysisId}/remediation/events`
  const es = new EventSource(url)

  let completed = false
  let errorCount = 0

  es.addEventListener('message', (e) => {
    errorCount = 0
    try {
      const parsed = JSON.parse(e.data) as SseMessage
      callbacks.onMessage(parsed)
    } catch {
      // ignore
    }
  })

  es.addEventListener('ping', () => { errorCount = 0 })

  es.addEventListener('done', () => {
    completed = true
    es.close()
    callbacks.onDone()
  })

  es.onerror = () => {
    if (completed) return
    errorCount += 1
    if (errorCount >= 3) {
      callbacks.onError('SSE connection error')
    }
  }

  return () => {
    completed = true
    es.close()
  }
}

/**
 * POST /api/analyses/{analysis_id}/revalidate
 *
 * Starts a new readiness analysis against the remediated workspace.
 */
export async function startRevalidation(
  analysisId: string,
): Promise<AnalysisCreatedResponse> {
  const res = await fetch(`${BASE_URL}/api/analyses/${analysisId}/revalidate`, {
    method: 'POST',
  })
  return handleResponse<AnalysisCreatedResponse>(res)
}

/**
 * GET /api/analyses/{analysis_id}/remediation/download
 */
export function getRemediationDownloadUrl(analysisId: string): string {
  return `${BASE_URL}/api/analyses/${analysisId}/remediation/download`
}
