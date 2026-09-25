import { describe, expect, it, vi } from 'vitest'
import { createMockQueryBuilder, createMockSupabase } from '@/test-utils/supabase-mock'
import { loadPriorEpisodeHistory } from '../load-prior-episode-history'
import { MAX_HISTORY_COLLECTION_BYTES } from '../prior-episode-history'
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

function setup() {
  const client = createMockSupabase()
  const current = { id: 'current', case_id: 'case', episode_number: 3 }
  const tables: Record<string, Record<string, unknown>[]> = { care_episodes: [{ id: 'old', case_id: 'case', episode_number: 1, status: 'discharged' }] }
  const errors = new Set<string>()
  const queries: Array<{ table: string; query: ReturnType<typeof createMockQueryBuilder> }> = []
  client.from.mockImplementation((table: string) => {
    const query = createMockQueryBuilder({ data: current, error: null })
    let start = 0, end = 499
    query.range.mockImplementation((from: number, to: number) => { start = from; end = to; return query })
    query.then = (resolve: (result: unknown) => void) => resolve({ data: (tables[table] ?? []).slice(start, end + 1), error: errors.has(table) ? { message: 'private database error' } : null })
    queries.push({ table, query }); return query
  })
  return { client, current, tables, errors, queries }
}
describe('read-only history loader', () => {
  it('pages complete collections and scopes all reads, including procedure narrative via owning procedure', async () => {
    const { client, tables, queries } = setup()
    tables.clinical_encounters = Array.from({ length: 501 }, (_, i) => ({ id: String(i), case_id: 'case', episode_id: 'old' }))
    await loadPriorEpisodeHistory(client as never, 'case', 'current', '2026-01-05')
    const pages = queries.filter(q => q.table === 'clinical_encounters')
    expect(pages.map(q => q.query.range.mock.calls[0])).toEqual([[0, 499], [500, 999]])
    for (const { table, query } of queries.slice(1)) {
      expect(query.eq).toHaveBeenCalledWith('case_id', 'case')
      expect(query.is).toHaveBeenCalledWith('deleted_at', null)
      if (table === 'care_episodes') expect(query.lt).toHaveBeenCalledWith('episode_number', 3)
      else expect(query.eq).toHaveBeenCalledWith(table === 'procedure_notes' ? 'procedures.episode_id' : 'episode_id', 'old')
      for (const method of ['insert', 'update', 'delete', 'upsert']) expect(query[method]).not.toHaveBeenCalled()
    }
  })
  it.each(['care_episodes', 'clinical_encounters', 'initial_visit_notes', 'pain_follow_up_notes', 'procedures', 'procedure_notes', 'discharge_notes'])('fails closed on %s errors', async (table) => {
    const { client, errors } = setup(); errors.add(table)
    await expect(loadPriorEpisodeHistory(client as never, 'case', 'current', '2026-01-05')).rejects.toThrow('Unable to load previous episode history')
  })
  it('skips historical queries for unknown service date and Episode 1', async () => {
    const { client, current } = setup()
    expect((await loadPriorEpisodeHistory(client as never, 'case', 'current', null)).history.coverage.complete).toBe(false)
    expect(client.from).toHaveBeenCalledTimes(1)
    current.episode_number = 1
    await loadPriorEpisodeHistory(client as never, 'case', 'current', '2026-01-05')
    expect(client.from).toHaveBeenCalledTimes(2)
  })
  it('validates selected episode ownership', async () => {
    const { client, current } = setup(); current.case_id = 'other'
    await expect(loadPriorEpisodeHistory(client as never, 'case', 'current', '2026-01-05')).rejects.toThrow('does not belong')
  })
  it('enforces aggregate collection budget before projecting', async () => {
    const { client, tables } = setup()
    tables.initial_visit_notes = [{ id: 'large', chief_complaint: 'x'.repeat(MAX_HISTORY_COLLECTION_BYTES) }]
    await expect(loadPriorEpisodeHistory(client as never, 'case', 'current', '2026-01-05')).rejects.toThrow('no records were truncated')
  })
})
