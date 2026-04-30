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
  computeFindingHash,
  type FindingDismissFormValues,
  type FindingEditFormValues,
  type FindingOverrideEntry,
  type FindingOverridesMap,
  type QualityFinding,
} from '@/lib/validations/case-quality-review'
import { assertCaseNotClosed } from '@/actions/case-status'
import { computeAgeAtDate } from '@/lib/age'
import {
  validateExternalCauseChain,
  validateSeventhCharacterIntegrity,
  SECTION_QC_EXTERNAL_CAUSE_CHAIN,
  SECTION_QC_SEVENTH_CHARACTER_INTEGRITY,
} from '@/lib/qc/diagnosis-validators'

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

  // Capture prior overrides BEFORE soft-deleting the old row. Carry forward
  // the provider's review work into the new row (acks/edits/dismisses
  // preserved when the underlying finding still appears in the new run;
  // auto-resolved when the finding goes away). Already-resolved entries
  // remain resolved across the boundary.
  const { data: prior } = await supabase
    .from('case_quality_reviews')
    .select('finding_overrides')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .maybeSingle()
  const priorOverrides: FindingOverridesMap =
    (prior?.finding_overrides as FindingOverridesMap) ?? {}

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

  // Deterministic post-LLM merge. Two TS validators emit hash-stable findings
  // for ICD-10 external-cause-chain integrity + 7th-character integrity.
  // Their findings always win the dedupe race against any LLM-paraphrased
  // finding sharing the same hash, AND any LLM-emitted finding carrying our
  // synthetic section_keys is dropped (LLM is not authorized to author those).
  const deterministicFindings: QualityFinding[] = [
    ...validateExternalCauseChain(inputData),
    ...validateSeventhCharacterIntegrity(inputData),
  ]
  const deterministicHashes = new Set(
    deterministicFindings.map((f) => computeFindingHash(f)),
  )
  const llmFindings: QualityFinding[] = (result.data.findings ?? []).filter(
    (f) =>
      !deterministicHashes.has(computeFindingHash(f as QualityFinding)) &&
      f.section_key !== SECTION_QC_EXTERNAL_CAUSE_CHAIN &&
      f.section_key !== SECTION_QC_SEVENTH_CHARACTER_INTEGRITY,
  ) as QualityFinding[]
  const mergedFindings: QualityFinding[] = [
    ...deterministicFindings,
    ...llmFindings,
  ]

  console.log(
    `[qc] case=${caseId} llm_findings=${result.data.findings?.length ?? 0} deterministic=${deterministicFindings.length} merged=${mergedFindings.length}`,
  )

  await supabase
    .from('case_quality_reviews')
    .update({
      findings: mergedFindings,
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

  // Carry-over merge. For every entry in priorOverrides:
  //   - status='resolved' → preserve verbatim (resolution sticky across runs)
  //   - finding hash present in new findings → preserve user's ack/edit/dismiss state
  //   - finding hash absent → flip to 'resolved' with resolution_source='auto_recheck'
  //     (finding the override targeted is gone — drift fixed)
  const newFindingHashes = new Set<string>(
    mergedFindings.map((f) => computeFindingHash(f)),
  )
  const mergedOverrides: FindingOverridesMap = {}
  const now = new Date().toISOString()
  for (const [hash, entry] of Object.entries(priorOverrides)) {
    if (entry.status === 'resolved') {
      mergedOverrides[hash] = entry
      continue
    }
    if (newFindingHashes.has(hash)) {
      mergedOverrides[hash] = entry
    } else {
      mergedOverrides[hash] = {
        ...entry,
        status: 'resolved',
        resolved_at: now,
        resolution_source: 'auto_recheck',
      }
    }
  }
  if (Object.keys(mergedOverrides).length > 0) {
    await supabase
      .from('case_quality_reviews')
      .update({ finding_overrides: mergedOverrides })
      .eq('id', record.id)
  }

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
    resolved_at: null,
    resolution_source: null,
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
    resolved_at: null,
    resolution_source: null,
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
    resolved_at: null,
    resolution_source: null,
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

// --- Resolution mutators ---
// verifyFinding runs a deterministic check against persistent audit columns
// kept current by existing regen paths. No recomputation of the underlying
// rule is needed. Dispatch by `step`:
//   - 'procedure' → procedure_notes.plan_alignment_status
//   - 'discharge' → discharge_notes.raw_ai_response.trajectory_warnings
//   - other steps → unsupported (provider uses Mark Resolved instead)

export async function verifyFinding(caseId: string, findingHash: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const { data: row } = await supabase
    .from('case_quality_reviews')
    .select('id, findings, finding_overrides')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!row) return { error: 'No active review' }

  const findings = (row.findings as QualityFinding[] | null) ?? []
  const finding = findings.find((f) => computeFindingHash(f) === findingHash)
  if (!finding) return { error: 'Finding not found in current review' }

  let resolved = false
  let reason: string | null = null

  // Deterministic-validator dispatch — re-run the matching validator against
  // fresh source data and check whether *this specific* finding hash is gone.
  // Must precede the step-based branches because deterministic findings on
  // step='procedure' / step='discharge' should hit the validator replay, not
  // the plan_alignment_status / trajectory_warnings checks.
  if (
    finding.section_key === SECTION_QC_EXTERNAL_CAUSE_CHAIN ||
    finding.section_key === SECTION_QC_SEVENTH_CHARACTER_INTEGRITY
  ) {
    const fresh = await gatherSourceData(supabase, caseId)
    if (fresh.error || !fresh.data) {
      return { error: 'Failed to refresh source data for verify' }
    }
    const replays =
      finding.section_key === SECTION_QC_EXTERNAL_CAUSE_CHAIN
        ? validateExternalCauseChain(fresh.data)
        : validateSeventhCharacterIntegrity(fresh.data)
    const stillPresent = replays.some(
      (f) => computeFindingHash(f) === findingHash,
    )
    if (stillPresent) {
      return {
        data: {
          resolved: false,
          reason:
            finding.section_key === SECTION_QC_EXTERNAL_CAUSE_CHAIN
              ? 'External cause code still present'
              : '7th-character integrity violation still present',
        },
      }
    }
    resolved = true
  } else if (finding.step === 'procedure') {
    if (!finding.note_id) {
      return { error: 'Procedure finding missing note_id; use Mark Resolved instead' }
    }
    const { data: pn } = await supabase
      .from('procedure_notes')
      .select('plan_alignment_status')
      .eq('id', finding.note_id)
      .is('deleted_at', null)
      .maybeSingle()
    if (!pn) {
      reason = 'Procedure note no longer exists'
    } else if (pn.plan_alignment_status === 'unplanned') {
      reason = 'Plan alignment still flagged as unplanned'
    } else {
      resolved = true
    }
  } else if (finding.step === 'discharge') {
    if (!finding.note_id) {
      return { error: 'Discharge finding missing note_id; use Mark Resolved instead' }
    }
    const { data: dn } = await supabase
      .from('discharge_notes')
      .select('raw_ai_response')
      .eq('id', finding.note_id)
      .is('deleted_at', null)
      .maybeSingle()
    if (!dn) {
      reason = 'Discharge note no longer exists'
    } else {
      const raw = dn.raw_ai_response as { trajectory_warnings?: unknown } | null
      const warnings = Array.isArray(raw?.trajectory_warnings)
        ? (raw.trajectory_warnings as unknown[])
        : []
      if (warnings.length > 0) {
        reason = 'Trajectory validator still emitting warnings'
      } else {
        resolved = true
      }
    }
  } else {
    return {
      error: 'Verify not supported for this finding type — use Mark Resolved',
    }
  }

  if (!resolved) {
    return { data: { resolved: false, reason } }
  }

  const overrides = (row.finding_overrides as FindingOverridesMap | null) ?? {}
  const existing = overrides[findingHash] ?? null
  const resolvedEntry: FindingOverrideEntry = {
    status: 'resolved',
    dismissed_reason: existing?.dismissed_reason ?? null,
    edited_message: existing?.edited_message ?? null,
    edited_rationale: existing?.edited_rationale ?? null,
    edited_suggested_tone_hint: existing?.edited_suggested_tone_hint ?? null,
    actor_user_id: user.id,
    set_at: existing?.set_at ?? new Date().toISOString(),
    resolved_at: new Date().toISOString(),
    resolution_source: 'manual_verify',
  }
  const updated: FindingOverridesMap = { ...overrides, [findingHash]: resolvedEntry }

  const { error } = await supabase
    .from('case_quality_reviews')
    .update({ finding_overrides: updated, updated_by_user_id: user.id })
    .eq('id', row.id)
  if (error) return { error: 'Failed to mark finding resolved' }

  revalidatePath(`/patients/${caseId}/qc`)
  return { data: { resolved: true } }
}

export async function markFindingResolved(caseId: string, findingHash: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const loaded = await loadActiveReviewForOverride(supabase, caseId)
  if (!loaded.data) return { error: loaded.error ?? 'No active review' }

  const overrides = loaded.data.finding_overrides
  const existing = overrides[findingHash] ?? null
  const entry: FindingOverrideEntry = {
    status: 'resolved',
    dismissed_reason: existing?.dismissed_reason ?? null,
    edited_message: existing?.edited_message ?? null,
    edited_rationale: existing?.edited_rationale ?? null,
    edited_suggested_tone_hint: existing?.edited_suggested_tone_hint ?? null,
    actor_user_id: user.id,
    set_at: existing?.set_at ?? new Date().toISOString(),
    resolved_at: new Date().toISOString(),
    resolution_source: 'manual_resolve',
  }
  const updated: FindingOverridesMap = { ...overrides, [findingHash]: entry }

  const { error } = await supabase
    .from('case_quality_reviews')
    .update({ finding_overrides: updated, updated_by_user_id: user.id })
    .eq('id', loaded.data.id)
  if (error) return { error: 'Failed to mark finding resolved' }

  revalidatePath(`/patients/${caseId}/qc`)
  return { data: { success: true } }
}
