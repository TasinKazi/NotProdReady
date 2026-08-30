import { useEffect, useMemo, useState } from 'react'
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
  Package,
  SecurityServices,
  Tools,
} from '@carbon/icons-react'
import type { ViewId } from '../types/navigation'
import type {
  RemediationStatusResponse,
  SseMessage,
} from '../api/types'
import {
  getRemediationStatus,
  subscribeToRemediationEvents,
} from '../api/analyses'
import styles from './RemediationProgressScreen.module.scss'

interface Props {
  analysisId: string | null
  onComplete: (status: RemediationStatusResponse) => void
  onNavigate: (view: ViewId) => void
}

/* ── IBM Bob remediation workflow ──────────────────────────────────── */

type StepStatus = 'done' | 'active' | 'waiting' | 'failed'

interface RemediationStep {
  id: string
  label: string
  description: string
  status: StepStatus
  icon: typeof Tools
}

const INITIAL_STEPS: RemediationStep[] = [
  {
    id: 'review',
    label: 'Review confirmed findings',
    description:
      'IBM Bob reviews the BLOCK and WARN findings produced by the release-readiness analysis.',
    status: 'active',
    icon: SecurityServices,
  },
  {
    id: 'change',
    label: 'Apply targeted repository changes',
    description:
      'Bob modifies only the files needed to address confirmed repository findings.',
    status: 'waiting',
    icon: Code,
  },
  {
    id: 'validate',
    label: 'Validate modified files',
    description:
      'Bob checks the changed repository artifacts before finalizing remediation.',
    status: 'waiting',
    icon: CheckmarkFilled,
  },
  {
    id: 'package',
    label: 'Finalize remediated repository',
    description:
      'Bob prepares the completed remediation output and change summary.',
    status: 'waiting',
    icon: Package,
  },
]

/* ── Workflow state helpers ────────────────────────────────────────── */

function updateStepStatuses(
  steps: RemediationStep[],
  statuses: Partial<Record<string, StepStatus>>,
): RemediationStep[] {
  return steps.map((step) => ({
    ...step,
    status: statuses[step.id] ?? step.status,
  }))
}

function completeAllSteps(
  steps: RemediationStep[],
): RemediationStep[] {
  return steps.map((step) => ({
    ...step,
    status:
      step.status === 'failed'
        ? 'failed'
        : ('done' as StepStatus),
  }))
}

/* ── Component ─────────────────────────────────────────────────────── */

