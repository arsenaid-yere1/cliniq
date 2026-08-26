import { describe, expect, it } from 'vitest'
import { careEpisodeSchema, startReturnCareEpisodeSchema } from '../care-episode'

const CASE_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_CASE_ID = '22222222-2222-4222-8222-222222222222'

describe('careEpisodeSchema', () => {
  it('accepts an active episode without an end timestamp', () => {
    expect(careEpisodeSchema.safeParse({
      case_id: CASE_ID,
      episode_number: 2,
      status: 'active',
      opened_at: '2026-08-26T12:00:00Z',
      ended_at: null,
      end_reason: null,
      return_reason: 'Pain returned',
    }).success).toBe(true)
  })

  it('rejects an active episode with an end timestamp', () => {
    expect(careEpisodeSchema.safeParse({
      case_id: CASE_ID,
      episode_number: 2,
      status: 'active',
      opened_at: '2026-08-26T12:00:00Z',
      ended_at: '2026-08-27T12:00:00Z',
      end_reason: null,
      return_reason: null,
    }).success).toBe(false)
  })
})
describe('startReturnCareEpisodeSchema', () => {
  const firstEncounter = {
    case_id: CASE_ID,
    modality: 'telehealth' as const,
    scheduled_start: '2026-08-26T12:00:00Z',
    scheduled_end: '2026-08-26T12:30:00Z',
    encounter_date: '2026-08-26',
    provider_id: null,
    reason_for_visit: 'Recurring pain',
    provider_intake: {},
    patient_reported_measurements: {},
  }

  it('accepts an atomic return episode request', () => {
    expect(startReturnCareEpisodeSchema.safeParse({
      case_id: CASE_ID,
      return_reason: 'Recurring pain after discharge',
      idempotency_key: 'return-episode-001',
      first_encounter: firstEncounter,
    }).success).toBe(true)
  })

  it('rejects an encounter belonging to another case', () => {
    expect(startReturnCareEpisodeSchema.safeParse({
      case_id: CASE_ID,
      return_reason: 'Recurring pain after discharge',
      idempotency_key: 'return-episode-002',
      first_encounter: { ...firstEncounter, case_id: OTHER_CASE_ID },
    }).success).toBe(false)
  })
})
