import { useEffect, useState } from 'react'
import type { ViewId } from './types/navigation'
import type {
  ApiReleaseResult,
  RemediationStatusResponse,
} from './api/types'
import AppShell from './shell/AppShell'
import LoginScreen from './screens/LoginScreen'
import WelcomeScreen from './screens/WelcomeScreen'
import OverviewScreen from './screens/OverviewScreen'
import NewAnalysisScreen from './screens/NewAnalysisScreen'
import AnalysisInProgressScreen from './screens/AnalysisInProgressScreen'
import ReleaseReadinessResults from './screens/ReleaseReadinessResults'
import RemediationProgressScreen from './screens/RemediationProgressScreen'
import RemediationResultScreen from './screens/RemediationResultScreen'
import HistoryScreen from './screens/HistoryScreen'
import ReleasePoliciesScreen from './screens/ReleasePoliciesScreen'
import IntegrationsScreen from './screens/IntegrationsScreen'

const SESSION_KEY = 'notProdReadySession'

/* ── Persisted product session ─────────────────────────────────────── */

interface PersistedSession {
  name: string
  email: string
  view: ViewId

  analysisId: string | null
  analysisResult: ApiReleaseResult | null

  remediationAnalysisId: string | null
  remediationStatus: RemediationStatusResponse | null
}

/* ── Session storage helpers ───────────────────────────────────────── */

function readSession(): PersistedSession | null {
  try {
    const raw =
      sessionStorage.getItem(SESSION_KEY)

    if (!raw) return null

    const parsed =
      JSON.parse(raw) as Partial<PersistedSession>

    if (
      !parsed.name ||
      !parsed.email ||
      !parsed.view
    ) {
      return null
    }

    return {
      name: parsed.name,
      email: parsed.email,
      view: parsed.view,
      analysisId:
        parsed.analysisId ?? null,
      analysisResult:
        parsed.analysisResult ?? null,
      remediationAnalysisId:
        parsed.remediationAnalysisId ?? null,
      remediationStatus:
        parsed.remediationStatus ?? null,
    }
  } catch {
    return null
  }
}

function writeSession(
  session: PersistedSession,
): void {
  try {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify(session),
    )
  } catch {
    // Keep the application usable if sessionStorage is unavailable.
  }
}

function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // Ignore storage cleanup failures.
  }
}

/* ── Demo identity helper ──────────────────────────────────────────── */

function emailToDisplayName(
  email: string,
): string {
  const local =
    email.split('@')[0] ?? ''

  return local
    .split('.')
    .map(
      (part) =>
        part.charAt(0).toUpperCase() +
        part.slice(1),
    )
    .join(' ')
}

/* ── Refresh-safe view restoration ────────────────────────────────── */

/**
 * The backend replays buffered analysis/remediation SSE events, so progress
 * screens can reconnect after a browser refresh as long as the required
 * analysis identifier was persisted.
 */
function restoreView(
  session: PersistedSession,
): ViewId {
  if (
    session.view ===
      'analysis-in-progress' &&
    !session.analysisId
  ) {
    return 'overview'
  }

  if (
    session.view ===
      'analysis-result' &&
    !(
      session.analysisResult ||
      session.analysisId
    )
  ) {
    return 'overview'
  }

  if (
    session.view ===
      'remediation-in-progress' &&
    !(
      session.remediationAnalysisId ||
      session.analysisId
    )
  ) {
    return 'overview'
  }

  if (
    session.view ===
      'remediation-result' &&
    !(
      session.remediationStatus ||
      session.remediationAnalysisId ||
      session.analysisId
    )
  ) {
    return 'overview'
  }

  return session.view
}

/* ── Application root ──────────────────────────────────────────────── */

