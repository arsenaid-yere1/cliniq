import 'server-only'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { getEpisodeById } from './episode-context'
import {
  canonicalHistoryJson, emptyPriorEpisodeHistory, historicalFieldSelections, historyServiceDate,
  HISTORY_TOO_LARGE, MAX_HISTORY_COLLECTION_BYTES, projectPriorEpisodeHistory,
  type HistoricalEpisodeRows, type HistoryRow, type HistoryTable,
} from './prior-episode-history'

const PAGE_SIZE = 500
const identity = 'id,case_id,episode_id,encounter_id,status,updated_at,deleted_at'
const selections: Record<HistoryTable, string> = {
  initial_visit_notes: `${identity},visit_type,visit_date,${historicalFieldSelections.initial_visit_notes.join(',')}`,
  pain_follow_up_notes: `${identity},${historicalFieldSelections.pain_follow_up_notes.join(',')}`,
  discharge_notes: `${identity},visit_date,${historicalFieldSelections.discharge_notes.join(',')}`,
  procedures: `id,case_id,episode_id,updated_at,deleted_at,procedure_date,${historicalFieldSelections.procedures.join(',')}`,
  procedure_notes: `id,case_id,procedure_id,status,updated_at,deleted_at,${historicalFieldSelections.procedure_notes.join(',')}`,
}

/** Authenticated, read-only collection. Errors must never masquerade as no history. */
export async function loadPriorEpisodeHistory(client: SupabaseClient<Database>, caseId: string, episodeId: string, serviceDate: string | null) {
  const episode = await getEpisodeById(caseId, episodeId, client)
  const cutoff = historyServiceDate(serviceDate)
  if (episode.episode_number <= 1 || !cutoff) return { history: emptyPriorEpisodeHistory(cutoff), fingerprint: null }
  let bytes = 0
  async function load(table: 'care_episodes' | 'clinical_encounters' | HistoryTable, columns: string, priorId?: string) {
    const collected: HistoryRow[] = []
    for (let start = 0; ; start += PAGE_SIZE) {
      let query = client.from(table).select(table === 'procedure_notes' ? `${columns},procedures!inner(episode_id,deleted_at)` : columns)
        .eq('case_id', caseId).is('deleted_at', null).order('id').range(start, start + PAGE_SIZE - 1)
      if (table === 'care_episodes') query = query.lt('episode_number', episode.episode_number)
      else if (table === 'procedure_notes') query = query.eq('procedures.episode_id', priorId!).is('procedures.deleted_at', null)
      else query = query.eq('episode_id', priorId!)
      const result = await query
      if (result.error) throw new Error(`Unable to load previous episode history (${table}). Please retry.`)
      if (!Array.isArray(result.data)) throw new Error('Malformed previous episode history response.')
      const page = result.data as unknown as HistoryRow[]
      bytes += Buffer.byteLength(JSON.stringify(page))
      if (bytes > MAX_HISTORY_COLLECTION_BYTES) throw new Error(HISTORY_TOO_LARGE)
      collected.push(...page)
      if (page.length < PAGE_SIZE) return collected
    }
  }
  const priorEpisodes = await load('care_episodes', 'id,case_id,episode_number,status,deleted_at')
  const batches: HistoricalEpisodeRows[] = []
  for (const prior of priorEpisodes) {
    if (prior.case_id !== caseId || prior.deleted_at || typeof prior.episode_number !== 'number' || prior.episode_number >= episode.episode_number || typeof prior.id !== 'string') continue
    const tables = ['clinical_encounters', ...Object.keys(selections)] as Array<'clinical_encounters' | HistoryTable>
    const results = await Promise.allSettled(tables.map(table => load(table,
      table === 'clinical_encounters' ? 'id,case_id,episode_id,encounter_date,encounter_type,status,updated_at,deleted_at' : selections[table], prior.id as string)))
    const batch = { episode: prior } as HistoricalEpisodeRows
    results.forEach((result, index) => {
      if (result.status === 'rejected') throw result.reason
      batch[tables[index]] = result.value
    })
    batches.push(batch)
  }
  const result = projectPriorEpisodeHistory(caseId, episode.episode_number, cutoff, batches)
  return { history: result.history, fingerprint: createHash('sha256').update(canonicalHistoryJson(result.versionState)).digest('hex') }
}
