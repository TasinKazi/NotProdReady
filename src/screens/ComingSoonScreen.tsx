import { Column, Grid, Tile } from '@carbon/react'
import { Time } from '@carbon/icons-react'
import styles from './ComingSoonScreen.module.scss'

interface Props {
  title: string
}

export default function ComingSoonScreen({ title }: Props) {
  return (
    <div className={styles.page}>
      <Grid narrow>
        <Column sm={4} md={6} lg={8}>
          <Tile className={styles.tile}>
            <Time size={32} className={styles.icon} />
            <h1 className={styles.heading}>{title}</h1>
            <p className={styles.body}>
              This feature is coming soon. The current build focuses on release readiness analysis.
            </p>
          </Tile>
        </Column>
      </Grid>
    </div>
  )
}
