import {
  StructuredListWrapper,
  StructuredListHead,
  StructuredListRow,
  StructuredListCell,
  StructuredListBody,
  Tag,
} from '@carbon/react'
import { CheckmarkFilled, WarningFilled, ErrorFilled } from '@carbon/icons-react'
import type { AgentStep } from '../../data/mockAnalysis'
import styles from './AgentActivityTab.module.scss'

interface Props {
  activity: AgentStep[]
}

function StatusIcon({ status }: { status: AgentStep['status'] }) {
  if (status === 'error') return <ErrorFilled size={16} className={styles.iconError} />
  if (status === 'warn') return <WarningFilled size={16} className={styles.iconWarn} />
  return <CheckmarkFilled size={16} className={styles.iconOk} />
}

function StatusTag({ status }: { status: AgentStep['status'] }) {
  if (status === 'error') return <Tag type="red" size="sm">error</Tag>
  if (status === 'warn') return <Tag type="warm-gray" size="sm">warn</Tag>
  return <Tag type="green" size="sm">ok</Tag>
}

export default function AgentActivityTab({ activity }: Props) {
  return (
    <div className={styles.root}>
      <p className={styles.preamble}>
        Sequential tool calls issued by IBM Bob during this analysis run.
      </p>
      <StructuredListWrapper>
        <StructuredListHead>
          <StructuredListRow head>
            <StructuredListCell head>#</StructuredListCell>
            <StructuredListCell head>Timestamp</StructuredListCell>
            <StructuredListCell head>Action</StructuredListCell>
            <StructuredListCell head>Target</StructuredListCell>
            <StructuredListCell head>Result</StructuredListCell>
            <StructuredListCell head>Status</StructuredListCell>
          </StructuredListRow>
        </StructuredListHead>
        <StructuredListBody>
          {activity.map((step, idx) => (
            <StructuredListRow key={step.id}>
              <StructuredListCell>
                <span className={styles.stepNum}>{idx + 1}</span>
              </StructuredListCell>
              <StructuredListCell>
                <code className={styles.timestamp}>{step.timestamp}</code>
              </StructuredListCell>
              <StructuredListCell>
                <code className={styles.action}>{step.action}</code>
              </StructuredListCell>
              <StructuredListCell>
                <code className={styles.target}>{step.target}</code>
              </StructuredListCell>
              <StructuredListCell>
                <span className={styles.result}>{step.result}</span>
              </StructuredListCell>
              <StructuredListCell>
                <div className={styles.statusCell}>
                  <StatusIcon status={step.status} />
                  <StatusTag status={step.status} />
                </div>
              </StructuredListCell>
            </StructuredListRow>
          ))}
        </StructuredListBody>
      </StructuredListWrapper>
    </div>
  )
}
