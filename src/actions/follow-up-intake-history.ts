'use server'

import { createClient } from '@/lib/supabase/server'
import { requireWritableEpisode } from '@/lib/clinical/episode-context'
import { loadFollowUpIntakeHistory } from '@/lib/clinical/load-follow-up-intake-history'
import type { IntakeHistoryResult } from '@/lib/clinical/follow-up-intake-prefill'

/** Explicit, read-only recovery for saved blank or partially completed intake. */
export async function requestFollowUpIntakeHistory(caseId: string, encounterId: string, visitDate: string): Promise<IntakeHistoryResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate) || !Number.isFinite(Date.parse(visitDate)) || new Date(visitDate).toISOString().slice(0, 10) !== visitDate) return { data: null, error: 'Select a valid visit date first.' }
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return { data: null, error: 'Not authenticated' }
  const { data: encounter, error } = await client.from('clinical_encounters').select('*')
    .eq('id', encounterId).eq('case_id', caseId).eq('encounter_type', 'pain_follow_up').is('deleted_at', null).maybeSingle()
  if (error || !encounter) return { data: null, error: 'Visit not found' }
  if (!['scheduled', 'in_progress'].includes(encounter.status)) return { data: null, error: 'This visit cannot be edited.' }
  try { await requireWritableEpisode(caseId, encounter.episode_id, client) }
  catch { return { data: null, error: 'This episode cannot be edited.' } }
  return loadFollowUpIntakeHistory(client, { ...encounter, encounter_date: visitDate }, { summarizeSavedIntake: true })
}
