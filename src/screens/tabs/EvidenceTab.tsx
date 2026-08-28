import { Tile } from '@carbon/react'
import { DocumentBlank } from '@carbon/icons-react'
import type { Finding } from '../../data/mockAnalysis'
import styles from './EvidenceTab.module.scss'

interface Props {
  findings: Finding[]
}

interface EvidenceEntry {
  file: string
  references: Array<{
    findingId: string
    findingTitle: string
    severity: Finding['severity']
    note: string
  }>
}

function buildEvidenceIndex(findings: Finding[]): EvidenceEntry[] {
  const map = new Map<string, EvidenceEntry>()
  for (const f of findings) {
    const file = f.evidenceFile ?? '(unknown)'
    if (!map.has(file)) {
      map.set(file, { file, references: [] })
    }
    map.get(file)!.references.push({
      findingId: f.id,
      findingTitle: f.title,
      severity: f.severity,
      note: f.evidence,
    })
  }
  return Array.from(map.values())
}

export default function EvidenceTab({ findings }: Props) {
  const entries = buildEvidenceIndex(findings)

  return (
    <div className={styles.root}>
      <p className={styles.preamble}>
        Files inspected during analysis that produced at least one finding.
      </p>
      <div className={styles.list}>
        {entries.map((entry) => (
          <Tile key={entry.file} className={styles.card}>
            <div className={styles.fileHeader}>
              <DocumentBlank size={16} className={styles.fileIcon} />
              <code className={styles.fileName}>{entry.file}</code>
            </div>
            <ul className={styles.refList}>
              {entry.references.map((ref) => (
                <li key={ref.findingId} className={styles.refItem}>
                  <div className={styles.refMeta}>
                    <span
                      className={
                        ref.severity === 'BLOCK'
                          ? styles.severityBlock
                          : ref.severity === 'WARN'
                          ? styles.severityWarn
                          : styles.severityPass
                      }
                    >
                      {ref.severity}
                    </span>
                    <span className={styles.refId}>{ref.findingId}</span>
                    <span className={styles.refTitle}>{ref.findingTitle}</span>
                  </div>
                  <p className={styles.refNote}>{ref.note}</p>
                </li>
              ))}
            </ul>
          </Tile>
        ))}
      </div>
    </div>
  )
}
