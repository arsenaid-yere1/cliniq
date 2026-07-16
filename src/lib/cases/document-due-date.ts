import { addDays, differenceInCalendarDays, parseISO } from 'date-fns'

export const DOCUMENT_DUE_OFFSET_DAYS = 7
export const DUE_SOON_WINDOW_DAYS = 3

export type DueStatus = 'overdue' | 'due_soon' | 'on_track'

export interface DocumentDueDate {
  dueDate: Date
  status: DueStatus
  /** Calendar days until due; negative if overdue. */
  daysUntilDue: number
}

/**
 * Document-to-lawyer due date, derived from the discharge visit date.
 * `visitDate` is a 'YYYY-MM-DD' date string (discharge_notes.visit_date) or null.
 * `today` is injectable for testing; defaults to now.
 * Returns null when there is no discharge visit date.
 */
export function computeDocumentDueDate(
  visitDate: string | null | undefined,
  today: Date = new Date(),
): DocumentDueDate | null {
  if (!visitDate) return null
  // Parse as local midnight to match the MM/dd/yyyy rendering used elsewhere.
  const visit = parseISO(`${visitDate}T00:00:00`)
  if (Number.isNaN(visit.getTime())) return null

  const dueDate = addDays(visit, DOCUMENT_DUE_OFFSET_DAYS)
  const daysUntilDue = differenceInCalendarDays(dueDate, today)

  const status: DueStatus =
    daysUntilDue < 0 ? 'overdue' : daysUntilDue <= DUE_SOON_WINDOW_DAYS ? 'due_soon' : 'on_track'

  return { dueDate, status, daysUntilDue }
}

export const DUE_STATUS_CONFIG: Record<DueStatus, { label: string; color: string }> = {
  overdue:  { label: 'Overdue',  color: 'bg-red-100 text-red-800 border-red-200' },
  due_soon: { label: 'Due soon', color: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  on_track: { label: 'On track', color: 'bg-gray-100 text-gray-700 border-gray-200' },
}
