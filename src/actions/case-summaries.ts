'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { createHash } from 'node:crypto'
import { generateCaseSummaryFromData, CASE_SUMMARY_SECTIONS_TOTAL, type SummaryInputData } from '@/lib/claude/generate-summary'
import { caseSummaryEditSchema, type CaseSummaryEditValues } from '@/lib/validations/case-summary'
import { assertCaseNotClosed } from '@/actions/case-status'

// --- Helper: compute source data hash ---

function computeSourceHash(inputData: SummaryInputData): string {
  const serialized = JSON.stringify(inputData)
  return createHash('sha256').update(serialized).digest('hex')
}

// --- Helper: gather all approved source data for a case ---

async function gatherSourceData(
  supabase: Awaited<ReturnType<typeof createClient>>,
  caseId: string,
): Promise<{ data: SummaryInputData | null; error: string | null }> {
  const [caseRes, mriRes, chiroRes, pmRes, ptRes, orthoRes, ctScanRes, xRayRes] = await Promise.all([
    supabase
      .from('cases')
      .select('accident_type, accident_date, accident_description')
      .eq('id', caseId)
      .is('deleted_at', null)
      .single(),
    supabase
      .from('mri_extractions')
      .select('body_region, mri_date, findings, impression_summary, provider_overrides')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .in('review_status', ['approved', 'edited']),
    supabase
      .from('chiro_extractions')
      .select('report_type, report_date, treatment_dates, diagnoses, treatment_modalities, functional_outcomes, provider_overrides')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .in('review_status', ['approved', 'edited']),
    supabase
      .from('pain_management_extractions')
      .select('report_date, examining_provider, chief_complaints, physical_exam, diagnoses, treatment_plan, diagnostic_studies_summary, provider_overrides')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .in('review_status', ['approved', 'edited']),
    supabase
      .from('pt_extractions')
      .select('evaluation_date, evaluating_therapist, pain_ratings, range_of_motion, muscle_strength, special_tests, outcome_measures, short_term_goals, long_term_goals, plan_of_care, diagnoses, clinical_impression, causation_statement, prognosis, provider_overrides')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .in('review_status', ['approved', 'edited']),
    supabase
      .from('orthopedic_extractions')
      .select('report_date, date_of_injury, examining_provider, provider_specialty, history_of_injury, present_complaints, physical_exam, diagnostics, diagnoses, recommendations, provider_overrides')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .in('review_status', ['approved', 'edited']),
    supabase
      .from('ct_scan_extractions')
      .select('body_region, scan_date, technique, reason_for_study, findings, impression_summary, provider_overrides')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .in('review_status', ['approved', 'edited']),
    supabase
      .from('x_ray_extractions')
      .select('body_region, laterality, scan_date, procedure_description, view_count, views_description, reading_type, ordering_provider, reading_provider, reason_for_study, findings, impression_summary, provider_overrides')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .in('review_status', ['approved', 'edited']),
  ])

  if (caseRes.error || !caseRes.data) {
    return { data: null, error: 'Failed to fetch case details' }
  }

  const mriExtractions = mriRes.data || []
  const chiroExtractions = chiroRes.data || []
  const pmExtractions = pmRes.data || []
  const ptExtractions = ptRes.data || []
  const orthoExtractions = orthoRes.data || []
  const ctScanExtractions = ctScanRes.data || []
  const xRayExtractions = xRayRes.data || []

  if (
    mriExtractions.length === 0 &&
    chiroExtractions.length === 0 &&
    pmExtractions.length === 0 &&
    ptExtractions.length === 0 &&
    orthoExtractions.length === 0 &&
    ctScanExtractions.length === 0 &&
    xRayExtractions.length === 0
  ) {
    return { data: null, error: 'No approved extractions found. Approve at least one extraction first.' }
  }

  return {
    data: {
      caseDetails: caseRes.data,
      mriExtractions,
      chiroExtractions,
      pmExtractions,
      ptExtractions,
      orthoExtractions,
      ctScanExtractions,
      xRayExtractions,
    },
    error: null,
  }
}

// --- Generate summary ---

