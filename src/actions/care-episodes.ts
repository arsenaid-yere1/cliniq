'use server'

import { createClient } from '@/lib/supabase/server'
import { getActiveOrLatestEpisode, getEpisodeById } from '@/lib/clinical/episode-context'
import { startReturnCareEpisode } from '@/actions/case-status'
import { requireReturnTeleVisitsMutation } from '@/lib/features/return-tele-visits'
import type { FirstReturnEncounterInput } from '@/lib/validations/clinical-encounter'

export async function listCareEpisodes(caseId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.from('care_episodes').select('*')
    .eq('case_id', caseId).is('deleted_at', null)
    .order('episode_number', { ascending: false })
  return error ? { error: 'Unable to load care episodes', data: [] } : { data: data ?? [] }
}

export async function getCareEpisode(caseId: string, episodeId?: string) {
  try {
    const data = episodeId
      ? await getEpisodeById(caseId, episodeId)
      : await getActiveOrLatestEpisode(caseId)
    return { data }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unable to load care episode' }
  }
}

export async function startReturnVisit(
  caseId: string,
  returnReason: string,
  encounter: FirstReturnEncounterInput,
  idempotencyKey: string,
) {
  const disabled = requireReturnTeleVisitsMutation()
  if (disabled) return disabled
  return startReturnCareEpisode(caseId, returnReason, encounter, idempotencyKey)
}
