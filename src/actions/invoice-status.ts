'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { ALLOWED_TRANSITIONS, type InvoiceStatus } from '@/lib/constants/invoice-status'

// -- Internal helper: validate and execute a status transition --

async function transitionInvoiceStatus(
  invoiceId: string,
  targetStatus: InvoiceStatus,
  options: { reason?: string; metadata?: Record<string, unknown> } = {}
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Fetch current invoice
  const { data: invoice, error: fetchError } = await supabase
    .from('invoices')
    .select('id, status, case_id')
    .eq('id', invoiceId)
    .is('deleted_at', null)
    .single()

  if (fetchError || !invoice) return { error: 'Invoice not found' }

  const currentStatus = invoice.status as InvoiceStatus

  // Validate transition
  if (!ALLOWED_TRANSITIONS[currentStatus]?.includes(targetStatus)) {
    return { error: `Cannot change status from '${currentStatus}' to '${targetStatus}'` }
  }

  // Update status
  const { error: updateError } = await supabase
    .from('invoices')
    .update({
      status: targetStatus,
      updated_by_user_id: user.id,
    })
    .eq('id', invoiceId)

  if (updateError) return { error: updateError.message }

  // Insert history record
  const { error: historyError } = await supabase
    .from('invoice_status_history')
    .insert({
      invoice_id: invoiceId,
      previous_status: currentStatus,
      new_status: targetStatus,
      changed_by_user_id: user.id,
      reason: options.reason ?? null,
      metadata: options.metadata ?? null,
    })

  if (historyError) {
    console.error('Failed to insert invoice status history:', historyError)
    // Don't fail the transition — the status update already succeeded
    // Log for monitoring but don't block the user
  }

  revalidatePath(`/patients/${invoice.case_id}/billing`)
  return { error: null }
}

// -- Public named transition actions --

export async function issueInvoice(invoiceId: string) {
  // Precondition: invoice must have at least 1 line item
  const supabase = await createClient()

  const { data: lineItems } = await supabase
    .from('invoice_line_items')
    .select('id')
    .eq('invoice_id', invoiceId)
    .limit(1)

  if (!lineItems || lineItems.length === 0) {
    return { error: 'Cannot issue an invoice with no line items' }
  }

  return transitionInvoiceStatus(invoiceId, 'issued')
}

export async function markInvoicePaid(invoiceId: string) {
  return transitionInvoiceStatus(invoiceId, 'paid')
}

export async function voidInvoice(invoiceId: string, reason: string) {
  if (!reason || reason.trim().length === 0) {
    return { error: 'A reason is required to void an invoice' }
  }
  return transitionInvoiceStatus(invoiceId, 'void', { reason: reason.trim() })
}

export async function markInvoiceOverdue(invoiceId: string) {
  return transitionInvoiceStatus(invoiceId, 'overdue')
}

export async function writeOffInvoice(invoiceId: string, reason: string) {
  if (!reason || reason.trim().length === 0) {
    return { error: 'A reason is required to write off an invoice' }
  }
  return transitionInvoiceStatus(invoiceId, 'uncollectible', { reason: reason.trim() })
}

// -- History query --

export async function getInvoiceStatusHistory(invoiceId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('invoice_status_history')
    .select('id, previous_status, new_status, changed_at, changed_by_user_id, reason')
    .eq('invoice_id', invoiceId)
    .order('changed_at', { ascending: false })

  if (error) return { error: error.message, data: null }
  return { error: null, data }
}
