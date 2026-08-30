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
  TableToolbar,
  TableToolbarContent,
  TableToolbarSearch,
  Tag,
} from '@carbon/react'
import {
  Add,
  Analytics,
  CheckmarkFilled,
  IbmWatsonMachineLearning,
  SecurityServices,
  WarningFilled,
} from '@carbon/icons-react'
import type { ViewId } from '../types/navigation'
import type { AnalysisStatusResponse } from '../api/types'
import { listAnalyses } from '../api/analyses'
import styles from './HistoryScreen.module.scss'

interface Props {
  onNavigate: (view: ViewId) => void
}

/* ── Analysis history table configuration ─────────────────────────── */

const headers = [
  { key: 'application', header: 'Application' },
  { key: 'release', header: 'Release' },
  { key: 'environment', header: 'Environment' },
  { key: 'decision', header: 'Decision' },
  { key: 'blockers', header: 'Blockers' },
  { key: 'score', header: 'Score' },
]

/* ── Small display helpers ─────────────────────────────────────────── */

function decisionTagType(decision?: string) {
  if (decision === 'GO') return 'green'
  if (decision === 'NO-GO') return 'red'
  return 'cool-gray'
}

function scoreClass(score: number | null | undefined) {
  if (score == null) return styles.scoreNeutral
  if (score >= 80) return styles.scoreHigh
  if (score >= 60) return styles.scoreMid
  return styles.scoreLow
}

/* ── Analysis history screen ───────────────────────────────────────── */

