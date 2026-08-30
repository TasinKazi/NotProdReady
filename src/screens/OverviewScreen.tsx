import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Column,
  DataTable,
  Grid,
  InlineLoading,
  InlineNotification,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
} from '@carbon/react'
import {
  Add,
  ArrowRight,
  CheckmarkFilled,
  DataStructured,
  IbmWatsonMachineLearning,
  WarningFilled,
} from '@carbon/icons-react'
import type { ViewId } from '../types/navigation'
import type { AnalysisStatusResponse } from '../api/types'
import { listAnalyses } from '../api/analyses'
import styles from './OverviewScreen.module.scss'

interface Props {
  onNavigate: (view: ViewId) => void
}

/* ── Recent analysis table configuration ─────────────────────────────── */

const headers = [
  { key: 'application', header: 'Application' },
  { key: 'release', header: 'Release' },
  { key: 'environment', header: 'Environment' },
  { key: 'decision', header: 'Decision' },
  { key: 'blockers', header: 'Blockers' },
  { key: 'score', header: 'Score' },
]

/* ── Small display helpers ───────────────────────────────────────────── */

function decisionTagType(decision?: string) {
  if (decision === 'GO') return 'green'
  if (decision === 'NO-GO') return 'red'
  return 'cool-gray'
}

function statusLabel(status: AnalysisStatusResponse['status']) {
  switch (status) {
    case 'QUEUED':
      return 'Queued'
    case 'PREPARING':
      return 'Preparing'
    case 'ANALYZING_DOCUMENT':
      return 'Analyzing runbook'
    case 'INSPECTING_REPOSITORY':
      return 'Inspecting repository'
    case 'VERIFYING':
      return 'Verifying'
    case 'SYNTHESIZING':
      return 'Synthesizing'
    case 'COMPLETED':
      return 'Complete'
    case 'FAILED':
      return 'Failed'
    default:
      return status
  }
}

