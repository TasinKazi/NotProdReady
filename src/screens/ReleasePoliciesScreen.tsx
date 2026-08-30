import {
  Accordion,
  AccordionItem,
  Column,
  Grid,
  Tag,
  Toggle,
} from '@carbon/react'
import {
  CheckmarkFilled,
  Code,
  DataStructured,
  IbmWatsonMachineLearning,
  Information,
  Launch,
  Locked,
  SecurityServices,
  Settings,
  WarningAlt,
} from '@carbon/icons-react'
import styles from './ReleasePoliciesScreen.module.scss'

/* ── Demo release policy catalog ───────────────────────────────────── */

const POLICIES = [
  {
    id: 'runtime',
    title: 'Runtime compatibility',
    description:
      'Validates that the application runtime version declared in the runbook matches the version in the repository manifest (package.json, .nvmrc, Pipfile, pom.xml, etc.).',
    enabled: true,
    category: 'Runtime',
    severity: 'BLOCK capable',
    icon: Code,
    rules: [
      'Runtime version must be explicitly declared',
      'Minor version drift (±1) triggers a warning',
      'Major version mismatch triggers a blocker',
    ],
  },
  {
    id: 'envvars',
    title: 'Required environment variables',
    description:
      'Checks that all environment variables referenced in application code are declared in the deployment runbook and have non-empty values for the target environment.',
    enabled: true,
    category: 'Configuration',
    severity: 'BLOCK capable',
    icon: Settings,
    rules: [
      'All referenced env vars must appear in runbook',
      'Secret vars (e.g. *_SECRET, *_KEY) must be masked, not absent',
      'Missing vars in production trigger a blocker',
    ],
  },
  {
    id: 'deploy-cmds',
    title: 'Deployment commands',
    description:
      'Verifies that deployment commands in the runbook are valid, include the correct environment flags, and match expected patterns for the detected framework.',
    enabled: true,
    category: 'Deployment',
    severity: 'BLOCK capable',
    icon: Launch,
    rules: [
      'Deploy scripts must specify target environment',
      'No interactive prompts allowed in automated deploy',
      'Rollback commands must follow deploy commands',
    ],
  },
  {
    id: 'health',
    title: 'Health checks',
    description:
      'Confirms that a health check endpoint is defined in the runbook and that the application exposes a reachable health route.',
    enabled: true,
    category: 'Verification',
    severity: 'WARN / BLOCK',
    icon: CheckmarkFilled,
    rules: [
      'Health endpoint must be declared',
      'HTTP 200 response expected within 30s of startup',
      'Liveness and readiness probes recommended',
    ],
  },
  {
    id: 'migration',
    title: 'Migration requirements',
    description:
      'Ensures database migration steps are documented and that migration scripts are present in the repository.',
    enabled: true,
    category: 'Database',
    severity: 'BLOCK capable',
    icon: DataStructured,
    rules: [
      'Migration scripts must be present if schema changes detected',
      'Rollback migration must be documented',
      'Zero-downtime migration preferred for production',
    ],
  },
  {
    id: 'rollback',
    title: 'Rollback requirements',
    description:
      'Validates that a documented rollback procedure is present and references the prior stable version.',
    enabled: true,
    category: 'Recovery',
    severity: 'BLOCK capable',
    icon: SecurityServices,
    rules: [
      'Rollback steps must be explicitly listed',
      'Prior version tag or artifact must be referenced',
      'Rollback must not require manual data intervention',
    ],
  },
  {
    id: 'threshold',
    title: 'Production readiness threshold',
    description:
      'Sets the minimum readiness score required for a GO decision. Analyses scoring below the threshold are automatically marked NO-GO.',
    enabled: true,
    category: 'Decision',
    severity: 'Decision control',
    icon: WarningAlt,
    rules: [
      'Default threshold: 75 / 100',
      'Score below threshold → NO-GO decision',
      'Score ≥ threshold with zero blockers → GO decision',
    ],
  },
]

/* ── Release policies screen ───────────────────────────────────────── */

