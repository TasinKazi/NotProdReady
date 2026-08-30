import { useState } from 'react'
import {
  Button,
  Form,
  InlineNotification,
  TextInput,
} from '@carbon/react'
import {
  CheckmarkFilled,
  Code,
  IbmWatsonMachineLearning,
  SecurityServices,
} from '@carbon/icons-react'
import styles from './LoginScreen.module.scss'

interface Props {
  onLogin: (email: string) => void
}

/* ── Product capability summary ────────────────────────────────────── */

const CAPABILITIES = [
  {
    id: 'analyze',
    label: 'Analyze release artifacts',
    description:
      'IBM Bob compares deployment expectations with repository implementation.',
    icon: IbmWatsonMachineLearning,
  },
  {
    id: 'verify',
    label: 'Verify release blockers',
    description:
      'Findings are grounded in evidence before a GO / NO-GO decision is published.',
    icon: SecurityServices,
  },
  {
    id: 'remediate',
    label: 'Remediate repository findings',
    description:
      'Bob can apply targeted code changes and produce a downloadable remediated repository.',
    icon: Code,
  },
]

/* ── Login screen ──────────────────────────────────────────────────── */

export default function LoginScreen({ onLogin }: Props) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)

  /* ── Demo authentication ─────────────────────────────────────────── */

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const normalizedEmail = email.trim()

    if (!normalizedEmail) {
      setError('Enter your email address to continue.')
      return
    }

    if (!normalizedEmail.includes('@')) {
      setError('Enter a valid email address.')
      return
    }

    setError(null)
    onLogin(normalizedEmail)
  }

  return (
    <main className={styles.page}>
      {/* ── Product identity panel ──────────────────────────────────── */}
      <section className={styles.productPanel}>
        <div className={styles.productPanelInner}>
          <div className={styles.brandRow}>
            <span className={styles.brandName}>NorthRiver Bank</span>

            <span
              className={styles.brandDivider}
              aria-hidden="true"
            />

            <span className={styles.productName}>NotProdReady</span>
          </div>

          <div className={styles.productHero}>
            <p className={styles.eyebrow}>
              Release readiness · Powered by IBM Bob
            </p>

            <h1>NotProdReady</h1>

            <p className={styles.heroDescription}>
              Release readiness before production. IBM Bob gives teams an
              evidence-backed view of deployment risk before a change reaches
              production.
            </p>
          </div>

          {/* ── IBM Bob capability trail ────────────────────────────── */}
          <div className={styles.capabilityList}>
            {CAPABILITIES.map((capability, index) => {
              const Icon = capability.icon

              return (
                <article
                  key={capability.id}
                  className={styles.capabilityItem}
                >
                  <span className={styles.capabilityIndex}>
                    {String(index + 1).padStart(2, '0')}
                  </span>

                  <span className={styles.capabilityIcon}>
                    <Icon size={20} />
                  </span>

                  <div>
                    <h2>{capability.label}</h2>
                    <p>{capability.description}</p>
                  </div>

                  <CheckmarkFilled
                    size={16}
                    className={styles.capabilityCheck}
                  />
                </article>
              )
            })}
          </div>

          <div className={styles.productFooter}>
            <IbmWatsonMachineLearning size={20} />

            <div>
              <strong>IBM Bob agent workflow</strong>
              <span>
                Analyze · Verify · Remediate
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Sign-in panel ───────────────────────────────────────────── */}
      <section className={styles.loginPanel}>
        <div className={styles.loginCard}>
          <div className={styles.loginHeader}>
            <p className={styles.loginEyebrow}>
              NorthRiver Bank
            </p>

            <h2>Sign in to NotProdReady</h2>

            <p>
              Access release-readiness analysis and IBM Bob remediation
              workflows.
            </p>
          </div>

          {error && (
            <InlineNotification
              kind="error"
              title="Sign in could not continue"
              subtitle={error}
              lowContrast
              hideCloseButton
            />
          )}

          <Form
            className={styles.form}
            onSubmit={handleSubmit}
          >
            <TextInput
              id="login-email"
              type="email"
              labelText="Work email"
              placeholder="name@northriverbank.com"
              value={email}
              onChange={(
                event: React.ChangeEvent<HTMLInputElement>,
              ) => {
                setEmail(event.target.value)

                if (error) {
                  setError(null)
                }
              }}
            />

            <Button
              type="submit"
              kind="primary"
              size="lg"
              className={styles.continueButton}
            >
              Continue
            </Button>
          </Form>

          {/* ── Demo environment note ───────────────────────────────── */}
          <div className={styles.demoNote}>
            <SecurityServices size={16} />

            <div>
              <strong>Demo authentication</strong>

              <p>
                This competition build uses lightweight sign-in to enter the
                product experience. Release analysis is performed by the
                backend IBM Bob workflow.
              </p>
            </div>
          </div>

          <div className={styles.loginFooter}>
            <span>NorthRiver Bank | NotProdReady</span>
            <span>Release readiness with IBM Bob</span>
          </div>
        </div>
      </section>
    </main>
  )
}
