'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { createHash } from 'node:crypto'
import {
  generateQualityReviewFromData,
  QUALITY_REVIEW_SECTIONS_TOTAL,
  type QualityReviewInputData,
} from '@/lib/claude/generate-quality-review'
import {
  findingDismissFormSchema,
  findingEditFormSchema,
  type FindingDismissFormValues,
  type FindingEditFormValues,
  type FindingOverrideEntry,
  type FindingOverridesMap,
} from '@/lib/validations/case-quality-review'
import { assertCaseNotClosed } from '@/actions/case-status'
import { computeAgeAtDate } from '@/lib/age'

function computeSourceHash(inputData: QualityReviewInputData): string {
  return createHash('sha256').update(JSON.stringify(inputData)).digest('hex')
}

async function gatherSourceData(
  supabase: Awaited<ReturnType<typeof createClient>>,
  caseId: string,
): Promise<{ data: QualityReviewInputData | null; error: string | null }> {
  const [
    caseRes,
    summaryRes,
    ivRes,
    procedureNotesRes,
    dischargeRes,
    mriCountRes,
    ptCountRes,
    pmCountRes,
    chiroCountRes,
    orthoCountRes,
    ctCountRes,
    xrayCountRes,
  ] = await Promise.all([
    supabase
      .from('cases')
      .select(
        'case_number, accident_type, accident_date, patient:patients!inner(first_name, last_name, date_of_birth)',
      )
      .eq('id', caseId)
      .is('deleted_at', null)
      .single(),
    supabase
      .from('case_summaries')
      .select(
        'chief_complaint, imaging_findings, suggested_diagnoses, review_status, raw_ai_response',
      )
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('initial_visit_notes')
      .select(
        'id, visit_type, visit_date, status, diagnoses, chief_complaint, physical_exam, treatment_plan, medical_necessity, prognosis, raw_ai_response',
      )
      .eq('case_id', caseId)
      .is('deleted_at', null),
    supabase
      .from('procedure_notes')
      .select(
        'id, procedure_id, status, subjective, assessment_summary, procedure_injection, assessment_and_plan, prognosis, plan_alignment_status, raw_ai_response, procedures!inner(id, procedure_date, procedure_number, diagnoses)',
      )
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .order('procedure_id', { ascending: true }),
    supabase
      .from('discharge_notes')
      .select(
        'id, visit_date, status, subjective, objective_vitals, diagnoses, assessment, plan_and_recommendations, prognosis, pain_score_max, pain_trajectory_text, raw_ai_response',
      )
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('mri_extractions')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', caseId)
      .in('review_status', ['approved', 'edited'])
      .is('deleted_at', null),
    supabase
      .from('pt_extractions')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', caseId)
      .in('review_status', ['approved', 'edited'])
      .is('deleted_at', null),
    supabase
      .from('pain_management_extractions')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', caseId)
      .in('review_status', ['approved', 'edited'])
      .is('deleted_at', null),
    supabase
      .from('chiro_extractions')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', caseId)
      .in('review_status', ['approved', 'edited'])
      .is('deleted_at', null),
    supabase
      .from('orthopedic_extractions')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', caseId)
      .in('review_status', ['approved', 'edited'])
      .is('deleted_at', null),
    supabase
      .from('ct_scan_extractions')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', caseId)
      .in('review_status', ['approved', 'edited'])
      .is('deleted_at', null),
    supabase
      .from('x_ray_extractions')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', caseId)
      .in('review_status', ['approved', 'edited'])
      .is('deleted_at', null),
  ])

  if (caseRes.error || !caseRes.data) {
    return { data: null, error: 'Failed to fetch case details' }
  }

  const patient = caseRes.data.patient as unknown as {
    first_name: string
    last_name: string
    date_of_birth: string | null
  }

  const ivRows = ivRes.data ?? []
  const initialVisit = ivRows.find((r) => r.visit_type === 'initial_visit') ?? null
  const painEval = ivRows.find((r) => r.visit_type === 'pain_evaluation_visit') ?? null

  // Procedure-vitals lookup so each procedure note carries its pain numbers.
  const procIds = (procedureNotesRes.data ?? []).map((n) => n.procedure_id)
  const { data: vitals } = procIds.length
    ? await supabase
        .from('vital_signs')
        .select('procedure_id, pain_score_min, pain_score_max')
        .in('procedure_id', procIds)
        .is('deleted_at', null)
    : {
        data: [] as Array<{
          procedure_id: string
          pain_score_min: number | null
          pain_score_max: number | null
        }>,
      }
  const vitalsByProc = new Map((vitals ?? []).map((v) => [v.procedure_id, v]))

  const procedureNotes = (procedureNotesRes.data ?? []).map((n) => {
    const proc = n.procedures as unknown as {
      id: string
      procedure_date: string | null
      procedure_number: number | null
      diagnoses: unknown
    }
    const v = vitalsByProc.get(n.procedure_id)
    return {
      id: n.id,
      procedure_id: n.procedure_id,
      procedure_date: proc?.procedure_date ?? null,
      procedure_number: proc?.procedure_number ?? 1,
      status: n.status,
      subjective: n.subjective,
      assessment_summary: n.assessment_summary,
      procedure_injection: n.procedure_injection,
      assessment_and_plan: n.assessment_and_plan,
      prognosis: n.prognosis,
      plan_alignment_status: n.plan_alignment_status,
      pain_score_min: v?.pain_score_min ?? null,
      pain_score_max: v?.pain_score_max ?? null,
      diagnoses: proc?.diagnoses ?? null,
      raw_ai_response: n.raw_ai_response,
    }
  })

  const today = new Date().toISOString().slice(0, 10)
  const age = computeAgeAtDate(patient.date_of_birth, today)

  return {
    data: {
      caseDetails: {
        case_number: caseRes.data.case_number,
        accident_type: caseRes.data.accident_type,
        accident_date: caseRes.data.accident_date,
      },
      patientInfo: {
        first_name: patient.first_name,
        last_name: patient.last_name,
        date_of_birth: patient.date_of_birth,
        age,
      },
      caseSummary: summaryRes.data
        ? {
            chief_complaint: summaryRes.data.chief_complaint,
            imaging_findings: summaryRes.data.imaging_findings,
            suggested_diagnoses: summaryRes.data.suggested_diagnoses,
            review_status: summaryRes.data.review_status,
            raw_ai_response: summaryRes.data.raw_ai_response,
          }
        : null,
      initialVisitNote: initialVisit
        ? {
            id: initialVisit.id,
            visit_type: initialVisit.visit_type,
            visit_date: initialVisit.visit_date,
            status: initialVisit.status,
            diagnoses: initialVisit.diagnoses,
            chief_complaint: initialVisit.chief_complaint,
            physical_exam: initialVisit.physical_exam,
            treatment_plan: initialVisit.treatment_plan,
            medical_necessity: initialVisit.medical_necessity,
            prognosis: initialVisit.prognosis,
            raw_ai_response: initialVisit.raw_ai_response,
          }
        : null,
      painEvaluationNote: painEval
        ? {
            id: painEval.id,
            visit_date: painEval.visit_date,
            status: painEval.status,
            diagnoses: painEval.diagnoses,
            chief_complaint: painEval.chief_complaint,
            physical_exam: painEval.physical_exam,
            treatment_plan: painEval.treatment_plan,
            prognosis: painEval.prognosis,
            raw_ai_response: painEval.raw_ai_response,
          }
        : null,
      procedureNotes,
      dischargeNote: dischargeRes.data
        ? {
            id: dischargeRes.data.id,
            visit_date: dischargeRes.data.visit_date,
            status: dischargeRes.data.status,
            subjective: dischargeRes.data.subjective,
            objective_vitals: dischargeRes.data.objective_vitals,
            diagnoses: dischargeRes.data.diagnoses,
            assessment: dischargeRes.data.assessment,
            plan_and_recommendations: dischargeRes.data.plan_and_recommendations,
            prognosis: dischargeRes.data.prognosis,
            pain_score_max: dischargeRes.data.pain_score_max,
            pain_trajectory_text: dischargeRes.data.pain_trajectory_text,
            raw_ai_response: dischargeRes.data.raw_ai_response,
          }
        : null,
      extractionsSummary: {
        mri_count: mriCountRes.count ?? 0,
        pt_count: ptCountRes.count ?? 0,
        pm_count: pmCountRes.count ?? 0,
        chiro_count: chiroCountRes.count ?? 0,
        ortho_count: orthoCountRes.count ?? 0,
        ct_count: ctCountRes.count ?? 0,
        xray_count: xrayCountRes.count ?? 0,
      },
    },
    error: null,
  }
}

