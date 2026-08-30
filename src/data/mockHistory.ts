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
    id: 'bob-analysis-20260829-094215',
    app: 'NorthRiver Payments API',
    release: 'v2.3.8',
    environment: 'Production',
    decision: 'GO',
    blockers: 0,
    score: 97,
    completedAt: '2026-08-29T09:42:15Z',
  },
  {
    id: 'bob-analysis-20260828-141022',
    app: 'Digital Banking Gateway',
    release: 'v5.12.1',
    environment: 'Production',
    decision: 'NO-GO',
    blockers: 2,
    score: 54,
    completedAt: '2026-08-28T14:10:22Z',
  },
  {
    id: 'bob-analysis-20260827-083511',
    app: 'Customer Profile API',
    release: 'v4.8.0',
    environment: 'Staging',
    decision: 'GO',
    blockers: 0,
    score: 91,
    completedAt: '2026-08-27T08:35:11Z',
  },
]
