vi.mock('@/lib/clinical/evaluation-scope', () => ({ resolveEvaluationEpisode: async () => ({ episode: { id: 'episode', episode_number: 1 } }) }))
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockQueryBuilder, createMockSupabase } from '@/test-utils/supabase-mock'

const state = vi.hoisted(() => ({ closed: vi.fn(), episode: vi.fn() }))
let client: ReturnType<typeof createMockSupabase>
let note: ReturnType<typeof createMockQueryBuilder>
let corrections: ReturnType<typeof createMockQueryBuilder>
vi.mock('@/lib/supabase/server', () => ({ createClient: () => client }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/actions/case-status', () => ({ assertCaseNotClosed: state.closed, autoAdvanceFromIntake: vi.fn() }))
vi.mock('@/lib/clinical/episode-context', async () => ({
  ...await vi.importActual<typeof import('@/lib/clinical/episode-context')>('@/lib/clinical/episode-context'),
  getActiveOrLatestEpisode: state.episode,
}))
import { saveInitialVisitNoteToneHint } from '../initial-visit-notes'
import { saveDischargeNoteToneHint } from '../discharge-notes'
const version = { noteId: 'note', expectedUpdatedAt: 'v1' }

beforeEach(() => {
  vi.clearAllMocks()
  client = createMockSupabase()
  note = createMockQueryBuilder({ data: { updated_at: 'v2', tone_hint: 'Concise' }, error: null })
  corrections = createMockQueryBuilder({ data: [], error: null })
  client.from.mockImplementation((table: string) => table === 'discharge_note_corrections' ? corrections : note)
  state.closed.mockResolvedValue({ error: null })
  state.episode.mockResolvedValue({ id: 'episode' })
})

describe.each(['initial_visit', 'pain_evaluation_visit', 'discharge'] as const)('%s guarded tone save', (family) => {
  const save = (tone: string | null = '  Concise  ', identity = version) => family === 'discharge'
    ? saveDischargeNoteToneHint('case', tone, identity)
    : saveInitialVisitNoteToneHint('case', family, tone, identity)

  it('updates only the exact draft version and returns the new version', async () => {
    expect(await save()).toEqual({ data: { updated_at: 'v2', tone_hint: 'Concise' } })
    expect(note.update).toHaveBeenCalledWith({ tone_hint: 'Concise', updated_by_user_id: 'test-user-id' })
    expect(note.eq.mock.calls).toEqual(expect.arrayContaining([
      ['id', 'note'], ['case_id', 'case'], ['status', 'draft'], ['updated_at', 'v1'],
      family === 'discharge' ? ['episode_id', 'episode'] : ['visit_type', family],
    ]))
    expect(note.is).toHaveBeenCalledWith('deleted_at', null)
    expect(note.select).toHaveBeenCalledWith('updated_at,tone_hint')
    expect(note.insert).not.toHaveBeenCalled()
  })
  it('normalizes empty tone to null', async () => {
    await save('   ')
    expect(note.update).toHaveBeenCalledWith(expect.objectContaining({ tone_hint: null }))
  })
  it('does not report success or insert when no current draft matches', async () => {
    note.maybeSingle.mockResolvedValue({ data: null, error: null })
    expect(await save()).toEqual({ error: 'Note changed. Reload before saving' })
    expect(note.insert).not.toHaveBeenCalled()
  })
  it('keeps unexpected database errors separate from conflicts', async () => {
    note.maybeSingle.mockResolvedValue({ data: null, error: { message: 'database internals' } })
    expect(await save()).toEqual({ error: 'Failed to save tone hint' })
  })
  it('requires the editor version and identity', async () => {
    expect(await save(null, { ...version, expectedUpdatedAt: '' })).toHaveProperty('error')
    expect(await save(null, { ...version, noteId: '' })).toHaveProperty('error')
    expect(note.update).not.toHaveBeenCalled()
  })
  it('rejects unauthenticated and locked requests without writing', async () => {
    client.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    expect(await save()).toEqual({ error: 'Not authenticated' })
    state.closed.mockResolvedValueOnce({ error: 'Case is locked' })
    expect(await save()).toEqual({ error: 'Case is locked' })
    expect(note.update).not.toHaveBeenCalled()
  })
})

it('preserves the discharge correction guard', async () => {
  corrections = createMockQueryBuilder({ data: [{ id: 'correction' }], error: null })
  expect(await saveDischargeNoteToneHint('case', 'Concise', version)).toHaveProperty('error')
  expect(note.update).not.toHaveBeenCalled()
})
