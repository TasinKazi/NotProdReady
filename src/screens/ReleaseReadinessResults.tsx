import { useMemo, useState } from 'react'
import {
  Button,
  Column,
  Grid,
  InlineLoading,
  InlineNotification,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Tag,
} from '@carbon/react'
import {
  Analytics,
  ArrowRight,
  CheckmarkFilled,
  Code,
  ErrorFilled,
  IbmWatsonMachineLearning,
  Renew,
  SecurityServices,
  User,
  WarningFilled,
} from '@carbon/icons-react'
import styles from './ReleaseReadinessResults.module.scss'
import { mockAnalysis } from '../data/mockAnalysis'
import type {
  AgentStep,
  Finding,
  MockAnalysis,
} from '../data/mockAnalysis'
import type {
  ApiAgentStep,
  ApiFinding,
  ApiReleaseResult,
} from '../api/types'
import OverviewTab from './tabs/OverviewTab'
import FindingsTab from './tabs/FindingsTab'
import EvidenceTab from './tabs/EvidenceTab'
import AgentActivityTab from './tabs/AgentActivityTab'
import type { ViewId } from '../types/navigation'
import { startRemediation } from '../api/analyses'

interface Props {
  apiResult?: ApiReleaseResult | null
  analysisId?: string | null
  onNavigate?: (view: ViewId) => void
  onRemediateStarted?: (analysisId: string) => void
}

/* ── API result → presentation model ───────────────────────────────── */

function mapFinding(finding: ApiFinding): Finding {
  return {
    id: finding.id,
    title: finding.title,
    severity: finding.severity as Finding['severity'],
    runbook: finding.runbook,
    repository: finding.repository,
    missing: finding.missing,
    migration: finding.migration,
    evidence: finding.evidence_text ?? finding.explanation,
    evidenceFile: finding.evidence_file,
    recommendation: finding.recommendation,
  }
}

function mapAgentStep(step: ApiAgentStep): AgentStep {
  return {
    id: step.id,
    timestamp: step.timestamp,
    action: step.action,
    target: step.target,
    result: step.result,
    status: step.status as AgentStep['status'],
  }
}

function buildDisplayData(apiResult: ApiReleaseResult): MockAnalysis {
  return {
    app: apiResult.app,
    release: apiResult.release,
    environment: apiResult.environment,
    decision: apiResult.decision as MockAnalysis['decision'],
    readiness: {
      score: apiResult.readiness_score,
    },
    summary: {
      blockers: apiResult.summary.blockers,
      warnings: apiResult.summary.warnings,
      passed: apiResult.summary.passed,
    },
    findings: apiResult.findings.map(mapFinding),
    agentActivity: apiResult.agent_activity.map(mapAgentStep),
    analysis: {
      id: apiResult.metadata.id,
      duration: apiResult.metadata.duration,
      filesInspected: apiResult.metadata.files_inspected,
      commandsExecuted: apiResult.metadata.commands_executed,
      completedAt: apiResult.metadata.completed_at,
    },
  }
}

/* ── Readiness score bar ────────────────────────────────────────────── */

function ReadinessBar({
  score,
  isNoGo,
}: {
  score: number
  isNoGo: boolean
}) {
  const clampedScore = Math.max(0, Math.min(100, score))

  return (
    <div
      className={styles.readinessBarWrap}
      aria-label={`Readiness score: ${score} out of 100`}
    >
      <div className={styles.readinessBarTrack}>
        <div
          className={
            isNoGo
              ? styles.readinessBarFillNogo
              : styles.readinessBarFillGo
          }
          style={{ width: `${clampedScore}%` }}
        />
      </div>
    </div>
  )
}

/* ── IBM Bob analysis provenance ────────────────────────────────────── */

