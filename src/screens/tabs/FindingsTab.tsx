import { Tag, Tile } from '@carbon/react'
import { ErrorFilled, WarningFilled } from '@carbon/icons-react'
import type { Finding } from '../../data/mockAnalysis'
import styles from './FindingsTab.module.scss'

interface Props {
  findings: Finding[]
}

function SeverityTag({ severity }: { severity: Finding['severity'] }) {
  if (severity === 'BLOCK') return <Tag type="red" size="sm">BLOCK</Tag>
  if (severity === 'WARN') return <Tag type="warm-gray" size="sm">WARN</Tag>
  return <Tag type="green" size="sm">PASS</Tag>
}

function SeverityIcon({ severity }: { severity: Finding['severity'] }) {
  if (severity === 'BLOCK') return <ErrorFilled size={20} className={styles.iconBlock} />
  if (severity === 'WARN') return <WarningFilled size={20} className={styles.iconWarn} />
  return null
}

function FindingCard({ finding }: { finding: Finding }) {
  return (
    <Tile className={styles.card}>
      {/* Card header */}
      <div className={styles.cardHeader}>
        <div className={styles.cardTitleRow}>
          <SeverityIcon severity={finding.severity} />
          <h3 className={styles.cardTitle}>{finding.title}</h3>
          <SeverityTag severity={finding.severity} />
          <span className={styles.findingId}>{finding.id}</span>
        </div>
      </div>

      {/* Claim: runbook vs repository */}
      {(finding.runbook || finding.repository) && (
        <div className={styles.claimGrid}>
          {finding.runbook && (
            <div className={styles.claimBlock}>
              <p className={styles.claimLabel}>Runbook states</p>
              <p className={styles.claimValue}>{finding.runbook}</p>
            </div>
          )}
          {finding.repository && (
            <div className={styles.claimBlock}>
              <p className={styles.claimLabel}>Repository requires</p>
              <p className={styles.claimValue}>{finding.repository}</p>
            </div>
          )}
        </div>
      )}

      {/* Missing env var */}
      {finding.missing && (
        <div className={styles.missingBlock}>
          <p className={styles.claimLabel}>Missing</p>
          <code className={styles.missingCode}>{finding.missing}</code>
        </div>
      )}

      {/* Migration */}
      {finding.migration && (
        <div className={styles.missingBlock}>
          <p className={styles.claimLabel}>Migration</p>
          <code className={styles.missingCode}>{finding.migration}</code>
        </div>
      )}

      {/* Evidence */}
      <div className={styles.evidenceBlock}>
        <p className={styles.claimLabel}>Evidence</p>
        <p className={styles.evidenceText}>
          {finding.evidenceFile && (
            <code className={styles.evidenceFileInline}>{finding.evidenceFile}</code>
          )}
          {' '}
          {finding.evidence}
        </p>
      </div>

      {/* Recommendation */}
      {finding.recommendation && (
        <div className={styles.recommendationBlock}>
          <p className={styles.claimLabel}>Recommendation</p>
          <p className={styles.recommendationText}>{finding.recommendation}</p>
        </div>
      )}
    </Tile>
  )
}

export default function FindingsTab({ findings }: Props) {
  const blockers = findings.filter((f) => f.severity === 'BLOCK')
  const warnings = findings.filter((f) => f.severity === 'WARN')

  return (
    <div className={styles.root}>
      {blockers.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionHeading}>
            <ErrorFilled size={16} className={styles.iconBlock} />
            Blockers <span className={styles.sectionCount}>({blockers.length})</span>
          </h2>
          <div className={styles.cardList}>
            {blockers.map((f) => <FindingCard key={f.id} finding={f} />)}
          </div>
        </section>
      )}
      {warnings.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionHeading}>
            <WarningFilled size={16} className={styles.iconWarn} />
            Warnings <span className={styles.sectionCount}>({warnings.length})</span>
          </h2>
          <div className={styles.cardList}>
            {warnings.map((f) => <FindingCard key={f.id} finding={f} />)}
          </div>
        </section>
      )}
    </div>
  )
}
