'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  createInvoiceSchema,
  updateInvoiceSchema,
  type CreateInvoiceFormValues,
  type UpdateInvoiceFormValues,
} from '@/lib/validations/invoice'
import { getServiceCatalogPriceMap, listServiceCatalog } from '@/actions/service-catalog'
import { assertCaseNotClosed } from '@/actions/case-status'

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

  const [caseResult, proceduresResult, clinicResult, initialVisitResult, pmExtractionResult, mriExtractionResult, dischargeNoteResult] = await Promise.all([
    supabase
      .from('cases')
      .select(`
        *,
        patient:patients(*),
        attorney:attorneys(*),
        provider:users!assigned_provider_id(id, full_name)
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
      .select('chief_complaint, diagnoses, created_at')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('pain_management_extractions')
      .select('chief_complaints')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .in('review_status', ['approved', 'edited'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('mri_extractions')
      .select('id')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .in('review_status', ['approved', 'edited'])
      .limit(1)
      .maybeSingle(),
    supabase
      .from('discharge_notes')
      .select('created_at')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (caseResult.error) return { error: caseResult.error.message, data: null }

  // Get provider profile for current user (single-provider clinic — logged-in user IS the provider)
  const { data: { user } } = await supabase.auth.getUser()
  let providerProfile = null
  if (user) {
    const { data } = await supabase
      .from('provider_profiles')
      .select('*')
      .eq('user_id', user.id)
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

  // Derive indication: build from PM extraction complaint locations with accident context
  let indication = ''
  const pmComplaints = pmExtractionResult.data?.chief_complaints as Array<{ location: string }> | null
  if (Array.isArray(pmComplaints) && pmComplaints.length > 0) {
    const locations = pmComplaints.map((c) => c.location).filter(Boolean)
    if (locations.length > 0) {
      indication = `Post-traumatic ${locations.join(' and ').toLowerCase()} following motor vehicle accident`
    }
  } else if (initialVisitResult.data?.chief_complaint) {
    indication = initialVisitResult.data.chief_complaint
  }

  // Fetch default prices and full catalog items from service catalog
  const [priceMap, { data: catalogItems }] = await Promise.all([
    getServiceCatalogPriceMap(),
    listServiceCatalog(),
  ])

  // Build pre-populated line items matching reference invoice format
  const prePopulatedLineItems: Array<{
    procedure_id?: string
    service_date: string
    cpt_code: string
    description: string
    quantity: number
    unit_price: number
    total_price: number
  }> = []

  const caseOpenDate = caseResult.data?.case_open_date

  // 1. Initial exam (CPT 99204) — if an initial visit note exists
  if (initialVisitResult.data) {
    const price = priceMap['99204'] ?? 0
    prePopulatedLineItems.push({
      service_date: caseOpenDate ?? new Date().toISOString().split('T')[0],
      cpt_code: '99204',
      description: 'Initial exam (45-60min)',
      quantity: 1,
      unit_price: price,
      total_price: price,
    })
  }

  // 2. MRI review (CPT 76140) — if approved MRI extractions exist
  if (mriExtractionResult.data) {
    const price = priceMap['76140'] ?? 0
    prePopulatedLineItems.push({
      service_date: caseOpenDate ?? new Date().toISOString().split('T')[0],
      cpt_code: '76140',
      description: 'MRI review',
      quantity: 1,
      unit_price: price,
      total_price: price,
    })
  }

  // 3. PRP procedure line items (CPT 0232T 86999 76942)
  for (const proc of procedures) {
    const typedProc = proc as {
      id: string
      procedure_date: string
      cpt_code: string | null
      procedure_name: string
      injection_site?: string | null
      laterality?: string | null
      charge_amount: number | null
    }
    // Build description with injection sites listed below the main description
    const sites: string[] = []
    if (typedProc.injection_site) sites.push(typedProc.injection_site)
    if (typedProc.laterality) sites.push(`(${typedProc.laterality})`)
    const description = 'PRP preparation and injection with US guided'
      + (sites.length > 0 ? `\n${sites.join(' ')}` : '')

    const prpBundlePrice = (priceMap['0232T'] ?? 0) + (priceMap['86999'] ?? 0) + (priceMap['76942'] ?? 0)
    const catalogPrice = prpBundlePrice > 0 ? prpBundlePrice : Number(typedProc.charge_amount ?? 0)

    prePopulatedLineItems.push({
      procedure_id: typedProc.id,
      service_date: typedProc.procedure_date,
      cpt_code: '0232T\n86999\n76942',
      description,
      quantity: 1,
      unit_price: catalogPrice,
      total_price: catalogPrice,
    })
  }

  // 4. Follow up / Discharge visit (CPT 99213) — if a discharge note exists
  if (dischargeNoteResult.data) {
    const price = priceMap['99213'] ?? 0
    prePopulatedLineItems.push({
      service_date: dischargeNoteResult.data.created_at?.split('T')[0] ?? new Date().toISOString().split('T')[0],
      cpt_code: '99213',
      description: 'Follow up/ Discharge visit',
      quantity: 1,
      unit_price: price,
      total_price: price,
    })
  }

  return {
    data: {
      caseData: caseResult.data,
      procedures,
      clinic: clinicResult.data,
      providerProfile,
      diagnoses,
      indication,
      prePopulatedLineItems,
      catalogItems: catalogItems ?? [],
    },
  }
}

export async function createInvoice(caseId: string, values: CreateInvoiceFormValues) {
  const parsed = createInvoiceSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const { line_items, ...invoiceData } = parsed.data
  const totalAmount = line_items.reduce((sum, item) => sum + item.total_price, 0)

  // invoice_number is auto-generated by DB trigger (set_invoice_number)
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

  // Case-closed guard
  const { data: invoiceRow } = await supabase
    .from('invoices')
    .select('status, case_id')
    .eq('id', invoiceId)
    .is('deleted_at', null)
    .single()

  if (!invoiceRow) return { error: 'Invoice not found' }

  const closedCheck = await assertCaseNotClosed(supabase, invoiceRow.case_id)
  if (closedCheck.error) return { error: closedCheck.error }

  // Immutability: only draft invoices can be edited
  if (invoiceRow.status !== 'draft') {
    return { error: 'Only draft invoices can be edited. Void this invoice and create a new one.' }
  }

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
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Fetch invoice to check status
  const { data: invoice } = await supabase
    .from('invoices')
    .select('status, case_id')
    .eq('id', invoiceId)
    .is('deleted_at', null)
    .single()

  if (!invoice) return { error: 'Invoice not found' }

  const closedCheck = await assertCaseNotClosed(supabase, invoice.case_id)
  if (closedCheck.error) return { error: closedCheck.error }

  // Only draft invoices can be deleted; issued+ invoices must be voided
  if (invoice.status !== 'draft') {
    return { error: 'Only draft invoices can be deleted. Use void for issued invoices.' }
  }

  const { error } = await supabase
    .from('invoices')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', invoiceId)

  if (error) return { error: error.message }
  revalidatePath(`/patients/${caseId}/billing`)
  return { success: true }
}

export async function generateInvoicePdf(invoiceId: string) {
  const { renderInvoicePdf } = await import('@/lib/pdf/render-invoice-pdf')

  try {
    const pdfBuffer = await renderInvoicePdf({ invoiceId })
    return { data: Buffer.from(pdfBuffer).toString('base64') }
  } catch {
    return { error: 'Failed to generate PDF' }
  }
}

export async function getInvoiceWithContext(invoiceId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated', data: null }

  // Parallel fetch: invoice+case+patient+attorney, clinic, provider profile (current user)
  const [invoiceResult, clinicResult, providerProfileResult] = await Promise.all([
    supabase
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
      .single(),
    supabase
      .from('clinic_settings')
      .select('*')
      .is('deleted_at', null)
      .maybeSingle(),
    // Use current user ID for provider profile (same pattern as getInvoiceFormData)
    supabase
      .from('provider_profiles')
      .select('*')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle(),
  ])

  if (invoiceResult.error) return { error: invoiceResult.error.message, data: null }

  return { data: { invoice: invoiceResult.data, clinic: clinicResult.data, providerProfile: providerProfileResult.data } }
}
