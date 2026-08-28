import { describe, expect, it } from 'vitest'
import { createMockQueryBuilder, createMockSupabase } from '@/test-utils/supabase-mock'
import { TEST_CASE_ID } from '@/test-utils/fixtures'
import {
  EpisodeContextError,
  getActiveEpisode,
  getActiveOrLatestEpisode,
  getEpisodeById,
  requireWritableEpisode,
  selectEpisodeDateFloor,
  selectLatestCompletedEncounter,
  type CareEpisode,
  type ClinicalEncounter,
} from '../episode-context'

const EPISODE_ID = '110e8400-e29b-41d4-a716-446655440000'
const OTHER_CASE_ID = '220e8400-e29b-41d4-a716-446655440000'

const episode: CareEpisode = {
  id: EPISODE_ID,
  case_id: TEST_CASE_ID,
  episode_number: 2,
  status: 'active',
  opened_at: '2026-08-01T09:00:00.000Z',
  ended_at: null,
  end_reason: null,
  return_reason: 'Pain returned',
  created_at: '2026-08-01T09:00:00.000Z',
  updated_at: '2026-08-01T09:00:00.000Z',
  deleted_at: null,
  created_by_user_id: null,
  updated_by_user_id: null,
}

function encounter(overrides: Partial<ClinicalEncounter>): ClinicalEncounter {
  return {
    id: '330e8400-e29b-41d4-a716-446655440000',
    case_id: TEST_CASE_ID,
    episode_id: EPISODE_ID,
    encounter_type: 'pain_follow_up',
    modality: 'telehealth',
    status: 'completed',
    scheduled_start: null,
    scheduled_end: null,
    encounter_date: '2026-08-10',
    completed_at: '2026-08-10T17:00:00.000Z',
    provider_id: null,
    reason_for_visit: null,
    provider_intake: {},
    patient_reported_pain_min: null,
    patient_reported_pain_max: null,
    patient_reported_measurements: {},
    telehealth_consent_obtained: null,
    telehealth_consent_at: null,
    patient_location_state: null,
    provider_location: null,
    connection_method: null,
    created_at: '2026-08-10T16:00:00.000Z',
    updated_at: '2026-08-10T17:00:00.000Z',
    deleted_at: null,
    diagnoses: [],
    diagnoses_confirmed_at: null,
    diagnoses_confirmed_by_user_id: null,
    created_by_user_id: null,
    updated_by_user_id: null,
    ...overrides,
  }
}

describe('episode context queries', () => {
  it('returns the active episode', async () => {
    const supabase = createMockSupabase({ data: episode, error: null })
    await expect(getActiveEpisode(TEST_CASE_ID, supabase as never)).resolves.toEqual(episode)
  })

  it('rejects an episode that belongs to another case', async () => {
    const supabase = createMockSupabase({ data: episode, error: null })
    await expect(getEpisodeById(OTHER_CASE_ID, EPISODE_ID, supabase as never)).rejects.toMatchObject({
      code: 'EPISODE_CASE_MISMATCH',
    } satisfies Partial<EpisodeContextError>)
  })

  it('falls back to the latest episode when none is active', async () => {
    const supabase = createMockSupabase()
    let callCount = 0
    supabase.from.mockImplementation(() => {
      callCount += 1
      return createMockQueryBuilder({
        data: callCount === 1 ? null : { ...episode, status: 'discharged' },
        error: null,
      })
    })

    const result = await getActiveOrLatestEpisode(TEST_CASE_ID, supabase as never)
    expect(result?.status).toBe('discharged')
    expect(callCount).toBe(2)
  })

  it('rejects writes when the legal case is locked', async () => {
    const supabase = createMockSupabase()
    supabase.from.mockImplementation((table: string) => createMockQueryBuilder({
      data: table === 'cases' ? { case_status: 'closed' } : episode,
      error: null,
    }))

    await expect(requireWritableEpisode(TEST_CASE_ID, EPISODE_ID, supabase as never))
      .rejects.toMatchObject({ code: 'CASE_LOCKED' })
  })

  it('rejects writes to an ended episode', async () => {
    const supabase = createMockSupabase()
    supabase.from.mockImplementation((table: string) => createMockQueryBuilder({
      data: table === 'cases' ? { case_status: 'active' } : { ...episode, status: 'discharged' },
      error: null,
    }))

    await expect(requireWritableEpisode(TEST_CASE_ID, EPISODE_ID, supabase as never))
      .rejects.toMatchObject({ code: 'EPISODE_NOT_ACTIVE' })
  })
})

describe('episode context selectors', () => {
  it('selects the latest live completed encounter', () => {
    const older = encounter({
      id: '440e8400-e29b-41d4-a716-446655440000',
      completed_at: '2026-08-05T17:00:00.000Z',
      encounter_date: '2026-08-05',
    })
    const cancelled = encounter({
      id: '550e8400-e29b-41d4-a716-446655440000',
      status: 'cancelled',
      completed_at: '2026-08-20T17:00:00.000Z',
    })
    const latest = encounter({ id: '660e8400-e29b-41d4-a716-446655440000' })

    expect(selectLatestCompletedEncounter([older, cancelled, latest])?.id).toBe(latest.id)
  })

  it('uses only same-episode completed encounters for the date floor', () => {
    const sameEpisode = encounter({ encounter_date: '2026-08-10' })
    const otherEpisode = encounter({
      id: '770e8400-e29b-41d4-a716-446655440000',
      episode_id: '880e8400-e29b-41d4-a716-446655440000',
      encounter_date: '2026-08-20',
      completed_at: '2026-08-20T17:00:00.000Z',
    })

    expect(selectEpisodeDateFloor(episode, [sameEpisode, otherEpisode])).toBe('2026-08-10')
  })
})
