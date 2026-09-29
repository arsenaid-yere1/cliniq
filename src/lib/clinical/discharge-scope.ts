import 'server-only'

import type { createClient } from '@/lib/supabase/server'
import { getActiveOrLatestEpisode, getEpisodeById, requireWritableEpisode } from './episode-context'

type Client = Awaited<ReturnType<typeof createClient>>

/** Resolve once; subsequent work must keep this exact episode, including after AI awaits. */
export async function resolveDischargeScope(
  client: Client, caseId: string, requestedEpisodeId?: string, writable = false,
): Promise<{ episodeId: string; error?: never } | { episodeId?: never; error: string }> {
  try {
    const episode = requestedEpisodeId
      ? await getEpisodeById(caseId, requestedEpisodeId, client)
      : await getActiveOrLatestEpisode(caseId, client)
    if (!episode) return { error: 'Care episode not found' }
    if (writable) {
      await requireWritableEpisode(caseId, episode.id, client)
      const { data, error } = await client.from('discharge_note_corrections').select('id')
        .eq('case_id', caseId).eq('episode_id', episode.id).eq('status', 'open').limit(1)
      if (error) return { error: 'Unable to check discharge correction status' }
      if (data?.length) return { error: 'A discharge correction is in progress. Use the correction controls to save, cancel, or finalize it.' }
    }
    return { episodeId: episode.id }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unable to load the discharge episode' }
  }
}
