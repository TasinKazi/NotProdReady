import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Column,
  Grid,
  InlineLoading,
  InlineNotification,
  Tag,
} from '@carbon/react'
import {
  ArrowRight,
  CheckmarkFilled,
  CircleDash,
  Code,
  Document,
  ErrorFilled,
  IbmWatsonMachineLearning,
  Search,
  SecurityServices,
} from '@carbon/icons-react'
import type { ViewId } from '../types/navigation'
import type { ApiReleaseResult, SseMessage } from '../api/types'
import { getAnalysisResult, subscribeToEvents } from '../api/analyses'
import styles from './AnalysisInProgressScreen.module.scss'

interface Props {
  analysisId: string | null
  isRevalidation?: boolean
  onComplete: (result: ApiReleaseResult) => void
  onNavigate: (view: ViewId) => void
}

/* ── Agent activity model ───────────────────────────────────────────── */

type StepStatus = 'done' | 'active' | 'waiting' | 'failed'

interface AgentStep {
  id: string
  label: string
  detail: string
  status: StepStatus
}

interface AgentStage {
  id: string
  name: string
  description: string
  status: StepStatus
  icon: typeof Document
  steps: AgentStep[]
}

/* ── Initial IBM Bob workflow ───────────────────────────────────────── */

function makeInitialStages(isRevalidation: boolean): AgentStage[] {
  const stages: AgentStage[] = [
    {
      id: 'runbook',
      name: 'Runbook Analyst',
      description:
        'Extracting the intended release contract from deployment documentation.',
      status: 'active',
      icon: Document,
      steps: [
        {
          id: 'runbook-parse',
          label: 'Parse deployment documentation',
          detail: 'Identify the release requirements Bob must verify.',
          status: 'active',
        },
        {
          id: 'runbook-runtime',
          label: 'Extract runtime requirements',
          detail: 'Runtime, environment, commands, and deployment expectations.',
          status: 'waiting',
        },
        {
          id: 'runbook-rollback',
          label: 'Extract migration and rollback requirements',
          detail: 'Operational expectations for database and rollback safety.',
          status: 'waiting',
        },
      ],
    },
    {
      id: 'repository',
      name: 'Repository Inspector',
      description:
        'Inspecting implementation evidence that determines how the release actually behaves.',
      status: 'waiting',
      icon: Code,
      steps: [
        {
          id: 'repo-files',
          label: 'Inspect release-defining files',
          detail:
            'Package manifests, container configuration, environment templates, and migrations.',
          status: 'waiting',
        },
        {
          id: 'repo-startup',
          label: 'Inspect startup and configuration',
          detail:
            'Confirm how the application starts and which settings are required.',
          status: 'waiting',
        },
        {
          id: 'repo-migrations',
          label: 'Inspect migration and rollback artifacts',
          detail:
            'Confirm required operational artifacts exist in the repository.',
          status: 'waiting',
        },
      ],
    },
    {
      id: 'verification',
      name: 'Release Verifier',
      description:
        'Comparing documented release claims with repository evidence before publishing findings.',
      status: 'waiting',
      icon: SecurityServices,
      steps: [
        {
          id: 'verify-runtime',
          label: 'Compare runtime and configuration',
          detail: 'Verify the runbook matches the implementation.',
          status: 'waiting',
        },
        {
          id: 'verify-deploy',
          label: 'Verify deployment behavior',
          detail: 'Validate build, startup, environment, and migration expectations.',
          status: 'waiting',
        },
        {
          id: 'verify-decision',
          label: 'Produce release decision',
          detail: 'Classify findings and calculate the readiness decision.',
          status: 'waiting',
        },
      ],
    },
  ]

  if (isRevalidation) {
    stages.push({
      id: 'revalidation',
      name: 'Revalidation Agent',
      description:
        'Checking the remediated repository against the previously confirmed findings.',
      status: 'waiting',
      icon: Search,
      steps: [
        {
          id: 'reval-check',
          label: 'Check remediated findings',
          detail: 'Verify changes made during remediation.',
          status: 'waiting',
        },
        {
          id: 'reval-verify',
          label: 'Verify remaining issues',
          detail: 'Identify any findings that still require attention.',
          status: 'waiting',
        },
        {
          id: 'reval-decision',
          label: 'Produce updated decision',
          detail: 'Generate the updated readiness result.',
          status: 'waiting',
        },
      ],
    })
  }

  return stages
}