export async function runCaseQualityReview(caseId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const { data: inputData, error: gatherError } = await gatherSourceData(supabase, caseId)
  if (gatherError || !inputData) {
    return { error: gatherError || 'Failed to gather source data' }
  }

  // Soft-delete existing active row.
  await supabase
    .from('case_quality_reviews')
    .update({ deleted_at: new Date().toISOString(), updated_by_user_id: user.id })
    .eq('case_id', caseId)
    .is('deleted_at', null)

  const sourceHash = computeSourceHash(inputData)
  const { data: record, error: insertError } = await supabase
    .from('case_quality_reviews')
    .insert({
      case_id: caseId,
      generation_status: 'processing',
      generation_attempts: 1,
      source_data_hash: sourceHash,
      sections_done: 0,
      sections_total: QUALITY_REVIEW_SECTIONS_TOTAL,
      created_by_user_id: user.id,
      updated_by_user_id: user.id,
    })
    .select('id')
    .single()

  if (insertError || !record) {
    if (insertError?.code === '23505') {
      return { error: 'QC review already in progress — please wait a moment and try again.' }
    }
    return { error: 'Failed to create review record' }
  }

  // Throttled progress writer (mirror case-summaries.ts).
  let lastProgressWriteAt = 0
  let lastWrittenCount = 0
  const writeProgress = async (count: number) => {
    if (count <= lastWrittenCount) return
    const now = Date.now()
    if (now - lastProgressWriteAt < 500) return
    lastProgressWriteAt = now
    lastWrittenCount = count
    await supabase
      .from('case_quality_reviews')
      .update({ sections_done: count })
      .eq('id', record.id)
  }

  const result = await generateQualityReviewFromData(inputData, (completedKeys) =>
    writeProgress(completedKeys.length),
  )

  if (result.error || !result.data) {
    await supabase
      .from('case_quality_reviews')
      .update({
        generation_status: 'failed',
        generation_error: result.error || 'Unknown error',
        raw_ai_response: result.rawResponse || null,
        updated_by_user_id: user.id,
      })
      .eq('id', record.id)
    revalidatePath(`/patients/${caseId}/qc`)
    return { error: result.error || 'Review generation failed' }
  }

  await supabase
    .from('case_quality_reviews')
    .update({
      findings: result.data.findings,
      summary: result.data.summary,
      overall_assessment: result.data.overall_assessment,
      ai_model: 'claude-opus-4-7',
      raw_ai_response: result.rawResponse || null,
      generation_status: 'completed',
      generated_at: new Date().toISOString(),
      sections_done: QUALITY_REVIEW_SECTIONS_TOTAL,
      source_data_hash: sourceHash,
      updated_by_user_id: user.id,
    })
    .eq('id', record.id)

  revalidatePath(`/patients/${caseId}/qc`)
  return { data: { id: record.id } }
}

