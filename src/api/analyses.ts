/**
 * API client for the NotProdReady FastAPI backend.
 * All fetch calls are centralized here — no direct fetch in UI components.
 */

import type {
  AnalysisCreatedResponse,
  AnalysisStatusResponse,
  ApiReleaseResult,
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

  es.addEventListener('message', (e) => {
    try {
      const parsed = JSON.parse(e.data) as SseMessage
      callbacks.onMessage(parsed)
    } catch {
      callbacks.onError('Failed to parse SSE message')
    }
  })

  es.addEventListener('done', () => {
    es.close()
    callbacks.onDone()
  })

  es.onerror = () => {
    es.close()
    callbacks.onError('SSE connection error')
  }

  return () => es.close()
}
