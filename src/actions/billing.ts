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
import { formatReasonForVisit } from '@/lib/constants/clinical-note-header'
import { parseIvnDiagnoses } from '@/lib/icd10/parse-ivn-diagnoses'
import { singleAnatomyFromSites } from '@/lib/procedures/anatomy-classifier'
import { getProcedureDefaultsByAnatomy } from '@/actions/procedure-defaults'
import { parseSitesJsonb } from '@/lib/procedures/sites-helpers'
import { computeBotoxDrugLineItems, computeBotoxFacilityLineItem, type BotoxDosing } from '@/lib/billing/botox-lines'
import { sortInvoiceLineItemsChronologically } from '@/lib/billing/sort-line-items'
import { resolveEncounterServiceDate } from '@/lib/billing/encounter-service-date'

// Count distinct injection sites in a free-text string.
// Splits on commas, semicolons, slashes, ampersands, plus signs, or the word "and".
// Examples:
//   "Cervical and Lumbar"      → 2
//   "Cervical, Lumbar, Thoracic" → 3
//   "Knee"                     → 1
//   "" | null | undefined      → 1
function countInjectionSites(injectionSite: string | null | undefined): number {
  if (!injectionSite) return 1
  const parts = injectionSite
    .split(/,|;|\/|&|\+|\s+and\s+/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  return Math.max(1, parts.length)
}

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
    .order('display_order', { foreignTable: 'invoice_line_items', ascending: true })
    .single()

  if (error) return { error: error.message, data: null }
  return { data }
}

