import { describe, it, expect } from 'vitest'
import { visitDateSchema } from '../visit-date'

describe('visitDateSchema', () => {
  it('accepts a non-empty date when no bounds are set', () => {
    const schema = visitDateSchema()
    expect(schema.safeParse('2026-04-24').success).toBe(true)
  })

  it('rejects an empty string', () => {
    const schema = visitDateSchema()
    const r = schema.safeParse('')
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].message).toMatch(/required/i)
  })

  it('accepts a date on or after the floor', () => {
    const schema = visitDateSchema({ floorDate: '2026-01-01' })
    expect(schema.safeParse('2026-01-01').success).toBe(true)
    expect(schema.safeParse('2026-06-01').success).toBe(true)
  })

  it('rejects a date before the floor with the label in the message', () => {
    const schema = visitDateSchema({
      floorDate: '2026-01-01',
      floorLabel: 'Initial Visit date',
    })
    const r = schema.safeParse('2025-12-31')
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].message).toContain('Initial Visit date')
  })

  it('accepts a date on or before the ceiling', () => {
    const schema = visitDateSchema({ ceilingDate: '2026-12-31' })
    expect(schema.safeParse('2026-12-31').success).toBe(true)
    expect(schema.safeParse('2026-01-01').success).toBe(true)
  })

  it('rejects a date after the ceiling with the label in the message', () => {
    const schema = visitDateSchema({
      ceilingDate: '2026-12-31',
      ceilingLabel: 'Pain Evaluation Visit date',
    })
    const r = schema.safeParse('2027-01-01')
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].message).toContain('Pain Evaluation Visit date')
  })

  it('skips the floor refine when floorDate is null/undefined', () => {
    const schema = visitDateSchema({ floorDate: null })
    expect(schema.safeParse('1900-01-01').success).toBe(true)
  })

  it('skips the ceiling refine when ceilingDate is null/undefined', () => {
    const schema = visitDateSchema({ ceilingDate: null })
    expect(schema.safeParse('9999-01-01').success).toBe(true)
  })
})
