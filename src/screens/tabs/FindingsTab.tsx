import { Accordion, AccordionItem, Tag } from '@carbon/react'
import { ErrorFilled, WarningFilled, CheckmarkFilled } from '@carbon/icons-react'
import type { Finding } from '../../data/mockAnalysis'
import styles from './FindingsTab.module.scss'

interface Props {
  findings: Finding[]
}

function SeverityTag({ severity }: { severity: Finding['severity'] }) {
  if (severity === 'BLOCK') return <Tag type="red" size="sm">BLOCK</Tag>
  if (severity === 'WARN')  return <Tag type="warm-gray" size="sm">WARN</Tag>
  return <Tag type="green" size="sm">PASS</Tag>
}

function SeverityIcon({ severity }: { severity: Finding['severity'] }) {
  if (severity === 'BLOCK') return <ErrorFilled   size={16} className={styles.iconBlock} />
  if (severity === 'WARN')  return <WarningFilled  size={16} className={styles.iconWarn} />
  return                           <CheckmarkFilled size={16} className={styles.iconPass} />
}

/** The accordion title row: icon + title + tag + id */
function FindingTitle({ finding }: { finding: Finding }) {
  return (
    <span className={styles.accordionTitle}>
      <SeverityIcon severity={finding.severity} />
      <span className={styles.accordionTitleText}>{finding.title}</span>
      <SeverityTag severity={finding.severity} />
      <span className={styles.findingId}>{finding.id}</span>
    </span>
  )
}

/** Claim → Evidence → Risk → Recommendation body */
function FindingBody({ finding }: { finding: Finding }) {
  return (
    <div className={styles.body}>

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
        <div className={styles.fieldRow}>
          <span className={styles.claimLabel}>Missing</span>
          <code className={styles.missingCode}>{finding.missing}</code>
        </div>
      )}

      {/* Migration */}
      {finding.migration && (
        <div className={styles.fieldRow}>
          <span className={styles.claimLabel}>Migration</span>
          <code className={styles.migrationCode}>{finding.migration}</code>
        </div>
      )}

      {/* Evidence */}
      <div className={styles.evidenceBlock}>
        <p className={styles.claimLabel}>Evidence</p>
        <p className={styles.evidenceText}>
          {finding.evidenceFile && (
            <code className={styles.evidenceFileInline}>{finding.evidenceFile}</code>
          )}
          {finding.evidenceFile ? '  ' : ''}
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

    </div>
  )
}

function FindingsSection({
  label,
  icon,
  count,
  findings,
  open,
}: {
  label: string
  icon: React.ReactNode
  count: number
  findings: Finding[]
  open: boolean
}) {
  if (findings.length === 0) return null
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionHeading}>
        {icon}
        {label}
        <span className={styles.sectionCount}>({count})</span>
      </h2>
      <Accordion>
        {findings.map((f) => (
          <AccordionItem
            key={f.id}
            title={<FindingTitle finding={f} />}
            open={open}
            className={
              f.severity === 'BLOCK'
                ? styles.accordionItemBlock
                : f.severity === 'WARN'
                ? styles.accordionItemWarn
                : styles.accordionItemPass
            }
          >
            <FindingBody finding={f} />
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  )
}

export default function FindingsTab({ findings }: Props) {
  const blockers = findings.filter((f) => f.severity === 'BLOCK')
  const warnings = findings.filter((f) => f.severity === 'WARN')

  return (
    <div className={styles.root}>
      <FindingsSection
        label="Blockers"
        icon={<ErrorFilled size={16} className={styles.iconBlock} />}
        count={blockers.length}
        findings={blockers}
        open={true}
      />
      <FindingsSection
        label="Warnings"
        icon={<WarningFilled size={16} className={styles.iconWarn} />}
        count={warnings.length}
        findings={warnings}
        open={true}
      />
    </div>
  )
}
