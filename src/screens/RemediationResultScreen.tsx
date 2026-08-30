import {
  Accordion,
  AccordionItem,
  Button,
  Column,
  Grid,
  Tag,
} from '@carbon/react'
import {
  ArrowLeft,
  CheckmarkFilled,
  Code,
  Document,
  Download,
  IbmWatsonMachineLearning,
  InformationFilled,
  Package,
  SecurityServices,
  WarningFilled,
} from '@carbon/icons-react'
import type { ViewId } from '../types/navigation'
import type {
  ApiFinding,
  ApiReleaseResult,
  RemediationStatusResponse,
} from '../api/types'
import { getRemediationDownloadUrl } from '../api/analyses'
import styles from './RemediationResultScreen.module.scss'

interface Props {
  analysisId: string | null
  remediationStatus: RemediationStatusResponse | null
  originalResult: ApiReleaseResult | null

  /*
   * Revalidation props remain optional temporarily so App.tsx can keep
   * passing its existing workflow state while the competition UI no longer
   * exposes revalidation. They are intentionally not rendered or invoked.
   */
  revalidationResult?: ApiReleaseResult | null
  onRevalidationStarted?: (newAnalysisId: string) => void

  onNavigate: (view: ViewId) => void
}

/* ── Finding lookup ────────────────────────────────────────────────── */

function findingById(
  findings: ApiFinding[],
  id: string,
): ApiFinding | undefined {
  return findings.find((finding) => finding.id === id)
}

/* ── Change type presentation ──────────────────────────────────────── */

function changeTagType(changeType: string) {
  if (changeType === 'created') return 'green'
  if (changeType === 'deleted') return 'red'
  return 'blue'
}

function changeDescription(changeType: string) {
  if (changeType === 'created') {
    return 'IBM Bob created this repository file during remediation.'
  }

  if (changeType === 'deleted') {
    return 'IBM Bob removed this repository file during remediation.'
  }

  return 'IBM Bob modified this repository file during remediation.'
}

/* ── Remediation result screen ─────────────────────────────────────── */

