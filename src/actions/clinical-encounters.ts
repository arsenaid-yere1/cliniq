'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireWritableEpisode } from '@/lib/clinical/episode-context'
import { requireReturnTeleVisitsMutation } from '@/lib/features/return-tele-visits'
import {
  changeEncounterStatusSchema,
  schedulePainFollowUpSchema,
  updatePainFollowUpEncounterSchema,
  type SchedulePainFollowUpInput,
  type UpdatePainFollowUpEncounterInput,
} from '@/lib/validations/clinical-encounter'

async function authenticatedClient() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

export async function listClinicalEncounters(caseId: string, episodeId?: string) {
  const supabase = await createClient()
  let query = supabase.from('clinical_encounters').select('*')
    .eq('case_id', caseId).is('deleted_at', null)
    .order('scheduled_start', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (episodeId) query = query.eq('episode_id', episodeId)
  const { data, error } = await query
  return error ? { error: 'Unable to load visits', data: [] } : { data: data ?? [] }
}

export async function schedulePainFollowUp(input: SchedulePainFollowUpInput) {
  const disabled = requireReturnTeleVisitsMutation()
  if (disabled) return disabled
  const parsed = schedulePainFollowUpSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid visit' }
  const { supabase, user } = await authenticatedClient()
  if (!user) return { error: 'Not authenticated' }
  try { await requireWritableEpisode(parsed.data.case_id, parsed.data.episode_id, supabase) }
  catch (error) { return { error: error instanceof Error ? error.message : 'Episode is not writable' } }
  const { data, error } = await supabase.from('clinical_encounters').insert({
    ...parsed.data,
    encounter_type: 'pain_follow_up',
    status: 'scheduled',
    created_by_user_id: user.id,
    updated_by_user_id: user.id,
  }).select('id').single()
  if (error) return { error: 'Unable to schedule visit' }
  revalidatePath(`/patients/${input.case_id}/visits`)
  return { data }
}

export async function updatePainFollowUpEncounter(
  caseId: string,
  input: UpdatePainFollowUpEncounterInput,
) {
  const disabled = requireReturnTeleVisitsMutation()
  if (disabled) return disabled
  const parsed = updatePainFollowUpEncounterSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid visit' }
  const { supabase, user } = await authenticatedClient()
  if (!user) return { error: 'Not authenticated' }
  const { data: existing } = await supabase.from('clinical_encounters').select('*')
    .eq('id', parsed.data.encounter_id).eq('case_id', caseId)
    .eq('encounter_type', 'pain_follow_up').is('deleted_at', null).maybeSingle()
  if (!existing) return { error: 'Visit not found' }
  try { await requireWritableEpisode(caseId, existing.episode_id, supabase) }
  catch (error) { return { error: error instanceof Error ? error.message : 'Episode is not writable' } }
  const { encounter_id, ...changes } = parsed.data
  const { error } = await supabase.from('clinical_encounters')
    .update({ ...changes, updated_by_user_id: user.id }).eq('id', encounter_id)
  if (error) return { error: 'Unable to update visit' }
  revalidatePath(`/patients/${caseId}/visits`)
  revalidatePath(`/patients/${caseId}/visits/${encounter_id}`)
  return { data: { id: encounter_id } }
}

export async function changePainFollowUpStatus(
  caseId: string,
  encounterId: string,
  status: 'in_progress' | 'cancelled' | 'no_show',
  reason?: string,
) {
  const disabled = requireReturnTeleVisitsMutation()
  if (disabled) return disabled
  const parsed = changeEncounterStatusSchema.safeParse({ case_id: caseId, encounter_id: encounterId, status, reason })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid visit status' }
  const { supabase, user } = await authenticatedClient()
  if (!user) return { error: 'Not authenticated' }
  const { data: existing } = await supabase.from('clinical_encounters')
    .select('episode_id,status,encounter_type,provider_intake').eq('id', encounterId).eq('case_id', caseId)
    .is('deleted_at', null).maybeSingle()
  if (!existing || existing.encounter_type !== 'pain_follow_up') return { error: 'Visit not found' }
  if (existing.status === 'completed') return { error: 'Completed visits cannot be changed' }
  try { await requireWritableEpisode(caseId, existing.episode_id, supabase) }
  catch (error) { return { error: error instanceof Error ? error.message : 'Episode is not writable' } }
  const { error } = await supabase.from('clinical_encounters').update({
    status,
    provider_intake: reason?.trim()
      ? { ...((existing.provider_intake as Record<string, unknown> | null) ?? {}), status_reason: reason.trim(), status_changed_at: new Date().toISOString() }
      : existing.provider_intake,
    updated_by_user_id: user.id,
  }).eq('id', encounterId)
  if (error) return { error: 'Unable to change visit status' }
  revalidatePath(`/patients/${caseId}/visits`)
  return { data: { id: encounterId } }
}
