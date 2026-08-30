import { useState } from 'react'
import {
  Button,
  Column,
  FileUploaderDropContainer,
  FileUploaderItem,
  Form,
  FormGroup,
  FormLabel,
  Grid,
  InlineLoading,
  InlineNotification,
  RadioButton,
  RadioButtonGroup,
  Tag,
  TextInput,
} from '@carbon/react'
import {
  Archive,
  ArrowRight,
  Catalog,
  CheckmarkFilled,
  DataBase,
  DocumentBlank,
  IbmWatsonMachineLearning,
  Search,
  Settings,
} from '@carbon/icons-react'
import type { ViewId } from '../types/navigation'
import { createAnalysis } from '../api/analyses'
import styles from './NewAnalysisScreen.module.scss'

interface Props {
  onAnalysisCreated: (analysisId: string) => void
  onNavigate?: (view: ViewId) => void
}

type UploadedFile = {
  name: string
  size: number
  uuid: string
  file?: File
}

/* ── IBM Bob release checks ─────────────────────────────────────────── */

const CHECKS = [
  {
    id: 'runtime',
    label: 'Runtime & configuration',
    description:
      'Compare runtime versions, dependency expectations, and configuration requirements.',
    icon: Settings,
  },
  {
    id: 'deploy',
    label: 'Deployment commands',
    description:
      'Verify documented build and startup commands against repository implementation.',
    icon: DataBase,
  },
  {
    id: 'env',
    label: 'Environment variables',
    description:
      'Identify required environment variables and confirm they are represented in release artifacts.',
    icon: Search,
  },
  {
    id: 'migration',
    label: 'Migration & rollback',
    description:
      'Inspect migration artifacts and confirm that rollback requirements are operationally supported.',
    icon: Archive,
  },
]

