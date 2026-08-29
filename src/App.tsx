import { useState } from 'react'
import type { ViewId } from './types/navigation'
import type { ApiReleaseResult, RemediationStatusResponse } from './api/types'
import AppShell from './shell/AppShell'
import OverviewScreen from './screens/OverviewScreen'
import NewAnalysisScreen from './screens/NewAnalysisScreen'
import AnalysisInProgressScreen from './screens/AnalysisInProgressScreen'
import ReleaseReadinessResults from './screens/ReleaseReadinessResults'
import RemediationProgressScreen from './screens/RemediationProgressScreen'
import RemediationResultScreen from './screens/RemediationResultScreen'
import ComingSoonScreen from './screens/ComingSoonScreen'

export default function App() {
  const [view, setView] = useState<ViewId>('overview')

  // Analysis state
  const [analysisId, setAnalysisId] = useState<string | null>(null)
  const [analysisResult, setAnalysisResult] = useState<ApiReleaseResult | null>(null)

  // Remediation state
  const [remediationAnalysisId, setRemediationAnalysisId] = useState<string | null>(null)
  const [remediationStatus, setRemediationStatus] = useState<RemediationStatusResponse | null>(null)

  // Revalidation state
  const [revalidationAnalysisId, setRevalidationAnalysisId] = useState<string | null>(null)
  const [revalidationResult, setRevalidationResult] = useState<ApiReleaseResult | null>(null)

  function navigate(next: ViewId) {
    setView(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleAnalysisCreated(id: string) {
    setAnalysisId(id)
    setAnalysisResult(null)
    navigate('analysis-in-progress')
  }

  function handleAnalysisComplete(result: ApiReleaseResult) {
    setAnalysisResult(result)
    navigate('analysis-result')
  }

  function handleRemediateStarted(aId: string) {
    setRemediationAnalysisId(aId)
    setRemediationStatus(null)
  }

  function handleRemediationComplete(status: RemediationStatusResponse) {
    setRemediationStatus(status)
    navigate('remediation-result')
  }

  function handleRevalidationStarted(newAnalysisId: string) {
    setRevalidationAnalysisId(newAnalysisId)
    setRevalidationResult(null)
    navigate('analysis-in-progress')
  }

  function handleRevalidationComplete(result: ApiReleaseResult) {
    setRevalidationResult(result)
    navigate('remediation-result')
  }

  function renderView() {
    switch (view) {
      case 'overview':
        return <OverviewScreen onNavigate={navigate} />

      case 'new-analysis':
        return (
          <NewAnalysisScreen
            onAnalysisCreated={handleAnalysisCreated}
            onNavigate={navigate}
          />
        )

      case 'analysis-in-progress': {
        // After remediation, the in-progress screen handles revalidation
        const activeId = revalidationAnalysisId ?? analysisId
        const onComplete = revalidationAnalysisId
          ? handleRevalidationComplete
          : handleAnalysisComplete
        return (
          <AnalysisInProgressScreen
            analysisId={activeId}
            onComplete={onComplete}
            onNavigate={navigate}
          />
        )
      }

      case 'analysis-result':
        return (
          <ReleaseReadinessResults
            apiResult={analysisResult}
            analysisId={analysisId}
            onNavigate={navigate}
            onRemediateStarted={handleRemediateStarted}
          />
        )

      case 'remediation-in-progress':
        return (
          <RemediationProgressScreen
            analysisId={remediationAnalysisId ?? analysisId}
            onComplete={handleRemediationComplete}
            onNavigate={navigate}
          />
        )

      case 'remediation-result':
        return (
          <RemediationResultScreen
            analysisId={remediationAnalysisId ?? analysisId}
            remediationStatus={remediationStatus}
            originalResult={analysisResult}
            revalidationResult={revalidationResult}
            onNavigate={navigate}
            onRevalidationStarted={handleRevalidationStarted}
          />
        )

      case 'history':
        return <ComingSoonScreen title="Analysis history" />
      case 'policies':
        return <ComingSoonScreen title="Release policies" />
      case 'integrations':
        return <ComingSoonScreen title="Integrations" />
      default:
        return <OverviewScreen onNavigate={navigate} />
    }
  }

  return (
    <AppShell activeView={view} onNavigate={navigate}>
      {renderView()}
    </AppShell>
  )
}
