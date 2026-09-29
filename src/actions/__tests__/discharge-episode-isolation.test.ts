import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockQueryBuilder, createMockSupabase } from '@/test-utils/supabase-mock'
import { dischargeNoteSections, type DischargeNoteEditValues } from '@/lib/validations/discharge-note'

const state = vi.hoisted(() => ({ get: vi.fn(), latest: vi.fn(), writable: vi.fn(), advance: vi.fn() }))
let client: ReturnType<typeof createMockSupabase>
let note: ReturnType<typeof createMockQueryBuilder>
let corrections: ReturnType<typeof createMockQueryBuilder>
vi.mock('@/lib/supabase/server', () => ({ createClient: () => client }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/actions/case-status', () => ({ assertCaseNotClosed: async () => ({}), autoAdvanceFromIntake: state.advance }))
vi.mock('@/lib/clinical/episode-context', () => ({ getEpisodeById: state.get, getActiveOrLatestEpisode: state.latest, requireWritableEpisode: state.writable, ensureEpisodeEncounter: vi.fn() }))
import { generateDischargeNote, saveDischargeNote, finalizeDischargeNote, regenerateDischargeNoteSectionAction, resetDischargeNote, getDischargeNote, getDischargeVitals, getDischargePainTimeline, saveDischargeVitals, saveDischargeNoteToneHint } from '../discharge-notes'
import { refreshDischargeTrajectory } from '../discharge-notes-trajectory'
import type { DischargeNoteInputData } from '@/lib/claude/generate-discharge-note'
const values = { visit_date: '2026-09-01', ...Object.fromEntries(dischargeNoteSections.map(s => [s, 'Content'])) } as DischargeNoteEditValues
const vitals = { bp_systolic: null, bp_diastolic: null, heart_rate: null, respiratory_rate: null, temperature_f: null, spo2_percent: null, pain_score_min: 1, pain_score_max: 2 }
const mutations = [
  ['generate', () => generateDischargeNote('case', null, null, 'old')],
  ['save', () => saveDischargeNote('case', values, 'old')],
  ['finalize', () => finalizeDischargeNote('case', 'v1', 'old')],
  ['regenerate', () => regenerateDischargeNoteSectionAction('case', 'subjective', undefined, 'v1', undefined, 'old')],
  ['reset', () => resetDischargeNote('case', 'old')],
  ['vitals', () => saveDischargeVitals('case', vitals, 'old')],
  ['tone', () => saveDischargeNoteToneHint('case', 'Concise', { noteId: 'note', expectedUpdatedAt: 'v1' }, 'old')],
] as const
beforeEach(() => {
  vi.clearAllMocks()
  client = createMockSupabase()
  note = createMockQueryBuilder({ data: { id: 'note', case_id: 'case', episode_id: 'old', status: 'draft', updated_at: 'v1' }, error: null })
  corrections = createMockQueryBuilder({ data: [], error: null })
  client.from.mockImplementation((table: string) => table === 'discharge_note_corrections' ? corrections : note)
  state.get.mockResolvedValue({ id: 'old', case_id: 'case', status: 'active' })
  state.latest.mockResolvedValue({ id: 'new', case_id: 'case', status: 'active' })
  state.writable.mockResolvedValue({ id: 'old', status: 'active' })
})
describe('explicit discharge episode isolation', () => {
  it.each(mutations)('rejects historical %s without writing to the new active episode', async (_, action) => {
    state.writable.mockRejectedValue(new Error('This care episode is not active'))
    expect(await action()).toMatchObject({ error: 'This care episode is not active' })
    expect(state.get).toHaveBeenCalledWith('case', 'old', client)
    expect(state.latest).not.toHaveBeenCalled()
    expect(note.update).not.toHaveBeenCalled()
    expect(note.insert).not.toHaveBeenCalled()
    expect(client.rpc).not.toHaveBeenCalled()
    expect(state.advance).not.toHaveBeenCalled()
  })
  it.each([getDischargeNote, getDischargeVitals])('allows exact historical reads', async read => {
    state.writable.mockRejectedValue(new Error('not active'))
    expect(await read('case', 'old')).toHaveProperty('data')
    expect(note.eq).toHaveBeenCalledWith('episode_id', 'old')
    expect(state.latest).not.toHaveBeenCalled()
    expect(state.writable).not.toHaveBeenCalled()
  })
  it.each([getDischargeNote, getDischargeVitals, getDischargePainTimeline])('fails closed on wrong-case/deleted/query-failed scope', async read => {
    state.get.mockRejectedValue(new Error('Care episode does not belong to this case'))
    expect(await read('case', 'foreign')).toHaveProperty('error')
    expect(client.from).not.toHaveBeenCalled()
  })
  it('does not treat a failed correction lookup as no correction', async () => {
    corrections = createMockQueryBuilder({ data: null, error: { message: 'unavailable' } })
    expect(await mutations[0][1]()).toEqual({ error: 'Unable to check discharge correction status' })
    expect(note.update).not.toHaveBeenCalled()
  })
  it('preserves finalized replay without reopening a historical episode', async () => {
    note.maybeSingle.mockResolvedValue({ data: { status: 'finalized', updated_at: 'v1' }, error: null })
    expect(await finalizeDischargeNote('case', 'v1', 'old')).toEqual({ data: { success: true, replayed: true } })
    expect(state.writable).not.toHaveBeenCalled()
    expect(client.rpc).not.toHaveBeenCalled()
  })
  it('rejects mismatched cached trajectory identity without writing', async () => {
    const result = await refreshDischargeTrajectory('case', 'note', { source: { caseId: 'case', episodeId: 'new', inputData: {} as DischargeNoteInputData } })
    expect(result).toEqual({ error: 'Discharge source does not match the selected note' })
    expect(note.update).not.toHaveBeenCalled()
  })
  it('re-gathers absent cached input using the note-owned episode', async () => {
    // Force the gatherer to stop at its scoped episode lookup; this still verifies identity.
    const episodes = createMockQueryBuilder({ data: null, error: null })
    client.from.mockImplementation((table: string) => table === 'care_episodes' ? episodes : table === 'discharge_note_corrections' ? corrections : note)
    expect(await refreshDischargeTrajectory('case', 'note')).toEqual({ error: 'Care episode not found' })
    expect(episodes.eq).toHaveBeenCalledWith('id', 'old')
    expect(state.latest).not.toHaveBeenCalled()
    expect(note.update).not.toHaveBeenCalled()
  })
})
