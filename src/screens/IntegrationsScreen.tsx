import {
  Button,
  Column,
  Grid,
  Tag,
} from '@carbon/react'
import {
  Api,
  CheckmarkFilled,
  Cloud,
  Code,
  IbmCloud,
  IbmWatsonMachineLearning,
  Locked,
  Network_4,
  SecurityServices,
  Settings,
} from '@carbon/icons-react'
import styles from './IntegrationsScreen.module.scss'

/* ── Demonstration integration catalog ─────────────────────────────── */

const INTEGRATIONS = [
  {
    id: 'bob',
    name: 'IBM Bob',
    category: 'Agent runtime',
    status: 'Connected',
    description:
      'Primary release-readiness agent used to inspect release artifacts, verify findings, and perform repository remediation.',
    icon: IbmWatsonMachineLearning,
    capabilities: [
      'Runbook analysis',
      'Repository inspection',
      'GO / NO-GO verification',
      'Targeted repository remediation',
    ],
    primary: true,
  },
  {
    id: 'github',
    name: 'Git repository provider',
    category: 'Source control',
    status: 'Demo ready',
    description:
      'A production deployment could ingest release repositories directly from an approved Git provider instead of manual archive upload.',
    icon: Code,
    capabilities: [
      'Repository retrieval',
      'Branch / tag selection',
      'Commit metadata',
      'Remediated change handoff',
    ],
    primary: false,
  },
  {
    id: 'pipeline',
    name: 'CI/CD pipeline',
    category: 'Delivery',
    status: 'Demo ready',
    description:
      'Release analysis can be positioned as a pre-production quality gate before deployment automation continues.',
    icon: Network_4,
    capabilities: [
      'Pre-deploy readiness check',
      'Decision gate',
      'Release metadata handoff',
      'Pipeline status integration',
    ],
    primary: false,
  },
  {
    id: 'cloud',
    name: 'Cloud deployment platform',
    category: 'Runtime',
    status: 'Demo ready',
    description:
      'Target environment metadata can be connected to cloud deployment context for richer runtime and configuration validation.',
    icon: IbmCloud,
    capabilities: [
      'Environment context',
      'Runtime metadata',
      'Deployment target',
      'Operational configuration',
    ],
    primary: false,
  },
]

/* ── Integration connection map ────────────────────────────────────── */

const FLOW = [
  {
    id: 'source',
    number: '01',
    title: 'Release source',
    description:
      'Repository and deployment runbook enter the NotProdReady workflow.',
    icon: Code,
  },
  {
    id: 'bob',
    number: '02',
    title: 'IBM Bob',
    description:
      'Bob inspects, compares, verifies, and produces grounded findings.',
    icon: IbmWatsonMachineLearning,
  },
  {
    id: 'decision',
    number: '03',
    title: 'Readiness decision',
    description:
      'NotProdReady publishes the evidence-backed GO / NO-GO result.',
    icon: SecurityServices,
  },
  {
    id: 'delivery',
    number: '04',
    title: 'Delivery workflow',
    description:
      'A production integration can pass the decision into CI/CD or deployment systems.',
    icon: Cloud,
  },
]

/* ── Integrations screen ───────────────────────────────────────────── */

