import {
  Button,
  Column,
  DataTable,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TableToolbar,
  TableToolbarContent,
  Tag,
} from '@carbon/react'
import { Add, ArrowRight, CheckmarkFilled, ErrorFilled } from '@carbon/icons-react'
import type { ViewId } from '../types/navigation'
import { mockHistory } from '../data/mockHistory'
import styles from './OverviewScreen.module.scss'

interface Props {
  onNavigate: (view: ViewId) => void
}

const headers = [
  { key: 'app', header: 'Application' },
  { key: 'release', header: 'Release' },
  { key: 'environment', header: 'Environment' },
  { key: 'decision', header: 'Decision' },
  { key: 'blockers', header: 'Blockers' },
  { key: 'score', header: 'Score' },
  { key: 'completedAt', header: 'Completed' },
]

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export default function OverviewScreen({ onNavigate }: Props) {
  const rows = mockHistory.map((r) => ({
    id: r.id,
    app: r.app,
    release: r.release,
    environment: r.environment,
    decision: r.decision,
    blockers: r.blockers,
    score: r.score,
    completedAt: formatDate(r.completedAt),
  }))

  return (
    <div className={styles.page}>
      <Grid narrow>
        {/* Page title */}
        <Column sm={4} md={8} lg={16}>
          <div className={styles.titleRow}>
            <div>
              <h1 className={styles.heading}>Release readiness</h1>
              <p className={styles.tagline}>Find out before production does.</p>
            </div>
            <Button
              kind="primary"
              renderIcon={Add}
              onClick={() => onNavigate('new-analysis')}
            >
              New analysis
            </Button>
          </div>
        </Column>

        {/* Recent analyses */}
        <Column sm={4} md={8} lg={16}>
          <DataTable rows={rows} headers={headers} isSortable>
            {({
              rows: tableRows,
              headers: tableHeaders,
              getTableProps,
              getHeaderProps,
              getRowProps,
              getTableContainerProps,
            }) => (
              <TableContainer
                title="Recent analyses"
                description="Click a row to view the full report."
                {...getTableContainerProps()}
              >
                <TableToolbar>
                  <TableToolbarContent>
                    <Button
                      kind="ghost"
                      renderIcon={Add}
                      size="sm"
                      onClick={() => onNavigate('new-analysis')}
                    >
                      New analysis
                    </Button>
                  </TableToolbarContent>
                </TableToolbar>
                <Table {...getTableProps()} className={styles.table}>
                  <TableHead>
                    <TableRow>
                      {tableHeaders.map((header) => (
                        <TableHeader {...getHeaderProps({ header })}>
                          {header.header}
                        </TableHeader>
                      ))}
                      <TableHeader />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {tableRows.map((row) => {
                      const record = mockHistory.find((r) => r.id === row.id)!
                      return (
                        <TableRow
                          {...getRowProps({ row })}
                          className={styles.tableRow}
                          onClick={() => onNavigate('analysis-result')}
                        >
                          <TableCell>{record.app}</TableCell>
                          <TableCell>
                            <code className={styles.releaseCode}>{record.release}</code>
                          </TableCell>
                          <TableCell>{record.environment}</TableCell>
                          <TableCell>
                            {record.decision === 'GO' ? (
                              <span className={styles.decisionGo}>
                                <CheckmarkFilled size={16} />
                                GO
                              </span>
                            ) : (
                              <span className={styles.decisionNogo}>
                                <ErrorFilled size={16} />
                                NO-GO
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            {record.blockers > 0 ? (
                              <Tag type="red" size="sm">{record.blockers} blocker{record.blockers !== 1 ? 's' : ''}</Tag>
                            ) : (
                              <Tag type="green" size="sm">None</Tag>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className={record.score >= 80 ? styles.scoreHigh : record.score >= 60 ? styles.scoreMid : styles.scoreLow}>
                              {record.score}
                            </span>
                          </TableCell>
                          <TableCell>{formatDate(record.completedAt)}</TableCell>
                          <TableCell>
                            <Button
                              kind="ghost"
                              size="sm"
                              renderIcon={ArrowRight}
                              iconDescription="View report"
                              onClick={(e: React.MouseEvent) => {
                                e.stopPropagation()
                                onNavigate('analysis-result')
                              }}
                            >
                              View
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </DataTable>
        </Column>
      </Grid>
    </div>
  )
}