export default function App() {
  const initialSession = readSession()

  const [loggedIn, setLoggedIn] =
    useState<boolean>(
      () => initialSession !== null,
    )

  const [userName, setUserName] =
    useState<string>(
      () => initialSession?.name ?? '',
    )

  const [userEmail, setUserEmail] =
    useState<string>(
      () => initialSession?.email ?? '',
    )

  const [view, setView] =
    useState<ViewId>(() =>
      initialSession
        ? restoreView(initialSession)
        : 'login',
    )

  /* ── Release analysis state ──────────────────────────────────────── */

  const [analysisId, setAnalysisId] =
    useState<string | null>(
      () =>
        initialSession?.analysisId ??
        null,
    )

  const [
    analysisResult,
    setAnalysisResult,
  ] =
    useState<ApiReleaseResult | null>(
      () =>
        initialSession?.analysisResult ??
        null,
    )

  /* ── IBM Bob remediation state ───────────────────────────────────── */

  const [
    remediationAnalysisId,
    setRemediationAnalysisId,
  ] =
    useState<string | null>(
      () =>
        initialSession
          ?.remediationAnalysisId ??
        null,
    )

  const [
    remediationStatus,
    setRemediationStatus,
  ] =
    useState<RemediationStatusResponse | null>(
      () =>
        initialSession
          ?.remediationStatus ??
        null,
    )

  /* ── Persist workflow state ──────────────────────────────────────── */

  useEffect(() => {
    if (!loggedIn) return

    writeSession({
      name: userName,
      email: userEmail,
      view,
      analysisId,
      analysisResult,
      remediationAnalysisId,
      remediationStatus,
    })
  }, [
    loggedIn,
    userName,
    userEmail,
    view,
    analysisId,
    analysisResult,
    remediationAnalysisId,
    remediationStatus,
  ])

  /* ── Navigation ──────────────────────────────────────────────────── */

  function navigate(next: ViewId) {
    setView(next)

    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    })
  }

  /* ── Authentication workflow ────────────────────────────────────── */

  function handleLogin(email: string) {
    const name =
      emailToDisplayName(email)

    setLoggedIn(true)
    setUserEmail(email)
    setUserName(name)

    setAnalysisId(null)
    setAnalysisResult(null)

    setRemediationAnalysisId(null)
    setRemediationStatus(null)

    setView('welcome')

    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    })
  }

  function handleSignOut() {
    clearSession()

    setLoggedIn(false)
    setUserName('')
    setUserEmail('')

    setAnalysisId(null)
    setAnalysisResult(null)

    setRemediationAnalysisId(null)
    setRemediationStatus(null)

    setView('login')

    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    })
  }

  /* ── Release analysis workflow ───────────────────────────────────── */

  function handleAnalysisCreated(
    id: string,
  ) {
    setAnalysisId(id)
    setAnalysisResult(null)

    /*
     * A new release analysis starts a clean workflow.
     * Do not carry remediation state from a previous release.
     */
    setRemediationAnalysisId(null)
    setRemediationStatus(null)

    setView('analysis-in-progress')

    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    })
  }

  function handleAnalysisComplete(
    result: ApiReleaseResult,
  ) {
    setAnalysisId(result.analysis_id)
    setAnalysisResult(result)
    setView('analysis-result')

    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    })
  }

  /* ── IBM Bob remediation workflow ────────────────────────────────── */

  function handleRemediateStarted(
    activeAnalysisId: string,
  ) {
    setRemediationAnalysisId(
      activeAnalysisId,
    )

    setRemediationStatus(null)
  }

  function handleRemediationComplete(
    status: RemediationStatusResponse,
  ) {
    setRemediationStatus(status)
    setView('remediation-result')

    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    })
  }

  /* ── Authentication route guard ──────────────────────────────────── */

  if (!loggedIn) {
    return (
      <LoginScreen
        onLogin={handleLogin}
      />
    )
  }

  /* ── Welcome experience ──────────────────────────────────────────── */

  if (view === 'welcome') {
    return (
      <WelcomeScreen
        userName={userName}
        onContinue={() =>
          navigate('overview')
        }
        onNavigate={navigate}
      />
    )
  }

  /* ── Product view routing ────────────────────────────────────────── */

  function renderView() {
    switch (view) {
      case 'overview':
        return (
          <OverviewScreen
            onNavigate={navigate}
          />
        )

      case 'new-analysis':
        return (
          <NewAnalysisScreen
            onAnalysisCreated={
              handleAnalysisCreated
            }
            onNavigate={navigate}
          />
        )

      case 'analysis-in-progress':
        return (
          <AnalysisInProgressScreen
            key={
              analysisId ??
              'no-analysis-id'
            }
            analysisId={analysisId}
            onComplete={
              handleAnalysisComplete
            }
            onNavigate={navigate}
          />
        )

      case 'analysis-result':
        return (
          <ReleaseReadinessResults
            apiResult={analysisResult}
            analysisId={analysisId}
            onNavigate={navigate}
            onRemediateStarted={
              handleRemediateStarted
            }
          />
        )

      case 'remediation-in-progress':
        return (
          <RemediationProgressScreen
            analysisId={
              remediationAnalysisId ??
              analysisId
            }
            onComplete={
              handleRemediationComplete
            }
            onNavigate={navigate}
          />
        )

      case 'remediation-result':
        return (
          <RemediationResultScreen
            analysisId={
              remediationAnalysisId ??
              analysisId
            }
            remediationStatus={
              remediationStatus
            }
            originalResult={
              analysisResult
            }
            onNavigate={navigate}
          />
        )

      case 'history':
        return (
          <HistoryScreen
            onNavigate={navigate}
          />
        )

      case 'policies':
        return (
          <ReleasePoliciesScreen />
        )

      case 'integrations':
        return (
          <IntegrationsScreen />
        )

      default:
        return (
          <OverviewScreen
            onNavigate={navigate}
          />
        )
    }
  }

  /* ── Carbon application shell ────────────────────────────────────── */

  return (
    <AppShell
      activeView={view}
      onNavigate={navigate}
      onSignOut={handleSignOut}
      userName={userName}
      userEmail={userEmail}
    >
      {renderView()}
    </AppShell>
  )
}