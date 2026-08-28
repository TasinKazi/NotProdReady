import {
  Header,
  HeaderMenuButton,
  HeaderName,
  HeaderGlobalBar,
  HeaderGlobalAction,
  SideNav,
  SideNavItems,
  SideNavLink,
  SkipToContent,
  Content,
} from '@carbon/react'
import {
  Dashboard,
  Add,
  Time,
  Policy,
  Integration,
  UserAvatar,
  type CarbonIconType,
} from '@carbon/icons-react'
import type { ViewId } from '../types/navigation'
import styles from './AppShell.module.scss'
import { useState } from 'react'

interface Props {
  activeView: ViewId
  onNavigate: (view: ViewId) => void
  children: React.ReactNode
}

const NAV_ITEMS: Array<{ id: ViewId; label: string; icon: CarbonIconType }> = [
  { id: 'overview', label: 'Overview', icon: Dashboard },
  { id: 'new-analysis', label: 'New analysis', icon: Add },
  { id: 'history', label: 'Analysis history', icon: Time },
  { id: 'policies', label: 'Release policies', icon: Policy },
  { id: 'integrations', label: 'Integrations', icon: Integration },
]

export default function AppShell({ activeView, onNavigate, children }: Props) {
  const [sideNavExpanded, setSideNavExpanded] = useState(false)

  return (
    <>
      <Header aria-label="NotProdReady">
        <SkipToContent />
        <HeaderMenuButton
          aria-label={sideNavExpanded ? 'Close menu' : 'Open menu'}
          onClick={() => setSideNavExpanded((v) => !v)}
          isActive={sideNavExpanded}
        />
        <HeaderName prefix="NorthRiver Bank">
          &nbsp;| NotProdReady
        </HeaderName>
        <HeaderGlobalBar>
          <span className={styles.poweredBy}>Powered by IBM Bob</span>
          <HeaderGlobalAction aria-label="User profile">
            <UserAvatar size={20} />
          </HeaderGlobalAction>
        </HeaderGlobalBar>
      </Header>

      <SideNav
        aria-label="Side navigation"
        expanded={sideNavExpanded}
        onOverlayClick={() => setSideNavExpanded(false)}
      >
        <SideNavItems>
          {NAV_ITEMS.map((item) => (
            <SideNavLink
              key={item.id}
              renderIcon={item.icon}
              isActive={activeView === item.id || (activeView === 'analysis-in-progress' && item.id === 'new-analysis') || (activeView === 'analysis-result' && item.id === 'overview')}
              onClick={(e: React.MouseEvent) => {
                e.preventDefault()
                onNavigate(item.id)
                setSideNavExpanded(false)
              }}
              href="#"
            >
              {item.label}
            </SideNavLink>
          ))}
        </SideNavItems>
      </SideNav>

      <Content id="main-content" className={styles.mainContent}>
        {children}
      </Content>
    </>
  )
}
