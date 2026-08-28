import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Column,
  Grid,
  InlineLoading,
  InlineNotification,
  Tag,
  Tile,
} from '@carbon/react'
import {
  CheckmarkFilled,
  CircleDash,
  RadioButton as RadioButtonIcon,
} from '@carbon/icons-react'
import type { ViewId } from '../types/navigation'
import type { ApiReleaseResult, SseMessage } from '../api/types'
import { getAnalysisResult, subscribeToEvents } from '../api/analyses'
import styles from './AnalysisInProgressScreen.module.scss'

interface Props {
  analysisId: string | null
  onComplete: (result: ApiReleaseResult) => void
  onNavigate: (view: ViewId) => void
}

// ── Agent model ─────────────────────────────────────────────

type StepStatus = 'done' | 'active' | 'waiting'

interface AgentSubStep {
  id: string
  label: string
  status: StepStatus
}

interface AgentGroup {
  id: string
  name: string
  steps: AgentSubStep[]
  groupStatus: StepStatus
}

// ── Evidence entries ────────────────────────────────────────

interface EvidenceEntry {
  id: string
  label: string
  source: string
  value: string
  severity: 'block' | 'warn' | 'info'
}

// ── Initial state ────────────────────────────────────────────

const INITIAL_GROUPS: AgentGroup[] = [
  {
    id: 'runbook-analyst',
    name: 'Runbook Analyst',
    groupStatus: 'active',
    steps: [
      { id: 'ra-1', label: 'Deployment requirements extracted', status: 'active' },
    ],
  },
  {
    id: 'repo-inspector',
    name: 'Repository Inspector',
    groupStatus: 'waiting',
    steps: [
      { id: 'ri-1', label: 'package.json inspected', status: 'waiting' },
      { id: 'ri-2', label: 'environment configuration inspected', status: 'waiting' },
      { id: 'ri-3', label: 'migrations being inspected', status: 'waiting' },
    ],
  },
  {
    id: 'release-verifier',
    name: 'Release Verifier',
    groupStatus: 'waiting',
    steps: [
      { id: 'rv-1', label: 'waiting for candidate findings', status: 'waiting' },
    ],
  },
]

// ── SSE event → UI state mapping ─────────────────────────────
//
// This is the only place that knows how to translate backend
// event names to the agent activity model. Replacing
// MockBobRunner with BobShellRunner in Step 9 only requires
// the runner to emit the same event names — this code stays.

