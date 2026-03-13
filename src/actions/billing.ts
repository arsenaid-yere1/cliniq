'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  createInvoiceSchema,
  updateInvoiceSchema,
  type CreateInvoiceFormValues,
  type UpdateInvoiceFormValues,
} from '@/lib/validations/invoice'

export async function listInvoices(caseId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .order('invoice_date', { ascending: false })

  if (error) return { error: error.message, data: [] }
  return { data: data ?? [] }
}

export async function getBillingSummary(caseId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('cases')
    .select('total_billed, total_paid, balance_due')
    .eq('id', caseId)
    .single()

  if (error) return { error: error.message, data: null }
  return { data }
}

export async function getInvoice(invoiceId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('invoices')
    .select(`
      *,
      line_items:invoice_line_items(*)
    `)
    .eq('id', invoiceId)
    .is('deleted_at', null)
    .single()

  if (error) return { error: error.message, data: null }
  return { data }
}

export async function getInvoiceFormData(caseId: string) {
  const supabase = await createClient()

  const [caseResult, proceduresResult, clinicResult, initialVisitResult] = await Promise.all([
    supabase
      .from('cases')
      .select(`
        *,
        patient:patients(*),
        attorney:attorneys(*)
      `)
      .eq('id', caseId)
      .is('deleted_at', null)
      .single(),
    supabase
      .from('procedures')
      .select('*')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .order('procedure_date', { ascending: true }),
    supabase
      .from('clinic_settings')
      .select('*')
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('initial_visit_notes')
      .select('chief_complaint, diagnoses')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (caseResult.error) return { error: caseResult.error.message, data: null }

  // Get provider profile if provider assigned
  let providerProfile = null
  const providerId = caseResult.data?.assigned_provider_id
  if (providerId) {
    const { data } = await supabase
      .from('provider_profiles')
      .select('*')
      .eq('user_id', providerId)
      .is('deleted_at', null)
      .maybeSingle()
    providerProfile = data
  }

  // Derive diagnoses: prefer structured from procedures, fall back to initial visit text
  let diagnoses: Array<{ icd10_code: string | null; description: string }> = []
  const procedures = proceduresResult.data ?? []
  const procedureWithDiagnoses = procedures.find(
    (p: { diagnoses?: unknown }) => Array.isArray(p.diagnoses) && (p.diagnoses as unknown[]).length > 0
  )
  if (procedureWithDiagnoses) {
    diagnoses = procedureWithDiagnoses.diagnoses as typeof diagnoses
  }

  // Derive indication from chief_complaint
  let indication = ''
  if (initialVisitResult.data?.chief_complaint) {
    indication = initialVisitResult.data.chief_complaint
  }

  // Build pre-populated line items from procedures
  const prePopulatedLineItems = procedures.map((proc: {
    id: string
    procedure_date: string
    cpt_code: string | null
    procedure_name: string
    injection_site?: string | null
    laterality?: string | null
    charge_amount: number | null
  }) => ({
    procedure_id: proc.id,
    service_date: proc.procedure_date,
    cpt_code: proc.cpt_code ?? '',
    description: proc.procedure_name + (proc.injection_site ? ` — ${proc.injection_site}` : '') + (proc.laterality ? ` (${proc.laterality})` : ''),
    quantity: 1,
    unit_price: Number(proc.charge_amount ?? 0),
    total_price: Number(proc.charge_amount ?? 0),
  }))

  return {
    data: {
      caseData: caseResult.data,
      procedures,
      clinic: clinicResult.data,
      providerProfile,
      diagnoses,
      indication,
      prePopulatedLineItems,
    },
  }
}

export async function createInvoice(caseId: string, values: CreateInvoiceFormValues) {
  const parsed = createInvoiceSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { line_items, ...invoiceData } = parsed.data
  const totalAmount = line_items.reduce((sum, item) => sum + item.total_price, 0)

  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .insert({
      case_id: caseId,
      invoice_type: invoiceData.invoice_type,
      invoice_date: invoiceData.invoice_date,
      claim_type: invoiceData.claim_type,
      indication: invoiceData.indication || null,
      diagnoses_snapshot: invoiceData.diagnoses_snapshot,
      payee_name: invoiceData.payee_name || null,
      payee_address: invoiceData.payee_address || null,
      notes: invoiceData.notes || null,
      total_amount: totalAmount,
      status: 'draft',
      created_by_user_id: user.id,
      updated_by_user_id: user.id,
    })
    .select()
    .single()

  if (invoiceError || !invoice) return { error: invoiceError?.message ?? 'Failed to create invoice' }

  const lineItemRows = line_items.map((item) => ({
    invoice_id: invoice.id,
    procedure_id: item.procedure_id || null,
    service_date: item.service_date,
    cpt_code: item.cpt_code,
    description: item.description,
    quantity: item.quantity,
    unit_price: item.unit_price,
    total_price: item.total_price,
  }))

  const { error: lineItemsError } = await supabase
    .from('invoice_line_items')
    .insert(lineItemRows)

  if (lineItemsError) return { error: lineItemsError.message }

  revalidatePath(`/patients/${caseId}/billing`)
  return { data: invoice }
}

export async function updateInvoice(invoiceId: string, caseId: string, values: UpdateInvoiceFormValues) {
  const parsed = updateInvoiceSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { line_items, ...invoiceData } = parsed.data
  const totalAmount = line_items.reduce((sum, item) => sum + item.total_price, 0)

  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .update({
      ...invoiceData,
      indication: invoiceData.indication || null,
      payee_name: invoiceData.payee_name || null,
      payee_address: invoiceData.payee_address || null,
      notes: invoiceData.notes || null,
      total_amount: totalAmount,
      updated_by_user_id: user.id,
    })
    .eq('id', invoiceId)
    .select()
    .single()

  if (invoiceError || !invoice) return { error: invoiceError?.message ?? 'Failed to update invoice' }

  // Replace line items: delete existing, insert new
  await supabase
    .from('invoice_line_items')
    .delete()
    .eq('invoice_id', invoiceId)

  const lineItemRows = line_items.map((item) => ({
    invoice_id: invoiceId,
    procedure_id: item.procedure_id || null,
    service_date: item.service_date,
    cpt_code: item.cpt_code,
    description: item.description,
    quantity: item.quantity,
    unit_price: item.unit_price,
    total_price: item.total_price,
  }))

  const { error: lineItemsError } = await supabase
    .from('invoice_line_items')
    .insert(lineItemRows)

  if (lineItemsError) return { error: lineItemsError.message }

  revalidatePath(`/patients/${caseId}/billing`)
  return { data: invoice }
}

export async function deleteInvoice(invoiceId: string, caseId: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('invoices')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', invoiceId)

  if (error) return { error: error.message }
  revalidatePath(`/patients/${caseId}/billing`)
  return { success: true }
}

export async function getInvoiceWithContext(invoiceId: string) {
  const supabase = await createClient()

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select(`
      *,
      line_items:invoice_line_items(*),
      case:cases(
        *,
        patient:patients(*),
        attorney:attorneys(*)
      )
    `)
    .eq('id', invoiceId)
    .is('deleted_at', null)
    .single()

  if (error) return { error: error.message, data: null }

  const { data: clinic } = await supabase
    .from('clinic_settings')
    .select('*')
    .is('deleted_at', null)
    .maybeSingle()

  let providerProfile = null
  const providerId = invoice?.case?.assigned_provider_id
  if (providerId) {
    const { data } = await supabase
      .from('provider_profiles')
      .select('*')
      .eq('user_id', providerId)
      .is('deleted_at', null)
      .maybeSingle()
    providerProfile = data
  }

  return { data: { invoice, clinic, providerProfile } }
}