/* ── Stage state helpers ────────────────────────────────────────────── */

function updateStage(
  stages: AgentStage[],
  stageId: string,
  updater: (stage: AgentStage) => AgentStage,
): AgentStage[] {
  return stages.map((stage) =>
    stage.id === stageId ? updater(stage) : stage,
  )
}

function setStageActive(
  stages: AgentStage[],
  stageId: string,
): AgentStage[] {
  return updateStage(stages, stageId, (stage) => ({
    ...stage,
    status: 'active',
    steps: stage.steps.map((step, index) => ({
      ...step,
      status:
        step.status === 'done'
          ? 'done'
          : index ===
              stage.steps.findIndex((candidate) => candidate.status !== 'done')
            ? 'active'
            : step.status,
    })),
  }))
}

function completeStage(
  stages: AgentStage[],
  stageId: string,
): AgentStage[] {
  return updateStage(stages, stageId, (stage) => ({
    ...stage,
    status: 'done',
    steps: stage.steps.map((step) => ({
      ...step,
      status: 'done',
    })),
  }))
}

function completeAllStages(stages: AgentStage[]): AgentStage[] {
  return stages.map((stage) => ({
    ...stage,
    status: stage.status === 'failed' ? 'failed' : 'done',
    steps: stage.steps.map((step) => ({
      ...step,
      status: step.status === 'failed' ? 'failed' : 'done',
    })),
  }))
}

function activateVerification(stages: AgentStage[]): AgentStage[] {
  let next = completeStage(stages, 'repository')
  next = setStageActive(next, 'verification')

  return updateStage(next, 'verification', (stage) => ({
    ...stage,
    steps: stage.steps.map((step, index) => ({
      ...step,
      status: index === 0 ? 'active' : 'waiting',
    })),
  }))
}

/* ── IBM Bob event → workflow mapping ──────────────────────────────── */

function applyBobEvent(
  stages: AgentStage[],
  message: SseMessage,
): AgentStage[] {
  switch (message.event) {
    case 'analysis.started':
    case 'document.analysis.started':
      return setStageActive(stages, 'runbook')

    case 'document.requirement.found':
      return updateStage(stages, 'runbook', (stage) => {
        const firstWaitingIndex = stage.steps.findIndex(
          (step) => step.status === 'waiting',
        )

        return {
          ...stage,
          steps: stage.steps.map((step, index) => {
            if (step.status === 'active') {
              return { ...step, status: 'done' as StepStatus }
            }

            if (index === firstWaitingIndex) {
              return { ...step, status: 'active' as StepStatus }
            }

            return step
          }),
        }
      })

    case 'document.analysis.completed': {
      let next = completeStage(stages, 'runbook')
      next = setStageActive(next, 'repository')
      return next
    }

    case 'repository.analysis.started':
    case 'repository.file.inspected':
      return setStageActive(stages, 'repository')

    case 'finding.detected':
      return setStageActive(stages, 'verification')

    case 'verification.started':
      return activateVerification(stages)

    case 'verification.completed':
      return completeStage(stages, 'verification')

    case 'revalidation.check':
      return setStageActive(stages, 'revalidation')

    case 'analysis.synthesizing':
      return updateStage(stages, 'verification', (stage) => ({
        ...stage,
        status: 'active',
        steps: stage.steps.map((step, index) => ({
          ...step,
          status:
            index < stage.steps.length - 1
              ? 'done'
              : 'active',
        })),
      }))

    case 'analysis.completed':
      return completeAllStages(stages)

    default:
      return stages
  }
}

/* ── User-safe failure message ─────────────────────────────────────── */

function toUserSafeError(rawError: string): string {
  if (
    rawError.includes('ReleaseResult schema') ||
    rawError.includes('Finalization output did not validate')
  ) {
    return (
      'IBM Bob completed repository inspection, but the final release result ' +
      'could not be validated. No readiness decision was published.'
    )
  }

  if (
    rawError.toLowerCase().includes('timeout') ||
    rawError.toLowerCase().includes('timed out')
  ) {
    return 'IBM Bob did not complete the analysis within the configured time limit.'
  }

  if (
    rawError.includes('BOB_API_KEY') ||
    rawError.includes('API key') ||
    rawError.includes('401')
  ) {
    return 'IBM Bob authentication failed. Check the configured Bob credentials.'
  }

  if (
    rawError.toLowerCase().includes('executable') ||
    rawError.toLowerCase().includes('not found on path')
  ) {
    return 'The IBM Bob executable could not be started by the backend.'
  }

  if (rawError) {
    const safeMessage = rawError
      .replace(/[A-Za-z0-9_-]{40,}/g, '[REDACTED]')
      .slice(0, 220)

    return `IBM Bob analysis failed: ${safeMessage}`
  }

  return 'IBM Bob analysis failed. Check the backend logs for details.'
}

