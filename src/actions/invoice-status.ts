'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { ALLOWED_TRANSITIONS, type InvoiceStatus } from '@/lib/constants/invoice-status'
import { assertCaseNotClosed } from '@/actions/case-status'

// -- Internal helper: validate and execute a status transition --

async function transitionInvoiceStatus(
  invoiceId: string,
  targetStatus: InvoiceStatus,
  options: { reason?: string; metadata?: Record<string, unknown> } = {}
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: invoice, error: fetchError } = await supabase
    .from('invoices')
    .select('id, status, case_id')
    .eq('id', invoiceId)
    .is('deleted_at', null)
    .single()

  if (fetchError || !invoice) return { error: 'Invoice not found' }

  const closedCheck = await assertCaseNotClosed(supabase, invoice.case_id)
  if (closedCheck.error) return { error: closedCheck.error }

  const currentStatus = invoice.status as InvoiceStatus

  if (!ALLOWED_TRANSITIONS[currentStatus]?.includes(targetStatus)) {
    return { error: `Cannot change status from '${currentStatus}' to '${targetStatus}'` }
  }

  const { error: updateError } = await supabase
    .from('invoices')
    .update({
      status: targetStatus,
      updated_by_user_id: user.id,
    })
    .eq('id', invoiceId)

  if (updateError) return { error: updateError.message }

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
  }

  revalidatePath(`/patients/${invoice.case_id}/billing`)
  return { error: null }
}

// -- Public named transition actions --

export async function issueInvoice(invoiceId: string) {
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

export async function markInvoicePaid(
  invoiceId: string,
  input: {
    amount: number
    paymentDate?: string
    paymentMethod?: string
    referenceNumber?: string
    notes?: string
    settlementReason?: string
  }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: invoice, error: fetchError } = await supabase
    .from('invoices')
    .select('id, status, case_id, total_amount, paid_amount')
    .eq('id', invoiceId)
    .is('deleted_at', null)
    .single()

  if (fetchError || !invoice) return { error: 'Invoice not found' }

  const closedCheck = await assertCaseNotClosed(supabase, invoice.case_id)
  if (closedCheck.error) return { error: closedCheck.error }

  const currentStatus = invoice.status as InvoiceStatus
  if (!ALLOWED_TRANSITIONS[currentStatus]?.includes('paid')) {
    return { error: `Cannot mark invoice paid from status '${currentStatus}'` }
  }

  const total = Number(invoice.total_amount)
  const alreadyPaid = Number(invoice.paid_amount)
  const balanceDue = total - alreadyPaid
  const amount = Number(input.amount)

  if (!(amount > 0)) return { error: 'Payment amount must be greater than 0' }
  if (amount > balanceDue) {
    return { error: `Payment amount ($${amount.toFixed(2)}) exceeds balance due ($${balanceDue.toFixed(2)}). Overpayment is not supported.` }
  }

  const newPaidTotal = alreadyPaid + amount
  const isSettledBelowTotal = newPaidTotal < total
  const settlementReason = input.settlementReason?.trim() ?? ''

  if (isSettledBelowTotal && settlementReason.length === 0) {
    return { error: 'Settlement reason is required when marking an invoice paid below its total amount' }
  }

  const { error: paymentError } = await supabase.from('payments').insert({
    invoice_id: invoiceId,
    amount,
    payment_date: input.paymentDate ?? new Date().toISOString().slice(0, 10),
    payment_method: input.paymentMethod ?? null,
    reference_number: input.referenceNumber ?? null,
    notes: input.notes ?? null,
    created_by_user_id: user.id,
  })
  if (paymentError) return { error: paymentError.message }

  const { error: updateError } = await supabase
    .from('invoices')
    .update({
      paid_amount: newPaidTotal,
      status: 'paid',
      settlement_reason: isSettledBelowTotal ? settlementReason : null,
      updated_by_user_id: user.id,
    })
    .eq('id', invoiceId)
  if (updateError) return { error: updateError.message }

  const { error: historyError } = await supabase.from('invoice_status_history').insert({
    invoice_id: invoiceId,
    previous_status: currentStatus,
    new_status: 'paid',
    changed_by_user_id: user.id,
    reason: isSettledBelowTotal ? settlementReason : null,
    metadata: {
      payment_amount: amount,
      total_amount: total,
      paid_amount_after: newPaidTotal,
      settled_below_total: isSettledBelowTotal,
      settlement_shortfall: isSettledBelowTotal ? total - newPaidTotal : 0,
    },
  })
  if (historyError) {
    console.error('Failed to insert invoice status history:', historyError)
  }

  revalidatePath(`/patients/${invoice.case_id}/billing`)
  return { error: null }
}

// Record a partial payment without changing invoice status.
// Use when clinic receive payment but not yet settling the invoice.
export async function recordPayment(
  invoiceId: string,
  input: {
    amount: number
    paymentDate?: string
    paymentMethod?: string
    referenceNumber?: string
    notes?: string
  }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: invoice, error: fetchError } = await supabase
    .from('invoices')
    .select('id, status, case_id, total_amount, paid_amount')
    .eq('id', invoiceId)
    .is('deleted_at', null)
    .single()
  if (fetchError || !invoice) return { error: 'Invoice not found' }

  const closedCheck = await assertCaseNotClosed(supabase, invoice.case_id)
  if (closedCheck.error) return { error: closedCheck.error }

  const status = invoice.status as InvoiceStatus
  if (status !== 'issued' && status !== 'overdue') {
    return { error: `Cannot record payment on invoice with status '${status}'` }
  }

  const total = Number(invoice.total_amount)
  const alreadyPaid = Number(invoice.paid_amount)
  const balanceDue = total - alreadyPaid
  const amount = Number(input.amount)

  if (!(amount > 0)) return { error: 'Payment amount must be greater than 0' }
  if (amount > balanceDue) {
    return { error: `Payment amount ($${amount.toFixed(2)}) exceeds balance due ($${balanceDue.toFixed(2)}). Overpayment is not supported.` }
  }

  const { error: paymentError } = await supabase.from('payments').insert({
    invoice_id: invoiceId,
    amount,
    payment_date: input.paymentDate ?? new Date().toISOString().slice(0, 10),
    payment_method: input.paymentMethod ?? null,
    reference_number: input.referenceNumber ?? null,
    notes: input.notes ?? null,
    created_by_user_id: user.id,
  })
  if (paymentError) return { error: paymentError.message }

  const { error: updateError } = await supabase
    .from('invoices')
    .update({
      paid_amount: alreadyPaid + amount,
      updated_by_user_id: user.id,
    })
    .eq('id', invoiceId)
  if (updateError) return { error: updateError.message }

  revalidatePath(`/patients/${invoice.case_id}/billing`)
  return { error: null }
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
    .select('id, previous_status, new_status, changed_at, changed_by_user_id, reason, metadata')
    .eq('invoice_id', invoiceId)
    .order('changed_at', { ascending: false })

  if (error) return { error: error.message, data: null }
  return { error: null, data }
}
