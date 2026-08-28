'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireWritableEpisode } from '@/lib/clinical/episode-context'
import { alignTelehealthConsentToEncounterDate } from '@/lib/clinical/encounter-dates'
import { requireReturnTeleVisitsMutation } from '@/lib/features/return-tele-visits'
import { normalizeVisitDiagnoses } from '@/lib/clinical/visit-diagnoses'
import {
  changeEncounterStatusSchema,
  saveEncounterDiagnosesSchema,
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

export async function getEncounterDiagnoses(caseId: string, encounterId: string) {
  const { supabase, user } = await authenticatedClient()
  if (!user) return { error: 'Not authenticated', data: null }

  const { data, error } = await supabase.from('clinical_encounters')
    .select('id,case_id,episode_id,provider_id,status,diagnoses,diagnoses_confirmed_at,diagnoses_confirmed_by_user_id')
    .eq('id', encounterId)
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error || !data) return { error: 'Visit not found', data: null }
  return { data, error: null }
}

export async function saveEncounterDiagnoses(
  caseId: string,
  encounterId: string,
  diagnoses: unknown,
) {
  const parsed = saveEncounterDiagnosesSchema.safeParse({
    case_id: caseId,
    encounter_id: encounterId,
    diagnoses,
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid diagnoses' }
  }

  const { supabase, user } = await authenticatedClient()
  if (!user) return { error: 'Not authenticated' }

  const [{ data: encounter, error: encounterError }, { data: actor, error: actorError }] = await Promise.all([
    supabase.from('clinical_encounters')
      .select('id,case_id,episode_id,provider_id,status')
      .eq('id', encounterId)
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase.from('users')
      .select('role,is_active')
      .eq('id', user.id)
      .maybeSingle(),
  ])

  if (encounterError || !encounter) return { error: 'Visit not found' }
  if (actorError || !actor?.is_active) return { error: 'Active user account required' }
  if (['completed', 'cancelled', 'no_show'].includes(encounter.status)) {
    return { error: 'Diagnoses cannot be changed on a locked encounter' }
  }

  try {
    await requireWritableEpisode(caseId, encounter.episode_id, supabase)
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Episode is not writable' }
  }

  let authorized = actor.role === 'admin'
  if (!authorized && actor.role === 'provider') {
    const { data: providerProfile } = await supabase.from('provider_profiles')
      .select('id')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle()
    authorized = providerProfile?.id === encounter.provider_id
  }
  if (!authorized) {
    return { error: 'Only the encounter provider or an administrator may confirm diagnoses' }
  }

  let normalized
  try {
    normalized = normalizeVisitDiagnoses(parsed.data.diagnoses)
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Invalid diagnoses' }
  }

  const { data, error } = await supabase.from('clinical_encounters')
    .update({
      diagnoses: normalized,
      updated_by_user_id: user.id,
    })
    .eq('id', encounterId)
    .eq('case_id', caseId)
    .select('id,diagnoses,diagnoses_confirmed_at,diagnoses_confirmed_by_user_id')
    .single()

  if (error || !data) {
    return { error: error?.message?.includes('locked encounter')
      ? 'Diagnoses cannot be changed on a locked encounter'
      : 'Unable to confirm visit diagnoses' }
  }

  revalidatePath(`/patients/${caseId}/visits`)
  revalidatePath(`/patients/${caseId}/visits/${encounterId}`)
  revalidatePath(`/patients/${caseId}/initial-visit`)
  return { data }
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

  const effectiveModality = parsed.data.modality ?? existing.modality
  const effectiveConsent = parsed.data.telehealth_consent_obtained
    ?? existing.telehealth_consent_obtained
  if (effectiveModality !== 'telehealth' && effectiveConsent === true) {
    return { error: 'Telehealth consent can only be recorded for a telehealth encounter' }
  }

  const { encounter_id, ...changes } = parsed.data
  const effectiveEncounterDate = parsed.data.encounter_date ?? existing.encounter_date
  const normalizedChanges = {
    ...changes,
    ...(effectiveConsent === true
      ? {
          telehealth_consent_at: alignTelehealthConsentToEncounterDate(
            parsed.data.telehealth_consent_at ?? existing.telehealth_consent_at,
            effectiveEncounterDate,
          ),
        }
      : parsed.data.telehealth_consent_obtained === false
        ? { telehealth_consent_at: null }
        : {}),
  }
  const { error } = await supabase.from('clinical_encounters')
    .update({ ...normalizedChanges, updated_by_user_id: user.id }).eq('id', encounter_id)
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
