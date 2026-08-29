import { Column, Grid, Tag, Tile } from '@carbon/react'
import {
  CheckmarkFilled,
  WarningFilled,
  ErrorFilled,
} from '@carbon/icons-react'
import type { MockAnalysis } from '../../data/mockAnalysis'
import styles from './OverviewTab.module.scss'

interface Props {
  data: MockAnalysis
}

export default function OverviewTab({ data }: Props) {
  const { summary, findings } = data
  const blockers = findings.filter((f) => f.severity === 'BLOCK')
  const warnings = findings.filter((f) => f.severity === 'WARN')
  const passed   = findings.filter((f) => f.severity === 'PASS')

  return (
    <div className={styles.root}>
      <Grid narrow>

        {/* ── Summary counts ─────────────────────────────────── */}
        <Column sm={4} md={8} lg={16}>
          <div className={styles.summaryRow}>
            <div className={`${styles.summaryCard} ${styles.summaryCardBlock}`}>
              <ErrorFilled size={20} className={styles.iconBlock} />
              <span className={styles.summaryCount}>{summary.blockers}</span>
              <span className={styles.summaryLabel}>Blockers</span>
            </div>
            <div className={`${styles.summaryCard} ${styles.summaryCardWarn}`}>
              <WarningFilled size={20} className={styles.iconWarn} />
              <span className={styles.summaryCount}>{summary.warnings}</span>
              <span className={styles.summaryLabel}>Warnings</span>
            </div>
            <div className={`${styles.summaryCard} ${styles.summaryCardPass}`}>
              <CheckmarkFilled size={20} className={styles.iconPass} />
              <span className={styles.summaryCount}>{summary.passed}</span>
              <span className={styles.summaryLabel}>Passed</span>
            </div>
          </div>
        </Column>

        {/* ── Blockers list ───────────────────────────────────── */}
        {blockers.length > 0 && (
          <Column sm={4} md={8} lg={16}>
            <Tile className={styles.section}>
              <h3 className={styles.sectionTitle}>
                <ErrorFilled size={16} className={styles.iconBlock} /> Blockers
              </h3>
              <ul className={styles.findingList}>
                {blockers.map((f) => (
                  <li key={f.id} className={styles.findingItem}>
                    <Tag type="red" size="sm">BLOCK</Tag>
                    <span className={styles.findingTitle}>{f.title}</span>
                    {f.evidenceFile && (
                      <code className={styles.evidenceFile}>{f.evidenceFile}</code>
                    )}
                  </li>
                ))}
              </ul>
            </Tile>
          </Column>
        )}

        {/* ── Warnings list ───────────────────────────────────── */}
        {warnings.length > 0 && (
          <Column sm={4} md={8} lg={16}>
            <Tile className={styles.section}>
              <h3 className={styles.sectionTitle}>
                <WarningFilled size={16} className={styles.iconWarn} /> Warnings
              </h3>
              <ul className={styles.findingList}>
                {warnings.map((f) => (
                  <li key={f.id} className={styles.findingItem}>
                    <Tag type="warm-gray" size="sm">WARN</Tag>
                    <span className={styles.findingTitle}>{f.title}</span>
                    {f.evidenceFile && (
                      <code className={styles.evidenceFile}>{f.evidenceFile}</code>
                    )}
                  </li>
                ))}
              </ul>
            </Tile>
          </Column>
        )}

        {/* ── Passed checks ───────────────────────────────────── */}
        {passed.length > 0 && (
          <Column sm={4} md={8} lg={16}>
            <Tile className={styles.section}>
              <h3 className={styles.sectionTitle}>
                <CheckmarkFilled size={16} className={styles.iconPass} /> Passed checks
              </h3>
              <ul className={styles.findingList}>
                {passed.map((f) => (
                  <li key={f.id} className={styles.findingItem}>
                    <Tag type="green" size="sm">PASS</Tag>
                    <span className={styles.findingTitle}>{f.title}</span>
                    {f.evidenceFile && (
                      <code className={styles.evidenceFile}>{f.evidenceFile}</code>
                    )}
                  </li>
                ))}
              </ul>
            </Tile>
          </Column>
        )}

      </Grid>
    </div>
  )
}
