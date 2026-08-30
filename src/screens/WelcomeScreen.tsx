import { useEffect } from 'react'
import { Button } from '@carbon/react'
import { ArrowRight } from '@carbon/icons-react'
import type { ViewId } from '../types/navigation'
import styles from './WelcomeScreen.module.scss'

interface Props {
  userName: string
  onContinue: () => void
  onNavigate: (view: ViewId) => void
}

export default function WelcomeScreen({ userName, onContinue }: Props) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onContinue()
    }, 3000)
    return () => clearTimeout(timer)
  }, [onContinue])

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <p className={styles.eyebrow}>NorthRiver Bank · NotProdReady</p>
        <h1 className={styles.heading}>
          Welcome back, {userName}.
        </h1>
        <p className={styles.subheading}>
          Release readiness intelligence is ready.
        </p>
        <div className={styles.actions}>
          <Button
            kind="primary"
            renderIcon={ArrowRight}
            onClick={onContinue}
            className={styles.continueBtn}
          >
            Continue to overview
          </Button>
        </div>
        <p className={styles.autoNote}>Redirecting automatically in 3 seconds…</p>
      </div>
      <p className={styles.poweredBy}>Powered by IBM Bob</p>
    </div>
  )
}
