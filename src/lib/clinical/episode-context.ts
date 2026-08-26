import { createClient } from '@/lib/supabase/server'
import { LOCKED_STATUSES, type CaseStatus } from '@/lib/constants/case-status'
import type { Tables } from '@/types/database'

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

export type CareEpisode = Tables<'care_episodes'>
export type ClinicalEncounter = Tables<'clinical_encounters'>

export type EpisodeContextErrorCode =
  | 'CASE_NOT_FOUND'
  | 'CASE_LOCKED'
  | 'EPISODE_NOT_FOUND'
  | 'EPISODE_CASE_MISMATCH'
  | 'EPISODE_NOT_ACTIVE'
  | 'EPISODE_QUERY_FAILED'

export class EpisodeContextError extends Error {
  constructor(
    public readonly code: EpisodeContextErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'EpisodeContextError'
  }
}

async function resolveClient(client?: SupabaseClient) {
  return client ?? createClient()
}

export async function getActiveEpisode(
  caseId: string,
  client?: SupabaseClient,
): Promise<CareEpisode | null> {
  const supabase = await resolveClient(client)
  const { data, error } = await supabase
    .from('care_episodes')
    .select('*')
    .eq('case_id', caseId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .maybeSingle()

  if (error) {
    throw new EpisodeContextError('EPISODE_QUERY_FAILED', 'Unable to load the active care episode')
  }

  return data
}

export async function getEpisodeById(
  caseId: string,
  episodeId: string,
  client?: SupabaseClient,
): Promise<CareEpisode> {
  const supabase = await resolveClient(client)
  const { data, error } = await supabase
    .from('care_episodes')
    .select('*')
    .eq('id', episodeId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) {
    throw new EpisodeContextError('EPISODE_QUERY_FAILED', 'Unable to load the care episode')
  }
  if (!data) {
    throw new EpisodeContextError('EPISODE_NOT_FOUND', 'Care episode not found')
  }
  if (data.case_id !== caseId) {
    throw new EpisodeContextError(
      'EPISODE_CASE_MISMATCH',
      'Care episode does not belong to this case',
    )
  }

  return data
}

export async function getActiveOrLatestEpisode(
  caseId: string,
  client?: SupabaseClient,
): Promise<CareEpisode | null> {
  const activeEpisode = await getActiveEpisode(caseId, client)
  if (activeEpisode) return activeEpisode

  const supabase = await resolveClient(client)
  const { data, error } = await supabase
    .from('care_episodes')
    .select('*')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .order('episode_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new EpisodeContextError('EPISODE_QUERY_FAILED', 'Unable to load the latest care episode')
  }

  return data
}

export async function requireWritableEpisode(
  caseId: string,
  episodeId: string,
  client?: SupabaseClient,
): Promise<CareEpisode> {
  const supabase = await resolveClient(client)
  const [{ data: clinicalCase, error: caseError }, episode] = await Promise.all([
    supabase
      .from('cases')
      .select('case_status')
      .eq('id', caseId)
      .is('deleted_at', null)
      .maybeSingle(),
    getEpisodeById(caseId, episodeId, supabase),
  ])

  if (caseError) {
    throw new EpisodeContextError('EPISODE_QUERY_FAILED', 'Unable to load the case')
  }
  if (!clinicalCase) {
    throw new EpisodeContextError('CASE_NOT_FOUND', 'Case not found')
  }
  if (LOCKED_STATUSES.includes(clinicalCase.case_status as CaseStatus)) {
    throw new EpisodeContextError('CASE_LOCKED', 'This case is locked for clinical changes')
  }
  if (episode.status !== 'active') {
    throw new EpisodeContextError('EPISODE_NOT_ACTIVE', 'This care episode is not active')
  }

  return episode
}

function encounterTimestamp(encounter: ClinicalEncounter) {
  return encounter.completed_at
    ?? (encounter.encounter_date ? `${encounter.encounter_date}T00:00:00.000Z` : null)
    ?? encounter.scheduled_start
    ?? encounter.created_at
}

export function selectLatestCompletedEncounter(
  encounters: ClinicalEncounter[],
): ClinicalEncounter | null {
  return encounters
    .filter((encounter) => encounter.status === 'completed' && !encounter.deleted_at)
    .sort((left, right) => (
      Date.parse(encounterTimestamp(right)) - Date.parse(encounterTimestamp(left))
    ))[0] ?? null
}

export function selectEpisodeDateFloor(
  episode: CareEpisode,
  encounters: ClinicalEncounter[],
): string {
  const completedDates = encounters
    .filter((encounter) => (
      encounter.episode_id === episode.id
      && encounter.status === 'completed'
      && !encounter.deleted_at
    ))
    .map(encounterTimestamp)

  const latestTimestamp = [episode.opened_at, ...completedDates]
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0]

  return latestTimestamp.slice(0, 10)
}
