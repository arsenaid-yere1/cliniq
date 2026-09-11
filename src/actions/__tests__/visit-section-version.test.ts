import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockSupabase, mockTableResults, type MockSupabaseClient } from '@/test-utils/supabase-mock'
let client: MockSupabaseClient
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => client }))
vi.mock('@/actions/case-status', () => ({ assertCaseNotClosed: async () => ({}), autoAdvanceFromIntake: vi.fn() }))
vi.mock('@/lib/clinical/episode-context', () => ({ getActiveOrLatestEpisode: async () => ({ id: 'episode' }), getEpisodeById: vi.fn(), ensureEpisodeEncounter: vi.fn() }))
import { regenerateNoteSection } from '../initial-visit-notes'
import { regenerateDischargeNoteSectionAction } from '../discharge-notes'
beforeEach(() => {
  client = createMockSupabase()
  mockTableResults(client, { initial_visit_notes: { data: { id: 'note', updated_at: 'v2' }, error: null }, discharge_notes: { data: { id: 'note', updated_at: 'v2' }, error: null } })
})
describe('section regeneration respects the version the clinician reviewed', () => {
  it.each(['initial_visit', 'pain_evaluation_visit'] as const)('rejects stale %s before generating or writing', async visitType => {
    expect(await regenerateNoteSection('case', visitType, 'prognosis', undefined, 'v1')).toEqual({ error: 'The note changed. Reload before regenerating.' })
    expect(client.from.mock.calls.map(([table]) => table)).toEqual(['initial_visit_notes'])
  })
  it('rejects stale discharge before gathering or writing', async () => {
    expect(await regenerateDischargeNoteSectionAction('case', 'prognosis', undefined, 'v1')).toEqual({ error: 'The note changed. Reload before regenerating.' })
    expect(client.from.mock.calls.map(([table]) => table)).toEqual(['discharge_note_corrections', 'discharge_notes'])
  })
})
