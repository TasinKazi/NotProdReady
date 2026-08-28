import { useState } from 'react'
import type { ViewId } from './types/navigation'
import type { ApiReleaseResult } from './api/types'
import AppShell from './shell/AppShell'
import OverviewScreen from './screens/OverviewScreen'
import NewAnalysisScreen from './screens/NewAnalysisScreen'
import AnalysisInProgressScreen from './screens/AnalysisInProgressScreen'
import ReleaseReadinessResults from './screens/ReleaseReadinessResults'
import ComingSoonScreen from './screens/ComingSoonScreen'

export default function App() {
  const [view, setView] = useState<ViewId>('overview')
  const [analysisId, setAnalysisId] = useState<string | null>(null)
  const [analysisResult, setAnalysisResult] = useState<ApiReleaseResult | null>(null)

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
      case 'analysis-in-progress':
        return (
          <AnalysisInProgressScreen
            analysisId={analysisId}
            onComplete={handleAnalysisComplete}
            onNavigate={navigate}
          />
        )
      case 'analysis-result':
        return (
          <ReleaseReadinessResults
            apiResult={analysisResult}
            onNavigate={navigate}
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
