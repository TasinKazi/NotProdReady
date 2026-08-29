import { useState } from 'react'
import {
  Button,
  Column,
  Grid,
  Tag,
  Tile,
} from '@carbon/react'
import {
  Renew,
  Download,
  ArrowRight,
  CheckmarkFilled,
  ErrorFilled,
  WarningFilled,
  Document,
} from '@carbon/icons-react'
import type { ViewId } from '../types/navigation'
import type {
  ApiReleaseResult,
  RemediationStatusResponse,
} from '../api/types'
import { startRevalidation, getRemediationDownloadUrl } from '../api/analyses'
import styles from './RemediationResultScreen.module.scss'

interface Props {
  analysisId: string | null
  remediationStatus: RemediationStatusResponse | null
  originalResult: ApiReleaseResult | null
  revalidationResult: ApiReleaseResult | null
  onNavigate: (view: ViewId) => void
  onRevalidationStarted: (newAnalysisId: string) => void
}

export default function RemediationResultScreen({
  analysisId,
  remediationStatus,
  originalResult,
  revalidationResult,
  onNavigate,
  onRevalidationStarted,
}: Props) {
  const [revalidating, setRevalidating] = useState(false)
  const [revalidationError, setRevalidationError] = useState<string | null>(null)

  const result = remediationStatus?.result
  const filesChanged = result?.files_changed ?? []
  const findingsAddressed = result?.findings_addressed ?? []
  const findingsNotAddressed = result?.findings_not_addressed ?? []

  async function handleRerunAnalysis() {
    if (!analysisId) return
    setRevalidating(true)
    setRevalidationError(null)
    try {
      const resp = await startRevalidation(analysisId)
      onRevalidationStarted(resp.analysis_id)
    } catch (e: unknown) {
      setRevalidationError(e instanceof Error ? e.message : 'Failed to start revalidation')
      setRevalidating(false)
    }
  }

  function handleDownload() {
    if (!analysisId) return
    const url = getRemediationDownloadUrl(analysisId)
    const a = document.createElement('a')
    a.href = url
    a.download = `${analysisId}-remediated.zip`
    a.click()
  }

  return (
    <div className={styles.page}>
      {/* Header band */}
      <div className={styles.headerBand}>
        <Grid narrow>
          <Column sm={4} md={8} lg={16}>
            <p className={styles.eyebrow}>NotProdReady · Remediation Complete</p>
            <div className={styles.headerMeta}>
              {originalResult && (
                <>
                  <span className={styles.appName}>{originalResult.app}</span>
                  <span className={styles.sep}>·</span>
                  <Tag type="cool-gray" size="md">{originalResult.release}</Tag>
                  <Tag type="cool-gray" size="md">{originalResult.environment}</Tag>
                </>
              )}
            </div>
          </Column>
        </Grid>
      </div>

      {/* Summary band */}
      <div className={styles.summaryBand}>
        <Grid narrow>
          <Column sm={4} md={8} lg={16}>
            <div className={styles.summaryRow}>
              <CheckmarkFilled size={28} className={styles.iconSuccess} />
              <div>
                <p className={styles.summaryHeading}>Remediation complete</p>
                <p className={styles.summarySub}>{result?.summary ?? 'Bob addressed the confirmed findings.'}</p>
              </div>
            </div>
            <div className={styles.summaryStats}>
              <div className={styles.statItem}>
                <span className={styles.statNumber}>{findingsAddressed.length}</span>
                <span className={styles.statLabel}>findings addressed</span>
              </div>
              <div className={styles.statSep} />
              <div className={styles.statItem}>
                <span className={styles.statNumber}>{filesChanged.length}</span>
                <span className={styles.statLabel}>files changed</span>
              </div>
              {findingsNotAddressed.length > 0 && (
                <>
                  <div className={styles.statSep} />
                  <div className={styles.statItem}>
                    <span className={styles.statNumberWarn}>{findingsNotAddressed.length}</span>
                    <span className={styles.statLabel}>not addressed</span>
                  </div>
                </>
              )}
            </div>
          </Column>
        </Grid>
      </div>

      {/* Action bar */}
      <div className={styles.actionsBar}>
        <Grid narrow>
          <Column sm={4} md={8} lg={16}>
            <div className={styles.actions}>
              <Button
                kind="primary"
                renderIcon={Renew}
                onClick={handleRerunAnalysis}
                disabled={revalidating}
              >
                {revalidating ? 'Starting…' : 'Re-run analysis'}
              </Button>
              <Button
                kind="secondary"
                renderIcon={Download}
                onClick={handleDownload}
                disabled={!analysisId}
              >
                Download remediated repository
              </Button>
              <Button
                kind="ghost"
                onClick={() => onNavigate('analysis-result')}
              >
                View original results
              </Button>
            </div>
            {revalidationError && (
              <p className={styles.revalError}>{revalidationError}</p>
            )}
          </Column>
        </Grid>
      </div>

      {/* Main content */}
      <Grid narrow className={styles.contentGrid}>
        {/* Changed files */}
        <Column sm={4} md={4} lg={8}>
          <Tile className={styles.tile}>
            <p className={styles.tileTitle}>Changed files</p>
            {filesChanged.length === 0 ? (
              <p className={styles.emptyMsg}>No files were changed.</p>
            ) : (
              <ul className={styles.fileList}>
                {filesChanged.map((f) => (
                  <li key={f.path} className={styles.fileItem}>
                    <Document size={14} className={styles.fileIcon} />
                    <code className={styles.filePath}>{f.path}</code>
                    <Tag
                      type={
                        f.change_type === 'created'
                          ? 'green'
                          : f.change_type === 'deleted'
                          ? 'red'
                          : 'blue'
                      }
                      size="sm"
                    >
                      {f.change_type}
                    </Tag>
                  </li>
                ))}
              </ul>
            )}
          </Tile>
        </Column>

        {/* Findings status */}
        <Column sm={4} md={4} lg={8}>
          <Tile className={styles.tile}>
            <p className={styles.tileTitle}>Findings addressed</p>
            {findingsAddressed.length === 0 ? (
              <p className={styles.emptyMsg}>No findings were addressed.</p>
            ) : (
              <ul className={styles.findingList}>
                {findingsAddressed.map((id) => (
                  <li key={id} className={styles.findingItem}>
                    <CheckmarkFilled size={14} className={styles.iconOk} />
                    <code>{id}</code>
                  </li>
                ))}
              </ul>
            )}
            {findingsNotAddressed.length > 0 && (
              <>
                <p className={styles.tileSubtitle}>Not addressed</p>
                <ul className={styles.findingList}>
                  {findingsNotAddressed.map((id) => (
                    <li key={id} className={styles.findingItemWarn}>
                      <WarningFilled size={14} className={styles.iconWarn} />
                      <code>{id}</code>
                    </li>
                  ))}
                </ul>
                {result?.notes && (
                  <p className={styles.notes}>{result.notes}</p>
                )}
              </>
            )}
          </Tile>
        </Column>

        {/* Before / after comparison
            - Before revalidation: show only BEFORE REMEDIATION column.
            - After revalidation completes: show BEFORE and AFTER REVALIDATION columns.
            Never invent a readiness score before the second analysis finishes. */}
        {originalResult && (
          <Column sm={4} md={8} lg={16}>
            <Tile className={styles.tile}>
              <p className={styles.tileTitle}>
                {revalidationResult ? 'Before / After comparison' : 'Original readiness result'}
              </p>
              <div className={styles.comparison}>
                {/* BEFORE — always shown when original result is available */}
                <div className={styles.comparisonBefore}>
                  <p className={styles.compLabel}>Before remediation</p>
                  <div className={`${styles.compDecision} ${originalResult.decision === 'NO-GO' ? styles.noGo : styles.go}`}>
                    {originalResult.decision === 'NO-GO'
                      ? <ErrorFilled size={20} />
                      : <CheckmarkFilled size={20} />
                    }
                    <span>{originalResult.decision}</span>
                  </div>
                  <p className={styles.compScore}>{originalResult.readiness_score} / 100</p>
                  <p className={styles.compCounts}>
                    {originalResult.summary.blockers} blocker{originalResult.summary.blockers !== 1 ? 's' : ''}
                    {' · '}
                    {originalResult.summary.warnings} warning{originalResult.summary.warnings !== 1 ? 's' : ''}
                  </p>
                </div>

                {/* AFTER — only shown once revalidation analysis has a real result */}
                {revalidationResult ? (
                  <div className={styles.comparisonAfter}>
                    <p className={styles.compLabel}>After revalidation</p>
                    <div className={`${styles.compDecision} ${revalidationResult.decision === 'NO-GO' ? styles.noGo : styles.go}`}>
                      {revalidationResult.decision === 'NO-GO'
                        ? <ErrorFilled size={20} />
                        : <CheckmarkFilled size={20} />
                      }
                      <span>{revalidationResult.decision}</span>
                    </div>
                    <p className={styles.compScore}>{revalidationResult.readiness_score} / 100</p>
                    <p className={styles.compCounts}>
                      {revalidationResult.summary.blockers} blocker{revalidationResult.summary.blockers !== 1 ? 's' : ''}
                      {' · '}
                      {revalidationResult.summary.warnings} warning{revalidationResult.summary.warnings !== 1 ? 's' : ''}
                    </p>
                  </div>
                ) : (
                  <div className={styles.comparisonAfterPending}>
                    <p className={styles.compLabelPending}>After revalidation</p>
                    <p className={styles.compPending}>
                      Re-run the analysis to see the updated readiness score.
                    </p>
                    <Button
                      kind="primary"
                      size="sm"
                      renderIcon={ArrowRight}
                      onClick={handleRerunAnalysis}
                      disabled={revalidating}
                    >
                      {revalidating ? 'Starting…' : 'Re-run analysis'}
                    </Button>
                  </div>
                )}
              </div>
            </Tile>
          </Column>
        )}
      </Grid>
    </div>
  )
}
