import {
  DataTable,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
} from '@carbon/react'
import { CheckmarkFilled, WarningFilled, ErrorFilled } from '@carbon/icons-react'
import type { AgentStep } from '../../data/mockAnalysis'
import { formatTimestamp } from '../../utils/formatters'
import styles from './AgentActivityTab.module.scss'

interface Props {
  activity: AgentStep[]
}

const headers = [
  { key: 'num', header: '#' },
  { key: 'timestamp', header: 'Timestamp' },
  { key: 'action', header: 'Action' },
  { key: 'target', header: 'Target' },
  { key: 'result', header: 'Result' },
  { key: 'status', header: 'Status' },
]

export default function AgentActivityTab({ activity }: Props) {
  const rows = activity.map((s, i) => ({
    id: s.id,
    num: String(i + 1),
    timestamp: s.timestamp,
    action: s.action,
    target: s.target,
    result: s.result,
    status: s.status,
  }))

  return (
    <div className={styles.root}>
      <p className={styles.preamble}>
        Sequential tool calls issued by IBM Bob during this analysis run.
      </p>
      <DataTable rows={rows} headers={headers}>
        {({ rows: tableRows, headers: tableHeaders, getTableProps, getHeaderProps, getRowProps, getTableContainerProps }) => (
          <TableContainer {...getTableContainerProps()}>
            <Table {...getTableProps()} size="sm">
              <TableHead>
                <TableRow>
                  {tableHeaders.map((header) => {
                    const hProps = getHeaderProps({ header })
                    return (
                      <TableHeader {...hProps}>
                        {header.header}
                      </TableHeader>
                    )
                  })}
                </TableRow>
              </TableHead>
              <TableBody>
                {tableRows.map((row) => {
                  const step = activity.find((s) => s.id === row.id)!
                  const rowProps = getRowProps({ row })
                  return (
                    <TableRow {...rowProps}>
                      <TableCell>
                        <span className={styles.stepNum}>{row.cells[0].value}</span>
                      </TableCell>
                      <TableCell>
                        <code className={styles.timestamp}>{formatTimestamp(step.timestamp)}</code>
                      </TableCell>
                      <TableCell>
                        <code className={styles.action}>{step.action}</code>
                      </TableCell>
                      <TableCell>
                        <code className={styles.target}>{step.target}</code>
                      </TableCell>
                      <TableCell>
                        <span className={styles.result}>{step.result}</span>
                      </TableCell>
                      <TableCell>
                        <div className={styles.statusCell}>
                          {step.status === 'error' ? (
                            <><ErrorFilled size={14} className={styles.iconError} /><Tag type="red" size="sm">error</Tag></>
                          ) : step.status === 'warn' ? (
                            <><WarningFilled size={14} className={styles.iconWarn} /><Tag type="warm-gray" size="sm">warn</Tag></>
                          ) : (
                            <><CheckmarkFilled size={14} className={styles.iconOk} /><Tag type="green" size="sm">ok</Tag></>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DataTable>
    </div>
  )
}
