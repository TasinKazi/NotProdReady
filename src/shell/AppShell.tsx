import { useState } from 'react'
import {
  Content,
  Header,
  HeaderGlobalAction,
  HeaderGlobalBar,
  HeaderMenuButton,
  HeaderName,
  SideNav,
  SideNavDivider,
  SideNavItems,
  SideNavLink,
  SkipToContent,
} from '@carbon/react'
import {
  Add,
  Dashboard,
  Integration,
  Logout,
  Policy,
  Settings,
  Time,
  UserAvatar,
  type CarbonIconType,
} from '@carbon/icons-react'
import type { ViewId } from '../types/navigation'
import styles from './AppShell.module.scss'

interface Props {
  activeView: ViewId
  onNavigate: (view: ViewId) => void
  onSignOut: () => void
  children: React.ReactNode
  userName?: string
  userEmail?: string
}

interface NavItem {
  id: ViewId
  label: string
  description: string
  icon: CarbonIconType
}

const NAV_ITEMS: NavItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Release readiness',
    icon: Dashboard,
  },
  {
    id: 'new-analysis',
    label: 'New analysis',
    description: 'Analyze with IBM Bob',
    icon: Add,
  },
  {
    id: 'history',
    label: 'Analysis history',
    description: 'Previous decisions',
    icon: Time,
  },
  {
    id: 'policies',
    label: 'Release policies',
    description: 'Readiness controls',
    icon: Policy,
  },
  {
    id: 'integrations',
    label: 'Integrations',
    description: 'Connected systems',
    icon: Integration,
  },
]

/**
 * Keep workflow screens associated with the most relevant primary
 * navigation item instead of exposing implementation-level route names
 * in the shell.
 */
function getActiveNavId(view: ViewId): ViewId {
  if (view === 'analysis-in-progress') return 'new-analysis'
  if (view === 'analysis-result') return 'overview'
  if (view === 'remediation-in-progress') return 'new-analysis'
  if (view === 'remediation-result') return 'new-analysis'
  return view
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)

  if (parts.length === 0) return '?'
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase()
  }

  return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase()
}

export default function AppShell({
  activeView,
  onNavigate,
  onSignOut,
  children,
  userName,
  userEmail,
}: Props) {
  const [sideNavExpanded, setSideNavExpanded] = useState(false)

  const activeNavId = getActiveNavId(activeView)
  const initials = userName ? getInitials(userName) : '?'

  function handleNavigate(id: ViewId) {
    onNavigate(id)
    setSideNavExpanded(false)
  }

  return (
    <div className={styles.shell}>
      <Header aria-label="NorthRiver Bank NotProdReady" className={styles.header}>
        <SkipToContent />

        <HeaderMenuButton
          aria-label={sideNavExpanded ? 'Close navigation' : 'Open navigation'}
          aria-expanded={sideNavExpanded}
          onClick={() => setSideNavExpanded((current) => !current)}
          isActive={sideNavExpanded}
          className={styles.menuButton}
        />

        <div className={styles.brandArea}>
          <HeaderName
            prefix="NorthRiver Bank"
            className={styles.headerName}
            onClick={() => handleNavigate('overview')}
          >
            <span className={styles.brandSeparator}>|</span>
            <span className={styles.productName}>NotProdReady</span>
          </HeaderName>

          <div className={styles.productContext} aria-hidden="true">
            Release readiness
          </div>
        </div>

        <HeaderGlobalBar className={styles.globalBar}>
          <div
            className={styles.bobStatus}
            title="IBM Bob powers release analysis and remediation"
          >
            <span className={styles.bobPulse} aria-hidden="true" />
            <span className={styles.bobStatusCopy}>
              <span className={styles.bobStatusLabel}>IBM Bob</span>
              <span className={styles.bobStatusMeta}>Agent enabled</span>
            </span>
          </div>

          <HeaderGlobalAction
            aria-label={`Signed in as ${userName ?? 'user'}`}
            tooltipAlignment="end"
            onClick={() => setSideNavExpanded((current) => !current)}
            className={styles.userAction}
          >
            {initials !== '?' ? (
              <span className={styles.avatarAction} aria-hidden="true">
                {initials}
              </span>
            ) : (
              <UserAvatar size={20} />
            )}
          </HeaderGlobalAction>
        </HeaderGlobalBar>
      </Header>

      <SideNav
        aria-label="NotProdReady navigation"
        expanded={sideNavExpanded}
        onOverlayClick={() => setSideNavExpanded(false)}
        className={styles.sideNav}
      >
        <SideNavItems className={styles.sideNavItems}>
          <li className={styles.navSectionLabel} aria-hidden="true">
            Workspace
          </li>

          {NAV_ITEMS.map((item) => (
            <SideNavLink
              key={item.id}
              renderIcon={item.icon}
              isActive={activeNavId === item.id}
              href="#"
              className={styles.navLink}
              onClick={(event: React.MouseEvent) => {
                event.preventDefault()
                handleNavigate(item.id)
              }}
            >
              <span className={styles.navCopy}>
                <span className={styles.navLabel}>{item.label}</span>
                <span className={styles.navDescription}>{item.description}</span>
              </span>
            </SideNavLink>
          ))}

          <SideNavDivider className={styles.divider} />

          <li className={styles.agentPanel}>
            <div className={styles.agentPanelHeader}>
              <span className={styles.agentIndicator} aria-hidden="true" />
              <span className={styles.agentTitle}>IBM Bob agent</span>
            </div>

            <p className={styles.agentDescription}>
              Analyzes release artifacts, verifies deployment readiness, and
              performs repository remediation.
            </p>

            <div className={styles.agentCapabilityRow}>
              <span>Analysis</span>
              <span>Verification</span>
              <span>Remediation</span>
            </div>
          </li>

          <SideNavDivider className={styles.divider} />

          {userName && (
            <li className={styles.userPanel}>
              <div className={styles.sideNavAvatar} aria-hidden="true">
                {initials}
              </div>

              <div className={styles.sideNavUserInfo}>
                <span className={styles.sideNavUserName}>{userName}</span>
                {userEmail && (
                  <span className={styles.sideNavUserEmail}>{userEmail}</span>
                )}
              </div>
            </li>
          )}

          <SideNavLink
            renderIcon={Settings}
            href="#"
            className={styles.secondaryNavLink}
            onClick={(event: React.MouseEvent) => {
              event.preventDefault()
            }}
          >
            Settings
          </SideNavLink>

          <SideNavLink
            renderIcon={Logout}
            href="#"
            className={`${styles.secondaryNavLink} ${styles.signOutLink}`}
            onClick={(event: React.MouseEvent) => {
              event.preventDefault()
              setSideNavExpanded(false)
              onSignOut()
            }}
          >
            Sign out
          </SideNavLink>
        </SideNavItems>
      </SideNav>

      <Content id="main-content" className={styles.mainContent}>
        <div className={styles.contentFrame}>{children}</div>
      </Content>
    </div>
  )
}
