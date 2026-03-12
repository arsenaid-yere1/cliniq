'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

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

  if (data?.case_status === 'closed') {
    return { error: 'This case is closed. No modifications are allowed until it is reopened.' }
  }
  return { error: null }
}

// --- Close case ---

export async function closeCase(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Check current status
  const { data: caseData } = await supabase
    .from('cases')
    .select('case_status')
    .eq('id', caseId)
    .is('deleted_at', null)
    .single()

  if (!caseData) return { error: 'Case not found' }
  if (caseData.case_status === 'closed') return { error: 'Case is already closed' }

  // Prerequisite: finalized discharge note
  const { data: dischargeNote } = await supabase
    .from('discharge_notes')
    .select('id')
    .eq('case_id', caseId)
    .eq('status', 'finalized')
    .is('deleted_at', null)
    .maybeSingle()

  if (!dischargeNote) {
    return { error: 'A finalized discharge summary is required before closing the case.' }
  }

  const previousStatus = caseData.case_status

  // Update case status
  const { error: updateError } = await supabase
    .from('cases')
    .update({
      case_status: 'closed',
      case_close_date: new Date().toISOString().split('T')[0],
      updated_by_user_id: user.id,
    })
    .eq('id', caseId)

  if (updateError) return { error: 'Failed to close case' }

  // Insert status history
  await supabase.from('case_status_history').insert({
    case_id: caseId,
    previous_status: previousStatus,
    new_status: 'closed',
    changed_by_user_id: user.id,
  })

  revalidatePath(`/patients/${caseId}`)
  revalidatePath('/patients')
  return { data: { success: true } }
}

// --- Reopen case ---

export async function reopenCase(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: caseData } = await supabase
    .from('cases')
    .select('case_status')
    .eq('id', caseId)
    .is('deleted_at', null)
    .single()

  if (!caseData) return { error: 'Case not found' }
  if (caseData.case_status !== 'closed') return { error: 'Case is not closed' }

  const { error: updateError } = await supabase
    .from('cases')
    .update({
      case_status: 'active',
      case_close_date: null,
      updated_by_user_id: user.id,
    })
    .eq('id', caseId)

  if (updateError) return { error: 'Failed to reopen case' }

  await supabase.from('case_status_history').insert({
    case_id: caseId,
    previous_status: 'closed',
    new_status: 'active',
    changed_by_user_id: user.id,
  })

  revalidatePath(`/patients/${caseId}`)
  revalidatePath('/patients')
  return { data: { success: true } }
}