/* ── Component ─────────────────────────────────────────────────────── */

export default function AnalysisInProgressScreen({
  analysisId,
  isRevalidation = false,
  onComplete,
  onNavigate,
}: Props) {
  const initialStages = makeInitialStages(isRevalidation)

  const [stages, setStages] = useState<AgentStage[]>(initialStages)
  const [finished, setFinished] = useState(false)
  const [failed, setFailed] = useState(false)
  const [failureMessage, setFailureMessage] = useState<string | null>(null)
  const [resultLoadFailed, setResultLoadFailed] = useState(false)
  const [connectionWarning, setConnectionWarning] =
    useState<string | null>(null)

  const [appName, setAppName] = useState('')
  const [releaseVersion, setReleaseVersion] = useState('')
  const [environment, setEnvironment] = useState('')

  const stagesRef = useRef<AgentStage[]>(initialStages)

  /* ── Subscribe to IBM Bob analysis activity ──────────────────────── */

  useEffect(() => {
    if (!analysisId) {
      setFailureMessage('No analysis ID was provided.')
      setFailed(true)
      setFinished(true)
      return
    }

    const cleanup = subscribeToEvents(analysisId, {
      onMessage: (message: SseMessage) => {
        if (message.event === 'analysis.started') {
          const data = message.data as Record<string, unknown>

          if (data.application_name) {
            setAppName(String(data.application_name))
          }

          if (data.release_version) {
            setReleaseVersion(String(data.release_version))
          }

          if (data.environment) {
            setEnvironment(String(data.environment))
          }
        }

        if (message.event === 'analysis.failed') {
          const data = message.data as Record<string, unknown>
          const rawError = String(data.error ?? '')

          setFailureMessage(toUserSafeError(rawError))
          setFailed(true)
          setFinished(true)
          return
        }

        const nextStages = applyBobEvent(stagesRef.current, message)
        stagesRef.current = nextStages
        setStages([...nextStages])
      },

      onDone: () => {
        const finalized = completeAllStages(stagesRef.current)
        stagesRef.current = finalized
        setStages([...finalized])
        setFinished(true)
      },

      onError: () => {
        setConnectionWarning(
          'The live progress connection was interrupted. IBM Bob may still be running in the backend.',
        )
      },
    })

    return cleanup
  }, [analysisId])

  /* ── Load the completed release result ────────────────────────────── */

  async function handleViewResults() {
    if (!analysisId) return

    setResultLoadFailed(false)

    try {
      const result = await getAnalysisResult(analysisId)
      onComplete(result)
    } catch (error) {
      setResultLoadFailed(true)
      setFailureMessage(
        error instanceof Error
          ? `The analysis completed, but the result could not be loaded: ${error.message}`
          : 'The analysis completed, but the result could not be loaded.',
      )
    }
  }

  /* ── Progress summary ─────────────────────────────────────────────── */

  const completedStages = stages.filter(
    (stage) => stage.status === 'done',
  ).length

  const activeStage = stages.find(
    (stage) => stage.status === 'active',
  )

  const progressPercent =
    stages.length > 0
      ? Math.round((completedStages / stages.length) * 100)
      : 0

  const title = isRevalidation
    ? appName
      ? `Revalidating ${appName}`
      : 'Revalidating release'
    : appName
      ? `Analyzing ${appName}`
      : 'Preparing analysis'

  return (
    <div className={styles.page}>
      {/* ── Analysis hero ────────────────────────────────────────────── */}
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <div className={styles.eyebrowRow}>
              <span className={styles.eyebrow}>
                {isRevalidation ? 'Revalidation' : 'Release analysis'}
              </span>

              <span className={styles.eyebrowDivider} aria-hidden="true" />

              <span className={styles.agentState}>
                <span className={styles.agentStateDot} aria-hidden="true" />
                IBM Bob agent
              </span>
            </div>

            <h1 className={styles.heading}>{title}</h1>

            <div className={styles.releaseMeta}>
              {releaseVersion && (
                <Tag type="cool-gray" size="md">
                  {releaseVersion}
                </Tag>
              )}

              {environment && (
                <Tag type="cool-gray" size="md">
                  {environment}
                </Tag>
              )}

              {analysisId && (
                <span className={styles.analysisId}>
                  {analysisId}
                </span>
              )}
            </div>
          </div>

          <div className={styles.heroAgent}>
            <IbmWatsonMachineLearning size={28} />

            <div>
              <span className={styles.heroAgentLabel}>IBM Bob</span>
              <span className={styles.heroAgentMeta}>
                Release-readiness agent
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Analysis status band ─────────────────────────────────────── */}
      <section
        className={
          failed
            ? styles.statusBandFailed
            : finished
              ? styles.statusBandComplete
              : styles.statusBandActive
        }
      >
        <div className={styles.statusBandInner}>
          <div className={styles.statusPrimary}>
            {failed ? (
              <ErrorFilled size={20} />
            ) : finished ? (
              <CheckmarkFilled size={20} />
            ) : (
              <InlineLoading status="active" />
            )}

            <div>
              <span className={styles.statusLabel}>
                {failed
                  ? 'Analysis failed'
                  : finished
                    ? 'IBM Bob analysis complete'
                    : 'IBM Bob is validating release readiness'}
              </span>

              <span className={styles.statusMeta}>
                {failed
                  ? 'The release decision was not published.'
                  : finished
                    ? 'Repository inspection and release verification are complete.'
                    : activeStage?.description ??
                      'Preparing the release-readiness workflow.'}
              </span>
            </div>
          </div>

          {!failed && (
            <div className={styles.progressSummary}>
              <span className={styles.progressValue}>
                {finished ? 100 : progressPercent}
                <span>%</span>
              </span>

              <span className={styles.progressLabel}>
                workflow complete
              </span>
            </div>
          )}
        </div>
      </section>

      {/* ── Page content ─────────────────────────────────────────────── */}
      <div className={styles.content}>
        <Grid fullWidth>
          {/* ── Failure / connection states ─────────────────────────── */}
          {(failed || resultLoadFailed) && failureMessage && (
            <Column sm={4} md={8} lg={16}>
              <InlineNotification
                kind="error"
                title={
                  failed
                    ? 'IBM Bob could not complete the analysis'
                    : 'Result could not be loaded'
                }
                subtitle={failureMessage}
                lowContrast
                hideCloseButton
              />
            </Column>
          )}

          {connectionWarning && !failed && (
            <Column sm={4} md={8} lg={16}>
              <InlineNotification
                kind="warning"
                title="Live progress connection interrupted"
                subtitle={connectionWarning}
                lowContrast
                hideCloseButton
              />
            </Column>
          )}

          {/* ── IBM Bob agent workflow ───────────────────────────────── */}
          <Column sm={4} md={8} lg={16}>
            <section className={styles.workflowSection}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.sectionEyebrow}>Agent activity</p>
                  <h2>IBM Bob release-readiness workflow</h2>
                </div>

                <p>
                  Bob moves through each analysis stage before publishing a
                  grounded GO / NO-GO decision.
                </p>
              </div>

              <div className={styles.stageGrid}>
                {stages.map((stage, index) => {
                  const Icon = stage.icon

                  return (
                    <article
                      key={stage.id}
                      className={`${styles.stageCard} ${
                        stage.status === 'active'
                          ? styles.stageCardActive
                          : stage.status === 'done'
                            ? styles.stageCardDone
                            : stage.status === 'failed'
                              ? styles.stageCardFailed
                              : styles.stageCardWaiting
                      }`}
                    >
                      <div className={styles.stageHeader}>
                        <span className={styles.stageIndex}>
                          {String(index + 1).padStart(2, '0')}
                        </span>

                        <StageStatusIcon status={stage.status} />
                      </div>

                      <div className={styles.stageIcon}>
                        <Icon size={24} />
                      </div>

                      <h3>{stage.name}</h3>
                      <p className={styles.stageDescription}>
                        {stage.description}
                      </p>

                      <div className={styles.stageSteps}>
                        {stage.steps.map((step) => (
                          <div key={step.id} className={styles.stepRow}>
                            <StepStatusIcon status={step.status} />

                            <div className={styles.stepCopy}>
                              <span
                                className={
                                  step.status === 'active'
                                    ? styles.stepLabelActive
                                    : step.status === 'done'
                                      ? styles.stepLabelDone
                                      : styles.stepLabel
                                }
                              >
                                {step.label}
                              </span>

                              <span className={styles.stepDetail}>
                                {step.detail}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>

                      {stage.status === 'active' && !finished && (
                        <div className={styles.stageWorking}>
                          <InlineLoading
                            status="active"
                            description="IBM Bob working…"
                          />
                        </div>
                      )}

                      {stage.status === 'done' && (
                        <div className={styles.stageComplete}>
                          <CheckmarkFilled size={14} />
                          Stage complete
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            </section>
          </Column>

          {/* ── What Bob is doing ────────────────────────────────────── */}
          <Column sm={4} md={8} lg={16}>
            <section className={styles.explanationBand}>
              <div className={styles.explanationIcon}>
                <IbmWatsonMachineLearning size={24} />
              </div>

              <div className={styles.explanationCopy}>
                <p className={styles.explanationEyebrow}>IBM Bob execution</p>

                <h2>
                  Evidence first. Decision second.
                </h2>

                <p>
                  Bob reads the deployment expectations, inspects the repository,
                  verifies candidate mismatches, and only then produces a
                  release-readiness result.
                </p>
              </div>

              <div className={styles.explanationStat}>
                <span>{completedStages}</span>
                <small>
                  of {stages.length}
                  <br />
                  stages complete
                </small>
              </div>
            </section>
          </Column>

          {/* ── Terminal action ──────────────────────────────────────── */}
          <Column sm={4} md={8} lg={16}>
            <div className={styles.actionBar}>
              <div className={styles.actionCopy}>
                {failed ? (
                  <>
                    <span className={styles.actionTitle}>
                      Release analysis did not complete
                    </span>

                    <span className={styles.actionMeta}>
                      Return to New analysis and try the release package again.
                    </span>
                  </>
                ) : finished ? (
                  <>
                    <span className={styles.actionTitle}>
                      IBM Bob has produced a release decision
                    </span>

                    <span className={styles.actionMeta}>
                      Open the result to review the readiness score, confirmed
                      blockers, warnings, passes, and Bob remediation action.
                    </span>
                  </>
                ) : (
                  <>
                    <span className={styles.actionTitle}>
                      IBM Bob analysis in progress
                    </span>

                    <span className={styles.actionMeta}>
                      Keep this page open while Bob completes the
                      release-readiness workflow.
                    </span>
                  </>
                )}
              </div>

              {failed ? (
                <Button
                  kind="secondary"
                  size="lg"
                  onClick={() => onNavigate('new-analysis')}
                >
                  Start new analysis
                </Button>
              ) : finished ? (
                <Button
                  kind="primary"
                  size="lg"
                  renderIcon={ArrowRight}
                  onClick={handleViewResults}
                >
                  View release decision
                </Button>
              ) : (
                <div className={styles.actionWorking}>
                  <InlineLoading
                    status="active"
                    description="IBM Bob working"
                  />
                </div>
              )}
            </div>
          </Column>
        </Grid>
      </div>
    </div>
  )
}

/* ── Stage status icon ──────────────────────────────────────────────── */

function StageStatusIcon({ status }: { status: StepStatus }) {
  if (status === 'done') {
    return (
      <CheckmarkFilled
        size={18}
        className={styles.iconDone}
      />
    )
  }

  if (status === 'failed') {
    return (
      <ErrorFilled
        size={18}
        className={styles.iconFailed}
      />
    )
  }

  if (status === 'active') {
    return (
      <span className={styles.activeStatusDot}>
        <span aria-hidden="true" />
      </span>
    )
  }

  return (
    <CircleDash
      size={18}
      className={styles.iconWaiting}
    />
  )
}

/* ── Step status icon ───────────────────────────────────────────────── */

function StepStatusIcon({ status }: { status: StepStatus }) {
  if (status === 'done') {
    return (
      <CheckmarkFilled
        size={14}
        className={styles.iconDone}
      />
    )
  }

  if (status === 'failed') {
    return (
      <ErrorFilled
        size={14}
        className={styles.iconFailed}
      />
    )
  }

  if (status === 'active') {
    return (
      <span className={styles.stepActiveDot} aria-hidden="true" />
    )
  }

  return (
    <CircleDash
      size={14}
      className={styles.iconWaiting}
    />
  )
}
