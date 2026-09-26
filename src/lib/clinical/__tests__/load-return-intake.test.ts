import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockQueryBuilder, createMockSupabase } from '@/test-utils/supabase-mock'
import { defaultProviderIntake } from '@/lib/validations/initial-visit-note'
import { loadReturnIntake } from '../load-return-intake'
import type { CareEpisode } from '../episode-context'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
const episode = { id: 'current', case_id: 'case', episode_number: 4, status: 'active', opened_at: '2026-09-25T10:00:00Z' } as CareEpisode
const current = () => ({ provider_intake: {}, status: 'draft', visit_date: '2026-09-25' })
const source = (id = 'prior', number = 2, date = '2026-08-01') => ({
  id, case_id: 'case', episode_id: `ep-${number}`, visit_type: 'pain_evaluation_visit', visit_date: date,
  status: 'finalized', deleted_at: null,
  provider_intake: { ...structuredClone(defaultProviderIntake),
    accident_details: { ...defaultProviderIntake.accident_details, narrative: 'Rear impact', seatbelt_worn: false },
    social_history: { ...defaultProviderIntake.social_history, occupation: `Work ${number}` },
    past_medical_history: { ...defaultProviderIntake.past_medical_history, medical_conditions: 'Prior history' },
    chief_complaints: { ...defaultProviderIntake.chief_complaints, additional_notes: 'Old pain' },
    exam_findings: { ...defaultProviderIntake.exam_findings, general_appearance: 'Old exam' },
  },
  clinical_encounters: { case_id: 'case', episode_id: `ep-${number}`, encounter_type: 'pain_evaluation', encounter_date: date, status: 'completed', deleted_at: null as string | null },
})
let client: ReturnType<typeof createMockSupabase>
let previous: ReturnType<typeof source>[]
let queries: ReturnType<typeof createMockQueryBuilder>[]
let fail: string | undefined
beforeEach(() => {
  previous = [source()]; queries = []; fail = undefined; client = createMockSupabase()
  client.from.mockImplementation(table => {
    const query = createMockQueryBuilder(); queries.push(query)
    let epId: string | undefined
    query.eq.mockImplementation((key: string, value: string) => { if (key === 'episode_id') epId = value; return query })
    query.then = (resolve: (value: unknown) => void) => resolve({ error: fail === table ? { message: 'Private DB error' } : null,
      data: table === 'care_episodes' ? [3,2,1].map(n => ({ id: `ep-${n}`, case_id: 'case', episode_number: n, status: 'discharged' })) : previous.filter(n => n.episode_id === epId) })
    return query
  })
})
const load = (note: Parameters<typeof loadReturnIntake>[3] = current(), ep = episode) => loadReturnIntake(client as never, 'case', ep, note, 'pain_evaluation_visit')
describe('return intake prefill', () => {
  it('carries only three history sections across episode gaps without mutating sources', async () => {
    const before = structuredClone(previous)
    const result = await load()
    expect(result.carriedSections.map(s => s.section)).toEqual(['accident_details','past_medical_history','social_history'])
    expect(result.carriedSections.every(s => s.episodeNumber === 2 && s.visitDate === '2026-08-01')).toBe(true)
    expect(result.data).toMatchObject({ accident_details: { narrative: 'Rear impact', seatbelt_worn: false }, social_history: { occupation: 'Work 2' }, chief_complaints: defaultProviderIntake.chief_complaints, exam_findings: defaultProviderIntake.exam_findings })
    expect(result.data).not.toHaveProperty('psychological_assessment')
    expect(previous).toEqual(before)
    for (const query of queries) for (const method of ['insert','update','upsert','delete']) expect(query[method]).not.toHaveBeenCalled()
    expect(queries[0].lt).toHaveBeenCalledWith('episode_number', 4)
    expect(queries[0].eq).toHaveBeenCalledWith('status', 'discharged')
    expect(queries[1].select.mock.calls[0][0]).toContain('!initial_visit_notes_encounter_id_fkey(')
  })
  it('preserves every existing section, including cleared and default values', async () => {
    const note = current(); note.provider_intake = { accident_details: null, social_history: defaultProviderIntake.social_history }
    const result = await load(note)
    expect(result.data).toMatchObject({ accident_details: null, social_history: defaultProviderIntake.social_history })
    expect(result.carriedSections.map(s => s.section)).toEqual(['past_medical_history'])
  })
  it('prefers the most recent episode and falls back per section when a section is invalid', async () => {
    const newer = source('newer',3); newer.provider_intake.accident_details = {} as never
    previous.push(newer)
    const result = await load()
    expect(result.carriedSections.find(s => s.section === 'accident_details')?.episodeNumber).toBe(2)
    expect(result.data).toMatchObject({ social_history: { occupation: 'Work 3' } })
  })
  it('prefers later clinical dates and pain evaluation on date ties', async () => {
    const initial = source('initial',2); initial.visit_type = 'initial_visit'; initial.clinical_encounters.encounter_type = 'initial_evaluation'; initial.provider_intake.social_history.occupation = 'Initial'
    previous.unshift(initial)
    expect((await load()).data).toMatchObject({ social_history: { occupation: 'Work 2' } })
    initial.visit_date = '2026-09-01'
    expect((await load()).data).toMatchObject({ social_history: { occupation: 'Initial' } })
  })
  it.each(['future','undated','draft','deleted','wrong case','wrong episode','cancelled encounter','deleted encounter','wrong encounter type','wrong encounter case'])('excludes %s sources', async reason => {
    const row = previous[0]
    if (reason === 'future') row.visit_date = '2026-10-01'
    if (reason === 'undated') { row.visit_date = ''; row.clinical_encounters.encounter_date = '' }
    if (reason === 'draft') row.status = 'draft'
    if (reason === 'deleted') row.deleted_at = 'deleted' as never
    if (reason === 'wrong case') row.case_id = 'other'
    if (reason === 'wrong episode') row.clinical_encounters.episode_id = 'other'
    if (reason === 'cancelled encounter') row.clinical_encounters.status = 'cancelled'
    if (reason === 'deleted encounter') row.clinical_encounters.deleted_at = 'deleted'
    if (reason === 'wrong encounter type') row.clinical_encounters.encounter_type = 'discharge'
    if (reason === 'wrong encounter case') row.clinical_encounters.case_id = 'other'
    expect((await load()).carriedSections).toEqual([])
  })
  it('uses encounter date when the note date is absent', async () => {
    previous[0].visit_date = ''
    expect((await load()).carriedSections).toHaveLength(3)
  })
  it('leaves existing complete, generated, failed, finalized, Episode 1 and discharged records untouched', async () => {
    for (const note of [{ ...current(), provider_intake: defaultProviderIntake }, { ...current(), introduction: 'Saved prose' }, { ...current(), chief_complaint: 'Saved complaint' }, { ...current(), status: 'finalized' }, { ...current(), status: 'failed' }]) expect((await load(note)).carriedSections).toEqual([])
    await load(current(), { ...episode, episode_number: 1 })
    await load(current(), { ...episode, status: 'discharged' })
    expect(client.from).not.toHaveBeenCalled()
  })
  it.each(['care_episodes','initial_visit_notes'])('surfaces %s read failures', async table => {
    fail = table
    await expect(load()).rejects.toThrow('Previous episode intake could not be loaded')
  })
  it('validates ownership and leaves missing history empty', async () => {
    await expect(load(current(), { ...episode, case_id: 'other' })).rejects.toThrow('does not belong')
    previous = []
    expect((await load()).carriedSections).toEqual([])
  })
})
