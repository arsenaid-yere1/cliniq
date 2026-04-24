import { describe, it, expect } from 'vitest'
import { computeAgeAtDate, pickVisitAnchor } from '../age'

describe('computeAgeAtDate', () => {
  it('returns age when anchor is before the birthday', () => {
    expect(computeAgeAtDate('2000-06-15', '2025-05-01')).toBe(24)
  })

  it('returns age when anchor is exactly on the birthday', () => {
    expect(computeAgeAtDate('2000-06-15', '2025-06-15')).toBe(25)
  })

  it('returns age when anchor is one day before the birthday', () => {
    expect(computeAgeAtDate('2000-06-16', '2025-06-15')).toBe(24)
  })

  it('accepts ISO timestamps and takes the date portion', () => {
    expect(computeAgeAtDate('2000-06-15', '2025-06-15T23:59:59Z')).toBe(25)
  })

  it('returns null when DOB is missing', () => {
    expect(computeAgeAtDate(null, '2025-05-01')).toBeNull()
    expect(computeAgeAtDate(undefined, '2025-05-01')).toBeNull()
    expect(computeAgeAtDate('', '2025-05-01')).toBeNull()
  })

  it('returns null when anchor is missing', () => {
    expect(computeAgeAtDate('2000-06-15', null)).toBeNull()
    expect(computeAgeAtDate('2000-06-15', undefined)).toBeNull()
    expect(computeAgeAtDate('2000-06-15', '')).toBeNull()
  })

  it('returns null when anchor precedes DOB (data error)', () => {
    expect(computeAgeAtDate('2025-05-01', '2000-06-15')).toBeNull()
  })

  it('returns null for invalid date strings', () => {
    expect(computeAgeAtDate('not-a-date', '2025-05-01')).toBeNull()
    expect(computeAgeAtDate('2000-06-15', 'not-a-date')).toBeNull()
  })
})

describe('pickVisitAnchor', () => {
  it('returns override verbatim when provided (highest precedence)', () => {
    expect(pickVisitAnchor('2025-01-01', '2025-05-01', '2025-06-01T12:00:00Z')).toBe('2025-01-01')
  })

  it('returns visit_date when override is missing', () => {
    expect(pickVisitAnchor(null, '2025-05-01', '2025-06-01T12:00:00Z')).toBe('2025-05-01')
  })

  it('returns date portion of finalized_at when override and visit_date are missing', () => {
    expect(pickVisitAnchor(null, null, '2025-06-01T12:00:00Z')).toBe('2025-06-01')
  })

  it('falls back to today when all three are missing', () => {
    const today = new Date().toISOString().slice(0, 10)
    expect(pickVisitAnchor(null, null, null)).toBe(today)
    expect(pickVisitAnchor(undefined, undefined, undefined)).toBe(today)
  })

  it('treats empty-string override as falsy', () => {
    expect(pickVisitAnchor('', '2025-05-01', null)).toBe('2025-05-01')
  })
})
