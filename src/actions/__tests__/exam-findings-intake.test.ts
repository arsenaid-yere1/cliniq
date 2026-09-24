vi.mock('@/lib/clinical/evaluation-scope', () => ({ resolveEvaluationEpisode: async () => ({ episode: { id: 'episode', episode_number: 1 } }) }))
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockQueryBuilder, createMockSupabase } from '@/test-utils/supabase-mock'
import { defaultProviderIntake } from '@/lib/validations/initial-visit-note'
import { defaultPsychologicalAssessment } from '@/lib/validations/psychological-assessment'
let client: ReturnType<typeof createMockSupabase>
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => client }))
vi.mock('@/actions/case-status', () => ({ assertCaseNotClosed: vi.fn(async () => ({ error: null })), autoAdvanceFromIntake: vi.fn() }))
vi.mock('@/lib/clinical/episode-context', () => ({ ensureEpisodeEncounter: vi.fn(async () => ({ episodeId: 'episode', encounterId: 'encounter' })) }))
import { saveProviderIntake, acknowledgePsychologicalReview } from '../initial-visit-notes'
import { assertCaseNotClosed } from '../case-status'
const intake = (muscle_spasm: boolean | null) => ({ ...structuredClone(defaultProviderIntake),
  exam_findings: { general_appearance: 'Saved appearance', neurological_notes: null,
    regions: [{ region: 'Knee', palpation_findings: '', additional_findings: null, muscle_spasm }] } })
function note(status = 'draft') {
  const stored = { ...intake(null), psychological_assessment: defaultPsychologicalAssessment }
  const row = { id: 'note', status, updated_at: 'v1', provider_intake: stored }
  const builder = createMockQueryBuilder()
  builder.maybeSingle.mockResolvedValueOnce({ data: row, error: null }).mockResolvedValue({ data: { id: 'note' }, error: null })
  builder.single.mockResolvedValueOnce({ data: row, error: null }).mockResolvedValue({ data: { updated_at: 'v2' }, error: null })
  client.from.mockReturnValue(builder)
  return builder
}
beforeEach(() => { vi.clearAllMocks(); client = createMockSupabase(); vi.mocked(assertCaseNotClosed).mockResolvedValue({ error: null }) })
describe('exam intake persistence', () => {
  for (const visit of ['initial_visit', 'pain_evaluation_visit'] as const) {
    it.each([null, false, true])(`preserves %s and siblings for ${visit}`, async spasm => {
      const builder = note()
      expect((await saveProviderIntake('case', visit, intake(spasm), 'exam_findings')).error).toBeUndefined()
      expect(builder.update.mock.calls[0][0].provider_intake.exam_findings).toEqual(intake(spasm).exam_findings)
      expect(builder.update.mock.calls[0][0].provider_intake.psychological_assessment).toBeTruthy()
      expect(builder.eq).toHaveBeenCalledWith('visit_type', visit)
      expect(builder.eq).toHaveBeenCalledWith('updated_at', 'v1')
    })
    it(`inserts a first ${visit} with nullable findings`, async () => {
      const builder = createMockQueryBuilder()
      builder.single.mockResolvedValue({ data: { assigned_provider_id: 'provider' }, error: null })
      client.from.mockReturnValue(builder)
      expect((await saveProviderIntake('case', visit, intake(null), 'exam_findings')).error).toBeUndefined()
      expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ encounter_id: 'encounter', provider_intake: expect.objectContaining({ exam_findings: intake(null).exam_findings }) }))
    })
  }
  it('preserves a nullable exam when saving another section', async () => {
    const builder = note()
    await saveProviderIntake('case', 'initial_visit', defaultProviderIntake, 'social_history')
    expect(builder.update.mock.calls[0][0].provider_intake.exam_findings).toEqual(intake(null).exam_findings)
  })
  it('acknowledges psychological review with a nullable exam', async () => {
    const builder = note()
    expect((await acknowledgePsychologicalReview('case', 'v1')).error).toBeUndefined()
    expect(builder.update.mock.calls[0][0].provider_intake.exam_findings).toEqual(intake(null).exam_findings)
  })
  it.each(['generating', 'finalized'])('rejects %s writes', async status => {
    const builder = note(status)
    expect((await saveProviderIntake('case', 'initial_visit', intake(null), 'exam_findings')).error).toBeTruthy()
    expect(builder.update).not.toHaveBeenCalled()
  })
  it('retains optimistic concurrency rejection', async () => {
    const builder = note()
    builder.maybeSingle.mockResolvedValue({ data: null, error: null })
    expect((await saveProviderIntake('case', 'initial_visit', intake(null), 'exam_findings')).error).toContain('retry saving')
  })
  it('fails closed on read error', async () => {
    const builder = createMockQueryBuilder({ data: null, error: { message: 'offline' } }); client.from.mockReturnValue(builder)
    expect((await saveProviderIntake('case', 'initial_visit', intake(null), 'exam_findings')).error).toContain('Unable to load')
    expect(builder.insert).not.toHaveBeenCalled()
  })
  it('rejects closed and unauthenticated writes', async () => {
    vi.mocked(assertCaseNotClosed).mockResolvedValue({ error: 'Case is closed' })
    expect((await saveProviderIntake('case', 'initial_visit', intake(null), 'exam_findings')).error).toBe('Case is closed')
    client.auth.getUser.mockResolvedValue({ data: { user: null }, error: null })
    expect((await saveProviderIntake('case', 'initial_visit', intake(null), 'exam_findings')).error).toBe('Not authenticated')
    expect(client.from).not.toHaveBeenCalled()
  })
})
