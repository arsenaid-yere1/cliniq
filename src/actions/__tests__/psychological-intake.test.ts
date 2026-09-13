import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockQueryBuilder, createMockSupabase } from '@/test-utils/supabase-mock'
import { defaultProviderIntake } from '@/lib/validations/initial-visit-note'
import { defaultPsychologicalAssessment as empty } from '@/lib/validations/psychological-assessment'

let client: ReturnType<typeof createMockSupabase>
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => client }))
vi.mock('@/actions/case-status', () => ({ assertCaseNotClosed: vi.fn(async () => ({ error: null })), autoAdvanceFromIntake: vi.fn() }))
import { acknowledgePsychologicalReview, finalizeInitialVisitNote, saveProviderIntake } from '../initial-visit-notes'
import { assertCaseNotClosed } from '../case-status'

const input = { ...defaultProviderIntake, psychological_assessment: { ...empty, symptom_status: 'reported' as const, symptoms: ['Nightmares' as const] } }
function mockNote(overrides: Record<string, unknown> = {}) {
  const note = { id: 'note', status: 'draft', updated_at: 'v1', introduction: 'Existing note', provider_intake: defaultProviderIntake, ...overrides }
  const builder = createMockQueryBuilder()
  builder.maybeSingle.mockResolvedValueOnce({ data: note, error: null }).mockResolvedValue({ data: { id: 'note' }, error: null })
  builder.single.mockResolvedValueOnce({ data: note, error: null }).mockResolvedValue({ data: { updated_at: 'v2' }, error: null })
  client.from.mockReturnValue(builder)
  return builder
}

describe('psychological intake persistence', () => {
  beforeEach(() => { vi.clearAllMocks(); client = createMockSupabase(); vi.mocked(assertCaseNotClosed).mockResolvedValue({ error: null }) })

  it('merges only the selected section into current stored intake and marks the note for review', async () => {
    const builder = mockNote({ provider_intake: { ...defaultProviderIntake, social_history: { ...defaultProviderIntake.social_history, occupation: 'Current stored occupation' } } })
    const result = await saveProviderIntake('case', 'initial_visit', input, 'psychological_assessment')
    expect(result.error).toBeUndefined()
    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ provider_intake: expect.objectContaining({
      social_history: expect.objectContaining({ occupation: 'Current stored occupation' }),
      psychological_assessment: expect.objectContaining({ note_review_required: true, symptoms: ['Nightmares'] }),
    }) }))
    expect(builder.eq).toHaveBeenCalledWith('visit_type', 'initial_visit')
    expect(builder.eq).toHaveBeenCalledWith('updated_at', 'v1')
    expect(builder.eq).toHaveBeenCalledWith('status', 'draft')
  })
  it('does not let another card overwrite the saved psychological assessment', async () => {
    const builder = mockNote({ provider_intake: input })
    await saveProviderIntake('case', 'initial_visit', defaultProviderIntake, 'chief_complaints')
    expect(builder.update.mock.calls[0][0].provider_intake.psychological_assessment.symptoms).toEqual(['Nightmares'])
  })
  it('does not require review before any note has been generated', async () => {
    const builder = mockNote({ introduction: null, chief_complaint: null })
    await saveProviderIntake('case', 'initial_visit', input, 'psychological_assessment')
    expect(builder.update.mock.calls[0][0].provider_intake.psychological_assessment.note_review_required).toBe(false)
  })
  it('requires authentication before accessing intake', async () => {
    client.auth.getUser.mockResolvedValue({ data: { user: null }, error: null })
    expect((await saveProviderIntake('case', 'initial_visit', input, 'psychological_assessment')).error).toBe('Not authenticated')
    expect(client.from).not.toHaveBeenCalled()
  })
  it('preserves the assessment for legacy whole-intake callers', async () => {
    const builder = mockNote({ provider_intake: input })
    await saveProviderIntake('case', 'initial_visit', defaultProviderIntake)
    expect(builder.update.mock.calls[0][0].provider_intake.psychological_assessment.symptoms).toEqual(['Nightmares'])
  })
  it.each(['finalized', 'generating'])('rejects intake writes for a %s note', async status => {
    const builder = mockNote({ status })
    expect((await saveProviderIntake('case', 'initial_visit', input, 'psychological_assessment')).error).toContain('cannot be changed')
    expect(builder.update).not.toHaveBeenCalled()
  })
  it('does not update the other visit type', async () => {
    expect((await saveProviderIntake('case', 'pain_evaluation_visit', input, 'psychological_assessment')).error).toContain('Initial Visit only')
    expect(client.from).not.toHaveBeenCalled()
  })
  it('returns a retry error when the note changes during a save', async () => {
    const builder = mockNote()
    builder.maybeSingle.mockResolvedValue({ data: null, error: null })
    expect((await saveProviderIntake('case', 'initial_visit', input, 'psychological_assessment')).error).toContain('retry saving')
  })
  it('fails closed on read errors without attempting an insert', async () => {
    const builder = createMockQueryBuilder({ data: null, error: { message: 'Read failed' } })
    client.from.mockReturnValue(builder)
    expect((await saveProviderIntake('case', 'initial_visit', input, 'psychological_assessment')).error).toContain('Unable to load')
    expect(builder.insert).not.toHaveBeenCalled()
  })
  it('rejects writes for closed cases', async () => {
    vi.mocked(assertCaseNotClosed).mockResolvedValue({ error: 'Case is closed' })
    expect((await saveProviderIntake('case', 'initial_visit', input, 'psychological_assessment')).error).toBe('Case is closed')
    expect(client.from).not.toHaveBeenCalled()
  })
  it('requires the reviewed version when acknowledging changed source data', async () => {
    const builder = mockNote({ provider_intake: input })
    expect((await acknowledgePsychologicalReview('case', 'older')).error).toContain('note changed')
    expect(builder.update).not.toHaveBeenCalled()
  })
  it('acknowledges review without removing assessment content', async () => {
    const builder = mockNote({ provider_intake: { ...input, psychological_assessment: { ...input.psychological_assessment, note_review_required: true } } })
    expect((await acknowledgePsychologicalReview('case', 'v1')).data?.updated_at).toBe('v2')
    expect(builder.update.mock.calls[0][0].provider_intake.psychological_assessment).toMatchObject({ note_review_required: false, symptoms: ['Nightmares'] })
  })
  it('blocks finalization before PDF creation when source review is outstanding', async () => {
    mockNote({ provider_intake: { ...input, psychological_assessment: { ...input.psychological_assessment, note_review_required: true } } })
    expect((await finalizeInitialVisitNote('case', 'initial_visit', 'v1')).error).toContain('Review the affected')
  })
})
