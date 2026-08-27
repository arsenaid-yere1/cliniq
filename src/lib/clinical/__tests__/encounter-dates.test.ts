import { describe, expect, it } from 'vitest'
import {
  alignTelehealthConsentToEncounterDate,
  encounterDateFromLocalDateTime,
} from '../encounter-dates'

describe('encounterDateFromLocalDateTime', () => {
  it('preserves the calendar date selected in a local datetime input', () => {
    expect(encounterDateFromLocalDateTime('2026-08-27T23:30')).toBe('2026-08-27')
  })

  it('rejects values without a local date and time', () => {
    expect(encounterDateFromLocalDateTime('')).toBeNull()
    expect(encounterDateFromLocalDateTime('2026-08-27')).toBeNull()
  })
})

describe('alignTelehealthConsentToEncounterDate', () => {
  it('moves a late consent entry onto the encounter service date', () => {
    expect(alignTelehealthConsentToEncounterDate(
      '2026-08-29T18:42:15.000Z',
      '2026-08-27',
    )).toBe('2026-08-27T18:42:15.000Z')
  })

  it('uses the capture time when the consent timestamp is missing', () => {
    expect(alignTelehealthConsentToEncounterDate(
      null,
      '2026-08-27',
      '2026-08-29T09:10:11.000Z',
    )).toBe('2026-08-27T09:10:11.000Z')
  })

  it('leaves the timestamp unchanged when the encounter date is unavailable', () => {
    expect(alignTelehealthConsentToEncounterDate(
      '2026-08-29T18:42:15.000Z',
      null,
    )).toBe('2026-08-29T18:42:15.000Z')
  })
})
