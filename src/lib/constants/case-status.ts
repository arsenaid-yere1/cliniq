export const CASE_STATUSES = ['intake', 'active', 'pending_settlement', 'closed', 'archived'] as const
export type CaseStatus = (typeof CASE_STATUSES)[number]

export const CASE_STATUS_CONFIG: Record<CaseStatus, {
  label: string
  color: string
  variant: 'default' | 'secondary' | 'outline'
}> = {
  intake:             { label: 'Intake',             color: 'bg-blue-100 text-blue-800 border-blue-200',     variant: 'default' },
  active:             { label: 'Active',             color: 'bg-green-100 text-green-800 border-green-200',  variant: 'default' },
  pending_settlement: { label: 'Pending Settlement', color: 'bg-yellow-100 text-yellow-800 border-yellow-200', variant: 'secondary' },
  closed:             { label: 'Closed',             color: 'bg-gray-100 text-gray-800 border-gray-200',     variant: 'secondary' },
  archived:           { label: 'Archived',           color: 'bg-gray-50 text-gray-500 border-gray-200',      variant: 'outline' },
}

export const CASE_STATUS_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  intake:             ['active', 'closed'],
  active:             ['pending_settlement', 'closed'],
  pending_settlement: ['closed', 'active'],
  closed:             ['active', 'archived'],
  archived:           ['closed'],
}

export const LOCKED_STATUSES: CaseStatus[] = ['pending_settlement', 'closed', 'archived']
