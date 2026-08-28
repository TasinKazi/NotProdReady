import { useEffect, useState } from 'react'
import {
  Button,
  Column,
  Grid,
  InlineLoading,
  Tag,
  Tile,
} from '@carbon/react'
import {
  CheckmarkFilled,
  CircleDash,
  RadioButton as RadioButtonIcon,
} from '@carbon/icons-react'
import type { ViewId } from '../types/navigation'
import styles from './AnalysisInProgressScreen.module.scss'

interface Props {
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

// ── Mock progression timeline ───────────────────────────────
// Each tick advances the state. Designed so real SSE events
// can replace these setTimeout calls later.

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

const INITIAL_EVIDENCE: EvidenceEntry[] = []

type ProgressEvent =
  | { type: 'step-done'; groupId: string; stepId: string }
  | { type: 'group-start'; groupId: string }
  | { type: 'group-step-active'; groupId: string; stepId: string }
  | { type: 'evidence'; entry: EvidenceEntry }

const TIMELINE: Array<{ delayMs: number; event: ProgressEvent }> = [
  { delayMs: 1200, event: { type: 'step-done', groupId: 'runbook-analyst', stepId: 'ra-1' } },
  { delayMs: 1600, event: { type: 'group-start', groupId: 'repo-inspector' } },
  { delayMs: 2000, event: { type: 'group-step-active', groupId: 'repo-inspector', stepId: 'ri-1' } },
  {
    delayMs: 2400,
    event: {
      type: 'evidence',
      entry: { id: 'e1', label: 'RUNBOOK', source: 'deployment-runbook.md', value: 'Node.js 18', severity: 'block' },
    },
  },
  { delayMs: 2800, event: { type: 'step-done', groupId: 'repo-inspector', stepId: 'ri-1' } },
  {
    delayMs: 3200,
    event: {
      type: 'evidence',
      entry: { id: 'e2', label: 'REPOSITORY', source: 'package.json', value: 'requires Node >=20', severity: 'block' },
    },
  },
  { delayMs: 3600, event: { type: 'group-step-active', groupId: 'repo-inspector', stepId: 'ri-2' } },
  {
    delayMs: 4000,
    event: {
      type: 'evidence',
      entry: { id: 'e3', label: 'COMMAND', source: 'package.json → scripts', value: 'npm run production → script not found', severity: 'block' },
    },
  },
  { delayMs: 4400, event: { type: 'step-done', groupId: 'repo-inspector', stepId: 'ri-2' } },
  { delayMs: 4800, event: { type: 'group-step-active', groupId: 'repo-inspector', stepId: 'ri-3' } },
]

function applyEvent(groups: AgentGroup[], event: ProgressEvent): AgentGroup[] {
  return groups.map((g) => {
    if (event.type === 'step-done' && g.id === event.groupId) {
      return {
        ...g,
        steps: g.steps.map((s) =>
          s.id === event.stepId ? { ...s, status: 'done' as StepStatus } : s
        ),
      }
    }
    if (event.type === 'group-start' && g.id === event.groupId) {
      return { ...g, groupStatus: 'active' as StepStatus }
    }
    if (event.type === 'group-step-active' && g.id === event.groupId) {
      return {
        ...g,
        steps: g.steps.map((s) =>
          s.id === event.stepId ? { ...s, status: 'active' as StepStatus } : s
        ),
      }
    }
    return g
  })
}

// ── Component ───────────────────────────────────────────────

export default function AnalysisInProgressScreen({ onNavigate }: Props) {
  const [groups, setGroups] = useState<AgentGroup[]>(INITIAL_GROUPS)
  const [evidence, setEvidence] = useState<EvidenceEntry[]>(INITIAL_EVIDENCE)
  const [finished, setFinished] = useState(false)

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []

    TIMELINE.forEach(({ delayMs, event }) => {
      timers.push(
        setTimeout(() => {
          if (event.type === 'evidence') {
            setEvidence((prev) => [...prev, event.entry])
          } else {
            setGroups((prev) => applyEvent(prev, event))
          }
        }, delayMs)
      )
    })

    // Auto-complete after timeline finishes
    timers.push(
      setTimeout(() => {
        setFinished(true)
      }, 5600)
    )

    return () => timers.forEach(clearTimeout)
  }, [])

  return (
    <div className={styles.page}>
      <Grid narrow>
        {/* Header */}
        <Column sm={4} md={8} lg={16}>
          <div className={styles.titleRow}>
            <div>
              <h1 className={styles.heading}>Analyzing NorthRiver Payments API</h1>
              <div className={styles.releaseMeta}>
                <Tag type="cool-gray" size="md">v2.4.0</Tag>
                <Tag type="cool-gray" size="md">Production</Tag>
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
              <Button
                kind="primary"
                onClick={() => onNavigate('analysis-result')}
              >
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