function AnalysisProvenance({
  analysis,
}: {
  analysis: MockAnalysis['analysis']
}) {
  return (
    <section className={styles.provenanceSection}>
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.sectionEyebrow}>Analysis provenance</p>
          <h2>Produced by IBM Bob</h2>
        </div>

        <Tag type="blue" size="sm">
          Agent-generated result
        </Tag>
      </div>

      <div className={styles.provenanceGrid}>
        <div className={styles.provenanceLead}>
          <div className={styles.provenanceAgentIcon}>
            <IbmWatsonMachineLearning size={26} />
          </div>

          <div>
            <span className={styles.provenanceLabel}>Performed by</span>

            <div className={styles.provenanceValueRow}>
              <User size={14} />
              <span className={styles.provenanceValue}>IBM Bob</span>
            </div>
          </div>
        </div>

        <div className={styles.provenanceItem}>
          <span className={styles.provenanceLabel}>Analysis ID</span>
          <code className={styles.provenanceCode}>
            {analysis.id || '—'}
          </code>
        </div>

        <div className={styles.provenanceItem}>
          <span className={styles.provenanceLabel}>Duration</span>
          <span className={styles.provenanceValue}>
            {analysis.duration || '—'}
          </span>
        </div>

        <div className={styles.provenanceItem}>
          <span className={styles.provenanceLabel}>Files inspected</span>
          <span
            className={`${styles.provenanceValue} ${styles.provenanceValueMono}`}
          >
            {analysis.filesInspected}
          </span>
        </div>

        <div className={styles.provenanceItem}>
          <span className={styles.provenanceLabel}>Commands executed</span>
          <span
            className={`${styles.provenanceValue} ${styles.provenanceValueMono}`}
          >
            {analysis.commandsExecuted}
          </span>
        </div>
      </div>
    </section>
  )
}

/* ── Result screen ─────────────────────────────────────────────────── */