export async function getCaseQualityReview(caseId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data, error } = await supabase
    .from('case_quality_reviews')
    .select('*')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) return { error: 'Failed to fetch review' }
  return { data: data || null }
}

// Manual re-run alias — same body as runCaseQualityReview, kept distinct so
// editor / UI can label "Recheck" vs "Run" without action duplication.
export async function recheckCaseQualityReview(caseId: string) {
  return runCaseQualityReview(caseId)
}

export async function checkQualityReviewStaleness(caseId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: review } = await supabase
    .from('case_quality_reviews')
    .select('source_data_hash')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!review) return { data: { isStale: false } }

  const { data: inputData } = await gatherSourceData(supabase, caseId)
  if (!inputData) return { data: { isStale: false } }

  const currentHash = computeSourceHash(inputData)
  return { data: { isStale: currentHash !== review.source_data_hash } }
}

// --- Provider override mutators ---
// All four mutators read the active review row, merge a finding-hash entry
// into finding_overrides jsonb, write back, revalidate. No row-level locking
// needed because each mutation is a single atomic UPDATE keyed by review id;
// concurrent provider edits last-write-wins, acceptable for advisory layer.

async function loadActiveReviewForOverride(
  supabase: Awaited<ReturnType<typeof createClient>>,
  caseId: string,
): Promise<
  | { data: { id: string; finding_overrides: FindingOverridesMap }; error: null }
  | { data: null; error: string }
