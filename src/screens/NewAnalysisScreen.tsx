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
  InlineNotification,
  RadioButton,
  RadioButtonGroup,
  TextInput,
  Tile,
} from '@carbon/react'
import {
  ArrowRight,
  Catalog,
  CheckmarkFilled,
} from '@carbon/icons-react'
import type { ViewId } from '../types/navigation'
import styles from './NewAnalysisScreen.module.scss'

interface Props {
  onNavigate: (view: ViewId) => void
}

const CHECKS = [
  { id: 'runtime', label: 'Runtime & configuration' },
  { id: 'deploy', label: 'Deployment commands' },
  { id: 'env', label: 'Environment variables' },
  { id: 'migration', label: 'Migration & rollback' },
]

type UploadedFile = { name: string; size: number; uuid: string }

export default function NewAnalysisScreen({ onNavigate }: Props) {
  const [repoFiles, setRepoFiles] = useState<UploadedFile[]>([])
  const [runbookFiles, setRunbookFiles] = useState<UploadedFile[]>([])
  const [app, setApp] = useState('NorthRiver Payments API')
  const [release, setRelease] = useState('v2.4.0')
  const [environment, setEnvironment] = useState('Production')

  function handleRepoAdd(files: File[]) {
    const added = files.map((f) => ({
      name: f.name,
      size: f.size,
      uuid: Math.random().toString(36).slice(2),
    }))
    setRepoFiles((prev) => [...prev, ...added])
  }

  function handleRunbookAdd(files: File[]) {
    const added = files.map((f) => ({
      name: f.name,
      size: f.size,
      uuid: Math.random().toString(36).slice(2),
    }))
    setRunbookFiles((prev) => [...prev, ...added])
  }

  function loadSample() {
    setRepoFiles([{ name: 'northriver-payments-api.zip', size: 204800, uuid: 'sample-repo' }])
    setRunbookFiles([{ name: 'deployment-runbook.md', size: 8192, uuid: 'sample-runbook' }])
    setApp('NorthRiver Payments API')
    setRelease('v2.4.0')
    setEnvironment('Production')
  }

  function handleAnalyze() {
    onNavigate('analysis-in-progress')
  }

  return (
    <div className={styles.page}>
      <Grid narrow>
        {/* Page title */}
        <Column sm={4} md={8} lg={16}>
          <div className={styles.titleRow}>
            <div>
              <h1 className={styles.heading}>Analyze a release</h1>
              <p className={styles.tagline}>
                Upload your repository archive and deployment runbook to begin.
              </p>
            </div>
            <Button
              kind="ghost"
              renderIcon={Catalog}
              onClick={loadSample}
            >
              Load NorthRiver sample
            </Button>
          </div>
        </Column>

        <Column sm={4} md={8} lg={10}>
          <Form>
            {/* Repository upload */}
            <FormGroup legendText="Repository" className={styles.formGroup}>
              <FormLabel>Upload the repository archive (.zip, .tar.gz)</FormLabel>
              <div className={styles.uploaderBox}>
                <FileUploaderDropContainer
                    labelText="Drag and drop a file here, or click to upload"
                    accept={['.zip', '.tar.gz', '.tgz']}
                    multiple={false}
                    onAddFiles={(_e, { addedFiles }) =>
                      handleRepoAdd(addedFiles as File[])
                    }
                  />
                {repoFiles.map((f) => (
                  <FileUploaderItem
                    key={f.uuid}
                    uuid={f.uuid}
                    name={f.name}
                    status="complete"
                    onDelete={() =>
                      setRepoFiles((prev) => prev.filter((x) => x.uuid !== f.uuid))
                    }
                  />
                ))}
              </div>
            </FormGroup>

            {/* Runbook upload */}
            <FormGroup legendText="Deployment runbook" className={styles.formGroup}>
              <FormLabel>Supported: PDF, DOCX, Markdown</FormLabel>
              <div className={styles.uploaderBox}>
                <FileUploaderDropContainer
                    labelText="Drag and drop a file here, or click to upload"
                    accept={['.pdf', '.docx', '.md', '.markdown']}
                    multiple={false}
                    onAddFiles={(_e, { addedFiles }) =>
                      handleRunbookAdd(addedFiles as File[])
                    }
                  />
                {runbookFiles.map((f) => (
                  <FileUploaderItem
                    key={f.uuid}
                    uuid={f.uuid}
                    name={f.name}
                    status="complete"
                    onDelete={() =>
                      setRunbookFiles((prev) => prev.filter((x) => x.uuid !== f.uuid))
                    }
                  />
                ))}
              </div>
            </FormGroup>

            {/* Metadata */}
            <FormGroup legendText="Release metadata" className={styles.formGroup}>
              <div className={styles.metaGrid}>
                <TextInput
                  id="app-name"
                  labelText="Application name"
                  value={app}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setApp(e.target.value)}
                />
                <TextInput
                  id="release-version"
                  labelText="Release version"
                  value={release}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRelease(e.target.value)}
                />
                <RadioButtonGroup
                  legendText="Target environment"
                  name="environment"
                  valueSelected={environment}
                  onChange={(val) => setEnvironment(String(val ?? 'Production'))}
                  orientation="horizontal"
                >
                  <RadioButton labelText="Production" value="Production" id="env-prod" />
                  <RadioButton labelText="Staging" value="Staging" id="env-staging" />
                  <RadioButton labelText="Development" value="Development" id="env-dev" />
                </RadioButtonGroup>
              </div>
            </FormGroup>
          </Form>
        </Column>

        {/* Checks panel */}
        <Column sm={4} md={8} lg={6}>
          <Tile className={styles.checksTile}>
            <p className={styles.checksTitle}>Analysis checks</p>
            <ul className={styles.checksList}>
              {CHECKS.map((c) => (
                <li key={c.id} className={styles.checkItem}>
                  <CheckmarkFilled size={16} className={styles.checkIcon} />
                  <span>{c.label}</span>
                </li>
              ))}
            </ul>
            <InlineNotification
              kind="info"
              title="IBM Bob will inspect"
              subtitle="your runbook and repository and compare them against each other and known deployment requirements."
              lowContrast
              hideCloseButton
              className={styles.checksNotice}
            />
          </Tile>
        </Column>

        {/* Actions */}
        <Column sm={4} md={8} lg={16}>
          <div className={styles.actions}>
            <Button
              kind="primary"
              renderIcon={ArrowRight}
              disabled={repoFiles.length === 0 || runbookFiles.length === 0}
              onClick={handleAnalyze}
            >
              Analyze release
            </Button>
            <Button kind="ghost" renderIcon={Catalog} onClick={loadSample}>
              Load NorthRiver sample
            </Button>
          </div>
        </Column>
      </Grid>
    </div>
  )
}