export default function IntegrationsScreen() {
  return (
    <div className={styles.page}>
      {/* ── Page hero ───────────────────────────────────────────────── */}
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <div className={styles.eyebrowRow}>
              <span className={styles.eyebrow}>
                Connected systems
              </span>

              <span
                className={styles.eyebrowDivider}
                aria-hidden="true"
              />

              <span className={styles.agentState}>
                <span
                  className={styles.agentStateDot}
                  aria-hidden="true"
                />
                IBM Bob connected
              </span>
            </div>

            <h1 className={styles.heading}>
              Integrations
            </h1>

            <p className={styles.heroDescription}>
              NotProdReady is centered on IBM Bob today and designed to fit
              into the release systems teams already use for source control,
              delivery, and cloud deployment.
            </p>
          </div>

          <div className={styles.heroMode}>
            <Api size={22} />

            <div>
              <span className={styles.heroModeLabel}>
                Integration surface
              </span>

              <span className={styles.heroModeMeta}>
                Demo architecture
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Page content ─────────────────────────────────────────────── */}
      <div className={styles.content}>
        <Grid fullWidth>
          {/* ── Demonstration notice ────────────────────────────────── */}
          <Column sm={4} md={8} lg={16}>
            <div className={styles.demoNotice}>
              <Locked
                size={18}
                className={styles.demoNoticeIcon}
              />

              <div>
                <strong>
                  Demonstration integration catalog
                </strong>

                <p>
                  IBM Bob is the active runtime integration in this demo.
                  The remaining cards show where production connectors could
                  extend the workflow without implying those systems are
                  currently connected.
                </p>
              </div>

              <Tag type="blue" size="sm">
                Demo architecture
              </Tag>
            </div>
          </Column>

          {/* ── Integration posture ─────────────────────────────────── */}
          <Column sm={4} md={8} lg={16}>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.sectionEyebrow}>
                  Integration posture
                </p>

                <h2>Release-readiness ecosystem</h2>
              </div>

              <p>
                IBM Bob is the active agent. Adjacent systems represent the
                handoff points for a production release workflow.
              </p>
            </div>
          </Column>

          <Column sm={4} md={4} lg={4}>
            <article
              className={`${styles.metric} ${styles.metricBlue}`}
            >
              <IbmWatsonMachineLearning size={20} />

              <span className={styles.metricLabel}>
                Active agent
              </span>

              <strong className={styles.metricValue}>
                1
              </strong>

              <span className={styles.metricMeta}>
                IBM Bob runtime
              </span>
            </article>
          </Column>

          <Column sm={4} md={4} lg={4}>
            <article
              className={`${styles.metric} ${styles.metricGreen}`}
            >
              <CheckmarkFilled size={20} />

              <span className={styles.metricLabel}>
                Connected
              </span>

              <strong className={styles.metricValue}>
                1
              </strong>

              <span className={styles.metricMeta}>
                Live demo integration
              </span>
            </article>
          </Column>

          <Column sm={4} md={4} lg={4}>
            <article
              className={`${styles.metric} ${styles.metricPurple}`}
            >
              <Network_4 size={20} />

              <span className={styles.metricLabel}>
                Extension points
              </span>

              <strong className={styles.metricValue}>
                3
              </strong>

              <span className={styles.metricMeta}>
                Production connector surfaces
              </span>
            </article>
          </Column>

          <Column sm={4} md={4} lg={4}>
            <article
              className={`${styles.metric} ${styles.metricDark}`}
            >
              <SecurityServices size={20} />

              <span className={styles.metricLabel}>
                Decision gate
              </span>

              <strong className={styles.metricValue}>
                GO
              </strong>

              <span className={styles.metricMeta}>
                Or NO-GO before production
              </span>
            </article>
          </Column>

          {/* ── Release integration flow ────────────────────────────── */}
          <Column sm={4} md={8} lg={16}>
            <section className={styles.flowSection}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.sectionEyebrow}>
                    Integration flow
                  </p>

                  <h2>Where IBM Bob sits in the release path</h2>
                </div>

                <Tag type="green" size="sm">
                  Bob active
                </Tag>
              </div>

              <div className={styles.flowGrid}>
                {FLOW.map((step, index) => {
                  const Icon = step.icon

                  return (
                    <article
                      key={step.id}
                      className={
                        step.id === 'bob'
                          ? styles.flowCardActive
                          : styles.flowCard
                      }
                    >
                      <div className={styles.flowHeader}>
                        <span className={styles.flowIndex}>
                          {step.number}
                        </span>

                        {index < FLOW.length - 1 && (
                          <span
                            className={styles.flowConnector}
                            aria-hidden="true"
                          />
                        )}
                      </div>

                      <div className={styles.flowIcon}>
                        <Icon size={22} />
                      </div>

                      <h3>{step.title}</h3>

                      <p>{step.description}</p>

                      {step.id === 'bob' && (
                        <div className={styles.flowActiveState}>
                          <span aria-hidden="true" />
                          Connected agent
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            </section>
          </Column>

          {/* ── Integration catalog ─────────────────────────────────── */}
          <Column sm={4} md={8} lg={16}>
            <section className={styles.catalogSection}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.sectionEyebrow}>
                    Connector catalog
                  </p>

                  <h2>Release systems</h2>
                </div>

                <p>
                  Current and proposed touchpoints around the IBM Bob
                  release-readiness workflow.
                </p>
              </div>

              <div className={styles.integrationGrid}>
                {INTEGRATIONS.map((integration) => {
                  const Icon = integration.icon

                  return (
                    <article
                      key={integration.id}
                      className={
                        integration.primary
                          ? styles.integrationCardPrimary
                          : styles.integrationCard
                      }
                    >
                      <div className={styles.integrationHeader}>
                        <div className={styles.integrationIdentity}>
                          <span className={styles.integrationIcon}>
                            <Icon size={22} />
                          </span>

                          <div>
                            <h3>{integration.name}</h3>

                            <span className={styles.integrationCategory}>
                              {integration.category}
                            </span>
                          </div>
                        </div>

                        <Tag
                          type={
                            integration.primary
                              ? 'green'
                              : 'cool-gray'
                          }
                          size="sm"
                        >
                          {integration.status}
                        </Tag>
                      </div>

                      <p className={styles.integrationDescription}>
                        {integration.description}
                      </p>

                      <div className={styles.capabilityList}>
                        {integration.capabilities.map((capability) => (
                          <div
                            key={capability}
                            className={styles.capabilityItem}
                          >
                            <CheckmarkFilled size={14} />
                            <span>{capability}</span>
                          </div>
                        ))}
                      </div>

                      <div className={styles.integrationFooter}>
                        <span>
                          {integration.primary
                            ? 'Active in this demo'
                            : 'Production extension point'}
                        </span>

                        {integration.primary ? (
                          <div className={styles.liveState}>
                            <span aria-hidden="true" />
                            Live
                          </div>
                        ) : (
                          <Button
                            kind="ghost"
                            size="sm"
                            disabled
                            renderIcon={Settings}
                          >
                            Configure
                          </Button>
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          </Column>

          {/* ── IBM Bob integration detail ──────────────────────────── */}
          <Column sm={4} md={8} lg={16}>
            <section className={styles.bobPanel}>
              <div className={styles.bobPanelIdentity}>
                <div className={styles.bobPanelIcon}>
                  <IbmWatsonMachineLearning size={28} />
                </div>

                <div>
                  <p className={styles.bobPanelEyebrow}>
                    Active integration
                  </p>

                  <h2>IBM Bob</h2>

                  <p>
                    The demo backend invokes IBM Bob to analyze uploaded
                    release artifacts and perform targeted remediation.
                  </p>
                </div>
              </div>

              <div className={styles.bobCapabilities}>
                <div>
                  <span>01</span>
                  <strong>Analyze</strong>
                  <p>
                    Read the release contract and inspect repository evidence.
                  </p>
                </div>

                <div>
                  <span>02</span>
                  <strong>Verify</strong>
                  <p>
                    Confirm candidate mismatches before publishing findings.
                  </p>
                </div>

                <div>
                  <span>03</span>
                  <strong>Remediate</strong>
                  <p>
                    Apply targeted repository changes for supported findings.
                  </p>
                </div>
              </div>
            </section>
          </Column>

          {/* ── Integration narrative footer ────────────────────────── */}
          <Column sm={4} md={8} lg={16}>
            <section className={styles.bobFooter}>
              <div className={styles.bobFooterIcon}>
                <Api size={22} />
              </div>

              <div>
                <p className={styles.bobFooterEyebrow}>
                  Integration architecture
                </p>

                <h2>
                  IBM Bob at the center, release systems around it.
                </h2>
              </div>

              <p>
                The demo proves the agent workflow today while keeping a clear
                path to source-control, CI/CD, and cloud connectors later.
              </p>
            </section>
          </Column>
        </Grid>
      </div>
    </div>
  )
}
