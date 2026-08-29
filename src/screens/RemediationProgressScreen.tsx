import { useEffect, useState } from 'react'
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
  Document,
} from '@carbon/icons-react'
import type { ViewId } from '../types/navigation'
import type { RemediationStatusResponse, SseMessage } from '../api/types'
import { getRemediationStatus, subscribeToRemediationEvents } from '../api/analyses'
import styles from './RemediationProgressScreen.module.scss'

interface Props {
  analysisId: string | null
  onComplete: (status: RemediationStatusResponse) => void
  onNavigate: (view: ViewId) => void
}

export default function RemediationProgressScreen({
  analysisId,
  onComplete,
  onNavigate,
}: Props) {
  const [finished, setFinished] = useState(false)
  const [failed, setFailed] = useState(false)
  const [failureMessage, setFailureMessage] = useState<string | null>(null)
  const [sseError, setSseError] = useState<string | null>(null)
  const [appName, setAppName] = useState<string>('')
  const [releaseVer, setReleaseVer] = useState<string>('')
  const [envName, setEnvName] = useState<string>('')
  const [currentDetail, setCurrentDetail] = useState<string>('Preparing remediation…')
  const [changedFiles, setChangedFiles] = useState<string[]>([])

  const steps: { id: string; label: string; event: string }[] = [
    { id: 's1', label: 'Reviewing confirmed findings', event: 'remediation.reviewing' },
    { id: 's2', label: 'Applying targeted changes', event: 'remediation.file.changed' },
    { id: 's3', label: 'Validating modified files', event: 'remediation.validating' },
    { id: 's4', label: 'Preparing re-analysis', event: 'remediation.completed' },
  ]

  const [stepStatuses, setStepStatuses] = useState<Record<string, 'done' | 'active' | 'waiting'>>({
    s1: 'active',
    s2: 'waiting',
    s3: 'waiting',
    s4: 'waiting',
  })

  useEffect(() => {
    if (!analysisId) return

    const cleanup = subscribeToRemediationEvents(analysisId, {
      onMessage: (msg: SseMessage) => {
        const evt = msg.event
        const d = msg.data as Record<string, unknown>

        if (evt === 'remediation.started') {
          if (d.application_name) setAppName(String(d.application_name))
          if (d.release_version) setReleaseVer(String(d.release_version))
          if (d.environment) setEnvName(String(d.environment))
        }

        if (evt === 'remediation.failed') {
          setFailureMessage(String(d.error ?? 'Remediation failed.'))
          setFailed(true)
          setFinished(true)
          return
        }

        if (evt === 'remediation.reviewing') {
          setCurrentDetail('Reviewing confirmed findings')
          setStepStatuses((prev) => ({ ...prev, s1: 'active' }))
        }

        if (evt === 'remediation.file.changed') {
          const file = String(d.file ?? '')
          if (file) setChangedFiles((prev) => prev.includes(file) ? prev : [...prev, file])
          setCurrentDetail('Applying targeted changes')
          setStepStatuses((prev) => ({ ...prev, s1: 'done', s2: 'active' }))
        }

        if (evt === 'remediation.validating') {
          setCurrentDetail('Validating modified files')
          setStepStatuses((prev) => ({ ...prev, s1: 'done', s2: 'done', s3: 'active' }))
        }

        if (evt === 'remediation.completed' || evt === 'remediation.done') {
          setCurrentDetail('Preparing re-analysis')
          setStepStatuses({ s1: 'done', s2: 'done', s3: 'done', s4: 'done' })
        }
      },

      onDone: async () => {
        setFinished(true)
        if (analysisId) {
          try {
            const status = await getRemediationStatus(analysisId)
            if (status.status === 'FAILED') {
              setFailed(true)
              setFailureMessage(status.error ?? 'Remediation failed.')
            } else {
              onComplete(status)
            }
          } catch {
            setSseError('Could not fetch remediation result.')
            setFinished(true)
          }
        }
      },

      onError: (err: string) => {
        setSseError(`Connection error: ${err}`)
        setFinished(true)
      },
    })

    return cleanup
  }, [analysisId])

  type StepStatus = 'done' | 'active' | 'waiting'

  function StepIcon({ status }: { status: StepStatus }) {
    if (status === 'done') return <CheckmarkFilled size={16} className={styles.iconDone} />
    if (status === 'active') return <RadioButtonIcon size={16} className={styles.iconActive} />
    return <CircleDash size={16} className={styles.iconWaiting} />
  }

  return (
    <div className={styles.page}>
      <Grid narrow>
        {/* Header */}
        <Column sm={4} md={8} lg={16}>
          <div className={styles.titleRow}>
            <div>
              <h1 className={styles.heading}>
                {appName ? `Remediating ${appName}` : 'Remediating release…'}
              </h1>
              <div className={styles.releaseMeta}>
                {releaseVer && <Tag type="cool-gray" size="md">{releaseVer}</Tag>}
                {envName && <Tag type="cool-gray" size="md">{envName}</Tag>}
              </div>
            </div>
          </div>
          <div className={styles.statusBar}>
            {finished && failed ? (
              <div className={styles.statusFailed}><span>Remediation failed</span></div>
            ) : finished ? (
              <div className={styles.statusDone}>
                <CheckmarkFilled size={20} className={styles.iconDone} />
                <span>Remediation complete</span>
              </div>
            ) : (
              <InlineLoading
                description="IBM Bob is addressing confirmed release blockers"
                status="active"
              />
            )}
          </div>
          {failed && failureMessage && (
            <InlineNotification
              kind="error"
              title="Remediation failed"
              subtitle={failureMessage}
              lowContrast
              hideCloseButton
            />
          )}
          {sseError && !failed && (
            <InlineNotification
              kind="warning"
              title="Connection warning"
              subtitle={sseError}
              lowContrast
              hideCloseButton
            />
          )}
        </Column>

        {/* Steps */}
        <Column sm={4} md={5} lg={10}>
          <Tile className={styles.stepsTile}>
            <p className={styles.tileTitle}>Remediation progress</p>
            <ul className={styles.stepList}>
              {steps.map((step) => {
                const st = stepStatuses[step.id] ?? 'waiting'
                return (
                  <li key={step.id} className={styles.stepItem}>
                    <StepIcon status={st} />
                    <span
                      className={
                        st === 'done'
                          ? styles.stepDone
                          : st === 'active'
                          ? styles.stepActive
                          : styles.stepWaiting
                      }
                    >
                      {step.label}
                    </span>
                    {st === 'active' && (
                      <InlineLoading status="active" className={styles.stepLoading} />
                    )}
                  </li>
                )
              })}
            </ul>
            {!finished && (
              <p className={styles.currentDetail}>{currentDetail}</p>
            )}
          </Tile>
        </Column>

        {/* Changed files */}
        <Column sm={4} md={3} lg={6}>
          <Tile className={styles.filesTile}>
            <p className={styles.tileTitle}>Changed files</p>
            {changedFiles.length === 0 ? (
              <p className={styles.filesEmpty}>Collecting changes…</p>
            ) : (
              <ul className={styles.fileList}>
                {changedFiles.map((f) => (
                  <li key={f} className={styles.fileItem}>
                    <Document size={14} className={styles.fileIcon} />
                    <code className={styles.fileName}>{f}</code>
                  </li>
                ))}
              </ul>
            )}
          </Tile>
        </Column>

        {/* CTA */}
        {finished && (
          <Column sm={4} md={8} lg={16}>
            <div className={styles.ctaRow}>
              {failed ? (
                <Button kind="secondary" onClick={() => onNavigate('analysis-result')}>
                  Back to results
                </Button>
              ) : (
                <Button kind="primary" onClick={() => onNavigate('remediation-result')}>
                  View remediation results
                </Button>
              )}
            </div>
          </Column>
        )}
      </Grid>
    </div>
  )
}