> {
  const { data, error } = await supabase
    .from('case_quality_reviews')
    .select('id, finding_overrides')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error || !data) return { data: null, error: 'No active review' }
  return {
    data: {
      id: data.id,
      finding_overrides: (data.finding_overrides as FindingOverridesMap) ?? {},
    },
    error: null,
  }
}

export async function acknowledgeFinding(caseId: string, findingHash: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const loaded = await loadActiveReviewForOverride(supabase, caseId)
  if (!loaded.data) return { error: loaded.error ?? 'No active review' }

  const entry: FindingOverrideEntry = {
    status: 'acknowledged',
    dismissed_reason: null,
    edited_message: null,
    edited_rationale: null,
    edited_suggested_tone_hint: null,
    actor_user_id: user.id,
    set_at: new Date().toISOString(),
  }
  const updated: FindingOverridesMap = {
    ...loaded.data.finding_overrides,
    [findingHash]: entry,
  }

  const { error } = await supabase
    .from('case_quality_reviews')
    .update({ finding_overrides: updated, updated_by_user_id: user.id })
    .eq('id', loaded.data.id)
  if (error) return { error: 'Failed to acknowledge finding' }

  revalidatePath(`/patients/${caseId}/qc`)
  return { data: { success: true } }
}

export async function dismissFinding(
  caseId: string,
  findingHash: string,
  values: FindingDismissFormValues,
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const validated = findingDismissFormSchema.safeParse(values)
  if (!validated.success) return { error: 'Invalid dismiss form data' }

  const loaded = await loadActiveReviewForOverride(supabase, caseId)
  if (!loaded.data) return { error: loaded.error ?? 'No active review' }

  const entry: FindingOverrideEntry = {
    status: 'dismissed',
    dismissed_reason: validated.data.dismissed_reason,
    edited_message: null,
    edited_rationale: null,
    edited_suggested_tone_hint: null,
    actor_user_id: user.id,
    set_at: new Date().toISOString(),
  }
  const updated: FindingOverridesMap = {
    ...loaded.data.finding_overrides,
    [findingHash]: entry,
  }

  const { error } = await supabase
    .from('case_quality_reviews')
    .update({ finding_overrides: updated, updated_by_user_id: user.id })
    .eq('id', loaded.data.id)
  if (error) return { error: 'Failed to dismiss finding' }

  revalidatePath(`/patients/${caseId}/qc`)
  return { data: { success: true } }
}

export async function editFinding(
  caseId: string,
  findingHash: string,
  values: FindingEditFormValues,
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const validated = findingEditFormSchema.safeParse(values)
  if (!validated.success) return { error: 'Invalid edit form data' }

  const loaded = await loadActiveReviewForOverride(supabase, caseId)
  if (!loaded.data) return { error: loaded.error ?? 'No active review' }

  const entry: FindingOverrideEntry = {
    status: 'edited',
    dismissed_reason: null,
    edited_message: validated.data.edited_message,
    edited_rationale: validated.data.edited_rationale,
    edited_suggested_tone_hint: validated.data.edited_suggested_tone_hint,
    actor_user_id: user.id,
    set_at: new Date().toISOString(),
  }
  const updated: FindingOverridesMap = {
    ...loaded.data.finding_overrides,
    [findingHash]: entry,
  }

  const { error } = await supabase
    .from('case_quality_reviews')
    .update({ finding_overrides: updated, updated_by_user_id: user.id })
    .eq('id', loaded.data.id)
  if (error) return { error: 'Failed to save finding edit' }

  revalidatePath(`/patients/${caseId}/qc`)
  return { data: { success: true } }
}

export async function clearFindingOverride(caseId: string, findingHash: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const loaded = await loadActiveReviewForOverride(supabase, caseId)
  if (!loaded.data) return { error: loaded.error ?? 'No active review' }

  const next = { ...loaded.data.finding_overrides }
  delete next[findingHash]

  const { error } = await supabase
    .from('case_quality_reviews')
    .update({ finding_overrides: next, updated_by_user_id: user.id })
    .eq('id', loaded.data.id)
  if (error) return { error: 'Failed to clear override' }

  revalidatePath(`/patients/${caseId}/qc`)
  return { data: { success: true } }
}
