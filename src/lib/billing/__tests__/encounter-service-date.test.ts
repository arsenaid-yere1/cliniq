import { describe, expect, it } from 'vitest'
import { resolveEncounterServiceDate } from '../encounter-service-date'

describe('resolveEncounterServiceDate', () => {
  it('uses the provider-entered discharge visit date before the encounter date', () => {
    expect(resolveEncounterServiceDate({
      encounter_type: 'discharge',
      encounter_date: '2026-08-27',
      completed_at: '2026-08-27T18:00:00.000Z',
    }, {
      dischargeVisitDate: '2026-08-20',
      fallbackDate: '2026-08-27',
    })).toBe('2026-08-20')
  })

  it('uses the encounter date for non-discharge visits', () => {
    expect(resolveEncounterServiceDate({
      encounter_type: 'pain_follow_up',
      encounter_date: '2026-08-22',
      completed_at: '2026-08-27T18:00:00.000Z',
    }, {
      dischargeVisitDate: '2026-08-20',
      fallbackDate: '2026-08-27',
    })).toBe('2026-08-22')
  })

  it('falls back through completion date and the supplied current date', () => {
    expect(resolveEncounterServiceDate({
      encounter_type: 'pain_follow_up',
      encounter_date: null,
      completed_at: '2026-08-23T18:00:00.000Z',
    }, {
      fallbackDate: '2026-08-27',
    })).toBe('2026-08-23')

    expect(resolveEncounterServiceDate({
      encounter_type: 'pain_follow_up',
      encounter_date: null,
      completed_at: null,
    }, {
      fallbackDate: '2026-08-27',
    })).toBe('2026-08-27')
  })
})