export default function HistoryScreen({ onNavigate }: Props) {
  const [analyses, setAnalyses] = useState<AnalysisStatusResponse[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  /* ── Load real IBM Bob analysis history ─────────────────────────── */

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
            : 'Could not load IBM Bob analysis history.',
        )

        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  /* ── Completed release decisions ─────────────────────────────────── */

  const completedAnalyses = useMemo(
    () =>
      analyses.filter(
        (analysis) =>
          analysis.status === 'COMPLETED' &&
          analysis.decision != null,
      ),
    [analyses],
  )

  const filteredAnalyses = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()

    if (!query) return completedAnalyses

    return completedAnalyses.filter((analysis) => {
      const searchable = [
        analysis.application_name,
        analysis.release_version,
        analysis.environment,
        analysis.decision ?? '',
        String(analysis.readiness_score ?? ''),
        String(analysis.blockers ?? ''),
      ]
        .join(' ')
        .toLowerCase()

      return searchable.includes(query)
    })
  }, [completedAnalyses, searchQuery])

  /* ── Archive metrics ─────────────────────────────────────────────── */

  const totalCompleted = completedAnalyses.length

  const goCount = completedAnalyses.filter(
    (analysis) => analysis.decision === 'GO',
  ).length

  const noGoCount = completedAnalyses.filter(
    (analysis) => analysis.decision === 'NO-GO',
  ).length

  const averageScore =
    totalCompleted > 0
      ? Math.round(
          completedAnalyses.reduce(
            (sum, analysis) =>
              sum + (analysis.readiness_score ?? 0),
            0,
          ) / totalCompleted,
        )
      : 0

  const totalBlockers = completedAnalyses.reduce(
    (sum, analysis) => sum + (analysis.blockers ?? 0),
    0,
  )

  /* ── Carbon table rows ───────────────────────────────────────────── */

  const rows = filteredAnalyses.map((analysis) => ({
    id: analysis.analysis_id,
    application: analysis.application_name,
    release: analysis.release_version,
    environment: analysis.environment,
    decision: analysis.decision ?? '—',
    blockers: analysis.blockers ?? 0,
    score: analysis.readiness_score ?? '—',
  }))

  return (
    <div className={styles.page}>
      {/* ── Page hero ───────────────────────────────────────────────── */}
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <div className={styles.eyebrowRow}>
              <span className={styles.eyebrow}>
                Analysis history
              </span>

              <span
                className={styles.eyebrowDivider}
                aria-hidden="true"
              />

              <span className={styles.agentState}>
                <span
                  className={styles.agentStateDot}
                  aria-hidden="true"
                />
                IBM Bob archive
              </span>
            </div>

            <h1 className={styles.heading}>
              Release decision history
            </h1>

            <p className={styles.heroDescription}>
              Review completed IBM Bob release-readiness decisions across
              applications, versions, environments, blockers, and readiness
              scores.
            </p>
          </div>

          <div className={styles.heroAction}>
            <Button
              kind="primary"
              size="lg"
              renderIcon={Add}
              onClick={() => onNavigate('new-analysis')}
            >
              New analysis
            </Button>
          </div>
        </div>
      </section>

      {/* ── Page content ─────────────────────────────────────────────── */}
      <div className={styles.content}>
        <Grid fullWidth>
          {/* ── Load state ───────────────────────────────────────────── */}
          {loadError && (
            <Column sm={4} md={8} lg={16}>
              <InlineNotification
                kind="error"
                title="Analysis history could not be loaded"
                subtitle={loadError}
                lowContrast
                hideCloseButton
              />
            </Column>
          )}

          {/* ── Historical readiness posture ────────────────────────── */}
          <Column sm={4} md={8} lg={16}>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.sectionEyebrow}>
                  Operational archive
                </p>

                <h2>Historical readiness posture</h2>
              </div>

              <p>
                Aggregated from completed IBM Bob release-readiness analyses.
              </p>
            </div>
          </Column>

          <Column sm={4} md={4} lg={4}>
            <article
              className={`${styles.metric} ${styles.metricBlue}`}
            >
              <Analytics size={20} />

              <span className={styles.metricLabel}>
                Analyses completed
              </span>

              <strong className={styles.metricValue}>
                {totalCompleted}
              </strong>

              <span className={styles.metricMeta}>
                IBM Bob decisions
              </span>
            </article>
          </Column>

          <Column sm={4} md={4} lg={4}>
            <article
              className={`${styles.metric} ${styles.metricGreen}`}
            >
              <CheckmarkFilled size={20} />

              <span className={styles.metricLabel}>
                GO decisions
              </span>

              <strong className={styles.metricValue}>
                {goCount}
              </strong>

              <span className={styles.metricMeta}>
                Releases cleared
              </span>
            </article>
          </Column>

          <Column sm={4} md={4} lg={4}>
            <article
              className={`${styles.metric} ${styles.metricRed}`}
            >
              <WarningFilled size={20} />

              <span className={styles.metricLabel}>
                NO-GO decisions
              </span>

              <strong className={styles.metricValue}>
                {noGoCount}
              </strong>

              <span className={styles.metricMeta}>
                {totalBlockers} confirmed blocker
                {totalBlockers === 1 ? '' : 's'}
              </span>
            </article>
          </Column>

          <Column sm={4} md={4} lg={4}>
            <article
              className={`${styles.metric} ${styles.metricPurple}`}
            >
              <IbmWatsonMachineLearning size={20} />

              <span className={styles.metricLabel}>
                Average readiness
              </span>

              <div className={styles.metricScoreRow}>
                <strong className={styles.metricValue}>
                  {averageScore}
                </strong>

                <span className={styles.metricDenominator}>
                  /100
                </span>
              </div>

              <span className={styles.metricMeta}>
                Across completed releases
              </span>
            </article>
          </Column>

          {/* ── Release decision archive ─────────────────────────────── */}
          <Column sm={4} md={8} lg={16}>
            <section className={styles.historySection}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.sectionEyebrow}>
                    IBM Bob activity
                  </p>

                  <h2>Completed release decisions</h2>
                </div>

                <div className={styles.historySignal}>
                  <SecurityServices size={16} />
                  Evidence-backed archive
                </div>
              </div>

              {loading ? (
                <div className={styles.loadingState}>
                  <InlineLoading
                    status="active"
                    description="Loading IBM Bob analysis history…"
                  />
                </div>
              ) : (
                <DataTable
                  rows={rows}
                  headers={headers}
                  isSortable
                >
                  {({
                    rows: tableRows,
                    headers: tableHeaders,
                    getHeaderProps,
                    getRowProps,
                    getTableProps,
                    getToolbarProps,
                  }) => (
                    <TableContainer className={styles.tableContainer}>
                      <TableToolbar
                        {...getToolbarProps()}
                        className={styles.tableToolbar}
                      >
                        <TableToolbarContent>
                          <TableToolbarSearch
                            persistent
                            value={searchQuery}
                            placeholder="Search application, release, environment, or decision"
                            onChange={(event) => {
                              const target =
                                event.target as HTMLInputElement

                              setSearchQuery(target.value)
                            }}
                          />
                        </TableToolbarContent>
                      </TableToolbar>

                      <Table
                        {...getTableProps()}
                        className={styles.table}
                      >
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
                          {tableRows.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={headers.length}>
                                <div className={styles.emptyState}>
                                  <IbmWatsonMachineLearning size={24} />

                                  <div>
                                    <p className={styles.emptyEyebrow}>
                                      {searchQuery
                                        ? 'No matching analyses'
                                        : 'No completed analyses'}
                                    </p>

                                    <h3>
                                      {searchQuery
                                        ? 'No IBM Bob release decision matches this search.'
                                        : 'Run the first IBM Bob release analysis.'}
                                    </h3>

                                    {!searchQuery && (
                                      <p>
                                        Completed GO / NO-GO decisions will
                                        appear here automatically.
                                      </p>
                                    )}
                                  </div>

                                  {!searchQuery && (
                                    <Button
                                      kind="primary"
                                      renderIcon={Add}
                                      onClick={() =>
                                        onNavigate('new-analysis')
                                      }
                                    >
                                      Start analysis
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          ) : (
                            tableRows.map((row) => {
                              const analysis =
                                filteredAnalyses.find(
                                  (item) =>
                                    item.analysis_id === row.id,
                                )

                              if (!analysis) return null

                              const blockers =
                                analysis.blockers ?? 0

                              const score =
                                analysis.readiness_score

                              return (
                                <TableRow
                                  {...getRowProps({ row })}
                                  key={row.id}
                                >
                                  <TableCell>
                                    <div className={styles.applicationCell}>
                                      <span className={styles.appName}>
                                        {analysis.application_name}
                                      </span>

                                      <code className={styles.analysisCode}>
                                        {analysis.analysis_id}
                                      </code>
                                    </div>
                                  </TableCell>

                                  <TableCell>
                                    <code className={styles.releaseCode}>
                                      {analysis.release_version}
                                    </code>
                                  </TableCell>

                                  <TableCell>
                                    {analysis.environment}
                                  </TableCell>

                                  <TableCell>
                                    <Tag
                                      type={decisionTagType(
                                        analysis.decision,
                                      )}
                                      size="sm"
                                    >
                                      {analysis.decision ?? '—'}
                                    </Tag>
                                  </TableCell>

                                  <TableCell>
                                    {blockers > 0 ? (
                                      <span className={styles.blockerCount}>
                                        {blockers}
                                      </span>
                                    ) : (
                                      <span className={styles.noBlockers}>
                                        0
                                      </span>
                                    )}
                                  </TableCell>

                                  <TableCell>
                                    <span
                                      className={scoreClass(score)}
                                    >
                                      {score ?? '—'}
                                      {score != null && (
                                        <small>/100</small>
                                      )}
                                    </span>
                                  </TableCell>
                                </TableRow>
                              )
                            })
                          )}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </DataTable>
              )}
            </section>
          </Column>

          {/* ── IBM Bob archive explanation ─────────────────────────── */}
          <Column sm={4} md={8} lg={16}>
            <section className={styles.bobFooter}>
              <div className={styles.bobFooterIcon}>
                <IbmWatsonMachineLearning size={24} />
              </div>

              <div>
                <p className={styles.bobFooterEyebrow}>
                  IBM Bob decision archive
                </p>

                <h2>
                  One operational record for every completed release-readiness
                  decision.
                </h2>
              </div>

              <p>
                The archive is populated from the same backend analysis records
                used by NotProdReady to produce GO / NO-GO decisions.
              </p>
            </section>
          </Column>
        </Grid>
      </div>
    </div>
  )
}