function applySSEMessage(
  groups: AgentGroup[],
  evidence: EvidenceEntry[],
  msg: SseMessage,
): { groups: AgentGroup[]; evidence: EvidenceEntry[] } {
  const evt = msg.event
  const d = msg.data as Record<string, unknown>

  // Helper to update a step in a group
  function setStepStatus(gId: string, sId: string, status: StepStatus): AgentGroup[] {
    return groups.map((g) =>
      g.id !== gId
        ? g
        : { ...g, steps: g.steps.map((s) => (s.id === sId ? { ...s, status } : s)) },
    )
  }

  function setGroupStatus(gId: string, status: StepStatus): AgentGroup[] {
    return groups.map((g) => (g.id === gId ? { ...g, groupStatus: status } : g))
  }

  switch (evt) {
    case 'analysis.started':
      return { groups, evidence }

    case 'document.analysis.started':
      return {
        groups: setGroupStatus('runbook-analyst', 'active'),
        evidence,
      }

    case 'document.requirement.found': {
      const label = String(d.type ?? 'RUNBOOK').toUpperCase()
      const value = String(d.value ?? '')
      const source = String(d.source ?? '')
      const newEntry: EvidenceEntry = {
        id: `e-${msg.sequence}`,
        label,
        source,
        value,
        severity: 'info',
      }
      return { groups, evidence: [...evidence, newEntry] }
    }

    case 'document.analysis.completed':
      return {
        groups: setStepStatus('runbook-analyst', 'ra-1', 'done').map((g) =>
          g.id === 'runbook-analyst' ? { ...g, groupStatus: 'done' } : g,
        ),
        evidence,
      }

    case 'repository.analysis.started':
      return {
        groups: setGroupStatus('repo-inspector', 'active'),
        evidence,
      }

    case 'repository.file.inspected': {
      const file = String(d.file ?? '')
      // Advance the appropriate sub-step
      let newGroups = groups
      if (file === 'package.json') {
        newGroups = setStepStatus('repo-inspector', 'ri-1', 'done')
      } else if (file === '.env.example') {
        newGroups = setStepStatus('repo-inspector', 'ri-2', 'active')
      } else if (file === 'src/services/paymentService.js') {
        newGroups = setStepStatus('repo-inspector', 'ri-2', 'done')
      } else if (file.startsWith('migrations/')) {
        newGroups = setStepStatus('repo-inspector', 'ri-3', 'active')
      }
      return { groups: newGroups, evidence }
    }

    case 'finding.detected': {
      const sev = String(d.severity ?? 'BLOCK').toLowerCase() as EvidenceEntry['severity']
      const newEntry: EvidenceEntry = {
        id: `f-${msg.sequence}`,
        label: sev === 'block' ? 'BLOCK' : sev === 'warn' ? 'WARN' : 'PASS',
        source: String(d.title ?? ''),
        value: `${String(d.claim ?? '')} → ${String(d.actual ?? '')}`,
        severity: sev === 'block' ? 'block' : sev === 'warn' ? 'warn' : 'info',
      }
      return { groups, evidence: [...evidence, newEntry] }
    }

    case 'verification.started':
      return {
        groups: setGroupStatus('release-verifier', 'active').map((g) =>
          g.id === 'release-verifier'
            ? { ...g, steps: g.steps.map((s) => ({ ...s, status: 'active' as StepStatus })) }
            : g,
        ),
        evidence,
      }

    case 'verification.completed':
      return {
        groups: groups.map((g) =>
          g.id === 'release-verifier'
            ? {
                ...g,
                groupStatus: 'done' as StepStatus,
                steps: g.steps.map((s) => ({ ...s, status: 'done' as StepStatus })),
              }
            : g,
        ),
        evidence,
      }

    case 'analysis.synthesizing':
      return { groups, evidence }

    default:
      return { groups, evidence }
  }
}

// ── Component ───────────────────────────────────────────────