export async function generateCaseSummary(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  // Gather source data
  const { data: inputData, error: gatherError } = await gatherSourceData(supabase, caseId)
  if (gatherError || !inputData) return { error: gatherError || 'Failed to gather source data' }

  // Soft-delete existing summary
  await supabase
    .from('case_summaries')
    .update({ deleted_at: new Date().toISOString(), updated_by_user_id: user.id })
    .eq('case_id', caseId)
    .is('deleted_at', null)

  // Insert processing record
  const sourceHash = computeSourceHash(inputData)
  const { data: record, error: insertError } = await supabase
    .from('case_summaries')
    .insert({
      case_id: caseId,
      generation_status: 'processing',
      generation_attempts: 1,
      source_data_hash: sourceHash,
      sections_done: 0,
      sections_total: CASE_SUMMARY_SECTIONS_TOTAL,
      created_by_user_id: user.id,
      updated_by_user_id: user.id,
    })
    .select('id')
    .single()

  if (insertError || !record) {
    revalidatePath(`/patients/${caseId}`)
    return { error: 'Failed to create summary record' }
  }

  // Throttled progress writer — coalesce Anthropic SDK inputJson events to
  // at most one DB UPDATE per 500ms so realtime subscribers get visible
  // ticks without thrashing the table.
  let lastProgressWriteAt = 0
  let lastWrittenCount = 0
  const writeProgress = async (count: number) => {
    if (count <= lastWrittenCount) return
    const now = Date.now()
    if (now - lastProgressWriteAt < 500) return
    lastProgressWriteAt = now
    lastWrittenCount = count
    await supabase
      .from('case_summaries')
      .update({ sections_done: count })
      .eq('id', record.id)
  }

  // Call Claude
  const result = await generateCaseSummaryFromData(
    inputData,
    (completedKeys) => writeProgress(completedKeys.length),
  )

  if (result.error || !result.data) {
    await supabase
      .from('case_summaries')
      .update({
        generation_status: 'failed',
        generation_error: result.error || 'Unknown error',
        generation_attempts: 1,
        raw_ai_response: result.rawResponse || null,
        updated_by_user_id: user.id,
      })
      .eq('id', record.id)

    revalidatePath(`/patients/${caseId}`)
    return { error: result.error || 'Summary generation failed' }
  }

  // Write success
  const data = result.data!
  await supabase
    .from('case_summaries')
    .update({
      chief_complaint: data.chief_complaint,
      imaging_findings: data.imaging_findings,
      prior_treatment: data.prior_treatment,
      symptoms_timeline: data.symptoms_timeline,
      suggested_diagnoses: data.suggested_diagnoses,
      ai_model: 'claude-opus-4-6',
      ai_confidence: data.confidence,
      extraction_notes: data.extraction_notes,
      raw_ai_response: result.rawResponse || null,
      generation_status: 'completed',
      generated_at: new Date().toISOString(),
      sections_done: CASE_SUMMARY_SECTIONS_TOTAL,
      source_data_hash: sourceHash,
      updated_by_user_id: user.id,
    })
    .eq('id', record.id)

  revalidatePath(`/patients/${caseId}`)
  return { data: { id: record.id } }
}

// --- Get summary ---

export async function getCaseSummary(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data, error } = await supabase
    .from('case_summaries')
    .select('*')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .single()

  if (error && error.code !== 'PGRST116') {
    return { error: 'Failed to fetch summary' }
  }

  return { data: data || null }
}

// --- Check staleness ---

export async function checkSummaryStaleness(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: summary } = await supabase
    .from('case_summaries')
    .select('source_data_hash')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .single()

  if (!summary) return { data: { isStale: false } }

  const { data: inputData } = await gatherSourceData(supabase, caseId)
  if (!inputData) return { data: { isStale: false } }

  const currentHash = computeSourceHash(inputData)
  return { data: { isStale: currentHash !== summary.source_data_hash } }
}

// --- Save edits ---

export async function saveCaseSummaryEdits(caseId: string, formValues: CaseSummaryEditValues) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const validated = caseSummaryEditSchema.safeParse(formValues)
  if (!validated.success) return { error: 'Invalid form data' }

  const { error } = await supabase
    .from('case_summaries')
    .update({
      provider_overrides: validated.data,
      review_status: 'edited',
      reviewed_by_user_id: user.id,
      reviewed_at: new Date().toISOString(),
      updated_by_user_id: user.id,
    })
    .eq('case_id', caseId)
    .is('deleted_at', null)

  if (error) return { error: 'Failed to save edits' }

  revalidatePath(`/patients/${caseId}`)
  return { data: { success: true } }
}

// --- Approve summary ---

export async function approveCaseSummary(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const { error } = await supabase
    .from('case_summaries')
    .update({
      review_status: 'approved',
      reviewed_by_user_id: user.id,
      reviewed_at: new Date().toISOString(),
      updated_by_user_id: user.id,
    })
    .eq('case_id', caseId)
    .is('deleted_at', null)

  if (error) return { error: 'Failed to approve summary' }

  revalidatePath(`/patients/${caseId}`)
  return { data: { success: true } }
}