export default function ReleaseReadinessResults({
  apiResult,
  analysisId,
  onNavigate,
  onRemediateStarted,
}: Props) {
  const [remediating, setRemediating] = useState(false)
  const [remediateError, setRemediateError] =
    useState<string | null>(null)

  const data: MockAnalysis = apiResult
    ? buildDisplayData(apiResult)
    : mockAnalysis

  const {
    app,
    release,
    environment,
    decision,
    readiness,
    summary,
    analysis,
  } = data

  const isNoGo = decision === 'NO-GO'
  const canRemediate = isNoGo && Boolean(analysisId)

  const supportText =
    apiResult?.support_message ??
    (isNoGo
      ? 'IBM Bob confirmed release-readiness blockers between the deployment contract and repository implementation.'
      : 'IBM Bob found no confirmed blocking mismatch preventing this release from proceeding.')

  /* ── High-signal findings for the decision summary ───────────────── */

  const priorityFindings = useMemo(
    () =>
      data.findings
        .filter(
          (finding) =>
            finding.severity === 'BLOCK' ||
            finding.severity === 'WARN',
        )
        .slice(0, 3),
    [data.findings],
  )

  /* ── Start IBM Bob remediation ───────────────────────────────────── */

  async function handleRemediate() {
    if (!analysisId || remediating) return

    setRemediating(true)
    setRemediateError(null)

    try {
      await startRemediation(analysisId)
      onRemediateStarted?.(analysisId)
      onNavigate?.('remediation-in-progress')
    } catch (error: unknown) {
      setRemediateError(
        error instanceof Error
          ? error.message
          : 'IBM Bob could not start remediation.',
      )
      setRemediating(false)
    }
  }

  return (
    <div className={styles.page}>
      {/* ── Result context header ────────────────────────────────────── */}
      <section className={styles.contextHeader}>
        <div className={styles.contextInner}>
          <div>
            <p className={styles.headerEyebrow}>
              IBM Bob release-readiness result
            </p>

            <div className={styles.headerMeta}>
              <span className={styles.appName}>{app}</span>

              <span
                className={styles.headerSeparator}
                aria-hidden="true"
              />

              <Tag type="cool-gray" size="md">
                {release}
              </Tag>

              <Tag type="cool-gray" size="md">
                {environment}
              </Tag>
            </div>
          </div>

          <div className={styles.contextAgent}>
            <span className={styles.contextAgentDot} aria-hidden="true" />

            <div>
              <span>IBM Bob</span>
              <small>Analysis complete</small>
            </div>
          </div>
        </div>
      </section>

      {/* ── GO / NO-GO decision hero ────────────────────────────────── */}
      <section
        className={
          isNoGo
            ? styles.decisionHeroNoGo
            : styles.decisionHeroGo
        }
      >
        <div className={styles.decisionHeroInner}>
          <div className={styles.decisionPrimary}>
            <div
              className={
                isNoGo
                  ? styles.decisionIconNoGo
                  : styles.decisionIconGo
              }
            >
              {isNoGo ? (
                <ErrorFilled size={32} />
              ) : (
                <CheckmarkFilled size={32} />
              )}
            </div>

            <div className={styles.decisionCopy}>
              <p className={styles.decisionEyebrow}>
                Release decision
              </p>

              <h1>{decision}</h1>

              <p className={styles.decisionSupport}>
                {supportText}
              </p>

              <div className={styles.decisionCounts}>
                <div className={styles.decisionCountBlock}>
                  <ErrorFilled size={16} />

                  <div>
                    <strong>{summary.blockers}</strong>
                    <span>
                      {summary.blockers === 1
                        ? 'blocker'
                        : 'blockers'}
                    </span>
                  </div>
                </div>

                <div className={styles.decisionCountWarn}>
                  <WarningFilled size={16} />

                  <div>
                    <strong>{summary.warnings}</strong>
                    <span>
                      {summary.warnings === 1
                        ? 'warning'
                        : 'warnings'}
                    </span>
                  </div>
                </div>

                <div className={styles.decisionCountPass}>
                  <CheckmarkFilled size={16} />

                  <div>
                    <strong>{summary.passed}</strong>
                    <span>passed</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <aside className={styles.scorePanel}>
            <p className={styles.scoreEyebrow}>
              Readiness score
            </p>

            <div className={styles.scoreRow}>
              <span className={styles.scoreValue}>
                {readiness.score}
              </span>

              <span className={styles.scoreMax}>
                /100
              </span>
            </div>

            <ReadinessBar
              score={readiness.score}
              isNoGo={isNoGo}
            />

            <p className={styles.scoreExplanation}>
              Calculated from confirmed IBM Bob findings.
            </p>
          </aside>
        </div>
      </section>

      {/* ── IBM Bob action bar ───────────────────────────────────────── */}
      <section className={styles.actionsBand}>
        <div className={styles.actionsInner}>
          <div className={styles.actionNarrative}>
            <IbmWatsonMachineLearning size={22} />

            <div>
              <span className={styles.actionNarrativeTitle}>
                {isNoGo
                  ? 'IBM Bob can act on this result'
                  : 'IBM Bob found no blocking release mismatch'}
              </span>

              <span className={styles.actionNarrativeMeta}>
                {isNoGo
                  ? 'Remediation applies targeted repository changes for confirmed findings while preserving the release analysis trail.'
                  : 'The release can proceed according to the current readiness decision.'}
              </span>
            </div>
          </div>

          <div className={styles.actions}>
            {isNoGo && (
              <Button
                kind="primary"
                size="lg"
                renderIcon={
                  remediating ? undefined : ArrowRight
                }
                onClick={handleRemediate}
                disabled={!canRemediate || remediating}
              >
                {remediating ? (
                  <InlineLoading
                    description="Starting IBM Bob…"
                    status="active"
                  />
                ) : (
                  'Ask Bob to remediate'
                )}
              </Button>
            )}

            <Button
              kind={isNoGo ? 'secondary' : 'primary'}
              size="lg"
              renderIcon={Renew}
              onClick={() => onNavigate?.('new-analysis')}
            >
              Run another analysis
            </Button>
          </div>
        </div>

        {remediateError && (
          <div className={styles.actionError}>
            <InlineNotification
              kind="error"
              title="IBM Bob remediation could not start"
              subtitle={remediateError}
              lowContrast
              hideCloseButton
            />
          </div>
        )}
      </section>

      {/* ── Decision summary ─────────────────────────────────────────── */}
      <section className={styles.content}>
        <Grid fullWidth>
          <Column sm={4} md={8} lg={16}>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.sectionEyebrow}>
                  Decision summary
                </p>

                <h2>
                  {isNoGo
                    ? 'What is preventing production readiness'
                    : 'Why IBM Bob considers this release ready'}
                </h2>
              </div>

              <p>
                Confirmed findings are grounded in the deployment
                documentation and repository inspected by IBM Bob.
              </p>
            </div>
          </Column>

          {/* ── High-signal finding cards ────────────────────────────── */}
          {priorityFindings.length > 0 ? (
            priorityFindings.map((finding, index) => (
              <Column
                key={finding.id}
                sm={4}
                md={8}
                lg={priorityFindings.length === 1 ? 16 : 8}
              >
                <article
                  className={
                    finding.severity === 'BLOCK'
                      ? styles.priorityFindingBlock
                      : styles.priorityFindingWarn
                  }
                >
                  <div className={styles.priorityFindingHeader}>
                    <span className={styles.priorityFindingIndex}>
                      {String(index + 1).padStart(2, '0')}
                    </span>

                    <Tag
                      type={
                        finding.severity === 'BLOCK'
                          ? 'red'
                          : 'warm-gray'
                      }
                      size="sm"
                    >
                      {finding.severity}
                    </Tag>
                  </div>

                  <h3>{finding.title}</h3>

                  {finding.evidenceFile && (
                    <code className={styles.priorityFindingFile}>
                      {finding.evidenceFile}
                    </code>
                  )}

                  <p>
                    {finding.recommendation ??
                      'Review the confirmed mismatch before production deployment.'}
                  </p>
                </article>
              </Column>
            ))
          ) : (
            <Column sm={4} md={8} lg={16}>
              <div className={styles.readySummary}>
                <div className={styles.readySummaryIcon}>
                  <CheckmarkFilled size={24} />
                </div>

                <div>
                  <h3>No blocking findings remain.</h3>

                  <p>
                    IBM Bob completed the release-readiness workflow
                    without confirming a production-blocking mismatch.
                  </p>
                </div>
              </div>
            </Column>
          )}

          {/* ── Detailed result navigation ───────────────────────────── */}
          <Column sm={4} md={8} lg={16}>
            <section className={styles.detailSection}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.sectionEyebrow}>
                    Analysis detail
                  </p>

                  <h2>Inspect the IBM Bob decision trail</h2>
                </div>

                <div className={styles.detailAgent}>
                  <SecurityServices size={16} />
                  Evidence-backed result
                </div>
              </div>

              <Tabs>
                <div className={styles.tabListWrapper}>
                  <TabList aria-label="Release readiness result sections">
                    <Tab>Overview</Tab>

                    <Tab>
                      Findings
                      {summary.blockers > 0 && (
                        <span className={styles.tabBadgeBlock}>
                          {summary.blockers}
                        </span>
                      )}
                    </Tab>

                    <Tab>Evidence</Tab>
                    <Tab>Agent activity</Tab>
                  </TabList>
                </div>

                <TabPanels>
                  <TabPanel>
                    <OverviewTab data={data} />
                  </TabPanel>

                  <TabPanel>
                    <FindingsTab findings={data.findings} />
                  </TabPanel>

                  <TabPanel>
                    <EvidenceTab findings={data.findings} />
                  </TabPanel>

                  <TabPanel>
                    <AgentActivityTab
                      activity={data.agentActivity}
                    />
                  </TabPanel>
                </TabPanels>
              </Tabs>
            </section>
          </Column>

          {/* ── IBM Bob analysis provenance ──────────────────────────── */}
          <Column sm={4} md={8} lg={16}>
            <AnalysisProvenance analysis={analysis} />
          </Column>

          {/* ── Result footer ────────────────────────────────────────── */}
          <Column sm={4} md={8} lg={16}>
            <section className={styles.resultFooter}>
              <div className={styles.resultFooterIcon}>
                <Analytics size={20} />
              </div>

              <div>
                <p className={styles.resultFooterEyebrow}>
                  NotProdReady · IBM Bob
                </p>

                <h2>
                  From release documentation to an actionable
                  production decision.
                </h2>
              </div>

              <div className={styles.resultFooterCapabilities}>
                <span>
                  <Code size={14} />
                  Repository inspection
                </span>

                <span>
                  <SecurityServices size={14} />
                  Release verification
                </span>

                <span>
                  <IbmWatsonMachineLearning size={14} />
                  Agent remediation
                </span>
              </div>
            </section>
          </Column>
        </Grid>
      </section>
    </div>
  )
}
