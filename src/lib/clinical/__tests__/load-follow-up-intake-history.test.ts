import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockQueryBuilder, createMockSupabase } from '@/test-utils/supabase-mock'
import type { Tables } from '@/types/database'
vi.mock('@/lib/claude/summarize-follow-up-intake', () => ({ summarizeFollowUpIntake: vi.fn() }))
import { summarizeFollowUpIntake } from '@/lib/claude/summarize-follow-up-intake'
import { loadFollowUpIntakeHistory } from '../load-follow-up-intake-history'

beforeEach(() => { vi.clearAllMocks(); vi.mocked(summarizeFollowUpIntake).mockImplementation(async (source) => ({ data: { chiefComplaint: source.previousVisit?.complaint ?? '', intervalHistory: [source.previousVisit?.plan, source.previousDischarge?.text].filter(Boolean).join(' ') } })) })

const encounter = { status: 'in_progress', provider_intake: {}, id: 'current', case_id: 'case', episode_id: 'episode', encounter_date: '2026-09-12' } as Tables<'clinical_encounters'>
function setup(overrides: Record<string, unknown> = {}, fail?: string) {
  const data: Record<string, unknown> = {
    clinical_encounters: [
      { id: 'old', encounter_date: '2026-09-01', provider_intake: { chief_complaint: 'Old pain' } },
      { id: 'recent', encounter_date: '2026-09-09', provider_intake: { chief_complaint: 'Recent pain' }, patient_reported_pain_min: 3, patient_reported_pain_max: 6 },
      { id: 'draft', encounter_date: '2026-09-11', provider_intake: { chief_complaint: 'Unfinalized' } },
    ],
    initial_visit_notes: [{ id: 'initial', encounter_id: 'old', visit_date: '2026-09-01', chief_complaint: 'Initial pain', treatment_plan: 'Initial plan' }],
    pain_follow_up_notes: [{ id: 'follow', encounter_id: 'recent', treatment_plan: 'Recent plan' }],
    procedures: [], care_episodes: { episode_number: 1 }, ...overrides,
  }
  const client = createMockSupabase()
  const queries: Record<string, ReturnType<typeof createMockQueryBuilder>> = {}
  client.from.mockImplementation((table: string) => {
    const query = createMockQueryBuilder({ data: data[table] ?? null, error: fail === table ? { message: 'failed' } : null })
    queries[table] = query
    return query
  })
  return { client, queries }
}