export default function ReleasePoliciesScreen() {
  const enabledCount = POLICIES.filter(
    (policy) => policy.enabled,
  ).length

  return (
    <div className={styles.page}>
      {/* ── Page hero ───────────────────────────────────────────────── */}
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <div className={styles.eyebrowRow}>
              <span className={styles.eyebrow}>
                Release governance
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
                IBM Bob policy engine
              </span>
            </div>

            <h1 className={styles.heading}>
              Release policies
            </h1>

            <p className={styles.heroDescription}>
              Governance rules define what IBM Bob verifies before it
              publishes a grounded GO / NO-GO release-readiness decision.
            </p>
          </div>

          <div className={styles.heroMode}>
            <Locked size={22} />

            <div>
              <span className={styles.heroModeLabel}>
                Demo configuration
              </span>

              <span className={styles.heroModeMeta}>
                Read-only policy catalog
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Page content ─────────────────────────────────────────────── */}
      <div className={styles.content}>
        <Grid fullWidth>
          {/* ── Policy catalog notice ───────────────────────────────── */}
          <Column sm={4} md={8} lg={16}>
            <div className={styles.demoNotice}>
              <Information
                size={18}
                className={styles.demoNoticeIcon}
              />

              <div>
                <strong>
                  Demonstration policy configuration
                </strong>

                <p>
                  Policies are read-only in this environment. A production
                  implementation could manage policy configuration through
                  IBM Bob integrations or CI/CD governance workflows.
                </p>
              </div>

              <Tag type="blue" size="sm">
                Read only
              </Tag>
            </div>
          </Column>

          {/* ── Policy posture ───────────────────────────────────────── */}
          <Column sm={4} md={8} lg={16}>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.sectionEyebrow}>
                  Governance posture
                </p>

                <h2>Active release controls</h2>
              </div>

              <p>
                Bob evaluates enabled controls against the release contract
                and repository evidence.
              </p>
            </div>
          </Column>

          <Column sm={4} md={4} lg={4}>
            <article
              className={`${styles.metric} ${styles.metricBlue}`}
            >
              <SecurityServices size={20} />

              <span className={styles.metricLabel}>
                Policies configured
              </span>

              <strong className={styles.metricValue}>
                {POLICIES.length}
              </strong>

              <span className={styles.metricMeta}>
                Release-readiness controls
              </span>
            </article>
          </Column>

          <Column sm={4} md={4} lg={4}>
            <article
              className={`${styles.metric} ${styles.metricGreen}`}
            >
              <CheckmarkFilled size={20} />

              <span className={styles.metricLabel}>
                Policies enabled
              </span>

              <strong className={styles.metricValue}>
                {enabledCount}
              </strong>

              <span className={styles.metricMeta}>
                Applied to analysis runs
              </span>
            </article>
          </Column>

          <Column sm={4} md={4} lg={4}>
            <article
              className={`${styles.metric} ${styles.metricPurple}`}
            >
              <IbmWatsonMachineLearning size={20} />

              <span className={styles.metricLabel}>
                Readiness threshold
              </span>

              <div className={styles.metricScoreRow}>
                <strong className={styles.metricValue}>
                  75
                </strong>

                <span className={styles.metricDenominator}>
                  /100
                </span>
              </div>

              <span className={styles.metricMeta}>
                Default GO threshold
              </span>
            </article>
          </Column>

          <Column sm={4} md={4} lg={4}>
            <article
              className={`${styles.metric} ${styles.metricRed}`}
            >
              <WarningAlt size={20} />

              <span className={styles.metricLabel}>
                Blocking rule
              </span>

              <strong className={styles.metricValue}>
                1
              </strong>

              <span className={styles.metricMeta}>
                Confirmed blocker can force NO-GO
              </span>
            </article>
          </Column>

          {/* ── Policy catalog ───────────────────────────────────────── */}
          <Column sm={4} md={8} lg={11}>
            <section className={styles.policySection}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.sectionEyebrow}>
                    Policy catalog
                  </p>

                  <h2>Controls IBM Bob evaluates</h2>
                </div>

                <Tag type="green" size="sm">
                  {enabledCount} enabled
                </Tag>
              </div>

              <Accordion className={styles.accordion}>
                {POLICIES.map((policy, index) => {
                  const Icon = policy.icon

                  return (
                    <AccordionItem
                      key={policy.id}
                      className={styles.accordionItem}
                      title={
                        <div className={styles.accordionTitle}>
                          <span className={styles.policyIndex}>
                            {String(index + 1).padStart(2, '0')}
                          </span>

                          <span className={styles.policyIcon}>
                            <Icon size={18} />
                          </span>

                          <span className={styles.policyTitleCopy}>
                            <span className={styles.policyName}>
                              {policy.title}
                            </span>

                            <span className={styles.policyMeta}>
                              {policy.category} · {policy.severity}
                            </span>
                          </span>

                          <Tag
                            type="cool-gray"
                            size="sm"
                            className={styles.policyStateTag}
                          >
                            Enabled
                          </Tag>

                          <Toggle
                            id={`toggle-${policy.id}`}
                            size="sm"
                            toggled={policy.enabled}
                            labelA="Off"
                            labelB="On"
                            hideLabel
                            readOnly
                            onClick={(
                              event: React.MouseEvent,
                            ) => event.stopPropagation()}
                          />
                        </div>
                      }
                    >
                      <div className={styles.policyBody}>
                        <p className={styles.policyDesc}>
                          {policy.description}
                        </p>

                        <div className={styles.rulesList}>
                          <p className={styles.rulesHeading}>
                            Evaluation rules
                          </p>

                          <ul>
                            {policy.rules.map((rule, ruleIndex) => (
                              <li
                                key={ruleIndex}
                                className={styles.ruleItem}
                              >
                                <CheckmarkFilled size={14} />
                                <span>{rule}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </AccordionItem>
                  )
                })}
              </Accordion>
            </section>
          </Column>

          {/* ── IBM Bob policy engine ───────────────────────────────── */}
          <Column sm={4} md={8} lg={5}>
            <aside className={styles.enginePanel}>
              <div className={styles.engineHeader}>
                <IbmWatsonMachineLearning size={26} />

                <div>
                  <span className={styles.engineLabel}>
                    IBM Bob
                  </span>

                  <span className={styles.engineMeta}>
                    Policy evaluation
                  </span>
                </div>

                <span
                  className={styles.engineDot}
                  aria-hidden="true"
                />
              </div>

              <div className={styles.engineIntro}>
                <p className={styles.engineEyebrow}>
                  Decision control
                </p>

                <h2>
                  Policies shape the release decision.
                </h2>

                <p>
                  Bob uses these controls to determine which mismatches
                  should become PASS, WARN, or BLOCK findings.
                </p>
              </div>

              <div className={styles.engineFlow}>
                <div className={styles.engineStep}>
                  <span>01</span>

                  <div>
                    <strong>Read policy</strong>
                    <p>
                      Determine the release condition Bob must evaluate.
                    </p>
                  </div>
                </div>

                <div className={styles.engineStep}>
                  <span>02</span>

                  <div>
                    <strong>Compare evidence</strong>
                    <p>
                      Match runbook requirements with repository evidence.
                    </p>
                  </div>
                </div>

                <div className={styles.engineStep}>
                  <span>03</span>

                  <div>
                    <strong>Classify finding</strong>
                    <p>
                      Publish PASS, WARN, or BLOCK only after verification.
                    </p>
                  </div>
                </div>

                <div className={styles.engineStep}>
                  <span>04</span>

                  <div>
                    <strong>Issue decision</strong>
                    <p>
                      Apply blocker and score rules to the final GO / NO-GO.
                    </p>
                  </div>
                </div>
              </div>

              <div className={styles.overridePanel}>
                <Locked size={16} />

                <div>
                  <strong>Overrides disabled in demo</strong>

                  <p>
                    A production policy service could support controlled
                    overrides with audit logging and environment scope.
                  </p>
                </div>
              </div>
            </aside>
          </Column>

          {/* ── Governance narrative footer ─────────────────────────── */}
          <Column sm={4} md={8} lg={16}>
            <section className={styles.bobFooter}>
              <div className={styles.bobFooterIcon}>
                <SecurityServices size={22} />
              </div>

              <div>
                <p className={styles.bobFooterEyebrow}>
                  Release governance
                </p>

                <h2>
                  Consistent controls before production, evidence-backed
                  decisions when it matters.
                </h2>
              </div>

              <p>
                NotProdReady makes the release criteria visible so operators
                can understand the rules behind IBM Bob’s decision.
              </p>
            </section>
          </Column>
        </Grid>
      </div>
    </div>
  )
}
