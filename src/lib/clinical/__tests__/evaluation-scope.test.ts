import { beforeEach, describe, expect, it } from 'vitest'
import { createMockQueryBuilder, createMockSupabase } from '@/test-utils/supabase-mock'
import { resolveEvaluationEpisode } from '../evaluation-scope'
import type { createClient } from '@/lib/supabase/server'

let db: ReturnType<typeof createMockSupabase>
let episode: ReturnType<typeof createMockQueryBuilder>
const client = () => db as unknown as Awaited<ReturnType<typeof createClient>>
beforeEach(() => {
  db = createMockSupabase()
  episode = createMockQueryBuilder({ data: { id: 'episode-2', case_id: 'case', episode_number: 2, status: 'active' }, error: null })
  db.from.mockImplementation((table: string) => table === 'care_episodes' ? episode : createMockQueryBuilder({ data: { case_status: 'in_treatment' }, error: null }))
})
describe('evaluation episode resolution', () => {
  it('pins omitted scope to Episode 1', async () => {
    await resolveEvaluationEpisode(client(), 'case')
    expect(episode.eq).toHaveBeenCalledWith('episode_number', 1)
    expect(episode.eq).toHaveBeenCalledWith('case_id', 'case')
  })
  it('permits explicit active return pain evaluation writes', async () => {
    expect((await resolveEvaluationEpisode(client(), 'case', 'episode-2', 'pain_evaluation_visit', true)).episode?.id).toBe('episode-2')
  })
  it('rejects another case before accessing notes', async () => {
    expect((await resolveEvaluationEpisode(client(), 'other', 'episode-2')).error).toContain('does not belong')
  })
  it('prevents an Initial Visit in a return episode', async () => {
    expect((await resolveEvaluationEpisode(client(), 'case', 'episode-2', 'initial_visit', true)).error).toContain('Pain Evaluation')
  })
  it('allows historical reads but rejects historical writes', async () => {
    episode.maybeSingle.mockResolvedValue({ data: { id: 'episode-2', case_id: 'case', episode_number: 2, status: 'discharged' }, error: null })
    expect((await resolveEvaluationEpisode(client(), 'case', 'episode-2', 'pain_evaluation_visit')).episode).toBeDefined()
    expect((await resolveEvaluationEpisode(client(), 'case', 'episode-2', 'pain_evaluation_visit', true)).error).toContain('not active')
  })
  it('returns a readable missing legacy episode result', async () => {
    episode.maybeSingle.mockResolvedValue({ data: null, error: null })
    expect((await resolveEvaluationEpisode(client(), 'case')).error).toContain('Episode 1')
  })
  it('returns sanitized database errors', async () => {
    episode.maybeSingle.mockResolvedValue({ data: null, error: { message: 'internal details' } })
    expect((await resolveEvaluationEpisode(client(), 'case', 'episode-2')).error).toBe('Unable to load the care episode')
  })
})