export default function OverviewScreen({ onNavigate }: Props) {
  const [analyses, setAnalyses] = useState<AnalysisStatusResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  /* ── Load real analysis data from the NotProdReady backend ─────────── */

  useEffect(() => {
    let cancelled = false

    listAnalyses()
      .then((data) => {
        if (cancelled) return
        setAnalyses(data)
        setLoading(false)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoadError(
          error instanceof Error
            ? error.message
            : 'Could not load release-readiness activity.',
        )
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  /* ── Derived readiness metrics ─────────────────────────────────────── */

  const completedAnalyses = useMemo(
    () =>
      analyses.filter(
        (analysis) =>
          analysis.status === 'COMPLETED' && analysis.decision != null,
      ),
    [analyses],
  )

  const totalCompleted = completedAnalyses.length

  const goCount = completedAnalyses.filter(
    (analysis) => analysis.decision === 'GO',
  ).length

  const noGoCount = completedAnalyses.filter(
    (analysis) => analysis.decision === 'NO-GO',
  ).length

  const totalBlockers = completedAnalyses.reduce(
    (sum, analysis) => sum + (analysis.blockers ?? 0),
    0,
  )

  const averageScore =
    totalCompleted > 0
      ? Math.round(
          completedAnalyses.reduce(
            (sum, analysis) => sum + (analysis.readiness_score ?? 0),
            0,
          ) / totalCompleted,
        )
      : 0

  const recentAnalyses = completedAnalyses.slice(0, 6)

  const rows = recentAnalyses.map((analysis) => ({
    id: analysis.analysis_id,
    application: analysis.application_name,
    release: analysis.release_version,
    environment: analysis.environment,
    decision: analysis.decision ?? '—',
    blockers: analysis.blockers ?? 0,
    score: analysis.readiness_score ?? 0,
  }))

  const activeAnalysis = analyses.find(
    (analysis) =>
      analysis.status !== 'COMPLETED' && analysis.status !== 'FAILED',
  )

  return (
    <div className={styles.page}>
      {/* ── Product hero ─────────────────────────────────────────────── */}
      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <div className={styles.heroCopy}>
            <div className={styles.eyebrowRow}>
              <span className={styles.eyebrow}>Release readiness</span>
              <span className={styles.heroDivider} aria-hidden="true" />
              <span className={styles.heroAgent}>
                <span className={styles.heroAgentDot} aria-hidden="true" />
                IBM Bob operational
              </span>
            </div>

            <h1 className={styles.heading}>
              Find out before
              <br />
              production does.
            </h1>

            <p className={styles.heroDescription}>
              IBM Bob inspects deployment documentation against the repository,
              verifies release requirements, and identifies confirmed blockers
              before a production deployment begins.
            </p>

            <div className={styles.heroActions}>
              <Button
                kind="primary"
                size="lg"
                renderIcon={Add}
                onClick={() => onNavigate('new-analysis')}
              >
                New analysis
              </Button>

              <Button
                kind="ghost"
                size="lg"
                renderIcon={ArrowRight}
                onClick={() => onNavigate('history')}
                className={styles.heroGhostButton}
              >
                View analysis history
              </Button>
            </div>
          </div>

          <div className={styles.heroAgentPanel}>
            <div className={styles.agentPanelTop}>
              <IbmWatsonMachineLearning size={24} />
              <span>IBM Bob</span>
            </div>

            <p className={styles.agentPanelTitle}>
              Release-readiness agent
            </p>

            <div className={styles.agentCapability}>
              <CheckmarkFilled size={16} />
              <span>Runbook requirement analysis</span>
            </div>

            <div className={styles.agentCapability}>
              <CheckmarkFilled size={16} />
              <span>Repository inspection</span>
            </div>

            <div className={styles.agentCapability}>
              <CheckmarkFilled size={16} />
              <span>GO / NO-GO verification</span>
            </div>

            <div className={styles.agentCapability}>
              <CheckmarkFilled size={16} />
              <span>Targeted remediation</span>
            </div>
          </div>
        </div>
      </section>

      <div className={styles.content}>
        <Grid fullWidth>
          {/* ── Active analysis status ───────────────────────────────── */}
          {activeAnalysis && (
            <Column sm={4} md={8} lg={16}>
              <div className={styles.activeRun}>
                <div className={styles.activeRunIcon}>
                  <InlineLoading status="active" />
                </div>

                <div className={styles.activeRunCopy}>
                  <span className={styles.activeRunLabel}>
                    IBM Bob is working
                  </span>

                  <span className={styles.activeRunTitle}>
                    {activeAnalysis.application_name}{' '}
                    <span className={styles.activeRunVersion}>
                      {activeAnalysis.release_version}
                    </span>
                  </span>

                  <span className={styles.activeRunMeta}>
                    {statusLabel(activeAnalysis.status)} ·{' '}
                    {activeAnalysis.environment}
                  </span>
                </div>

                <Button
                  kind="ghost"
                  renderIcon={ArrowRight}
                  onClick={() => onNavigate('new-analysis')}
                >
                  Open analysis
                </Button>
              </div>
            </Column>
          )}

          {/* ── Release-readiness metrics ────────────────────────────── */}
          <Column sm={4} md={8} lg={16}>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.sectionEyebrow}>Operational view</p>
                <h2 className={styles.sectionTitle}>Readiness posture</h2>
              </div>

              <p className={styles.sectionDescription}>
                Results from completed IBM Bob release analyses.
              </p>
            </div>
          </Column>

          <Column sm={4} md={4} lg={4}>
            <article className={`${styles.metric} ${styles.metricBlue}`}>
              <span className={styles.metricLabel}>Analyses completed</span>
              <strong className={styles.metricValue}>{totalCompleted}</strong>
              <span className={styles.metricMeta}>IBM Bob decisions</span>
            </article>
          </Column>

          <Column sm={4} md={4} lg={4}>
            <article className={`${styles.metric} ${styles.metricGreen}`}>
              <span className={styles.metricLabel}>GO decisions</span>
              <strong className={styles.metricValue}>{goCount}</strong>
              <span className={styles.metricMeta}>
                {totalCompleted > 0
                  ? `${Math.round((goCount / totalCompleted) * 100)}% of completed`
                  : 'No completed analyses yet'}
              </span>
            </article>
          </Column>

          <Column sm={4} md={4} lg={4}>
            <article className={`${styles.metric} ${styles.metricRed}`}>
              <span className={styles.metricLabel}>NO-GO decisions</span>
              <strong className={styles.metricValue}>{noGoCount}</strong>
              <span className={styles.metricMeta}>
                {totalBlockers} confirmed blocker
                {totalBlockers === 1 ? '' : 's'}
              </span>
            </article>
          </Column>

          <Column sm={4} md={4} lg={4}>
            <article className={`${styles.metric} ${styles.metricPurple}`}>
              <span className={styles.metricLabel}>Average readiness</span>
              <div className={styles.metricScoreRow}>
                <strong className={styles.metricValue}>{averageScore}</strong>
                <span className={styles.metricDenominator}>/ 100</span>
              </div>
              <span className={styles.metricMeta}>Across completed releases</span>
            </article>
          </Column>

          {/* ── IBM Bob workflow ─────────────────────────────────────── */}
          <Column sm={4} md={8} lg={16}>
            <section className={styles.workflowSection}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.sectionEyebrow}>Agent workflow</p>
                  <h2 className={styles.sectionTitle}>How IBM Bob evaluates a release</h2>
                </div>

                <div className={styles.agentBadge}>
                  <span className={styles.agentBadgeDot} aria-hidden="true" />
                  Agent enabled
                </div>
              </div>

              <div className={styles.workflowGrid}>
                <article className={styles.workflowStep}>
                  <span className={styles.workflowNumber}>01</span>
                  <DataStructured size={24} />
                  <h3>Read the release contract</h3>
                  <p>
                    Bob extracts runtime, environment, deployment, migration,
                    and rollback expectations from the runbook.
                  </p>
                </article>

                <article className={styles.workflowStep}>
                  <span className={styles.workflowNumber}>02</span>
                  <DataStructured size={24} />
                  <h3>Inspect the repository</h3>
                  <p>
                    Bob examines the files that define how the application
                    builds, starts, configures, and migrates.
                  </p>
                </article>

                <article className={styles.workflowStep}>
                  <span className={styles.workflowNumber}>03</span>
                  <WarningFilled size={24} />
                  <h3>Verify every mismatch</h3>
                  <p>
                    Candidate issues are checked against repository evidence
                    before Bob classifies them as BLOCK, WARN, or PASS.
                  </p>
                </article>

                <article className={styles.workflowStep}>
                  <span className={styles.workflowNumber}>04</span>
                  <IbmWatsonMachineLearning size={24} />
                  <h3>Issue a release decision</h3>
                  <p>
                    Bob produces a readiness score and a grounded GO / NO-GO
                    recommendation that operators can act on.
                  </p>
                </article>
              </div>
            </section>
          </Column>

          {/* ── Recent IBM Bob analyses ──────────────────────────────── */}
          <Column sm={4} md={8} lg={16}>
            <section className={styles.recentSection}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.sectionEyebrow}>IBM Bob activity</p>
                  <h2 className={styles.sectionTitle}>Recent analyses</h2>
                </div>

                <Button
                  kind="ghost"
                  renderIcon={ArrowRight}
                  onClick={() => onNavigate('history')}
                >
                  View all
                </Button>
              </div>

              {loading ? (
                <div className={styles.loadingState}>
                  <InlineLoading
                    status="active"
                    description="Loading IBM Bob analysis activity…"
                  />
                </div>
              ) : loadError ? (
                <InlineNotification
                  kind="warning"
                  title="Analysis history unavailable"
                  subtitle={loadError}
                  lowContrast
                  hideCloseButton
                />
              ) : rows.length === 0 ? (
                <div className={styles.emptyState}>
                  <div>
                    <p className={styles.emptyEyebrow}>No analyses yet</p>
                    <h3>Give IBM Bob a release to evaluate.</h3>
                    <p>
                      Upload a repository archive and deployment runbook to
                      produce the first readiness decision.
                    </p>
                  </div>

                  <Button
                    kind="primary"
                    renderIcon={Add}
                    onClick={() => onNavigate('new-analysis')}
                  >
                    Start first analysis
                  </Button>
                </div>
              ) : (
                <DataTable rows={rows} headers={headers} size="lg">
                  {({
                    rows: tableRows,
                    headers: tableHeaders,
                    getHeaderProps,
                    getRowProps,
                    getTableProps,
                  }) => (
                    <TableContainer className={styles.tableContainer}>
                      <Table {...getTableProps()} useZebraStyles={false}>
                        <TableHead>
                          <TableRow>
                            {tableHeaders.map((header) => (
                              <TableHeader
                                {...getHeaderProps({ header })}
                                key={header.key}
                              >
                                {header.header}
                              </TableHeader>
                            ))}
                          </TableRow>
                        </TableHead>

                        <TableBody>
                          {tableRows.map((row) => {
                            const source = recentAnalyses.find(
                              (analysis) => analysis.analysis_id === row.id,
                            )

                            return (
                              <TableRow {...getRowProps({ row })} key={row.id}>
                                {row.cells.map((cell) => {
                                  if (cell.info.header === 'decision') {
                                    const decision = String(cell.value)

                                    return (
                                      <TableCell key={cell.id}>
                                        <Tag
                                          type={decisionTagType(decision)}
                                          size="sm"
                                        >
                                          {decision}
                                        </Tag>
                                      </TableCell>
                                    )
                                  }

                                  if (cell.info.header === 'blockers') {
                                    const blockers = Number(cell.value)

                                    return (
                                      <TableCell key={cell.id}>
                                        <span
                                          className={
                                            blockers > 0
                                              ? styles.blockerCount
                                              : styles.noBlockers
                                          }
                                        >
                                          {blockers > 0
                                            ? `${blockers} blocker${
                                                blockers === 1 ? '' : 's'
                                              }`
                                            : 'None'}
                                        </span>
                                      </TableCell>
                                    )
                                  }

                                  if (cell.info.header === 'score') {
                                    return (
                                      <TableCell key={cell.id}>
                                        <span className={styles.tableScore}>
                                          {cell.value}
                                          <span>/100</span>
                                        </span>
                                      </TableCell>
                                    )
                                  }

                                  return (
                                    <TableCell key={cell.id}>
                                      {cell.value}
                                    </TableCell>
                                  )
                                })}

                                {source?.status === 'FAILED' && (
                                  <TableCell className={styles.failedCell}>
                                    Failed
                                  </TableCell>
                                )}
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </DataTable>
              )}
            </section>
          </Column>

          {/* ── Competition narrative footer ─────────────────────────── */}
          <Column sm={4} md={8} lg={16}>
            <section className={styles.bobFooter}>
              <div>
                <p className={styles.bobFooterEyebrow}>Powered by IBM Bob</p>
                <h2>Release intelligence with an agent that can act.</h2>
              </div>

              <p>
                NotProdReady uses IBM Bob to move beyond static validation:
                analyze the release contract, verify the repository, explain the
                decision, and remediate confirmed repository findings.
              </p>
            </section>
          </Column>
        </Grid>
      </div>
    </div>
  )
}
