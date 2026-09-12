import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockSupabase } from '@/test-utils/supabase-mock'
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/clinical/episode-context', () => ({ requireWritableEpisode: vi.fn() }))
vi.mock('@/lib/clinical/load-follow-up-intake-history', () => ({ loadFollowUpIntakeHistory: vi.fn() }))
import { createClient } from '@/lib/supabase/server'
import { requireWritableEpisode } from '@/lib/clinical/episode-context'
import { loadFollowUpIntakeHistory } from '@/lib/clinical/load-follow-up-intake-history'
import { requestFollowUpIntakeHistory } from '../follow-up-intake-history'
const encounter = { id: 'visit', case_id: 'case', episode_id: 'episode', status: 'scheduled', encounter_date: '2026-09-12', provider_intake: { chief_complaint: '' } }
let client: ReturnType<typeof createMockSupabase>
beforeEach(() => {
  vi.resetAllMocks()
  client = createMockSupabase({ data: encounter, error: null })
  vi.mocked(createClient).mockResolvedValue(client as never)
  vi.mocked(loadFollowUpIntakeHistory).mockResolvedValue({ data: null })
})
describe('explicit historical intake request', () => {
  it('uses the selected date after authenticating and validating the visit and episode, without saving', async () => {
    await requestFollowUpIntakeHistory('case', 'visit', '2026-09-10')
    expect(client._builder.eq).toHaveBeenCalledWith('case_id', 'case')
    expect(client._builder.eq).toHaveBeenCalledWith('id', 'visit')
    expect(client._builder.eq).toHaveBeenCalledWith('encounter_type', 'pain_follow_up')
    expect(requireWritableEpisode).toHaveBeenCalledWith('case', 'episode', client)
    expect(loadFollowUpIntakeHistory).toHaveBeenCalledWith(client, { ...encounter, encounter_date: '2026-09-10' }, { summarizeSavedIntake: true })
    expect(client._builder.update).not.toHaveBeenCalled()
  })
  it.each(['', '2026-02-30', 'invalid'])('rejects invalid date %s', async (date) => {
    expect((await requestFollowUpIntakeHistory('case', 'visit', date)).error).toBeTruthy()
    expect(createClient).not.toHaveBeenCalled()
  })
  it.each(['unauthenticated', 'missing', 'completed', 'locked'])('does not load history when %s', async (condition) => {
    if (condition === 'unauthenticated') client.auth.getUser.mockResolvedValue({ data: { user: null } })
    if (condition === 'missing') client._builder.maybeSingle.mockResolvedValue({ data: null })
    if (condition === 'completed') client._builder.maybeSingle.mockResolvedValue({ data: { ...encounter, status: 'completed' } })
    if (condition === 'locked') vi.mocked(requireWritableEpisode).mockRejectedValue(new Error('Locked'))
    expect((await requestFollowUpIntakeHistory('case', 'visit', '2026-09-12')).error).toBeTruthy()
    expect(loadFollowUpIntakeHistory).not.toHaveBeenCalled()
  })
})
