import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockQueryBuilder, createMockSupabase } from '@/test-utils/supabase-mock'
import { followUpReviewFixture } from '@/test-utils/follow-up-source'
import { painFollowUpNoteSections, painFollowUpNoteResultSchema } from '@/lib/validations/pain-follow-up-note'
const { generate, client } = vi.hoisted(() => ({ generate: vi.fn(), client: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: client }))
vi.mock('@/lib/claude/generate-pain-follow-up', () => ({ generatePainFollowUp: generate }))
vi.mock('@/lib/features/return-tele-visits', () => ({ requireReturnTeleVisitsMutation: () => null }))
vi.mock('@/lib/clinical/episode-context', () => ({ requireWritableEpisode: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { generatePainFollowUpNote, regeneratePainFollowUpSectionAction, applyPainFollowUpProposal, discardPainFollowUpProposal, reviewPainFollowUpSources, getPainFollowUpReview, savePainFollowUpNote } from '../pain-follow-up-notes'
let db: ReturnType<typeof createMockSupabase>
const source = followUpReviewFixture('v1').snapshot
const content = painFollowUpNoteResultSchema.parse({ ...Object.fromEntries(painFollowUpNoteSections.map((key) => [key, 'Synthetic text'])), procedure_recommendations: [] })
beforeEach(() => {
  vi.clearAllMocks()
  db = createMockSupabase()
  client.mockResolvedValue(db)
  db.rpc.mockImplementation((_name, args) => Promise.resolve({ data: args.p_action === 'prepare' ? { id: 'proposal', version: 'v1', snapshot: source } : { success: true }, error: null }))
  generate.mockResolvedValue({ data: content, rawResponse: content, model: 'actual-model' })
})
describe('durable follow-up proposals', () => {
  it('prepares authoritative sources and stores a proposal without writing the note', async () => {
    expect(await generatePainFollowUpNote('case', 'encounter', 'v1')).toEqual({ data: { proposalId: 'proposal' } })
    expect(generate).toHaveBeenCalledWith(source.data, undefined)
    expect(db.rpc).toHaveBeenNthCalledWith(2, 'follow_up_review', expect.objectContaining({ p_action: 'complete', p_expected_updated_at: 'v1', p_proposal_id: 'proposal', p_payload: { content, raw_response: content, model: 'actual-model' } }))
    expect(db.from).not.toHaveBeenCalled()
  })
  it('records failure while preserving saved text', async () => {
    generate.mockResolvedValue({ error: 'Unavailable' })
    expect(await generatePainFollowUpNote('case', 'encounter', 'v1')).toEqual({ error: 'Unavailable' })
    expect(db.rpc).toHaveBeenLastCalledWith('follow_up_review', expect.objectContaining({ p_action: 'fail' }))
    expect(db.from).not.toHaveBeenCalled()
  })
  it('does not call the model when another proposal or a stale version blocks preparation', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: 'Review or discard the existing proposal first' } })
    expect(await generatePainFollowUpNote('case', 'encounter', 'old')).toMatchObject({ error: expect.stringContaining('existing proposal') })
    expect(generate).not.toHaveBeenCalled()
  })
  it('reports a source/note conflict during generation without applying text', async () => {
    db.rpc.mockResolvedValueOnce({ data: { id: 'proposal', version: 'v1', snapshot: source }, error: null }).mockResolvedValueOnce({ data: null, error: { message: 'Note or sources changed' } })
    expect(await generatePainFollowUpNote('case', 'encounter', 'v1')).toMatchObject({ error: expect.stringContaining('changed') })
    expect(db.from).not.toHaveBeenCalled()
  })
  it('requests a scoped plan replacement, leaving linked recommendations to atomic database application', async () => {
    await regeneratePainFollowUpSectionAction('case', 'encounter', 'treatment_plan', undefined, 'v1')
    expect(db.rpc).toHaveBeenNthCalledWith(1, 'follow_up_review', expect.objectContaining({ p_payload: { scope: 'treatment_plan' }, p_expected_updated_at: 'v1' }))
    expect(db.from).not.toHaveBeenCalled()
  })
  it('accepts stored proposals by ID and version, never submitted replacement text', async () => {
    await applyPainFollowUpProposal('case', 'encounter', 'v1', 'proposal')
    expect(db.rpc).toHaveBeenCalledWith('follow_up_review', expect.objectContaining({ p_action: 'apply', p_payload: {}, p_expected_updated_at: 'v1', p_proposal_id: 'proposal' }))
    await discardPainFollowUpProposal('case', 'encounter', 'v1', 'proposal')
    expect(db.rpc).toHaveBeenLastCalledWith('follow_up_review', expect.objectContaining({ p_action: 'discard' }))
  })
  it('binds explicit manual review to the seen source and saved version', async () => {
    await reviewPainFollowUpSources('case', 'encounter', 'v1', 'seen')
    expect(db.rpc).toHaveBeenCalledWith('follow_up_review', expect.objectContaining({ p_action: 'review', p_expected_updated_at: 'v1', p_payload: { source_fingerprint: 'seen' } }))
  })
  it('returns unavailable for a failed or incompatible source response', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: 'Source query failed' } })
    expect((await getPainFollowUpReview('case', 'encounter')).error).toContain('failed')
    db.rpc.mockResolvedValue({ data: {}, error: null })
    expect((await getPainFollowUpReview('case', 'encounter')).error).toBeTruthy()
  })
  it('uses a version-checked RPC even when saving without a treatment decision', async () => {
    db.from.mockReturnValue(createMockQueryBuilder({ data: { episode_id: 'episode' }, error: null }))
    db.rpc.mockResolvedValue({ data: { note: { updated_at: 'v2' } }, error: null })
    await savePainFollowUpNote('case', { ...content, encounter_id: '20000000-0000-4000-8000-000000000001', expected_updated_at: 'v1' } as Parameters<typeof savePainFollowUpNote>[1])
    expect(db.rpc).toHaveBeenCalledWith('follow_up_review', expect.objectContaining({ p_action: 'save', p_expected_updated_at: 'v1' }))
    expect(db.from).not.toHaveBeenCalledWith('pain_follow_up_notes')
  })
})
