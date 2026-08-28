import {
  Button,
  Column,
  Grid,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Tag,
  Tile,
} from '@carbon/react'
import {
  ArrowRight,
  Renew,
  Download,
  CheckmarkFilled,
  WarningFilled,
  ErrorFilled,
  InformationFilled,
} from '@carbon/icons-react'
import styles from './ReleaseReadinessResults.module.scss'
import { mockAnalysis } from '../data/mockAnalysis'
import OverviewTab from './tabs/OverviewTab'
import FindingsTab from './tabs/FindingsTab'
import EvidenceTab from './tabs/EvidenceTab'
import AgentActivityTab from './tabs/AgentActivityTab'
import type { ViewId } from '../types/navigation'

interface Props {
  onNavigate?: (view: ViewId) => void
}

export default function ReleaseReadinessResults({ onNavigate }: Props) {
  const { app, release, environment, decision, readiness, summary, analysis } = mockAnalysis

  const isNoGo = decision === 'NO-GO'

  return (
    <div className={styles.page}>
      {/* ── Page header ─────────────────────────────────────────── */}
      <div className={styles.pageHeader}>
        <Grid narrow>
          <Column sm={4} md={8} lg={16}>
            <p className={styles.headerEyebrow}>NorthRiver Bank · NotProdReady</p>
            <div className={styles.headerMeta}>
              <span className={styles.appName}>{app}</span>
              <span className={styles.headerSeparator}>·</span>
              <Tag type="cool-gray" size="md">{release}</Tag>
              <Tag type="cool-gray" size="md">{environment}</Tag>
            </div>
          </Column>
        </Grid>
      </div>

      {/* ── Verdict band ────────────────────────────────────────── */}
      <div className={isNoGo ? styles.verdictBandNogo : styles.verdictBandGo}>
        <Grid narrow>
          <Column sm={4} md={5} lg={8}>
            <div className={styles.verdictLeft}>
              {isNoGo ? (
                <ErrorFilled size={32} className={styles.verdictIconNogo} />
              ) : (
                <CheckmarkFilled size={32} className={styles.verdictIconGo} />
              )}
              <div>
                <p className={styles.verdictLabel}>{decision}</p>
                <p className={styles.verdictSupport}>
                  Release blockers were found between the deployment runbook and the actual application.
                </p>
              </div>
            </div>
          </Column>
          <Column sm={4} md={3} lg={8}>
            <div className={styles.verdictRight}>
              <div className={styles.scoreBlock}>
                <span className={styles.scoreValue}>{readiness.score}</span>
                <span className={styles.scoreDivider}>/</span>
                <span className={styles.scoreMax}>100</span>
              </div>
              <div className={styles.scoreCounts}>
                <span className={styles.countBlocker}>
                  <ErrorFilled size={16} /> {summary.blockers} blockers
                </span>
                <span className={styles.countSep}>|</span>
                <span className={styles.countWarning}>
                  <WarningFilled size={16} /> {summary.warnings} warning
                </span>
                <span className={styles.countSep}>|</span>
                <span className={styles.countPassed}>
                  <CheckmarkFilled size={16} /> {summary.passed} passed
                </span>
              </div>
            </div>
          </Column>
        </Grid>
      </div>

      {/* ── Actions ─────────────────────────────────────────────── */}
      <div className={styles.actionsBar}>
        <Grid narrow>
          <Column sm={4} md={8} lg={16}>
            <div className={styles.actions}>
              <Button kind="primary" renderIcon={ArrowRight}>
                Ask Bob to remediate
              </Button>
              <Button
                kind="secondary"
                renderIcon={Renew}
                onClick={() => onNavigate?.('new-analysis')}
              >
                Run analysis again
              </Button>
              <Button kind="ghost" renderIcon={Download}>
                Export report
              </Button>
            </div>
          </Column>
        </Grid>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────── */}
      <div className={styles.tabsWrapper}>
        <Grid narrow>
          <Column sm={4} md={8} lg={16}>
            <Tabs>
              <TabList aria-label="Release readiness sections" contained={false}>
                <Tab>Overview</Tab>
                <Tab>Findings</Tab>
                <Tab>Evidence</Tab>
                <Tab>Agent activity</Tab>
              </TabList>
              <TabPanels>
                <TabPanel>
                  <OverviewTab data={mockAnalysis} />
                </TabPanel>
                <TabPanel>
                  <FindingsTab findings={mockAnalysis.findings} />
                </TabPanel>
                <TabPanel>
                  <EvidenceTab findings={mockAnalysis.findings} />
                </TabPanel>
                <TabPanel>
                  <AgentActivityTab activity={mockAnalysis.agentActivity} />
                </TabPanel>
              </TabPanels>
            </Tabs>
          </Column>
        </Grid>
      </div>

      {/* ── Analysis footer ─────────────────────────────────────── */}
      <div className={styles.analysisFooter}>
        <Grid narrow>
          <Column sm={4} md={8} lg={16}>
            <Tile className={styles.analysisTile}>
              <div className={styles.analysisHeader}>
                <InformationFilled size={16} className={styles.analysisIcon} />
                <span className={styles.analysisTitle}>Analysis performed by IBM Bob</span>
              </div>
              <dl className={styles.analysisMeta}>
                <div className={styles.metaItem}>
                  <dt>Analysis ID</dt>
                  <dd><code>{analysis.id}</code></dd>
                </div>
                <div className={styles.metaItem}>
                  <dt>Duration</dt>
                  <dd>{analysis.duration}</dd>
                </div>
                <div className={styles.metaItem}>
                  <dt>Files inspected</dt>
                  <dd>{analysis.filesInspected}</dd>
                </div>
                <div className={styles.metaItem}>
                  <dt>Commands executed</dt>
                  <dd>{analysis.commandsExecuted}</dd>
                </div>
                <div className={styles.metaItem}>
                  <dt>Completed at</dt>
                  <dd>{analysis.completedAt}</dd>
                </div>
              </dl>
            </Tile>
          </Column>
        </Grid>
      </div>
    </div>
  )
}
