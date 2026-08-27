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

import { saveProviderIntake } from '../initial-visit-notes'
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
