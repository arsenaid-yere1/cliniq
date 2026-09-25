import type { HistoricalEpisodeRows } from '@/lib/clinical/prior-episode-history'
export function historicalEpisode(number = 1): HistoricalEpisodeRows {
  const episode = { id: `e${number}`, case_id: 'case', episode_number: number, status: 'discharged' }
  const owned = { case_id: 'case', episode_id: episode.id, status: 'finalized', updated_at: 'v1' }
  return {
    episode,
    clinical_encounters: [
      { ...owned, id: `eval-enc${number}`, encounter_type: 'pain_evaluation', status: 'completed', encounter_date: '2026-01-01' },
      { ...owned, id: `follow-enc${number}`, encounter_type: 'pain_follow_up', status: 'completed', encounter_date: '2026-01-03' },
      { ...owned, id: `dis-enc${number}`, encounter_type: 'discharge', status: 'completed', encounter_date: '2026-01-05' },
    ],
    initial_visit_notes: [{ ...owned, id: `eval${number}`, encounter_id: `eval-enc${number}`, visit_type: 'pain_evaluation_visit', chief_complaint: 'Prior pain', diagnoses: 'Prior diagnosis' }],
    pain_follow_up_notes: [{ ...owned, id: `follow${number}`, encounter_id: `follow-enc${number}`, subjective: 'Improved after treatment' }],
    discharge_notes: [{ ...owned, id: `dis${number}`, encounter_id: `dis-enc${number}`, assessment: 'Recovered; discharged', pain_score_max: 1, discharge_pain_estimated: false }],
    procedures: [{ ...owned, id: `proc${number}`, procedure_date: '2026-01-02', procedure_type: 'prp', sites: [], injection_site: 'Right Knee', patient_tolerance: 'well' }],
    procedure_notes: [{ case_id: 'case', id: `pn${number}`, procedure_id: `proc${number}`, status: 'finalized', subjective: 'Prior procedure narrative' }],
  }
}

import { createMockQueryBuilder, createMockSupabase } from './supabase-mock'
import type { HistoryRow } from '@/lib/clinical/prior-episode-history'

/** Executes scope, join and paging filters so unscoped history leaks fail tests. */
export function historyDatabase() {
  const prior = historicalEpisode()
  const tables: Record<string, HistoryRow[]> = {
    care_episodes: [prior.episode, { id: 'current', case_id: 'case', episode_number: 2, status: 'active', updated_at: 'v1' }],
    cases: [{ id: 'case', case_status: 'in_treatment', patient: { first_name: 'Test', last_name: 'Patient' } }],
    ...Object.fromEntries(Object.entries(prior).filter(([key]) => key !== 'episode')),
  }
  tables.initial_visit_notes.push({ id: 'current-note', case_id: 'case', episode_id: 'current', encounter_id: 'current-enc', visit_type: 'pain_evaluation_visit', visit_date: '2026-01-05', status: 'draft', chief_complaint: 'Pain returned', updated_at: 'v1' })
  tables.clinical_encounters.push({ id: 'current-enc', case_id: 'case', episode_id: 'current', encounter_type: 'pain_evaluation', encounter_date: '2026-01-05', status: 'in_progress' })
  const client = createMockSupabase()
  const errors = new Set<string>()
  const queries: Array<{ table: string; query: ReturnType<typeof createMockQueryBuilder> }> = []
  client.from.mockImplementation((table: string) => {
    const query = createMockQueryBuilder()
    const filters: Array<(row: HistoryRow) => boolean> = []
    let start = 0, end = Infinity
    const field = (row: HistoryRow, key: string) => key.startsWith('procedures.')
      ? tables.procedures.find(proc => proc.id === row.procedure_id)?.[key.split('.')[1]] : row[key]
    query.eq.mockImplementation((key: string, value: unknown) => { filters.push(row => field(row, key) === value); return query })
    query.is.mockImplementation((key: string, value: unknown) => { filters.push(row => (field(row, key) ?? null) === value); return query })
    query.lt.mockImplementation((key: string, value: number) => { filters.push(row => Number(field(row, key)) < value); return query })
    query.in.mockImplementation((key: string, values: unknown[]) => { filters.push(row => values.includes(field(row, key))); return query })
    query.range.mockImplementation((a: number, b: number) => { start = a; end = b; return query })
    const execute = (single = false) => {
      const rows = (tables[table] ?? []).filter(row => filters.every(filter => filter(row)))
        .sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(start, end + 1)
      return { data: single ? rows[0] ?? null : rows, error: errors.has(table) ? { message: 'Unavailable' } : null }
    }
    query.then = (resolve: (value: unknown) => void) => resolve(execute())
    query.single.mockImplementation(async () => execute(true))
    query.maybeSingle.mockImplementation(async () => execute(true))
    queries.push({ table, query }); return query
  })
  return { client, tables, queries, errors }
}
