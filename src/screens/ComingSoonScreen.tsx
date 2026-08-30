import { Column, Grid, Tile } from '@carbon/react'
import { Time } from '@carbon/icons-react'
import styles from './ComingSoonScreen.module.scss'

interface Props {
  title: string
}

export default function ComingSoonScreen({ title }: Props) {
  return (
    <div className={styles.page}>
      <Grid>
        <Column sm={4} md={6} lg={8}>
          <Tile className={styles.tile}>
            <Time size={24} className={styles.icon} />
            <h1 className={styles.heading}>{title}</h1>
            <p className={styles.body}>
              This feature is under development. The current release focuses on
              automated release readiness analysis with AI remediation.
            </p>
          </Tile>
        </Column>
      </Grid>
    </div>
  )
}
