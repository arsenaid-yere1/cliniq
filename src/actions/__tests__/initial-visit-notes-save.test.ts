import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockQueryBuilder, createMockSupabase, type MockSupabaseClient } from '@/test-utils/supabase-mock'
import { TEST_CASE_ID } from '@/test-utils/fixtures'
import { defaultProviderIntake } from '@/lib/validations/initial-visit-note'

let mockSupabase: MockSupabaseClient
const mockEnsureLegacyEpisodeEncounter = vi.fn()

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => mockSupabase),
}))

vi.mock('@/actions/case-status', () => ({
  assertCaseNotClosed: vi.fn(async () => ({ error: null })),
  autoAdvanceFromIntake: vi.fn(async () => ({ error: null })),
}))

vi.mock('@/lib/clinical/episode-context', async () => {
  const actual = await vi.importActual<typeof import('@/lib/clinical/episode-context')>(
    '@/lib/clinical/episode-context',
  )
  return {
    ...actual,
    ensureLegacyEpisodeEncounter: (...args: unknown[]) => mockEnsureLegacyEpisodeEncounter(...args),
  }
})

import { saveInitialVisitVitals, saveProviderIntake } from '../initial-visit-notes'
import { EpisodeContextError } from '@/lib/clinical/episode-context'

describe('saveProviderIntake', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'initial_visit_notes') {
        return createMockQueryBuilder({ data: null, error: null })
      }
      if (table === 'cases') {
        return createMockQueryBuilder({ data: { assigned_provider_id: null }, error: null })
      }
      return createMockQueryBuilder()
    })
    vi.clearAllMocks()
  })

  it('returns a readable error when Episode 1 is missing', async () => {
    mockEnsureLegacyEpisodeEncounter.mockRejectedValueOnce(
      new EpisodeContextError('EPISODE_NOT_FOUND', 'Episode 1 is required for the legacy visit'),
    )

    const result = await saveProviderIntake(
      TEST_CASE_ID,
      'pain_evaluation_visit',
      defaultProviderIntake,
    )

    expect(result).toEqual({ error: 'Episode 1 is required for the legacy visit' })
  })

  it('does not expose unexpected exception details', async () => {
    mockEnsureLegacyEpisodeEncounter.mockRejectedValueOnce(new Error('database internals'))

    const result = await saveProviderIntake(
      TEST_CASE_ID,
      'pain_evaluation_visit',
      defaultProviderIntake,
    )

    expect(result).toEqual({ error: 'Unable to prepare the visit record. Please try again.' })
  })
})

describe('saveInitialVisitVitals', () => {
  const vitals = {
    bp_systolic: 120,
    bp_diastolic: 80,
    heart_rate: 72,
    respiratory_rate: 16,
    temperature_f: 98.6,
    spo2_percent: 99,
    pain_score_min: 4,
    pain_score_max: 8,
  }

  beforeEach(() => {
    mockSupabase = createMockSupabase()
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'cases') {
        return createMockQueryBuilder({ data: { assigned_provider_id: null }, error: null })
      }
      if (table === 'vital_signs') {
        return createMockQueryBuilder({ data: null, error: null })
      }
      return createMockQueryBuilder()
    })
    mockEnsureLegacyEpisodeEncounter.mockResolvedValue({
      episodeId: '110e8400-e29b-41d4-a716-446655440000',
      encounterId: '220e8400-e29b-41d4-a716-446655440000',
    })
    vi.clearAllMocks()
  })

  it('owns Pain Evaluation vitals with a pain_evaluation encounter', async () => {
    const result = await saveInitialVisitVitals(
      TEST_CASE_ID,
      'pain_evaluation_visit',
      vitals,
    )

    expect(result).toEqual({ data: { success: true } })
    expect(mockEnsureLegacyEpisodeEncounter).toHaveBeenCalledWith(
      TEST_CASE_ID,
      'pain_evaluation',
      expect.objectContaining({ userId: 'test-user-id' }),
      mockSupabase,
    )
  })

  it('owns Initial Visit vitals with an initial_evaluation encounter', async () => {
    const result = await saveInitialVisitVitals(TEST_CASE_ID, 'initial_visit', vitals)

    expect(result).toEqual({ data: { success: true } })
    expect(mockEnsureLegacyEpisodeEncounter).toHaveBeenCalledWith(
      TEST_CASE_ID,
      'initial_evaluation',
      expect.objectContaining({ userId: 'test-user-id' }),
      mockSupabase,
    )
  })

  it('relinks an existing shared vitals snapshot to the selected visit encounter', async () => {
    const vitalsBuilder = createMockQueryBuilder({
      data: { id: '330e8400-e29b-41d4-a716-446655440000' },
      error: null,
    })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'cases') {
        return createMockQueryBuilder({ data: { assigned_provider_id: null }, error: null })
      }
      if (table === 'vital_signs') return vitalsBuilder
      return createMockQueryBuilder()
    })

    const result = await saveInitialVisitVitals(
      TEST_CASE_ID,
      'pain_evaluation_visit',
      vitals,
    )

    expect(result).toEqual({ data: { success: true } })
    expect(vitalsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({
      encounter_id: '220e8400-e29b-41d4-a716-446655440000',
    }))
  })

  it('does not save vitals when encounter ownership cannot be prepared', async () => {
    mockEnsureLegacyEpisodeEncounter.mockRejectedValueOnce(
      new EpisodeContextError('EPISODE_NOT_FOUND', 'Episode 1 is required for the legacy visit'),
    )

    const result = await saveInitialVisitVitals(
      TEST_CASE_ID,
      'pain_evaluation_visit',
      vitals,
    )

    expect(result).toEqual({ error: 'Episode 1 is required for the legacy visit' })
  })
})
