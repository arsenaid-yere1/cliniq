import { describe, expect, it } from 'vitest'
import { createMockQueryBuilder, createMockSupabase } from '@/test-utils/supabase-mock'
import type { Tables } from '@/types/database'
import { loadFollowUpIntakeHistory } from '../load-follow-up-intake-history'

const encounter = { id: 'current', case_id: 'case', episode_id: 'episode', encounter_date: '2026-09-12' } as Tables<'clinical_encounters'>
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
    expect(result.data?.intervalHistory).toContain('Previous episode discharge on 2026-08-01 (background)')
  })
  it.each(['clinical_encounters', 'initial_visit_notes', 'pain_follow_up_notes', 'procedures', 'care_episodes'])('returns no partial prefill when %s fails', async (table) => {
    const { client } = setup({}, table)
    const result = await loadFollowUpIntakeHistory(client as never, encounter)
    expect(result.data).toBeNull()
    expect(result.error).toContain('manually')
  })
  it('does not query without a visit date', async () => {
    const { client } = setup()
    expect(await loadFollowUpIntakeHistory(client as never, { ...encounter, encounter_date: null })).toEqual({ data: null })
    expect(client.from).not.toHaveBeenCalled()
  })
})