describe('follow-up history loading', () => {
  it('selects the latest finalized visit and enforces source scoping/filter contracts', async () => {
    const { client, queries } = setup()
    const result = await loadFollowUpIntakeHistory(client as never, encounter)
    expect(result.data?.chiefComplaint).toContain('Recent pain')
    expect(result.data?.intervalHistory).toContain('Recent plan')
    expect(result.data?.intervalHistory).not.toContain('Initial plan')
    for (const table of ['clinical_encounters', 'initial_visit_notes', 'pain_follow_up_notes', 'procedures']) {
      expect(queries[table].eq).toHaveBeenCalledWith('case_id', 'case')
      expect(queries[table].eq).toHaveBeenCalledWith('episode_id', 'episode')
      expect(queries[table].is).toHaveBeenCalledWith('deleted_at', null)
    }
    expect(queries.clinical_encounters.eq).toHaveBeenCalledWith('status', 'completed')
    expect(queries.clinical_encounters.neq).toHaveBeenCalledWith('id', 'current')
    expect(queries.clinical_encounters.lt).toHaveBeenCalledWith('encounter_date', '2026-09-12')
    expect(queries.initial_visit_notes.eq).toHaveBeenCalledWith('status', 'finalized')
    expect(queries.pain_follow_up_notes.eq).toHaveBeenCalledWith('status', 'finalized')
    expect(queries.initial_visit_notes.lt).toHaveBeenCalledWith('visit_date', '2026-09-12')
    expect(queries.procedures.lt).toHaveBeenCalledWith('procedure_date', '2026-09-12')
  })
  it('uses finalized initial evaluation complaint and plan when it is the latest eligible visit', async () => {
    const { client } = setup({ pain_follow_up_notes: [] })
    const result = await loadFollowUpIntakeHistory(client as never, encounter)
    expect(result.data?.chiefComplaint).toContain('Initial pain')
    expect(result.data?.intervalHistory).toContain('Initial plan')
  })
  it('omits notes whose date is not before the current visit', async () => {
    const { client } = setup({ pain_follow_up_notes: [], initial_visit_notes: [{ id: 'initial', encounter_id: 'old', visit_date: '2026-09-12', chief_complaint: 'Same day' }] })
    expect((await loadFollowUpIntakeHistory(client as never, encounter)).data?.chiefComplaint).toBe('')
  })
  it('loads the immediately previous episode finalized discharge as dated background', async () => {
    const { client } = setup({ clinical_encounters: [], initial_visit_notes: [], pain_follow_up_notes: [] })
    const original = client.from.getMockImplementation()!
    let episodeCalls = 0
    const discharge = createMockQueryBuilder({ data: { id: 'discharge', visit_date: '2026-08-01', assessment: 'Prior assessment', plan_and_recommendations: 'Prior plan' }, error: null })
    const previous = createMockQueryBuilder({ data: { id: 'previous' }, error: null })
    client.from.mockImplementation((table: string) => {
      if (table === 'care_episodes') return ++episodeCalls === 1 ? createMockQueryBuilder({ data: { episode_number: 2 }, error: null }) : previous
      return table === 'discharge_notes' ? discharge : original(table)
    })
    const result = await loadFollowUpIntakeHistory(client as never, encounter)
    expect(previous.eq).toHaveBeenCalledWith('episode_number', 1)
    expect(discharge.eq).toHaveBeenCalledWith('episode_id', 'previous')
    expect(discharge.eq).toHaveBeenCalledWith('status', 'finalized')
    expect(discharge.lt).toHaveBeenCalledWith('visit_date', '2026-09-12')
    expect(result.data?.intervalHistory).toContain('Prior assessment')
    expect(result.data?.sources[0].label).toBe('Previous episode discharge on 2026-08-01')
  })
  it.each(['clinical_encounters', 'initial_visit_notes', 'pain_follow_up_notes', 'procedures', 'care_episodes'])('returns no partial prefill when %s fails', async (table) => {
    const { client } = setup({}, table)
    const result = await loadFollowUpIntakeHistory(client as never, encounter)
    expect(result.data).toBeNull()
    expect(result.error).toContain('manually')
  })
  it('uses concise summaries rather than the full source text', async () => {
    const { client } = setup()
    vi.mocked(summarizeFollowUpIntake).mockResolvedValue({ data: { chiefComplaint: 'The patient presents for follow-up for knee pain.', intervalHistory: 'Physical therapy was previously recommended.' } })
    const result = await loadFollowUpIntakeHistory(client as never, encounter)
    expect(summarizeFollowUpIntake).toHaveBeenCalledWith({ visitDate: '2026-09-12', previousVisit: { date: '2026-09-09', complaint: 'Recent pain', response: '', plan: 'Recent plan' }, procedures: [], previousDischarge: null })
    expect(result.data?.chiefComplaint).toBe('The patient presents for follow-up for knee pain.')
    expect(result.data?.intervalHistory).toBe('Physical therapy was previously recommended.')
    expect(result.data?.previousPain).toEqual({ date: '2026-09-09', min: 3, max: 6 })
    expect(result.data?.sources[0].id).toBe('follow')
  })
  it('passes documented response and procedure series/dates to support natural session wording', async () => {
    const { client, queries } = setup({
      pain_follow_up_notes: [{ id: 'follow', encounter_id: 'recent', subjective: 'The patient reports moderate improvement.', interval_history: 'Improvement followed the second PRP session.', treatment_plan: 'Continue therapy.' }],
      procedures: [{ id: 'p1', procedure_date: '2026-09-02', procedure_type: 'prp', series_id: 'series', sites: [] }, { id: 'p2', procedure_date: '2026-09-08', procedure_type: 'prp', series_id: 'series', sites: [] }],
    })
    await loadFollowUpIntakeHistory(client as never, encounter)
    const source = vi.mocked(summarizeFollowUpIntake).mock.calls[0][0]
    expect(source.previousVisit?.date).toBe('2026-09-09')
    expect(source.previousVisit?.response).toContain('moderate improvement')
    expect(source.procedures).toEqual([{ date: '2026-09-02', type: 'prp', seriesId: 'series', sites: [] }, { date: '2026-09-08', type: 'prp', seriesId: 'series', sites: [] }])
    expect(queries.pain_follow_up_notes.select).toHaveBeenCalledWith('id,encounter_id,subjective,interval_history,treatment_plan')
  })
  it('never falls back to full text when summaries fail', async () => {
    const { client } = setup()
    vi.mocked(summarizeFollowUpIntake).mockResolvedValue({ error: 'Unavailable' })
    const result = await loadFollowUpIntakeHistory(client as never, encounter)
    expect(result.error).toContain('summaries could not')
    expect(result.data?.chiefComplaint).toBe('')
    expect(result.data?.intervalHistory).toBe('')
    expect(result.data?.previousPain?.min).toBe(3)
  })
  it.each([{ provider_intake: { chief_complaint: '' } }, { status: 'completed' }])('skips summary calls for existing or closed intake %j', async (saved) => {
    const { client } = setup()
    await loadFollowUpIntakeHistory(client as never, { ...encounter, ...saved })
    expect(summarizeFollowUpIntake).not.toHaveBeenCalled()
  })
  it('does not query without a visit date', async () => {
    const { client } = setup()
    expect(await loadFollowUpIntakeHistory(client as never, { ...encounter, encounter_date: null })).toEqual({ data: null })
    expect(client.from).not.toHaveBeenCalled()
  })
})
