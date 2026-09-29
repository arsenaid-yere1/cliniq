import { beforeEach, expect, it, vi } from 'vitest'
import { createMockQueryBuilder, createMockSupabase } from '@/test-utils/supabase-mock'
let client: ReturnType<typeof createMockSupabase>
let rows: Record<string, Array<Record<string, unknown>>>
let failure: string | null
const builders: ReturnType<typeof createMockQueryBuilder>[] = []
vi.mock('@/lib/supabase/server', () => ({ createClient: () => client }))
vi.mock('@/lib/features/return-tele-visits', () => ({ RETURN_TELE_VISITS_ENABLED: true }))
import { getCaseVisitOverview } from '../visit-summaries'
beforeEach(() => {
  client = createMockSupabase(); failure = null; builders.length = 0
  rows = {
    cases: [{ case_status: 'active', assigned_provider_id: 'test-user-id' }], users: [{ role: 'provider', is_active: true }],
    care_episodes: [{ id: 'ep', case_id: 'case', episode_number: 1, status: 'active', requires_pain_evaluation: false, opened_at: '2026-09-01', ended_at: null, return_reason: null }],
    clinical_encounters: [{ id: 'visit', case_id: 'case', episode_id: 'ep', encounter_type: 'initial_evaluation', status: 'in_progress', encounter_date: '2026-09-01', modality: 'phone', provider_id: null, scheduled_start: null }],
    initial_visit_notes: [{ id: 'note', case_id: 'case', episode_id: 'ep', encounter_id: 'visit', visit_type: 'initial_visit', status: 'draft', visit_date: '2026-09-01', introduction: 'PRIVATE NARRATIVE', chief_complaint: 'PRIVATE COMPLAINT', document_id: null }],
  }
  client.from.mockImplementation((table: string) => {
    const data = rows[table] ?? []
    let error = table === failure ? { message: 'database details' } : null
    const builder = createMockQueryBuilder({ data: data[0] ?? null, error })
    // Follow-up dates live on clinical_encounters, never on the note table.
    builder.select.mockImplementation((fields: string) => {
      if (table === 'pain_follow_up_notes' && fields.split(',').includes('visit_date')) {
        error = { message: 'column pain_follow_up_notes.visit_date does not exist' }
      }
      return builder
    })
    let start = 0; let end = 499
    builder.range.mockImplementation((from: number, to: number) => { start = from; end = to; return builder })
    builder.then = (resolve: (result: unknown) => unknown) => Promise.resolve({ data: error ? null : data.slice(start, end + 1), error, count: data.length }).then(resolve)
    builders.push(builder)
    return builder
  })
})
it('returns only summaries and performs no writes', async () => {
  const result = await getCaseVisitOverview('case')
  expect(result.data?.episodes[0].rows[0].noteState).toBe('Draft')
  expect(JSON.stringify(result)).not.toContain('PRIVATE')
  for (const builder of builders) { expect(builder.insert).not.toHaveBeenCalled(); expect(builder.update).not.toHaveBeenCalled() }
  expect(client.rpc).not.toHaveBeenCalled()
})
it.each(['care_episodes', 'clinical_encounters', 'initial_visit_notes', 'pain_follow_up_notes', 'discharge_notes', 'discharge_note_corrections', 'procedure_orders', 'procedure_appointments'])('fails closed when %s cannot load', async table => {
  failure = table
  expect(await getCaseVisitOverview('case')).toMatchObject({ error: expect.stringContaining('Unable to load complete') })
})
it('permits history viewing when provider names fail but disables scheduling', async () => {
  failure = 'provider_profiles'
  const result = await getCaseVisitOverview('case')
  expect(result.data?.providerError).toBe(true)
  expect(result.data?.episodes[0].canSchedule).toBe(false)
})
it('authenticates before reading case data', async () => {
  client.auth.getUser.mockResolvedValue({ data: { user: null }, error: null })
  expect(await getCaseVisitOverview('case')).toEqual({ error: 'Not authenticated' })
  expect(client.from).not.toHaveBeenCalled()
})

it('uses the encounter service date for existing follow-ups without a note date column', async () => {
  rows.clinical_encounters.push({ id: 'follow-up', case_id: 'case', episode_id: 'ep', encounter_type: 'pain_follow_up', status: 'completed', encounter_date: '2026-09-29', modality: 'telehealth', provider_id: null, scheduled_start: '2026-09-28T18:00:00Z' })
  rows.pain_follow_up_notes = [{ id: 'follow-up-note', case_id: 'case', episode_id: 'ep', encounter_id: 'follow-up', status: 'finalized', subjective: 'PRIVATE FOLLOW-UP', procedure_recommendations: [], document_id: null }]
  const result = await getCaseVisitOverview('case')
  expect(result.error).toBeUndefined()
  expect(result.data?.episodes[0].rows.find(row => row.encounterId === 'follow-up')).toMatchObject({ noteState: 'Finalized', serviceDate: '2026-09-29', scheduledStart: '2026-09-28T18:00:00Z' })
  expect(JSON.stringify(result)).not.toContain('PRIVATE')
})
