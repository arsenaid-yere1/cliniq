import { createClient } from '@/lib/supabase/server'
import { EpisodeContextError, getEpisodeById, requireWritableEpisode, type CareEpisode } from './episode-context'
import type { NoteVisitType } from '@/lib/claude/generate-initial-visit'

type Client = Awaited<ReturnType<typeof createClient>>

/** Legacy links always resolve Episode 1; explicit links retain their selected episode. */
export async function resolveEvaluationEpisode(
  client: Client, caseId: string, episodeId?: string, visitType?: NoteVisitType, writable = false,
): Promise<{ episode: CareEpisode; error?: never } | { episode?: never; error: string }> {
  try {
    let episode: CareEpisode
    if (episodeId) {
      episode = await getEpisodeById(caseId, episodeId, client)
    } else {
      const result = await client.from('care_episodes').select('*').eq('case_id', caseId)
        .eq('episode_number', 1).is('deleted_at', null).maybeSingle()
      if (result.error) return { error: 'Unable to load the evaluation episode' }
      if (!result.data) return { error: 'Episode 1 is required for the legacy visit' }
      episode = result.data
    }
    if (episode.episode_number > 1 && visitType === 'initial_visit') {
      return { error: 'Return episodes start with a Pain Evaluation Visit.' }
    }
    if (writable) await requireWritableEpisode(caseId, episode.id, client)
    return { episode }
  } catch (error) {
    return { error: error instanceof EpisodeContextError ? error.message : 'Unable to load the evaluation episode' }
  }
}