export default function AnalysisInProgressScreen({
  analysisId,
  onComplete,
  onNavigate,
}: Props) {
  const [groups, setGroups] = useState<AgentGroup[]>(INITIAL_GROUPS)
  const [evidence, setEvidence] = useState<EvidenceEntry[]>([])
  const [finished, setFinished] = useState(false)
  const [sseError, setSseError] = useState<string | null>(null)
  const [appName, setAppName] = useState<string>('NorthRiver Payments API')
  const [releaseVer, setReleaseVer] = useState<string>('v2.4.0')
  const [envName, setEnvName] = useState<string>('Production')

  // Mutable ref so the SSE handler always sees latest state
  const stateRef = useRef({ groups: INITIAL_GROUPS, evidence: [] as EvidenceEntry[] })

  useEffect(() => {
    if (!analysisId) return

    const cleanup = subscribeToEvents(analysisId, {
      onMessage: (msg: SseMessage) => {
        // Capture header metadata from first event
        if (msg.event === 'analysis.started') {
          const d = msg.data as Record<string, string>
          if (d.application_name) setAppName(d.application_name)
          if (d.release_version) setReleaseVer(d.release_version)
          if (d.environment) setEnvName(d.environment)
        }

        const next = applySSEMessage(
          stateRef.current.groups,
          stateRef.current.evidence,
          msg,
        )
        stateRef.current = next
        setGroups([...next.groups])
        setEvidence([...next.evidence])
      },

      onDone: () => {
        setFinished(true)
      },

      onError: (err: string) => {
        setSseError(`Connection error: ${err}. Click "View results" when ready.`)
        setFinished(true)
      },
    })

    return cleanup
  }, [analysisId])

  async function handleViewResults() {
    if (!analysisId) {
      onNavigate('analysis-result')
      return
    }
    try {
      const result = await getAnalysisResult(analysisId)
      onComplete(result)
    } catch {
      // Fallback: navigate without result — result screen will use mock data
      onNavigate('analysis-result')
    }
  }

  return (
    <div className={styles.page}>
      <Grid narrow>
        {/* Header */}
        <Column sm={4} md={8} lg={16}>
          <div className={styles.titleRow}>
            <div>
              <h1 className={styles.heading}>Analyzing {appName}</h1>
              <div className={styles.releaseMeta}>
                <Tag type="cool-gray" size="md">{releaseVer}</Tag>
                <Tag type="cool-gray" size="md">{envName}</Tag>
              </div>
            </div>
          </div>
          <div className={styles.statusBar}>
            {finished ? (
              <div className={styles.statusDone}>
                <CheckmarkFilled size={20} className={styles.iconDone} />
                <span>Analysis complete — reviewing results</span>
              </div>
            ) : (
              <InlineLoading
                description="IBM Bob is validating release readiness"
                status="active"
              />
            )}
          </div>
          {sseError && (
            <InlineNotification
              kind="warning"
              title="Connection warning"
              subtitle={sseError}
              lowContrast
              hideCloseButton
            />
          )}
        </Column>

        {/* Agent activity */}
        <Column sm={4} md={5} lg={10}>
          <Tile className={styles.agentTile}>
            <p className={styles.tileTitle}>Agent activity</p>
            <div className={styles.agentGroups}>
              {groups.map((group) => (
                <div key={group.id} className={styles.agentGroup}>
                  <div className={styles.groupHeader}>
                    <GroupStatusIcon status={group.groupStatus} />
                    <span className={styles.groupName}>{group.name}</span>
                    {group.groupStatus === 'active' && (
                      <InlineLoading status="active" className={styles.groupLoading} />
                    )}
                  </div>
                  <ul className={styles.stepList}>
                    {group.steps.map((step) => (
                      <li key={step.id} className={styles.stepItem}>
                        <StepIcon status={step.status} />
                        <span
                          className={
                            step.status === 'done'
                              ? styles.stepDone
                              : step.status === 'active'
                              ? styles.stepActive
                              : styles.stepWaiting
                          }
                        >
                          {step.label}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Tile>
        </Column>

        {/* Live evidence */}
        <Column sm={4} md={3} lg={6}>
          <Tile className={styles.evidenceTile}>
            <p className={styles.tileTitle}>Live evidence</p>
            {evidence.length === 0 ? (
              <p className={styles.evidenceEmpty}>Collecting evidence&hellip;</p>
            ) : (
              <div className={styles.evidenceList}>
                {evidence.map((e) => (
                  <div key={e.id} className={styles.evidenceItem}>
                    <span
                      className={
                        e.severity === 'block'
                          ? styles.evidenceLabelBlock
                          : e.severity === 'warn'
                          ? styles.evidenceLabelWarn
                          : styles.evidenceLabelInfo
                      }
                    >
                      {e.label}
                    </span>
                    <code className={styles.evidenceSource}>{e.source}</code>
                    <p className={styles.evidenceValue}>{e.value}</p>
                  </div>
                ))}
              </div>
            )}
          </Tile>
        </Column>

        {/* CTA once finished */}
        {finished && (
          <Column sm={4} md={8} lg={16}>
            <div className={styles.ctaRow}>
              <Button kind="primary" onClick={handleViewResults}>
                View results
              </Button>
            </div>
          </Column>
        )}
      </Grid>
    </div>
  )
}

function GroupStatusIcon({ status }: { status: StepStatus }) {
  if (status === 'done') return <CheckmarkFilled size={16} className={styles.iconDone} />
  if (status === 'active') return <RadioButtonIcon size={16} className={styles.iconActive} />
  return <CircleDash size={16} className={styles.iconWaiting} />
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'done') return <CheckmarkFilled size={14} className={styles.iconDone} />
  if (status === 'active') return <RadioButtonIcon size={14} className={styles.iconActive} />
  return <CircleDash size={14} className={styles.iconWaiting} />
}