export default function RemediationProgressScreen({
  analysisId,
  onComplete,
  onNavigate,
}: Props) {
  const [finished, setFinished] = useState(false)
  const [failed, setFailed] = useState(false)

  const [failureMessage, setFailureMessage] =
    useState<string | null>(null)

  const [connectionWarning, setConnectionWarning] =
    useState<string | null>(null)

  const [appName, setAppName] = useState('')
  const [releaseVersion, setReleaseVersion] = useState('')
  const [environment, setEnvironment] = useState('')

  const [currentDetail, setCurrentDetail] = useState(
    'Preparing IBM Bob remediation workflow…',
  )

  const [changedFiles, setChangedFiles] = useState<string[]>([])
  const [steps, setSteps] =
    useState<RemediationStep[]>(INITIAL_STEPS)

  /* ── Subscribe to IBM Bob remediation activity ───────────────────── */

  useEffect(() => {
    if (!analysisId) {
      setFailed(true)
      setFinished(true)
      setFailureMessage(
        'No analysis ID was provided for remediation.',
      )
      return
    }

    const cleanup = subscribeToRemediationEvents(
      analysisId,
      {
        onMessage: (message: SseMessage) => {
          const event = message.event
          const data =
            message.data as Record<string, unknown>

          if (event === 'remediation.started') {
            if (data.application_name) {
              setAppName(
                String(data.application_name),
              )
            }

            if (data.release_version) {
              setReleaseVersion(
                String(data.release_version),
              )
            }

            if (data.environment) {
              setEnvironment(
                String(data.environment),
              )
            }

            setCurrentDetail(
              'IBM Bob is reviewing the confirmed release-readiness findings.',
            )

            setSteps((current) =>
              updateStepStatuses(current, {
                review: 'active',
              }),
            )
          }

          if (event === 'remediation.failed') {
            setFailed(true)
            setFinished(true)

            setFailureMessage(
              String(
                data.error ??
                  'IBM Bob remediation failed.',
              ),
            )

            setSteps((current) =>
              current.map((step) =>
                step.status === 'active'
                  ? {
                      ...step,
                      status:
                        'failed' as StepStatus,
                    }
                  : step,
              ),
            )

            return
          }

          if (event === 'remediation.reviewing') {
            setCurrentDetail(
              'Reviewing confirmed BLOCK and WARN findings.',
            )

            setSteps((current) =>
              updateStepStatuses(current, {
                review: 'active',
              }),
            )
          }

          if (
            event === 'remediation.file.changed'
          ) {
            const file = String(data.file ?? '')

            if (file) {
              setChangedFiles((current) =>
                current.includes(file)
                  ? current
                  : [...current, file],
              )
            }

            setCurrentDetail(
              file
                ? `Applying targeted change to ${file}`
                : 'Applying targeted repository changes.',
            )

            setSteps((current) =>
              updateStepStatuses(current, {
                review: 'done',
                change: 'active',
              }),
            )
          }

          if (event === 'remediation.validating') {
            setCurrentDetail(
              'Validating modified repository files.',
            )

            setSteps((current) =>
              updateStepStatuses(current, {
                review: 'done',
                change: 'done',
                validate: 'active',
              }),
            )
          }

          if (
            event === 'remediation.completed' ||
            event === 'remediation.done'
          ) {
            setCurrentDetail(
              'Finalizing the remediated repository and change summary.',
            )

            setSteps((current) =>
              updateStepStatuses(current, {
                review: 'done',
                change: 'done',
                validate: 'done',
                package: 'done',
              }),
            )
          }
        },

        onDone: async () => {
          setFinished(true)

          setSteps((current) =>
            completeAllSteps(current),
          )

          try {
            const status =
              await getRemediationStatus(
                analysisId,
              )

            if (status.status === 'FAILED') {
              setFailed(true)

              setFailureMessage(
                status.error ??
                  'IBM Bob remediation failed.',
              )

              return
            }

            onComplete(status)
          } catch {
            setConnectionWarning(
              'IBM Bob finished the remediation stream, but the final remediation summary could not be loaded automatically.',
            )
          }
        },

        onError: () => {
          setConnectionWarning(
            'The live remediation connection was interrupted. IBM Bob may still be working in the backend.',
          )
        },
      },
    )

    return cleanup
  }, [analysisId, onComplete])

  /* ── Progress summary ────────────────────────────────────────────── */

  const completedSteps = useMemo(
    () =>
      steps.filter(
        (step) => step.status === 'done',
      ).length,
    [steps],
  )

  const progressPercent = finished
    ? 100
    : Math.round(
        (completedSteps / steps.length) * 100,
      )

  const activeStep = steps.find(
    (step) => step.status === 'active',
  )

  const heading = appName
    ? `Remediating ${appName}`
    : 'Remediating release'

  return (
    <div className={styles.page}>
      {/* ── Remediation hero ────────────────────────────────────────── */}
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <div className={styles.eyebrowRow}>
              <span className={styles.eyebrow}>
                Repository remediation
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
                IBM Bob agent
              </span>
            </div>

            <h1 className={styles.heading}>
              {heading}
            </h1>

            <p className={styles.heroDescription}>
              IBM Bob is acting on the confirmed
              release-readiness findings and applying
              targeted changes to the repository.
            </p>

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
                <code
                  className={styles.analysisId}
                >
                  {analysisId}
                </code>
              )}
            </div>
          </div>

          <div className={styles.heroAgent}>
            <IbmWatsonMachineLearning
              size={30}
            />

            <div>
              <span
                className={
                  styles.heroAgentLabel
                }
              >
                IBM Bob
              </span>

              <span
                className={
                  styles.heroAgentMeta
                }
              >
                Remediation agent
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Remediation status band ─────────────────────────────────── */}
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
                  ? 'IBM Bob remediation failed'
                  : finished
                    ? 'IBM Bob remediation complete'
                    : 'IBM Bob is modifying the repository'}
              </span>

              <span className={styles.statusMeta}>
                {failed
                  ? 'Repository remediation did not complete.'
                  : finished
                    ? 'Targeted changes were applied and the remediation output is ready.'
                    : activeStep?.description ??
                      currentDetail}
              </span>
            </div>
          </div>

          {!failed && (
            <div
              className={
                styles.progressSummary
              }
            >
              <span
                className={
                  styles.progressValue
                }
              >
                {progressPercent}
                <span>%</span>
              </span>

              <span
                className={
                  styles.progressLabel
                }
              >
                remediation complete
              </span>
            </div>
          )}
        </div>
      </section>

      {/* ── Page content ────────────────────────────────────────────── */}
      <div className={styles.content}>
        <Grid fullWidth>
          {/* ── Failure / connection states ─────────────────────────── */}
          {failed && failureMessage && (
            <Column
              sm={4}
              md={8}
              lg={16}
            >
              <InlineNotification
                kind="error"
                title="IBM Bob remediation failed"
                subtitle={failureMessage}
                lowContrast
                hideCloseButton
              />
            </Column>
          )}

          {connectionWarning && !failed && (
            <Column
              sm={4}
              md={8}
              lg={16}
            >
              <InlineNotification
                kind="warning"
                title="Remediation status warning"
                subtitle={connectionWarning}
                lowContrast
                hideCloseButton
              />
            </Column>
          )}

          {/* ── IBM Bob remediation workflow ────────────────────────── */}
          <Column
            sm={4}
            md={8}
            lg={10}
          >
            <section
              className={
                styles.workflowSection
              }
            >
              <div
                className={
                  styles.sectionHeading
                }
              >
                <div>
                  <p
                    className={
                      styles.sectionEyebrow
                    }
                  >
                    Agent activity
                  </p>

                  <h2>
                    IBM Bob remediation workflow
                  </h2>
                </div>

                <p>
                  Bob applies targeted changes only
                  after reviewing the confirmed
                  release findings.
                </p>
              </div>

              <div className={styles.stepList}>
                {steps.map(
                  (step, index) => {
                    const Icon = step.icon

                    return (
                      <article
                        key={step.id}
                        className={`${styles.stepCard} ${
                          step.status ===
                          'active'
                            ? styles.stepCardActive
                            : step.status ===
                                'done'
                              ? styles.stepCardDone
                              : step.status ===
                                  'failed'
                                ? styles.stepCardFailed
                                : styles.stepCardWaiting
                        }`}
                      >
                        <div
                          className={
                            styles.stepNumber
                          }
                        >
                          {String(
                            index + 1,
                          ).padStart(2, '0')}
                        </div>

                        <div
                          className={
                            styles.stepIcon
                          }
                        >
                          <Icon size={20} />
                        </div>

                        <div
                          className={
                            styles.stepCopy
                          }
                        >
                          <h3>
                            {step.label}
                          </h3>

                          <p>
                            {step.description}
                          </p>
                        </div>

                        <div
                          className={
                            styles.stepStatus
                          }
                        >
                          <StepStatusIcon
                            status={
                              step.status
                            }
                          />
                        </div>

                        {step.status ===
                          'active' &&
                          !finished && (
                            <div
                              className={
                                styles.stepWorking
                              }
                            >
                              <InlineLoading
                                status="active"
                                description="IBM Bob working…"
                              />
                            </div>
                          )}
                      </article>
                    )
                  },
                )}
              </div>

              {!finished && (
                <div
                  className={
                    styles.currentActivity
                  }
                >
                  <span
                    className={
                      styles.currentActivityLabel
                    }
                  >
                    Current activity
                  </span>

                  <span
                    className={
                      styles.currentActivityValue
                    }
                  >
                    {currentDetail}
                  </span>
                </div>
              )}
            </section>
          </Column>

          {/* ── Changed repository files ────────────────────────────── */}
          <Column
            sm={4}
            md={8}
            lg={6}
          >
            <aside className={styles.filesPanel}>
              <div
                className={
                  styles.filesPanelHeader
                }
              >
                <div>
                  <p
                    className={
                      styles.sectionEyebrow
                    }
                  >
                    Repository changes
                  </p>

                  <h2>
                    Files changed by IBM Bob
                  </h2>
                </div>

                <span
                  className={
                    styles.fileCount
                  }
                >
                  {changedFiles.length}
                </span>
              </div>

              {changedFiles.length === 0 ? (
                <div
                  className={
                    styles.filesEmpty
                  }
                >
                  <Document size={24} />

                  <p>
                    Bob has not reported a changed
                    file yet.
                  </p>

                  {!finished && (
                    <InlineLoading
                      status="active"
                      description="Waiting for repository changes…"
                    />
                  )}
                </div>
              ) : (
                <div
                  className={
                    styles.fileList
                  }
                >
                  {changedFiles.map(
                    (file, index) => (
                      <div
                        key={file}
                        className={
                          styles.fileItem
                        }
                      >
                        <span
                          className={
                            styles.fileIndex
                          }
                        >
                          {String(
                            index + 1,
                          ).padStart(2, '0')}
                        </span>

                        <Document
                          size={16}
                          className={
                            styles.fileIcon
                          }
                        />

                        <code
                          className={
                            styles.fileName
                          }
                        >
                          {file}
                        </code>

                        <CheckmarkFilled
                          size={14}
                          className={
                            styles.fileDone
                          }
                        />
                      </div>
                    ),
                  )}
                </div>
              )}

              <div className={styles.filesNote}>
                <Tools size={16} />

                <p>
                  Changes shown here are reported by
                  the IBM Bob remediation workflow.
                </p>
              </div>
            </aside>
          </Column>

          {/* ── Remediation execution explanation ───────────────────── */}
          <Column
            sm={4}
            md={8}
            lg={16}
          >
            <section
              className={
                styles.explanationBand
              }
            >
              <div
                className={
                  styles.explanationIcon
                }
              >
                <IbmWatsonMachineLearning
                  size={24}
                />
              </div>

              <div
                className={
                  styles.explanationCopy
                }
              >
                <p
                  className={
                    styles.explanationEyebrow
                  }
                >
                  IBM Bob execution
                </p>

                <h2>
                  From finding to repository change.
                </h2>

                <p>
                  NotProdReady does not stop at a
                  recommendation. IBM Bob acts on the
                  confirmed findings and produces a
                  remediated repository artifact.
                </p>
              </div>

              <div
                className={
                  styles.explanationStat
                }
              >
                <span>
                  {changedFiles.length}
                </span>

                <small>
                  repository file
                  {changedFiles.length === 1
                    ? ''
                    : 's'}
                  <br />
                  changed
                </small>
              </div>
            </section>
          </Column>

          {/* ── Terminal action ─────────────────────────────────────── */}
          {finished && (
            <Column
              sm={4}
              md={8}
              lg={16}
            >
              <div
                className={
                  styles.actionBar
                }
              >
                <div
                  className={
                    styles.actionCopy
                  }
                >
                  <span
                    className={
                      styles.actionTitle
                    }
                  >
                    {failed
                      ? 'Remediation did not complete'
                      : 'IBM Bob remediation is ready'}
                  </span>

                  <span
                    className={
                      styles.actionMeta
                    }
                  >
                    {failed
                      ? 'Return to the release decision and review the confirmed findings.'
                      : 'Open the remediation summary to review the findings addressed and repository files changed by Bob.'}
                  </span>
                </div>

                <Button
                  kind={
                    failed
                      ? 'secondary'
                      : 'primary'
                  }
                  size="lg"
                  renderIcon={ArrowRight}
                  onClick={() =>
                    onNavigate(
                      failed
                        ? 'analysis-result'
                        : 'remediation-result',
                    )
                  }
                >
                  {failed
                    ? 'Back to release decision'
                    : 'View remediation summary'}
                </Button>
              </div>
            </Column>
          )}
        </Grid>
      </div>
    </div>
  )
}

/* ── Step status icon ──────────────────────────────────────────────── */

function StepStatusIcon({
  status,
}: {
  status: StepStatus
}) {
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
      <span
        className={styles.activeStatusDot}
      >
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
