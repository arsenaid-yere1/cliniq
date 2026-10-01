import { beforeEach, expect, it, vi } from 'vitest'
import { createMockQueryBuilder, createMockSupabase } from '@/test-utils/supabase-mock'
let client: ReturnType<typeof createMockSupabase>
const ai = vi.hoisted(() => vi.fn())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => client }))
vi.mock('@/lib/clinical/evaluation-scope', () => ({ resolveEvaluationEpisode: async () => ({ episode: { id: 'episode', episode_number: 1 } }) }))
vi.mock('@/lib/clinical/discharge-scope', () => ({ resolveDischargeScope: async () => ({ episodeId: 'episode' }) }))
vi.mock('@/actions/case-status', () => ({ assertCaseNotClosed: async () => ({}), autoAdvanceFromIntake: async () => ({}) }))
vi.mock('@/lib/claude/generate-initial-visit', () => ({ generateInitialVisitFromData: ai, INITIAL_VISIT_SECTIONS_TOTAL: 16 }))
vi.mock('@/lib/claude/generate-discharge-note', () => ({ generateDischargeNoteFromData: ai, DISCHARGE_NOTE_SECTIONS_TOTAL: 12 }))
import { generateInitialVisitNote } from '../initial-visit-notes'
import { generateDischargeNote } from '../discharge-notes'
beforeEach(() => { client = createMockSupabase(); ai.mockReset() })
it.each(['initial_visit','pain_evaluation_visit'] as const)('%s refuses an unacknowledged changed date before AI', async kind => {
  const query = createMockQueryBuilder({ data: { id: 'note', visit_date: '2026-09-02', updated_at: 'v2' }, error: null })
  client.from.mockReturnValue(query)
  const result = await generateInitialVisitNote('case', kind, null, '2026-09-01', 'episode', { noteId: 'note', visitDate: '2026-09-01', updatedAt: 'v1' })
  expect(result.error).toContain('Save the selected visit date')
  expect(ai).not.toHaveBeenCalled()
  expect(query.update).not.toHaveBeenCalled()
})
it('does not recreate a disappeared acknowledged note for Generate', async () => {
  client.from.mockReturnValue(createMockQueryBuilder({ data: null, error: null }))
  const result = await generateInitialVisitNote('case','initial_visit',null,'2026-09-01','episode',{noteId:'removed',visitDate:'2026-09-01',updatedAt:'v1'})
  expect(result.error).toContain('visit changed')
  expect(client.rpc).not.toHaveBeenCalled()
  expect(ai).not.toHaveBeenCalled()
})
it('discharge refuses an unacknowledged changed date before gathering or AI', async () => {
  client.from.mockImplementation(table => createMockQueryBuilder({ data: table === 'clinical_encounters' ? [{ id: 'visit', status: 'completed' }] : table === 'discharge_notes' ? { id: 'note', status: 'draft', visit_date: '2026-09-02', updated_at: 'v2' } : null, error: null }))
  const result = await generateDischargeNote('case',null,'2026-09-01','episode',{noteId:'note',visitDate:'2026-09-01',updatedAt:'v1'})
  expect(result.error).toContain('Save the selected visit date')
  expect(ai).not.toHaveBeenCalled()
})