/* ── Small display helpers ───────────────────────────────────────────── */

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function NewAnalysisScreen({ onAnalysisCreated }: Props) {
  const [repoFiles, setRepoFiles] = useState<UploadedFile[]>([])
  const [runbookFiles, setRunbookFiles] = useState<UploadedFile[]>([])
  const [app, setApp] = useState('')
  const [release, setRelease] = useState('')
  const [environment, setEnvironment] = useState('Production')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSample, setIsSample] = useState(false)

  /* ── Repository upload handling ───────────────────────────────────── */

  function handleRepoAdd(files: File[]) {
    const nextFile = files[0]

    if (!nextFile) return

    setRepoFiles([
      {
        name: nextFile.name,
        size: nextFile.size,
        uuid: Math.random().toString(36).slice(2),
        file: nextFile,
      },
    ])

    setIsSample(false)
    setError(null)
  }

  /* ── Runbook upload handling ──────────────────────────────────────── */

  function handleRunbookAdd(files: File[]) {
    const nextFile = files[0]

    if (!nextFile) return

    setRunbookFiles([
      {
        name: nextFile.name,
        size: nextFile.size,
        uuid: Math.random().toString(36).slice(2),
        file: nextFile,
      },
    ])

    setIsSample(false)
    setError(null)
  }

  /* ── Competition sample data ──────────────────────────────────────── */

  function loadSample() {
    setRepoFiles([
      {
        name: 'northriver-payments-api.zip',
        size: 204800,
        uuid: 'sample-repo',
      },
    ])

    setRunbookFiles([
      {
        name: 'deployment-runbook.md',
        size: 8192,
        uuid: 'sample-runbook',
      },
    ])

    setApp('NorthRiver Payments API')
    setRelease('v2.4.0')
    setEnvironment('Production')
    setIsSample(true)
    setError(null)
  }

  /* ── Start IBM Bob analysis ───────────────────────────────────────── */

  async function handleAnalyze() {
    if (submitting) return

    setError(null)
    setSubmitting(true)

    try {
      const response = await createAnalysis({
        applicationName: app.trim(),
        releaseVersion: release.trim(),
        environment,
        repository: isSample ? undefined : repoFiles[0]?.file,
        deploymentRunbook: isSample ? undefined : runbookFiles[0]?.file,
        useSample: isSample,
      })

      onAnalysisCreated(response.analysis_id)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'IBM Bob could not start the release analysis.',
      )
      setSubmitting(false)
    }
  }

  /* ── Submission readiness ─────────────────────────────────────────── */

  const repositoryReady = repoFiles.length > 0
  const runbookReady = runbookFiles.length > 0
  const metadataReady =
    app.trim().length > 0 && release.trim().length > 0

  const canSubmit =
    repositoryReady &&
    runbookReady &&
    metadataReady &&
    !submitting

  return (
    <div className={styles.page}>
      {/* ── Page hero ───────────────────────────────────────────────── */}
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div>
            <div className={styles.eyebrowRow}>
              <span className={styles.eyebrow}>New analysis</span>
              <span className={styles.eyebrowDivider} aria-hidden="true" />
              <span className={styles.agentState}>
                <span className={styles.agentStateDot} aria-hidden="true" />
                IBM Bob ready
              </span>
            </div>

            <h1 className={styles.heading}>Analyze a release</h1>

            <p className={styles.tagline}>
              Provide the release artifacts. IBM Bob will inspect the
              deployment contract, compare it with the repository, verify
              mismatches, and produce a grounded readiness decision.
            </p>
          </div>

          <button
            type="button"
            className={styles.sampleLink}
            onClick={loadSample}
            disabled={submitting}
          >
            <Catalog size={16} />
            Load competition sample
          </button>
        </div>
      </section>

      {/* ── Page content ─────────────────────────────────────────────── */}
      <div className={styles.content}>
        <Grid fullWidth>
          {/* ── Sample state ─────────────────────────────────────────── */}
          {isSample && (
            <Column sm={4} md={8} lg={16}>
              <div className={styles.sampleBanner}>
                <Tag type="blue" size="sm">
                  Sample release loaded
                </Tag>

                <span className={styles.sampleBannerText}>
                  NorthRiver Payments API v2.4.0 is ready for IBM Bob analysis.
                </span>
              </div>
            </Column>
          )}

          {/* ── API error state ──────────────────────────────────────── */}
          {error && (
            <Column sm={4} md={8} lg={16}>
              <InlineNotification
                kind="error"
                title="Analysis could not start"
                subtitle={error}
                onCloseButtonClick={() => setError(null)}
                lowContrast
              />
            </Column>
          )}

          {/* ── Release input workflow ───────────────────────────────── */}
          <Column sm={4} md={8} lg={10}>
            <Form
              className={styles.releaseForm}
              onSubmit={(event: React.FormEvent) => event.preventDefault()}
            >
              <div className={styles.formIntro}>
                <div>
                  <p className={styles.sectionEyebrow}>Release inputs</p>
                  <h2>Give IBM Bob the evidence it needs.</h2>
                </div>

                <p>
                  Repository code is treated as implementation evidence.
                  Deployment documentation is treated as the intended release
                  contract.
                </p>
              </div>

              {/* ── Step 01 — Repository archive ─────────────────────── */}
              <section className={styles.inputSection}>
                <div className={styles.sectionRail}>
                  <span className={styles.stepNumber}>01</span>

                  <div
                    className={
                      repositoryReady
                        ? styles.stepStateComplete
                        : styles.stepState
                    }
                  >
                    {repositoryReady ? (
                      <CheckmarkFilled size={16} />
                    ) : (
                      <span aria-hidden="true" />
                    )}
                  </div>
                </div>

                <div className={styles.sectionBody}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <h3>Repository archive</h3>
                      <p>
                        The implementation Bob will inspect for runtime,
                        startup, configuration, migration, and rollback evidence.
                      </p>
                    </div>

                    {repositoryReady && (
                      <Tag type="green" size="sm">
                        Ready
                      </Tag>
                    )}
                  </div>

                  <FormGroup
                    legendText=""
                    className={styles.formGroup}
                  >
                    <FormLabel>
                      Accepted formats: .zip, .tar.gz, .tgz
                    </FormLabel>

                    <div className={styles.uploaderBox}>
                      <FileUploaderDropContainer
                        labelText="Drop repository archive here or browse"
                        accept={['.zip', '.tar.gz', '.tgz']}
                        multiple={false}
                        onAddFiles={(_event, { addedFiles }) =>
                          handleRepoAdd(addedFiles as File[])
                        }
                      />

                      {repoFiles.map((file) => (
                        <div
                          key={file.uuid}
                          className={styles.fileItemWrap}
                        >
                          <FileUploaderItem
                            uuid={file.uuid}
                            name={file.name}
                            status="complete"
                            onDelete={() => {
                              setRepoFiles([])
                              setIsSample(false)
                            }}
                          />

                          <span className={styles.fileSize}>
                            {formatFileSize(file.size)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </FormGroup>
                </div>
              </section>

              {/* ── Step 02 — Deployment runbook ────────────────────── */}
              <section className={styles.inputSection}>
                <div className={styles.sectionRail}>
                  <span className={styles.stepNumber}>02</span>

                  <div
                    className={
                      runbookReady
                        ? styles.stepStateComplete
                        : styles.stepState
                    }
                  >
                    {runbookReady ? (
                      <CheckmarkFilled size={16} />
                    ) : (
                      <span aria-hidden="true" />
                    )}
                  </div>
                </div>

                <div className={styles.sectionBody}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <h3>Deployment runbook</h3>
                      <p>
                        The documented release expectations Bob will verify
                        against the repository.
                      </p>
                    </div>

                    {runbookReady && (
                      <Tag type="green" size="sm">
                        Ready
                      </Tag>
                    )}
                  </div>

                  <FormGroup
                    legendText=""
                    className={styles.formGroup}
                  >
                    <FormLabel>
                      Supported: PDF, DOCX, Markdown (.md)
                    </FormLabel>

                    <div className={styles.uploaderBox}>
                      <FileUploaderDropContainer
                        labelText="Drop deployment runbook here or browse"
                        accept={['.pdf', '.docx', '.md', '.markdown']}
                        multiple={false}
                        onAddFiles={(_event, { addedFiles }) =>
                          handleRunbookAdd(addedFiles as File[])
                        }
                      />

                      {runbookFiles.map((file) => (
                        <div
                          key={file.uuid}
                          className={styles.fileItemWrap}
                        >
                          <FileUploaderItem
                            uuid={file.uuid}
                            name={file.name}
                            status="complete"
                            onDelete={() => {
                              setRunbookFiles([])
                              setIsSample(false)
                            }}
                          />

                          <span className={styles.fileSize}>
                            {formatFileSize(file.size)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </FormGroup>
                </div>
              </section>

              {/* ── Step 03 — Release metadata ──────────────────────── */}
              <section className={styles.inputSection}>
                <div className={styles.sectionRail}>
                  <span className={styles.stepNumber}>03</span>

                  <div
                    className={
                      metadataReady
                        ? styles.stepStateComplete
                        : styles.stepState
                    }
                  >
                    {metadataReady ? (
                      <CheckmarkFilled size={16} />
                    ) : (
                      <span aria-hidden="true" />
                    )}
                  </div>
                </div>

                <div className={styles.sectionBody}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <h3>Release metadata</h3>
                      <p>
                        Identify the application and version Bob is evaluating.
                      </p>
                    </div>

                    {metadataReady && (
                      <Tag type="green" size="sm">
                        Ready
                      </Tag>
                    )}
                  </div>

                  <FormGroup
                    legendText=""
                    className={styles.formGroup}
                  >
                    <div className={styles.metaGrid}>
                      <TextInput
                        id="app-name"
                        labelText="Application name"
                        placeholder="e.g. Payments API"
                        value={app}
                        onChange={(
                          event: React.ChangeEvent<HTMLInputElement>,
                        ) => setApp(event.target.value)}
                      />

                      <TextInput
                        id="release-version"
                        labelText="Release version"
                        placeholder="e.g. v2.4.0"
                        value={release}
                        onChange={(
                          event: React.ChangeEvent<HTMLInputElement>,
                        ) => setRelease(event.target.value)}
                      />
                    </div>
                  </FormGroup>
                </div>
              </section>

              {/* ── Step 04 — Target environment ────────────────────── */}
              <section className={styles.inputSection}>
                <div className={styles.sectionRail}>
                  <span className={styles.stepNumber}>04</span>

                  <div className={styles.stepStateComplete}>
                    <CheckmarkFilled size={16} />
                  </div>
                </div>

                <div className={styles.sectionBody}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <h3>Target environment</h3>
                      <p>
                        Set the deployment context for the readiness decision.
                      </p>
                    </div>

                    <Tag type="cool-gray" size="sm">
                      {environment}
                    </Tag>
                  </div>

                  <FormGroup
                    legendText=""
                    className={styles.formGroup}
                  >
                    <RadioButtonGroup
                      legendText=""
                      name="environment"
                      valueSelected={environment}
                      onChange={(value) =>
                        setEnvironment(
                          String(value ?? 'Production'),
                        )
                      }
                      orientation="horizontal"
                    >
                      <RadioButton
                        id="env-prod"
                        labelText="Production"
                        value="Production"
                      />

                      <RadioButton
                        id="env-staging"
                        labelText="Staging"
                        value="Staging"
                      />

                      <RadioButton
                        id="env-dev"
                        labelText="Development"
                        value="Development"
                      />
                    </RadioButtonGroup>
                  </FormGroup>
                </div>
              </section>
            </Form>
          </Column>

          {/* ── IBM Bob analysis plan ────────────────────────────────── */}
          <Column sm={4} md={8} lg={6}>
            <aside className={styles.bobPanel}>
              <div className={styles.bobPanelHeader}>
                <div className={styles.bobIdentity}>
                  <IbmWatsonMachineLearning size={24} />

                  <div>
                    <span className={styles.bobLabel}>IBM Bob</span>
                    <span className={styles.bobState}>Release agent ready</span>
                  </div>
                </div>

                <span className={styles.bobOnlineDot} aria-hidden="true" />
              </div>

              <div className={styles.bobPanelIntro}>
                <p className={styles.bobEyebrow}>Analysis plan</p>
                <h2>What Bob will verify</h2>
                <p>
                  Bob evaluates release claims against implementation evidence
                  before publishing any blocker or readiness decision.
                </p>
              </div>

              <div className={styles.scopeCards}>
                {CHECKS.map((check, index) => {
                  const Icon = check.icon

                  return (
                    <div
                      key={check.id}
                      className={styles.scopeCard}
                    >
                      <div className={styles.scopeIndex}>
                        {String(index + 1).padStart(2, '0')}
                      </div>

                      <div className={styles.scopeCardIcon}>
                        <Icon size={20} />
                      </div>

                      <div>
                        <p className={styles.scopeCardTitle}>
                          {check.label}
                        </p>

                        <p className={styles.scopeCardDesc}>
                          {check.description}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className={styles.bobEvidenceNote}>
                <DocumentBlank size={16} />

                <p>
                  Findings are grounded in repository or runbook evidence.
                  Confirmed BLOCK findings drive a NO-GO decision.
                </p>
              </div>

              {/* ── Readiness checklist ─────────────────────────────── */}
              <div className={styles.readinessChecklist}>
                <p className={styles.checklistTitle}>
                  Ready to hand off to Bob
                </p>

                <div className={styles.checklistItem}>
                  <CheckmarkFilled
                    size={14}
                    className={
                      repositoryReady
                        ? styles.checkReady
                        : styles.checkPending
                    }
                  />
                  <span>Repository archive</span>
                </div>

                <div className={styles.checklistItem}>
                  <CheckmarkFilled
                    size={14}
                    className={
                      runbookReady
                        ? styles.checkReady
                        : styles.checkPending
                    }
                  />
                  <span>Deployment runbook</span>
                </div>

                <div className={styles.checklistItem}>
                  <CheckmarkFilled
                    size={14}
                    className={
                      metadataReady
                        ? styles.checkReady
                        : styles.checkPending
                    }
                  />
                  <span>Release metadata</span>
                </div>
              </div>
            </aside>
          </Column>

          {/* ── Analysis action bar ──────────────────────────────────── */}
          <Column sm={4} md={8} lg={16}>
            <div className={styles.actionBar}>
              <div className={styles.actionCopy}>
                {submitting ? (
                  <InlineLoading
                    status="active"
                    description="Handing release artifacts to IBM Bob…"
                  />
                ) : (
                  <>
                    <span className={styles.actionTitle}>
                      {canSubmit
                        ? 'Release package ready'
                        : 'Complete the release package'}
                    </span>

                    <span className={styles.actionMeta}>
                      {canSubmit
                        ? 'IBM Bob has the inputs required to begin release-readiness analysis.'
                        : 'Add both artifacts and release metadata before starting analysis.'}
                    </span>
                  </>
                )}
              </div>

              <Button
                type="button"
                kind="primary"
                size="lg"
                renderIcon={
                  submitting ? undefined : ArrowRight
                }
                disabled={!canSubmit}
                onClick={handleAnalyze}
                className={styles.analyzeButton}
              >
                {submitting
                  ? 'Starting IBM Bob…'
                  : 'Analyze with IBM Bob'}
              </Button>
            </div>
          </Column>
        </Grid>
      </div>
    </div>
  )
}
