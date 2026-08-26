'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getCurrentUserWithRole } from '@/lib/auth/require-role'
import { LOCKED_STATUSES, PAYMENT_ALLOWED_LOCKED_STATUSES, CASE_STATUS_TRANSITIONS, CASE_STATUS_CONFIG, type CaseStatus } from '@/lib/constants/case-status'
import {
  startReturnCareEpisodeSchema,
  type StartReturnCareEpisodeInput,
} from '@/lib/validations/care-episode'
import type { FirstReturnEncounterInput } from '@/lib/validations/clinical-encounter'

// --- Shared guard: call at top of every write action ---

export async function assertCaseNotClosed(
  supabase: Awaited<ReturnType<typeof createClient>>,
  caseId: string,
  options?: { allowPayment?: boolean },
): Promise<{ error: string | null }> {
  const { data } = await supabase
    .from('cases')
    .select('case_status')
    .eq('id', caseId)
    .is('deleted_at', null)
    .single()

  if (data?.case_status && LOCKED_STATUSES.includes(data.case_status as CaseStatus)) {
    const status = data.case_status as CaseStatus
    // Payment actions stay open in Pending Settlement (still blocked in Closed/Archived).
    if (options?.allowPayment && PAYMENT_ALLOWED_LOCKED_STATUSES.includes(status)) {
      return { error: null }
    }
    const label = CASE_STATUS_CONFIG[status].label
    return { error: `This case is locked (${label}). Move it back to Active to make changes.` }
  }
  return { error: null }
}

// --- Lock guard with optional admin bypass ---

export async function assertCaseWritable(
  supabase: Awaited<ReturnType<typeof createClient>>,
  caseId: string,
  options?: { allowLockedForAdmin?: boolean },
): Promise<{ error: string | null }> {
  if (options?.allowLockedForAdmin) {
    const me = await getCurrentUserWithRole()
    if (me?.role === 'admin') return { error: null }
  }
  return assertCaseNotClosed(supabase, caseId)
}

// --- Unified status change ---

export async function updateCaseStatus(
  caseId: string,
  newStatus: CaseStatus,
  notes?: string,
  options?: { override?: boolean },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Admin-only: bypass transition rules + prerequisites
  const me = await getCurrentUserWithRole()
  const isAdminOverride = !!options?.override && me?.role === 'admin'

  // Fetch current status
  const { data: caseData } = await supabase
    .from('cases')
    .select('case_status')
    .eq('id', caseId)
    .is('deleted_at', null)
    .single()

  if (!caseData) return { error: 'Case not found' }

  const currentStatus = caseData.case_status as CaseStatus

  if (currentStatus === newStatus) {
    return { error: `Case is already ${CASE_STATUS_CONFIG[newStatus].label}` }
  }

  // Validate transition (skipped for admin override)
  if (!isAdminOverride) {
    const allowed = CASE_STATUS_TRANSITIONS[currentStatus]
    if (!allowed?.includes(newStatus)) {
      return { error: `Cannot change status from ${CASE_STATUS_CONFIG[currentStatus].label} to ${CASE_STATUS_CONFIG[newStatus].label}` }
    }
  }

  // Prerequisites: medical (visit) invoice required for pending_settlement and closed
  // (skipped for admin override)
  if (!isAdminOverride && (newStatus === 'pending_settlement' || newStatus === 'closed')) {
    const { data: medicalInvoices } = await supabase
      .from('invoices')
      .select('id')
      .eq('case_id', caseId)
      .eq('invoice_type', 'visit')
      .is('deleted_at', null)
      .neq('status', 'void')
      .limit(1)

    if (!medicalInvoices || medicalInvoices.length === 0) {
      return { error: 'A medical invoice is required before changing to this status.' }
    }
  }

  // Build update payload
  const updatePayload: Record<string, unknown> = {
    case_status: newStatus,
    updated_by_user_id: user.id,
  }

  // Set/clear case_close_date based on target status
  if (newStatus === 'closed' || newStatus === 'archived') {
    updatePayload.case_close_date = new Date().toISOString().split('T')[0]
  } else {
    updatePayload.case_close_date = null
  }

  const { error: updateError } = await supabase
    .from('cases')
    .update(updatePayload)
    .eq('id', caseId)

  if (updateError) return { error: 'Failed to update case status' }

  // Insert history
  const historyNotes = isAdminOverride
    ? [notes, 'admin override'].filter(Boolean).join(' — ')
    : (notes ?? null)
  await supabase.from('case_status_history').insert({
    case_id: caseId,
    previous_status: currentStatus,
    new_status: newStatus,
    changed_by_user_id: user.id,
    notes: historyNotes,
  })

  revalidatePath(`/patients/${caseId}`)
  revalidatePath('/patients')
  return { data: { success: true } }
}