export async function getInvoiceFormData(caseId: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated', data: null }

  const [caseResult, proceduresResult, clinicResult, providerProfileResult, initialVisitNotesResult, pmExtractionResult, mriExtractionResult, dischargeNoteResult, finalizedDischargeNotesResult, completedEncountersResult, claimsResult] = await Promise.all([
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
    // Use current user ID for provider profile (single-provider clinic)
    supabase
      .from('provider_profiles')
      .select('*')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('initial_visit_notes')
      .select('visit_type, chief_complaint, diagnoses, created_at, visit_date, encounter_id, status')
      .eq('case_id', caseId)
      .eq('status', 'finalized')
      .is('deleted_at', null)
      .order('created_at', { ascending: true }),
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
      .select('created_at, visit_date, diagnoses, status, encounter_id')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('discharge_notes')
      .select('encounter_id, visit_date')
      .eq('case_id', caseId)
      .eq('status', 'finalized')
      .is('deleted_at', null),
    supabase.from('clinical_encounters').select('id,encounter_type,encounter_date,completed_at')
      .eq('case_id',caseId).eq('status','completed').in('encounter_type',['pain_follow_up','discharge']).is('deleted_at',null),
    supabase.from('billing_source_claims').select('encounter_id,procedure_id,claim_kind,invoice_id')
      .is('released_at',null),
  ])

  if (caseResult.error) return { error: caseResult.error.message, data: null }

  const providerProfile = providerProfileResult.data

  // Derive diagnoses precedence:
  //  1. Finalized Discharge Note free-text diagnoses — post-treatment
  //     authoritative list (A→D suffix rewrites and downgrades have already
  //     been applied). When a discharge is committed it is the medico-legal
  //     final word, so it supersedes procedure jsonb (which still holds the
  //     pre-discharge "initial encounter" snapshots from earlier visits).
  //  2. Procedure structured diagnoses (jsonb) — clinical encounter codes
  //     used while treatment is ongoing or when discharge is still in draft.
  //  3. Draft Discharge Note free-text diagnoses — supersedes IVN so stale
  //     pre-treatment codes don't reappear post-discharge.
  //  4. Initial Visit Note free-text diagnoses — pre-discharge working list.
  let diagnoses: Array<{ icd10_code: string | null; description: string }> = []
  const procedures = proceduresResult.data ?? []
  const dischargeNote = dischargeNoteResult.data as
    | { diagnoses: string | null; status: string | null }
    | null
  const procedureWithDiagnoses = procedures.find(
    (p: { diagnoses?: unknown }) => Array.isArray(p.diagnoses) && (p.diagnoses as unknown[]).length > 0
  )
  const dischargeIsFinalized = dischargeNote?.status === 'finalized'
  const dischargeDiagnoses = dischargeNote ? parseIvnDiagnoses(dischargeNote.diagnoses) : []

  if (dischargeIsFinalized && dischargeDiagnoses.length > 0) {
    diagnoses = dischargeDiagnoses
  } else if (procedureWithDiagnoses) {
    diagnoses = procedureWithDiagnoses.diagnoses as typeof diagnoses
  } else if (dischargeNote) {
    diagnoses = dischargeDiagnoses
  } else {
    // Prefer pain_evaluation_visit (imaging-confirmed codes) over initial_visit (clinical impression).
    const visitNotesForDx = (initialVisitNotesResult.data ?? []) as Array<{
      visit_type: string
      diagnoses: string | null
    }>
    const preferredIvn =
      visitNotesForDx.find((r) => r.visit_type === 'pain_evaluation_visit' && r.diagnoses)
      ?? visitNotesForDx.find((r) => r.visit_type === 'initial_visit' && r.diagnoses)
      ?? null
    diagnoses = parseIvnDiagnoses(preferredIvn?.diagnoses)
  }

  // Derive indication: use formatReasonForVisit() — same medical-legal etiology phrase
  // used by Initial Visit Notes and Discharge Notes. Ensures the invoice's indication
  // matches the rest of the chart for defensible PI paperwork.
  const indication = formatReasonForVisit(caseResult.data.accident_type)

  // Fetch default prices and full catalog items from service catalog
  const [priceMap, { data: catalogItems }] = await Promise.all([
    getServiceCatalogPriceMap(),
    listServiceCatalog(),
  ])

  // Diagnostic: surface silent $0 fallbacks caused by mis-entered CPT codes in Settings.
  // Leave as a warn (not a thrown error) — a clinic may legitimately leave some codes at 0.
  const expectedCodes = ['99204', '76140', '0232T', '86999', '76942', '99213']
  const missingCodes = expectedCodes.filter((code) => (priceMap[code] ?? 0) === 0)
  if (missingCodes.length > 0) {
    console.warn(
      `[billing] Missing or zero-priced CPT codes in service_catalog: ${missingCodes.join(', ')} — check Settings → Pricing Catalog`,
    )
  }

  // Build pre-populated line items matching reference invoice format
  const prePopulatedLineItems: Array<{
    procedure_id?: string
    encounter_id?: string
    service_date: string
    cpt_code: string
    description: string
    quantity: number
    unit_price: number
    total_price: number
  }> = []

  const caseOpenDate = caseResult.data?.case_open_date
  const claimedEncounterIds = new Set((claimsResult.data ?? []).filter((claim)=>claim.claim_kind==='visit').map((claim)=>claim.encounter_id).filter(Boolean))
  const claimedProcedureKinds = new Set((claimsResult.data ?? []).filter((claim)=>claim.procedure_id).map((claim)=>`${claim.procedure_id}:${claim.claim_kind}`))

  // 1. Visit line items (CPT 99204) — one per initial_visit_notes row
  // The initial_visit_notes table stores both Initial Visit and Pain Evaluation Visit,
  // discriminated by visit_type. Each is a separate billable visit.
  const visitNotes = (initialVisitNotesResult.data ?? []) as Array<{
    visit_type: string
    visit_date: string | null
    created_at: string | null
    chief_complaint: string | null
    diagnoses: string | null
    encounter_id: string | null
  }>
  for (const note of visitNotes) {
    if (note.encounter_id && claimedEncounterIds.has(note.encounter_id)) continue
    const price = priceMap['99204'] ?? 0
    const description = note.visit_type === 'pain_evaluation_visit'
      ? 'Pain evaluation visit (45-60min)'
      : 'Initial exam (45-60min)'
    prePopulatedLineItems.push({
      encounter_id: note.encounter_id ?? undefined,
      service_date: note.visit_date
        ?? note.created_at?.split('T')[0]
        ?? caseOpenDate
        ?? new Date().toISOString().split('T')[0],
      cpt_code: '99204',
      description,
      quantity: 1,
      unit_price: price,
      total_price: price,
    })
  }

  // 2. MRI review (CPT 76140) — if approved MRI extractions exist.
  // Service date = the visit during which the MRI was reviewed (Pain Evaluation Visit
  // if it exists, otherwise Initial Visit).
  if (mriExtractionResult.data) {
    const price = priceMap['76140'] ?? 0
    const painEvalNote = visitNotes.find((n) => n.visit_type === 'pain_evaluation_visit')
    const initialNote = visitNotes.find((n) => n.visit_type === 'initial_visit')
    const mriReviewDate = painEvalNote?.visit_date
      ?? initialNote?.visit_date
      ?? caseOpenDate
      ?? new Date().toISOString().split('T')[0]
    prePopulatedLineItems.push({
      service_date: mriReviewDate,
      cpt_code: '76140',
      description: 'MRI review',
      quantity: 1,
      unit_price: price,
      total_price: price,
    })
  }

  // 3. Procedure line items — CPT lookup per anatomy via procedure_defaults
  // table (B1). Falls back to legacy hard-coded composite when sites do not
  // resolve to a single seeded anatomy or when no row matches. Old invoices
  // already-built keep their literal cpt_code; only newly-constructed line
  // items consult the table.
  const FALLBACK_CPT_CODES = ['0232T', '86999', '76942']
  // BOTOX billing codes. Per-unit drug/admin ($/U) and a flat facility fee are
  // read from the service catalog by these codes; fall back to defaults when
  // the catalog has no entry.
  const BOTOX_UNIT_CODE = 'BOTOX-UNIT'
  const BOTOX_FACILITY_CODE = 'BOTOX-FACILITY'
  const BOTOX_UNIT_PRICE_FALLBACK = 15
  const BOTOX_FACILITY_PRICE_FALLBACK = 200
  const botoxUnitPrice = priceMap[BOTOX_UNIT_CODE] || BOTOX_UNIT_PRICE_FALLBACK
  const botoxFacilityPrice = priceMap[BOTOX_FACILITY_CODE] || BOTOX_FACILITY_PRICE_FALLBACK

  for (const proc of procedures) {
    const typedProc = proc as {
      id: string
      procedure_date: string
      cpt_code: string | null
      procedure_name: string
      injection_site?: string | null
      sites?: unknown
      procedure_type?: 'prp' | 'cortisone' | 'hyaluronic' | 'botox' | null
      botox_dosing?: unknown
    }
    if (claimedProcedureKinds.has(`${typedProc.id}:medical`)) continue

    // BOTOX: per-unit administration line + separate waste line (JW-style),
    // reconciling to the reconstituted vial. No PRP CPT composite.
    if (typedProc.procedure_type === 'botox') {
      prePopulatedLineItems.push(
        ...computeBotoxDrugLineItems({
          procedureId: typedProc.id,
          procedureDate: typedProc.procedure_date,
          injectionSite: typedProc.injection_site,
          dosing: (typedProc.botox_dosing ?? null) as BotoxDosing | null,
          unitCode: BOTOX_UNIT_CODE,
          unitPrice: botoxUnitPrice,
        }),
      )
      continue
    }

    const parsedSites = parseSitesJsonb(typedProc.sites)
    const anatomyKey = singleAnatomyFromSites(parsedSites)
    const procDefaults = anatomyKey
      ? await getProcedureDefaultsByAnatomy(anatomyKey, typedProc.procedure_type ?? 'prp')
      : null

    const cptCodes =
      procDefaults?.default_cpt_codes && procDefaults.default_cpt_codes.length > 0
        ? procDefaults.default_cpt_codes
        : FALLBACK_CPT_CODES

    const sitesText: string[] = []
    if (typedProc.injection_site) sitesText.push(typedProc.injection_site)
    const baseDescription = anatomyKey
      ? `PRP preparation and injection — ${anatomyKey.replace(/_/g, ' ')}`
      : 'PRP preparation and injection with US guided'
    const description =
      baseDescription + (sitesText.length > 0 ? `\n${sitesText.join(' ')}` : '')

    const unitPrice = cptCodes.reduce((sum, code) => sum + (priceMap[code] ?? 0), 0)
    const quantity = countInjectionSites(typedProc.injection_site)

    prePopulatedLineItems.push({
      procedure_id: typedProc.id,
      service_date: typedProc.procedure_date,
      cpt_code: cptCodes.join('\n'),
      description,
      quantity,
      unit_price: unitPrice,
      total_price: unitPrice * quantity,
    })
  }

  // Facility invoice line items — one "Medical site utilization" per procedure performed
  // Look up price from the catalog entry with description matching "Medical site utilization"
  const msuItem = (catalogItems ?? []).find(
    (item: { description: string }) => item.description.toLowerCase().includes('medical site utilization')
  )
  const msuPrice = msuItem ? Number((msuItem as { default_price: number }).default_price) : 0
  const facilityLineItems: typeof prePopulatedLineItems = procedures.map((proc) => {
    const typedProc = proc as {
      id: string
      procedure_date: string
      procedure_type?: 'prp' | 'cortisone' | 'hyaluronic' | 'botox' | null
    }
    // BOTOX: flat procedure-room/site utilization fee (distinct from the PRP MSU).
    if (typedProc.procedure_type === 'botox') {
      return computeBotoxFacilityLineItem({
        procedureId: typedProc.id,
        procedureDate: typedProc.procedure_date,
        facilityCode: BOTOX_FACILITY_CODE,
        facilityPrice: botoxFacilityPrice,
      })
    }
    return {
      procedure_id: typedProc.id,
      service_date: typedProc.procedure_date,
      cpt_code: '0232T\n86999\n76942',
      description: 'Medical site utilization',
      quantity: 1,
      unit_price: msuPrice,
      total_price: msuPrice,
    }
  }).filter((line) => !line.procedure_id || !claimedProcedureKinds.has(`${line.procedure_id}:facility`))

  const dischargeVisitDatesByEncounterId = new Map(
    (finalizedDischargeNotesResult.data ?? [])
      .filter((note) => note.encounter_id)
      .map((note) => [note.encounter_id as string, note.visit_date]),
  )
  const currentDate = new Date().toISOString().slice(0, 10)

  for (const encounter of completedEncountersResult.data ?? []) {
    if (claimedEncounterIds.has(encounter.id)) continue
    const dischargeVisitDate = dischargeVisitDatesByEncounterId.get(encounter.id)
    if (encounter.encounter_type === 'discharge' && !dischargeVisitDatesByEncounterId.has(encounter.id)) continue
    const price = priceMap['99213'] ?? 0
    prePopulatedLineItems.push({
      encounter_id: encounter.id,
      service_date: resolveEncounterServiceDate(encounter, {
        dischargeVisitDate,
        fallbackDate: currentDate,
      }),
      cpt_code:'99213',
      description:encounter.encounter_type==='discharge'?'Follow-up / discharge visit':'Pain management follow-up visit',
      quantity:1,unit_price:price,total_price:price,
    })
  }

  // Default invoice date: discharge visit → initial visit → null (dialog falls back to today).
  // Picks the earliest initial_visit_notes row (ordered ascending above) so we land on the
  // initial_visit rather than a later pain_evaluation_visit.
  const dischargeData = dischargeNoteResult.data as { visit_date?: string | null; created_at?: string | null } | null
  const firstVisitNote = (initialVisitNotesResult.data ?? [])[0] as { visit_date?: string | null; created_at?: string | null } | undefined
  const dischargeDate =
    dischargeData?.visit_date
    ?? dischargeData?.created_at?.split('T')[0]
    ?? firstVisitNote?.visit_date
    ?? firstVisitNote?.created_at?.split('T')[0]
    ?? null

  return {
    data: {
      caseData: caseResult.data,
      procedures,
      clinic: clinicResult.data,
      providerProfile,
      diagnoses,
      indication,
      dischargeDate,
      prePopulatedLineItems: sortInvoiceLineItemsChronologically(prePopulatedLineItems),
      facilityLineItems: sortInvoiceLineItemsChronologically(facilityLineItems),
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

  const lineItemRows = line_items.map((item, idx) => ({
    procedure_id: item.procedure_id || null,
    encounter_id: item.encounter_id || null,
    service_date: item.service_date,
    cpt_code: item.cpt_code,
    description: item.description,
    quantity: item.quantity,
    unit_price: item.unit_price,
    total_price: item.total_price,
    display_order: idx,
  }))

  const { data: invoiceId, error: invoiceError } = await supabase.rpc('save_invoice_with_claims', {
    p_case_id: caseId, p_invoice_id: null,
    p_invoice: { ...invoiceData, total_amount: totalAmount }, p_lines: lineItemRows,
  })
  if (invoiceError || !invoiceId) return { error: invoiceError?.code === '23505' ? 'One or more clinical services are already on another invoice' : 'Failed to create invoice' }
  const { data: invoice } = await supabase.from('invoices').select('*').eq('id', invoiceId).single()

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

  const lineItemRows = line_items.map((item, idx) => ({
    procedure_id: item.procedure_id || null,
    encounter_id: item.encounter_id || null,
    service_date: item.service_date,
    cpt_code: item.cpt_code,
    description: item.description,
    quantity: item.quantity,
    unit_price: item.unit_price,
    total_price: item.total_price,
    display_order: idx,
  }))

  const { error: invoiceError } = await supabase.rpc('save_invoice_with_claims', {
    p_case_id: caseId, p_invoice_id: invoiceId,
    p_invoice: { ...invoiceData, total_amount: totalAmount }, p_lines: lineItemRows,
  })
  if (invoiceError) return { error: invoiceError.code === '23505' ? 'One or more clinical services are already on another invoice' : 'Failed to update invoice' }
  const { data: invoice } = await supabase.from('invoices').select('*').eq('id', invoiceId).single()

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
      .order('display_order', { foreignTable: 'invoice_line_items', ascending: true })
      .single(),
    supabase
      .from('clinic_settings')
      .select('*')
      .is('deleted_at', null)
      .maybeSingle(),
    // Use current user ID for provider profile (single-provider clinic)
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
