'use server'

import { createClient } from '@/lib/supabase/server'
import { INVOICE_STATUS_LABELS, type InvoiceStatus } from '@/lib/constants/invoice-status'
import { CASE_STATUS_CONFIG, type CaseStatus } from '@/lib/constants/case-status'

export type TimelineEventType = 'status_change' | 'document_added' | 'procedure' | 'invoice_created' | 'invoice_status_change'

export interface TimelineEvent {
  id: string
  type: TimelineEventType
  date: string
  title: string
  description: string | null
  metadata?: Record<string, unknown>
}

export async function getTimelineEvents(caseId: string): Promise<{ data: TimelineEvent[], error?: string }> {
  const supabase = await createClient()

  const [statusRes, docRes, procRes, invRes, invStatusRes] = await Promise.all([
    supabase
      .from('case_status_history')
      .select('id, previous_status, new_status, changed_at, notes, changed_by:users!changed_by_user_id(full_name)')
      .eq('case_id', caseId)
      .order('changed_at', { ascending: false }),
    supabase
      .from('documents')
      .select('id, file_name, document_type, created_at')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabase
      .from('procedures')
      .select('id, procedure_name, procedure_date')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .order('procedure_date', { ascending: false }),
    supabase
      .from('invoices')
      .select('id, invoice_number, invoice_date, total_amount, status')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .order('invoice_date', { ascending: false }),
    supabase
      .from('invoice_status_history')
      .select(`
        id,
        invoice_id,
        previous_status,
        new_status,
        changed_at,
        reason,
        invoices!inner(invoice_number, case_id)
      `)
      .eq('invoices.case_id', caseId)
      .order('changed_at', { ascending: false }),
  ])

  const events: TimelineEvent[] = []

  // Map status changes
  for (const s of statusRes.data ?? []) {
    const changedBy = Array.isArray(s.changed_by) ? s.changed_by[0] : s.changed_by
    events.push({
      id: `status-${s.id}`,
      type: 'status_change',
      date: s.changed_at,
      title: s.previous_status
        ? `Status changed from ${formatStatus(s.previous_status)} to ${formatStatus(s.new_status)}`
        : `Case opened as ${formatStatus(s.new_status)}`,
      description: s.notes ?? (changedBy?.full_name ? `By ${changedBy.full_name}` : null),
    })
  }

  // Map documents
  for (const d of docRes.data ?? []) {
    events.push({
      id: `doc-${d.id}`,
      type: 'document_added',
      date: d.created_at,
      title: `Document added: ${d.file_name}`,
      description: formatDocType(d.document_type),
    })
  }

  // Map procedures
  for (const p of procRes.data ?? []) {
    events.push({
      id: `proc-${p.id}`,
      type: 'procedure',
      date: p.procedure_date + 'T00:00:00',
      title: p.procedure_name,
      description: null,
    })
  }

  // Map invoices
  for (const i of invRes.data ?? []) {
    events.push({
      id: `inv-${i.id}`,
      type: 'invoice_created',
      date: i.invoice_date + 'T00:00:00',
      title: `Invoice ${i.invoice_number}`,
      description: `$${Number(i.total_amount).toFixed(2)} - ${INVOICE_STATUS_LABELS[i.status as InvoiceStatus] ?? i.status}`,
    })
  }

  // Map invoice status changes
  for (const h of invStatusRes.data ?? []) {
    const inv = Array.isArray(h.invoices) ? h.invoices[0] : h.invoices
    if (!inv) continue
    const prevLabel = h.previous_status ? (INVOICE_STATUS_LABELS[h.previous_status as InvoiceStatus] ?? h.previous_status) : 'New'
    const newLabel = INVOICE_STATUS_LABELS[h.new_status as InvoiceStatus] ?? h.new_status
    events.push({
      id: `inv-status-${h.id}`,
      type: 'invoice_status_change',
      date: h.changed_at,
      title: `Invoice ${inv.invoice_number} — ${newLabel}`,
      description: h.reason
        ? `${prevLabel} → ${newLabel}. Reason: ${h.reason}`
        : `${prevLabel} → ${newLabel}`,
    })
  }

  // Sort by date descending
  events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return { data: events }
}

function formatStatus(status: string): string {
  return CASE_STATUS_CONFIG[status as CaseStatus]?.label ?? status
}

function formatDocType(type: string): string {
  const labels: Record<string, string> = {
    mri_report: 'MRI Report',
    chiro_report: 'Chiropractor Report',
    generated: 'Generated Document',
    lien_agreement: 'Lien Agreement',
    other: 'Other',
  }
  return labels[type] ?? type
}

