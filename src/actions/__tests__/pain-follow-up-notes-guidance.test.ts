import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockQueryBuilder, createMockSupabase } from '@/test-utils/supabase-mock'

const mocks = vi.hoisted(() => ({ generate: vi.fn(), writable: vi.fn(), feature: vi.fn() }))
let client: ReturnType<typeof createMockSupabase>
let notes: ReturnType<typeof createMockQueryBuilder>
let encounter: ReturnType<typeof createMockQueryBuilder>
vi.mock('@/lib/supabase/server', () => ({ createClient: () => client }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/claude/generate-pain-follow-up', () => ({ generatePainFollowUp: mocks.generate }))
vi.mock('@/lib/features/return-tele-visits', () => ({ requireReturnTeleVisitsMutation: mocks.feature }))
vi.mock('@/lib/clinical/episode-context', () => ({ requireWritableEpisode: mocks.writable, selectLatestCompletedEncounter: () => null }))
import { generatePainFollowUpNote, regeneratePainFollowUpSectionAction, savePainFollowUpNoteToneHint } from '../pain-follow-up-notes'
import { revalidatePath } from 'next/cache'

const stored = { id: 'note', status: 'draft', generation_attempts: 1, updated_at: 'v1', tone_hint: 'Stored guidance' }
const committed = { ...stored, updated_at: 'v3', subjective: 'Generated' }
const version = { noteId: 'note', expectedUpdatedAt: 'v1' }
function prepareGeneration(existing: typeof stored | null = stored) {
  notes.maybeSingle.mockResolvedValueOnce({ data: existing, error: null })
    .mockResolvedValueOnce({ data: { id: 'note', updated_at: 'v2' }, error: null })
    .mockResolvedValueOnce({ data: { id: 'note' }, error: null })
  notes.single.mockResolvedValue({ data: { id: 'note', updated_at: 'v2' }, error: null })
}
beforeEach(() => {
  vi.clearAllMocks()
  client = createMockSupabase()
  notes = createMockQueryBuilder({ data: committed, error: null })
  encounter = createMockQueryBuilder({ data: { id: 'visit', episode_id: 'episode', status: 'in_progress' }, error: null })
  client.from.mockImplementation((table: string) => table === 'pain_follow_up_notes' ? notes
    : table === 'clinical_encounters' ? encounter
      : createMockQueryBuilder({ data: null, error: null }))
  mocks.feature.mockReturnValue(null)
  mocks.writable.mockResolvedValue({})
  mocks.generate.mockResolvedValue({ data: { subjective: 'Generated' } })
})

describe('follow-up generation guidance', () => {
  it.each([
    [undefined, 'Stored guidance'], [null, null], ['', null], ['   ', null], ['  Concise  ', 'Concise'],
  ])('persists and forwards %j as %j', async (input, expected) => {
    prepareGeneration()
    expect(await generatePainFollowUpNote('case', 'visit', input)).toEqual({ data: { noteId: 'note' } })
    expect(notes.update.mock.calls[0][0]).toMatchObject({ tone_hint: expected, status: 'generating' })
    expect(mocks.generate).toHaveBeenCalledWith(expect.any(Object), undefined, expected)
    expect(notes.eq.mock.calls).toEqual(expect.arrayContaining([['case_id', 'case'], ['encounter_id', 'visit'], ['updated_at', 'v1'], ['updated_at', 'v2'], ['status', 'generating']]))
  })
  it('persists guidance on first insertion before calling AI', async () => {
    prepareGeneration(null)
    await generatePainFollowUpNote('case', 'visit', 'Concise')
    expect(notes.insert).toHaveBeenCalledWith(expect.objectContaining({ tone_hint: 'Concise', case_id: 'case', encounter_id: 'visit' }))
    expect(notes.insert.mock.invocationCallOrder[0]).toBeLessThan(mocks.generate.mock.invocationCallOrder[0])
  })
  it.each(['returned', 'thrown'])('retains guidance when AI failure is %s', async (kind) => {
    prepareGeneration()
    if (kind === 'returned') mocks.generate.mockResolvedValue({ error: 'Unavailable' })
    else mocks.generate.mockRejectedValue(new Error('Unavailable'))
    expect(await generatePainFollowUpNote('case', 'visit', 'Concise')).toHaveProperty('error')
    expect(notes.update.mock.calls[0][0].tone_hint).toBe('Concise')
    expect(notes.update.mock.calls[1][0]).toMatchObject({ status: 'failed' })
    expect(notes.update.mock.calls[1][0]).not.toHaveProperty('tone_hint')
    expect(revalidatePath).toHaveBeenCalled()
  })
  it('reuses persisted guidance from a failed attempt on omitted retry', async () => {
    prepareGeneration({ ...stored, status: 'failed' })
    await generatePainFollowUpNote('case', 'visit')
    expect(mocks.generate).toHaveBeenCalledWith(expect.any(Object), undefined, 'Stored guidance')
  })
  it.each(['generating', 'finalized'])('does not start from %s', async (status) => {
    prepareGeneration({ ...stored, status })
    expect(await generatePainFollowUpNote('case', 'visit')).toHaveProperty('error')
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(notes.update).not.toHaveBeenCalled()
  })
  it('does not call AI when acquiring the row loses a race', async () => {
    notes.maybeSingle.mockResolvedValueOnce({ data: stored, error: null }).mockResolvedValueOnce({ data: null, error: null })
    expect(await generatePainFollowUpNote('case', 'visit')).toHaveProperty('error')
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('does not call AI after a failed load or insertion', async () => {
    notes.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'failed' } })
    expect(await generatePainFollowUpNote('case', 'visit')).toHaveProperty('error')
    expect(mocks.generate).not.toHaveBeenCalled()
    notes.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    notes.single.mockResolvedValueOnce({ data: null, error: { code: '23505' } })
    expect(await generatePainFollowUpNote('case', 'visit')).toHaveProperty('error')
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('does not report success if another write replaced the acquired version', async () => {
    notes.maybeSingle.mockResolvedValueOnce({ data: stored, error: null })
      .mockResolvedValueOnce({ data: { id: 'note', updated_at: 'v2' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
    expect(await generatePainFollowUpNote('case', 'visit')).toHaveProperty('error')
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('guarded follow-up tone save', () => {
  it('writes only the exact owned draft and returns the committed row', async () => {
    const result = await savePainFollowUpNoteToneHint('case', 'visit', '  Concise  ', version)
    expect(result).toEqual({ data: { savedNote: committed, updated_at: 'v3', tone_hint: 'Stored guidance' } })
    expect(notes.update).toHaveBeenCalledWith({ tone_hint: 'Concise', updated_by_user_id: 'test-user-id' })
    expect(notes.eq.mock.calls).toEqual(expect.arrayContaining([['id', 'note'], ['case_id', 'case'], ['encounter_id', 'visit'], ['episode_id', 'episode'], ['status', 'draft'], ['updated_at', 'v1']]))
    expect(encounter.eq).toHaveBeenCalledWith('encounter_type', 'pain_follow_up')
    expect(notes.is).toHaveBeenCalledWith('deleted_at', null)
    expect(notes.select).toHaveBeenCalledWith('*')
    expect(revalidatePath).not.toHaveBeenCalled()
  })
  it('clears whitespace to null', async () => {
    await savePainFollowUpNoteToneHint('case', 'visit', '  ', version)
    expect(notes.update).toHaveBeenCalledWith(expect.objectContaining({ tone_hint: null }))
  })
  it.each([null, { message: 'DB internals' }])('rejects a missing row with error %j without inserting', async (error) => {
    notes.maybeSingle.mockResolvedValue({ data: null, error })
    expect(await savePainFollowUpNoteToneHint('case', 'visit', null, version)).toEqual({ error: error ? 'Failed to save tone hint' : 'Note changed. Reload before saving' })
    expect(notes.insert).not.toHaveBeenCalled()
  })
  it.each(['auth', 'feature', 'episode', 'encounter', 'status', 'version', 'invalid'])('does not write when blocked by %s', async (guard) => {
    if (guard === 'auth') client.auth.getUser.mockResolvedValueOnce({ data: { user: null } })
    if (guard === 'feature') mocks.feature.mockReturnValueOnce({ error: 'Disabled' })
    if (guard === 'episode') mocks.writable.mockRejectedValueOnce(new Error('Locked'))
    if (guard === 'encounter') encounter.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    if (guard === 'status') encounter.maybeSingle.mockResolvedValueOnce({ data: { status: 'completed' }, error: null })
    const result = await savePainFollowUpNoteToneHint('case', 'visit', guard === 'invalid' ? 12 as unknown as string : null, guard === 'version' ? { ...version, expectedUpdatedAt: '' } : version)
    expect(result).toHaveProperty('error')
    expect(notes.update).not.toHaveBeenCalled()
  })
})

describe('section guidance and versions', () => {
  it('keeps the finding argument, applies stored tone, and returns the committed row', async () => {
    notes.maybeSingle.mockResolvedValueOnce({ data: stored, error: null })
    const finding = { message: 'Clarify source', rationale: null }
    expect(await regeneratePainFollowUpSectionAction('case', 'visit', 'subjective', finding, 'v1')).toEqual({ data: { success: true, savedNote: committed } })
    expect(mocks.generate).toHaveBeenCalledWith(expect.any(Object), { section: 'subjective', ...finding }, 'Stored guidance')
    expect(notes.update.mock.calls[0][0]).toMatchObject({ subjective: 'Generated' })
    expect(notes.update.mock.calls[0][0]).not.toHaveProperty('treatment_plan')
    expect(notes.eq).toHaveBeenCalledWith('updated_at', 'v1')
  })
  it('rejects stale editor versions before invoking AI', async () => {
    notes.maybeSingle.mockResolvedValueOnce({ data: stored, error: null })
    expect(await regeneratePainFollowUpSectionAction('case', 'visit', 'subjective', undefined, 'old')).toHaveProperty('error')
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('keeps quality-review callers without an editor version working', async () => {
    notes.maybeSingle.mockResolvedValueOnce({ data: stored, error: null })
    expect(await regeneratePainFollowUpSectionAction('case', 'visit', 'subjective')).toHaveProperty('data.savedNote')
  })
  it('does not claim success after a concurrent section change', async () => {
    notes.maybeSingle.mockResolvedValueOnce({ data: stored, error: null })
    notes.single.mockResolvedValueOnce({ data: null, error: null })
    expect(await regeneratePainFollowUpSectionAction('case', 'visit', 'subjective')).toHaveProperty('error')
  })
})
