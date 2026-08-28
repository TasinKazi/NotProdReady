import { useState } from 'react'
import type { ViewId } from './types/navigation'
import AppShell from './shell/AppShell'
import OverviewScreen from './screens/OverviewScreen'
import NewAnalysisScreen from './screens/NewAnalysisScreen'
import AnalysisInProgressScreen from './screens/AnalysisInProgressScreen'
import ReleaseReadinessResults from './screens/ReleaseReadinessResults'
import ComingSoonScreen from './screens/ComingSoonScreen'

export default function App() {
  const [view, setView] = useState<ViewId>('overview')

  function navigate(next: ViewId) {
    setView(next)
    // scroll to top on navigation
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function renderView() {
    switch (view) {
      case 'overview':
        return <OverviewScreen onNavigate={navigate} />
      case 'new-analysis':
        return <NewAnalysisScreen onNavigate={navigate} />
      case 'analysis-in-progress':
        return <AnalysisInProgressScreen onNavigate={navigate} />
      case 'analysis-result':
        return <ReleaseReadinessResults onNavigate={navigate} />
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
