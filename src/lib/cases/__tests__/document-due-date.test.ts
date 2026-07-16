import { describe, it, expect } from 'vitest'
import { computeDocumentDueDate } from '../document-due-date'

describe('computeDocumentDueDate', () => {
  // Fixed reference "today" (local midnight) so day math is deterministic.
  const today = new Date(2026, 6, 16) // 2026-07-16

  it('returns null for null / undefined / empty visit date', () => {
    expect(computeDocumentDueDate(null, today)).toBeNull()
    expect(computeDocumentDueDate(undefined, today)).toBeNull()
    expect(computeDocumentDueDate('', today)).toBeNull()
  })

  it('returns null for an invalid date string', () => {
    expect(computeDocumentDueDate('not-a-date', today)).toBeNull()
  })

  it('marks overdue when the due date is before today', () => {
    // visit 10 days ago -> due 3 days ago
    const result = computeDocumentDueDate('2026-07-06', today)
    expect(result).not.toBeNull()
    expect(result!.status).toBe('overdue')
    expect(result!.daysUntilDue).toBe(-3)
    expect(result!.dueDate.getFullYear()).toBe(2026)
    expect(result!.dueDate.getMonth()).toBe(6) // July
    expect(result!.dueDate.getDate()).toBe(13)
  })

  it('marks due_soon when visit date is today (due in 7 days is not soon, but boundary check below)', () => {
    // visit today -> due +7 days -> daysUntilDue 7 -> on_track (7 > 3)
    const result = computeDocumentDueDate('2026-07-16', today)
    expect(result!.daysUntilDue).toBe(7)
    expect(result!.status).toBe('on_track')
  })

  it('marks on_track for a far-future visit date', () => {
    const result = computeDocumentDueDate('2026-12-01', today)
    expect(result!.status).toBe('on_track')
  })

  it('boundary: daysUntilDue === 3 is due_soon', () => {
    // due exactly 3 days out -> visit = today - 4 days = 2026-07-12
    const result = computeDocumentDueDate('2026-07-12', today)
    expect(result!.daysUntilDue).toBe(3)
    expect(result!.status).toBe('due_soon')
  })

  it('boundary: daysUntilDue === 4 is on_track', () => {
    // due 4 days out -> visit = today - 3 days = 2026-07-13
    const result = computeDocumentDueDate('2026-07-13', today)
    expect(result!.daysUntilDue).toBe(4)
    expect(result!.status).toBe('on_track')
  })

  it('boundary: daysUntilDue === 0 (due today) is due_soon, not overdue', () => {
    // due today -> visit = today - 7 days = 2026-07-09
    const result = computeDocumentDueDate('2026-07-09', today)
    expect(result!.daysUntilDue).toBe(0)
    expect(result!.status).toBe('due_soon')
  })

  it('boundary: daysUntilDue === -1 is overdue', () => {
    // due yesterday -> visit = today - 8 days = 2026-07-08
    const result = computeDocumentDueDate('2026-07-08', today)
    expect(result!.daysUntilDue).toBe(-1)
    expect(result!.status).toBe('overdue')
  })
})