export default function RemediationResultScreen({
  analysisId,
  remediationStatus,
  originalResult,
  onNavigate,
}: Props) {
  const result = remediationStatus?.result

  const filesChanged = result?.files_changed ?? []
  const findingsAddressed = result?.findings_addressed ?? []
  const findingsNotAddressed =
    result?.findings_not_addressed ?? []

  const originalFindings =
    originalResult?.findings ?? []

  const totalFindingsHandled =
    findingsAddressed.length +
    findingsNotAddressed.length

  const remediationComplete =
    remediationStatus?.status === 'COMPLETED'

  /* ── Download remediated repository ──────────────────────────────── */

  function handleDownload() {
    if (!analysisId) return

    const url =
      getRemediationDownloadUrl(analysisId)

    const anchor =
      document.createElement('a')

    anchor.href = url
    anchor.download =
      `${analysisId}-remediated.zip`

    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }

  return (
    <div className={styles.page}>
      {/* ── Result context header ───────────────────────────────────── */}
      <section className={styles.contextHeader}>
        <div className={styles.contextInner}>
          <div>
            <p className={styles.headerEyebrow}>
              IBM Bob remediation result
            </p>

            <div className={styles.headerMeta}>
              {originalResult && (
                <>
                  <span className={styles.appName}>
                    {originalResult.app}
                  </span>

                  <span
                    className={styles.headerSeparator}
                    aria-hidden="true"
                  />

                  <Tag
                    type="cool-gray"
                    size="md"
                  >
                    {originalResult.release}
                  </Tag>

                  <Tag
                    type="cool-gray"
                    size="md"
                  >
                    {originalResult.environment}
                  </Tag>
                </>
              )}

              <Tag
                type={
                  remediationComplete
                    ? 'green'
                    : 'cool-gray'
                }
                size="md"
              >
                {remediationComplete
                  ? 'Remediation complete'
                  : 'Remediation result'}
              </Tag>
            </div>
          </div>

          <div className={styles.contextAgent}>
            <span
              className={styles.contextAgentDot}
              aria-hidden="true"
            />

            <div>
              <span>IBM Bob</span>
              <small>Repository remediation</small>
            </div>
          </div>
        </div>
      </section>

      {/* ── Remediation completion hero ─────────────────────────────── */}
      <section className={styles.completionHero}>
        <div className={styles.completionHeroInner}>
          <div className={styles.completionPrimary}>
            <div className={styles.completionIcon}>
              <CheckmarkFilled size={32} />
            </div>

            <div className={styles.completionCopy}>
              <p className={styles.completionEyebrow}>
                Repository remediation
              </p>

              <h1>Remediation complete</h1>

              <p className={styles.completionSummary}>
                {result?.summary ??
                  'IBM Bob addressed the confirmed repository findings and prepared a remediated release artifact.'}
              </p>

              <div className={styles.completionStats}>
                <div className={styles.statItem}>
                  <strong>
                    {findingsAddressed.length}
                  </strong>

                  <span>
                    finding
                    {findingsAddressed.length === 1
                      ? ''
                      : 's'}{' '}
                    addressed
                  </span>
                </div>

                <div className={styles.statItem}>
                  <strong>
                    {filesChanged.length}
                  </strong>

                  <span>
                    repository file
                    {filesChanged.length === 1
                      ? ''
                      : 's'}{' '}
                    changed
                  </span>
                </div>

                {findingsNotAddressed.length >
                  0 && (
                  <div
                    className={
                      styles.statItemWarning
                    }
                  >
                    <strong>
                      {
                        findingsNotAddressed.length
                      }
                    </strong>

                    <span>
                      require manual action
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <aside className={styles.agentOutcome}>
            <IbmWatsonMachineLearning
              size={28}
            />

            <p className={styles.agentOutcomeEyebrow}>
              IBM Bob action
            </p>

            <h2>
              From confirmed finding to code change.
            </h2>

            <p>
              Bob reviewed the release decision,
              changed the repository where safe,
              and preserved a traceable remediation
              summary for the operator.
            </p>
          </aside>
        </div>
      </section>

      {/* ── Primary remediation actions ─────────────────────────────── */}
      <section className={styles.actionsBand}>
        <div className={styles.actionsInner}>
          <div className={styles.actionNarrative}>
            <Package size={22} />

            <div>
              <span
                className={
                  styles.actionNarrativeTitle
                }
              >
                Remediated repository ready
              </span>

              <span
                className={
                  styles.actionNarrativeMeta
                }
              >
                Download the repository produced
                by IBM Bob or return to the
                original release decision.
              </span>
            </div>
          </div>

          <div className={styles.actions}>
            <Button
              kind="primary"
              size="lg"
              renderIcon={Download}
              onClick={handleDownload}
              disabled={!analysisId}
            >
              Download remediated repository
            </Button>

            <Button
              kind="secondary"
              size="lg"
              renderIcon={ArrowLeft}
              onClick={() =>
                onNavigate('analysis-result')
              }
            >
              View original result
            </Button>
          </div>
        </div>
      </section>

      {/* ── Main remediation detail ─────────────────────────────────── */}
      <div className={styles.content}>
        <Grid fullWidth>
          {/* ── Remediation impact ──────────────────────────────────── */}
          <Column
            sm={4}
            md={8}
            lg={16}
          >
            <section
              className={
                styles.impactSection
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
                    Remediation impact
                  </p>

                  <h2>
                    What IBM Bob changed
                  </h2>
                </div>

                <p>
                  The remediation result connects
                  the confirmed release findings
                  with the repository files Bob
                  changed.
                </p>
              </div>

              <div className={styles.impactGrid}>
                <article
                  className={
                    styles.impactCardBlue
                  }
                >
                  <Code size={24} />

                  <span
                    className={
                      styles.impactValue
                    }
                  >
                    {filesChanged.length}
                  </span>

                  <h3>Files changed</h3>

                  <p>
                    Repository artifacts created,
                    modified, or removed during
                    IBM Bob remediation.
                  </p>
                </article>

                <article
                  className={
                    styles.impactCardGreen
                  }
                >
                  <CheckmarkFilled size={24} />

                  <span
                    className={
                      styles.impactValue
                    }
                  >
                    {findingsAddressed.length}
                  </span>

                  <h3>Findings addressed</h3>

                  <p>
                    Confirmed BLOCK or WARN
                    findings Bob was able to
                    remediate safely in code.
                  </p>
                </article>

                <article
                  className={
                    findingsNotAddressed.length >
                    0
                      ? styles.impactCardWarning
                      : styles.impactCardNeutral
                  }
                >
                  {findingsNotAddressed.length >
                  0 ? (
                    <WarningFilled size={24} />
                  ) : (
                    <SecurityServices size={24} />
                  )}

                  <span
                    className={
                      styles.impactValue
                    }
                  >
                    {
                      findingsNotAddressed.length
                    }
                  </span>

                  <h3>Manual actions</h3>

                  <p>
                    Findings intentionally left
                    for operator-level action
                    outside safe repository
                    remediation.
                  </p>
                </article>

                <article
                  className={
                    styles.impactCardDark
                  }
                >
                  <IbmWatsonMachineLearning
                    size={24}
                  />

                  <span
                    className={
                      styles.impactValue
                    }
                  >
                    {totalFindingsHandled}
                  </span>

                  <h3>Findings reviewed</h3>

                  <p>
                    Total remediation scope
                    processed by the IBM Bob
                    workflow.
                  </p>
                </article>
              </div>
            </section>
          </Column>

          {/* ── Changed repository files ────────────────────────────── */}
          <Column
            sm={4}
            md={8}
            lg={9}
          >
            <section
              className={styles.detailPanel}
            >
              <div
                className={
                  styles.detailPanelHeader
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
                    styles.panelCount
                  }
                >
                  {filesChanged.length}
                </span>
              </div>

              {filesChanged.length === 0 ? (
                <div
                  className={
                    styles.emptyState
                  }
                >
                  <Document size={24} />

                  <p>
                    No repository file changes
                    were reported.
                  </p>
                </div>
              ) : (
                <Accordion
                  className={
                    styles.fileAccordion
                  }
                >
                  {filesChanged.map(
                    (file) => {
                      const relatedFindings =
                        findingsAddressed.filter(
                          (findingId) => {
                            const finding =
                              findingById(
                                originalFindings,
                                findingId,
                              )

                            return (
                              finding?.evidence_file ===
                                file.path ||
                              finding?.evidence?.some(
                                (evidence) =>
                                  evidence.file_path ===
                                  file.path,
                              )
                            )
                          },
                        )

                      return (
                        <AccordionItem
                          key={file.path}
                          title={
                            <span
                              className={
                                styles.fileAccordionTitle
                              }
                            >
                              <Document
                                size={15}
                              />

                              <code
                                className={
                                  styles.filePath
                                }
                              >
                                {file.path}
                              </code>

                              <Tag
                                type={changeTagType(
                                  file.change_type,
                                )}
                                size="sm"
                              >
                                {
                                  file.change_type
                                }
                              </Tag>
                            </span>
                          }
                        >
                          <div
                            className={
                              styles.fileDetail
                            }
                          >
                            <p>
                              {changeDescription(
                                file.change_type,
                              )}
                            </p>

                            {relatedFindings.length >
                              0 && (
                              <div
                                className={
                                  styles.relatedFindings
                                }
                              >
                                <span>
                                  Related findings
                                </span>

                                <div>
                                  {relatedFindings.map(
                                    (
                                      findingId,
                                    ) => (
                                      <Tag
                                        key={
                                          findingId
                                        }
                                        type="green"
                                        size="sm"
                                      >
                                        {
                                          findingId
                                        }
                                      </Tag>
                                    ),
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </AccordionItem>
                      )
                    },
                  )}
                </Accordion>
              )}
            </section>
          </Column>

          {/* ── Findings addressed ──────────────────────────────────── */}
          <Column
            sm={4}
            md={8}
            lg={7}
          >
            <section
              className={styles.detailPanel}
            >
              <div
                className={
                  styles.detailPanelHeader
                }
              >
                <div>
                  <p
                    className={
                      styles.sectionEyebrow
                    }
                  >
                    Finding resolution
                  </p>

                  <h2>
                    Findings addressed
                  </h2>
                </div>

                <span
                  className={
                    styles.panelCount
                  }
                >
                  {findingsAddressed.length}
                </span>
              </div>

              {findingsAddressed.length ===
              0 ? (
                <div
                  className={
                    styles.emptyState
                  }
                >
                  <InformationFilled
                    size={24}
                  />

                  <p>
                    No findings were reported as
                    addressed.
                  </p>
                </div>
              ) : (
                <div
                  className={
                    styles.findingList
                  }
                >
                  {findingsAddressed.map(
                    (findingId) => {
                      const finding =
                        findingById(
                          originalFindings,
                          findingId,
                        )

                      return (
                        <article
                          key={findingId}
                          className={
                            styles.findingItem
                          }
                        >
                          <div
                            className={
                              styles.findingStatus
                            }
                          >
                            <CheckmarkFilled
                              size={16}
                            />
                          </div>

                          <div
                            className={
                              styles.findingContent
                            }
                          >
                            <div
                              className={
                                styles.findingHeader
                              }
                            >
                              <code>
                                {findingId}
                              </code>

                              {finding && (
                                <Tag
                                  type={
                                    finding.severity ===
                                    'BLOCK'
                                      ? 'red'
                                      : finding.severity ===
                                          'WARN'
                                        ? 'warm-gray'
                                        : 'green'
                                  }
                                  size="sm"
                                >
                                  {
                                    finding.severity
                                  }
                                </Tag>
                              )}
                            </div>

                            <h3>
                              {finding?.title ??
                                'Confirmed finding'}
                            </h3>

                            {finding?.recommendation && (
                              <p>
                                {
                                  finding.recommendation
                                }
                              </p>
                            )}
                          </div>
                        </article>
                      )
                    },
                  )}
                </div>
              )}
            </section>
          </Column>

          {/* ── Manual action findings ──────────────────────────────── */}
          {findingsNotAddressed.length >
            0 && (
            <Column
              sm={4}
              md={8}
              lg={16}
            >
              <section
                className={
                  styles.manualSection
                }
              >
                <div
                  className={
                    styles.manualHeader
                  }
                >
                  <WarningFilled size={22} />

                  <div>
                    <p
                      className={
                        styles.sectionEyebrow
                      }
                    >
                      Operator follow-up
                    </p>

                    <h2>
                      Manual action still
                      required
                    </h2>

                    <p>
                      Bob intentionally leaves
                      changes outside safe
                      repository remediation for
                      an operator to complete.
                    </p>
                  </div>
                </div>

                <div
                  className={
                    styles.manualGrid
                  }
                >
                  {findingsNotAddressed.map(
                    (findingId) => {
                      const finding =
                        findingById(
                          originalFindings,
                          findingId,
                        )

                      return (
                        <article
                          key={findingId}
                          className={
                            styles.manualItem
                          }
                        >
                          <code>
                            {findingId}
                          </code>

                          <h3>
                            {finding?.title ??
                              'Manual action required'}
                          </h3>

                          {finding?.recommendation && (
                            <p>
                              {
                                finding.recommendation
                              }
                            </p>
                          )}
                        </article>
                      )
                    },
                  )}
                </div>

                {result?.notes && (
                  <div
                    className={
                      styles.manualNotes
                    }
                  >
                    <InformationFilled
                      size={16}
                    />

                    <p>{result.notes}</p>
                  </div>
                )}
              </section>
            </Column>
          )}

          {/* ── IBM Bob remediation provenance ──────────────────────── */}
          <Column
            sm={4}
            md={8}
            lg={16}
          >
            <section
              className={
                styles.provenanceSection
              }
            >
              <div
                className={
                  styles.provenanceAgent
                }
              >
                <div
                  className={
                    styles.provenanceIcon
                  }
                >
                  <IbmWatsonMachineLearning
                    size={26}
                  />
                </div>

                <div>
                  <span
                    className={
                      styles.provenanceLabel
                    }
                  >
                    Remediation performed by
                  </span>

                  <strong>IBM Bob</strong>
                </div>
              </div>

              <div
                className={
                  styles.provenanceItem
                }
              >
                <span
                  className={
                    styles.provenanceLabel
                  }
                >
                  Analysis ID
                </span>

                <code>
                  {analysisId ?? '—'}
                </code>
              </div>

              <div
                className={
                  styles.provenanceItem
                }
              >
                <span
                  className={
                    styles.provenanceLabel
                  }
                >
                  Files changed
                </span>

                <strong>
                  {filesChanged.length}
                </strong>
              </div>

              <div
                className={
                  styles.provenanceItem
                }
              >
                <span
                  className={
                    styles.provenanceLabel
                  }
                >
                  Findings addressed
                </span>

                <strong>
                  {findingsAddressed.length}
                </strong>
              </div>
            </section>
          </Column>

          {/* ── Competition narrative footer ────────────────────────── */}
          <Column
            sm={4}
            md={8}
            lg={16}
          >
            <section
              className={
                styles.resultFooter
              }
            >
              <div
                className={
                  styles.resultFooterIcon
                }
              >
                <IbmWatsonMachineLearning
                  size={24}
                />
              </div>

              <div>
                <p
                  className={
                    styles.resultFooterEyebrow
                  }
                >
                  Powered by IBM Bob
                </p>

                <h2>
                  Analyze the release. Explain
                  the risk. Act on the code.
                </h2>
              </div>

              <div
                className={
                  styles.resultFooterCapabilities
                }
              >
                <span>
                  <SecurityServices size={14} />
                  Confirmed findings
                </span>

                <span>
                  <Code size={14} />
                  Repository remediation
                </span>

                <span>
                  <Package size={14} />
                  Downloadable output
                </span>
              </div>
            </section>
          </Column>
        </Grid>
      </div>
    </div>
  )
}
