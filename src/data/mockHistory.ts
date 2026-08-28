export interface HistoryRecord {
  id: string
  app: string
  release: string
  environment: string
  decision: 'GO' | 'NO-GO'
  blockers: number
  score: number
  completedAt: string
}

export const mockHistory: HistoryRecord[] = [
  {
    id: 'bob-analysis-20250114-094215',
    app: 'NorthRiver Payments API',
    release: 'v2.3.8',
    environment: 'Production',
    decision: 'GO',
    blockers: 0,
    score: 97,
    completedAt: '2025-01-14T09:42:15Z',
  },
  {
    id: 'bob-analysis-20250113-141022',
    app: 'Digital Banking Gateway',
    release: 'v5.12.1',
    environment: 'Production',
    decision: 'NO-GO',
    blockers: 2,
    score: 54,
    completedAt: '2025-01-13T14:10:22Z',
  },
  {
    id: 'bob-analysis-20250112-083511',
    app: 'Customer Profile API',
    release: 'v4.8.0',
    environment: 'Staging',
    decision: 'GO',
    blockers: 0,
    score: 91,
    completedAt: '2025-01-12T08:35:11Z',
  },
]