// --- Auto-advance from intake on first clinical activity ---

export async function autoAdvanceFromIntake(
  supabase: Awaited<ReturnType<typeof createClient>>,
  caseId: string,
  userId: string,
) {
  const { data } = await supabase
    .from('cases')
    .select('case_status')
    .eq('id', caseId)
    .is('deleted_at', null)
    .single()

  if (data?.case_status !== 'intake') return

  await supabase
    .from('cases')
    .update({ case_status: 'active', updated_by_user_id: userId })
    .eq('id', caseId)

  await supabase.from('case_status_history').insert({
    case_id: caseId,
    previous_status: 'intake',
    new_status: 'active',
    changed_by_user_id: userId,
    notes: 'Auto-advanced: first clinical activity',
  })
}

// --- Thin wrappers for existing callers ---

export async function closeCase(caseId: string) {
  return updateCaseStatus(caseId, 'closed')
}

export async function reopenCase(caseId: string) {
  return updateCaseStatus(caseId, 'active')
}

export async function startReturnCareEpisode(
  caseId: string,
  returnReason: string,
  firstEncounterInput: FirstReturnEncounterInput,
  idempotencyKey: string,
) {
  const parsed = startReturnCareEpisodeSchema.safeParse({
    case_id: caseId,
    return_reason: returnReason,
    idempotency_key: idempotencyKey,
    first_encounter: firstEncounterInput,
  } satisfies StartReturnCareEpisodeInput)

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid return visit details' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const encounter = parsed.data.first_encounter
  const { data, error } = await supabase.rpc('start_return_episode', {
    p_case_id: parsed.data.case_id,
    p_return_reason: parsed.data.return_reason,
    p_idempotency_key: parsed.data.idempotency_key,
    p_modality: encounter.modality,
    p_scheduled_start: encounter.scheduled_start ?? null,
    p_scheduled_end: encounter.scheduled_end ?? null,
    p_encounter_date: encounter.encounter_date ?? null,
    p_provider_id: encounter.provider_id ?? null,
    p_provider_intake: encounter.provider_intake,
    p_patient_reported_pain_min: encounter.patient_reported_pain_min ?? null,
    p_patient_reported_pain_max: encounter.patient_reported_pain_max ?? null,
    p_patient_reported_measurements: encounter.patient_reported_measurements,
    p_telehealth_consent_obtained: encounter.telehealth_consent_obtained ?? null,
    p_telehealth_consent_at: encounter.telehealth_consent_at ?? null,
    p_patient_location_state: encounter.patient_location_state ?? null,
    p_provider_location: encounter.provider_location ?? null,
    p_connection_method: encounter.connection_method ?? null,
  })

  if (error) {
    const knownMessages = [
      'Case not found',
      'Archived cases must be moved to Closed before starting a return visit',
      'Case must be Active, Pending Settlement, or Closed to start a return visit',
      'This case already has an active care episode',
      'Idempotency key was already used with different input',
    ]
    const knownMessage = knownMessages.find((message) => error.message?.includes(message))
    return { error: knownMessage ?? 'Failed to start the return visit' }
  }

  const result = Array.isArray(data) ? data[0] : data
  if (!result?.episode_id || !result.encounter_id) {
    return { error: 'Failed to start the return visit' }
  }

  revalidatePath(`/patients/${caseId}`)
  revalidatePath(`/patients/${caseId}/visits`)
  revalidatePath('/patients')

  return {
    data: {
      episodeId: result.episode_id,
      encounterId: result.encounter_id,
      replayed: result.replayed === true,
    },
  }
}
