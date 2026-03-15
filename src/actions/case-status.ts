'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { LOCKED_STATUSES, CASE_STATUS_TRANSITIONS, CASE_STATUS_CONFIG, type CaseStatus } from '@/lib/constants/case-status'

// --- Shared guard: call at top of every write action ---

export async function assertCaseNotClosed(
  supabase: Awaited<ReturnType<typeof createClient>>,
  caseId: string,
): Promise<{ error: string | null }> {
  const { data } = await supabase
    .from('cases')
    .select('case_status')
    .eq('id', caseId)
    .is('deleted_at', null)
    .single()

  if (data?.case_status && LOCKED_STATUSES.includes(data.case_status as CaseStatus)) {
    return { error: 'This case is closed. No modifications are allowed until it is reopened.' }
  }
  return { error: null }
}

// --- Unified status change ---

export async function updateCaseStatus(caseId: string, newStatus: CaseStatus, notes?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

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

  // Validate transition
  const allowed = CASE_STATUS_TRANSITIONS[currentStatus]
  if (!allowed?.includes(newStatus)) {
    return { error: `Cannot change status from ${CASE_STATUS_CONFIG[currentStatus].label} to ${CASE_STATUS_CONFIG[newStatus].label}` }
  }

  // Prerequisites: finalized discharge required for pending_settlement and closed
  if (newStatus === 'pending_settlement' || newStatus === 'closed') {
    const { data: dischargeNote } = await supabase
      .from('discharge_notes')
      .select('id')
      .eq('case_id', caseId)
      .eq('status', 'finalized')
      .is('deleted_at', null)
      .maybeSingle()

    if (!dischargeNote) {
      return { error: 'A finalized discharge summary is required before changing to this status.' }
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
  await supabase.from('case_status_history').insert({
    case_id: caseId,
    previous_status: currentStatus,
    new_status: newStatus,
    changed_by_user_id: user.id,
    notes: notes ?? null,
  })

  revalidatePath(`/patients/${caseId}`)
  revalidatePath('/patients')
  return { data: { success: true } }
}

// --- Thin wrappers for existing callers ---

export async function closeCase(caseId: string) {
  return updateCaseStatus(caseId, 'closed')
}

export async function reopenCase(caseId: string) {
  return updateCaseStatus(caseId, 'active')
}
