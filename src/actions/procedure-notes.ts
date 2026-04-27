'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { createHash } from 'node:crypto'
import {
  generateProcedureNoteFromData,
  PROCEDURE_NOTE_SECTIONS_TOTAL,
  regenerateProcedureNoteSection as regenerateSectionAI,
  type ProcedureNoteInputData,
} from '@/lib/claude/generate-procedure-note'
import {
  procedureNoteEditSchema,
  procedureNoteSections,
  type ProcedureNoteEditValues,
  type ProcedureNoteSection,
} from '@/lib/validations/procedure-note'
import { assertCaseNotClosed, autoAdvanceFromIntake } from '@/actions/case-status'
import { computeAgeAtDate } from '@/lib/age'
import { computePainToneLabel, computeSeriesVolatility, deriveChiroProgress, type PainToneContext } from '@/lib/claude/pain-tone'
import { computePlanAlignment } from '@/lib/procedures/compute-plan-alignment'
import { parseSitesJsonb } from '@/lib/procedures/sites-helpers'
import { acquireGenerationLock } from '@/lib/supabase/generation-lock'
import { softDeleteFinalizedDocument } from '@/lib/supabase/finalize-document'

// --- Helper: compute source data hash ---

function computeSourceHash(inputData: ProcedureNoteInputData): string {
  const serialized = JSON.stringify(inputData)
  return createHash('sha256').update(serialized).digest('hex')
}

// --- Helper: gather all source data for note generation ---

async function gatherProcedureNoteSourceData(
  supabase: Awaited<ReturnType<typeof createClient>>,
  procedureId: string,
  caseId: string,
): Promise<{ data: ProcedureNoteInputData | null; error: string | null }> {
  const [
    procedureRes,
    vitalsRes,
    caseRes,
    pmRes,
    mriRes,
    ivNoteRes,
    priorProceduresRes,
    clinicRes,
    chiroRes,
    intakeVitalsRes,
    caseSummaryRes,
  ] = await Promise.all([
    supabase
      .from('procedures')
      .select('*')
      .eq('id', procedureId)
      .is('deleted_at', null)
      .single(),
    supabase
      .from('vital_signs')
      .select('bp_systolic, bp_diastolic, heart_rate, respiratory_rate, temperature_f, spo2_percent, pain_score_min, pain_score_max')
      .eq('procedure_id', procedureId)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle(),
    supabase
      .from('cases')
      .select('case_number, accident_type, accident_date, assigned_provider_id, patient:patients!inner(first_name, last_name, date_of_birth, gender)')
      .eq('id', caseId)
      .is('deleted_at', null)
      .single(),
    supabase
      .from('pain_management_extractions')
      .select('chief_complaints, physical_exam, diagnoses, treatment_plan, diagnostic_studies_summary, provider_overrides, updated_at')
      .eq('case_id', caseId)
      .in('review_status', ['approved', 'edited'])
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('mri_extractions')
      .select('body_region, mri_date, findings, impression_summary')
      .eq('case_id', caseId)
      .in('review_status', ['approved', 'edited'])
      .is('deleted_at', null),
    supabase
      .from('initial_visit_notes')
      .select('past_medical_history, social_history, treatment_plan')
      .eq('case_id', caseId)
      .eq('status', 'finalized')
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle(),
    // Prior procedures: all for this case excluding current, chronological (oldest → newest)
    supabase
      .from('procedures')
      .select('id, procedure_date, procedure_number')
      .eq('case_id', caseId)
      .neq('id', procedureId)
      .is('deleted_at', null)
      .order('procedure_date', { ascending: true }),
    supabase
      .from('clinic_settings')
      .select('clinic_name, address_line1, address_line2, city, state, zip_code, phone, fax')
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('chiro_extractions')
      .select('functional_outcomes')
      .eq('case_id', caseId)
      .eq('review_status', 'approved')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Intake vitals = most recent non-procedure vital_signs row for this case.
    // Used as the baseline anchor for procedure #1 when no prior procedure
    // exists, so the AI can narrate intake → current pain reduction.
    supabase
      .from('vital_signs')
      .select('recorded_at, pain_score_min, pain_score_max')
      .eq('case_id', caseId)
      .is('procedure_id', null)
      .is('deleted_at', null)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('case_summaries')
      .select('chief_complaint, imaging_findings, prior_treatment, symptoms_timeline, suggested_diagnoses')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .in('review_status', ['approved', 'edited'])
      .eq('generation_status', 'completed')
      .maybeSingle(),
  ])

  if (procedureRes.error || !procedureRes.data) {
    return { data: null, error: 'Failed to fetch procedure' }
  }
  if (caseRes.error || !caseRes.data) {
    return { data: null, error: 'Failed to fetch case details' }
  }

  // Batch-fetch prior procedures' pain ranges in a single query
  const priorProcedureRows = priorProceduresRes.data ?? []
  const priorProcedureIds = priorProcedureRows.map((p) => p.id)
  const priorVitalsByProcedureId = new Map<string, {
    pain_score_min: number | null
    pain_score_max: number | null
  }>()
  const priorNotesByProcedureId = new Map<string, {
    subjective: string | null
    assessment_summary: string | null
    procedure_injection: string | null
    assessment_and_plan: string | null
    prognosis: string | null
  }>()
  if (priorProcedureIds.length > 0) {
    const [priorVitals, priorNotes] = await Promise.all([
      supabase
        .from('vital_signs')
        .select('procedure_id, pain_score_min, pain_score_max')
        .in('procedure_id', priorProcedureIds)
        .is('deleted_at', null),
      supabase
        .from('procedure_notes')
        .select('procedure_id, subjective, assessment_summary, procedure_injection, assessment_and_plan, prognosis')
        .in('procedure_id', priorProcedureIds)
        .eq('status', 'finalized')
        .is('deleted_at', null),
    ])
    for (const row of priorVitals.data ?? []) {
      if (row.procedure_id) {
        priorVitalsByProcedureId.set(row.procedure_id, {
          pain_score_min: row.pain_score_min,
          pain_score_max: row.pain_score_max,
        })
      }
    }
    for (const row of priorNotes.data ?? []) {
      if (row.procedure_id) {
        priorNotesByProcedureId.set(row.procedure_id, {
          subjective: row.subjective,
          assessment_summary: row.assessment_summary,
          procedure_injection: row.procedure_injection,
          assessment_and_plan: row.assessment_and_plan,
          prognosis: row.prognosis,
        })
      }
    }
  }

  // Fetch provider profile from case's assigned provider
  const assignedProviderId = caseRes.data.assigned_provider_id as string | null
  let providerRes: { data: { display_name: string; credentials: string | null; npi_number: string | null } | null } = { data: null }
  if (assignedProviderId) {
    providerRes = await supabase
      .from('provider_profiles')
      .select('display_name, credentials, npi_number')
      .eq('id', assignedProviderId)
      .is('deleted_at', null)
      .maybeSingle()
  }

  const proc = procedureRes.data
  const patient = caseRes.data.patient as unknown as {
    first_name: string
    last_name: string
    date_of_birth: string | null
    gender: string | null
  }

  const diagnoses = Array.isArray(proc.diagnoses)
    ? (proc.diagnoses as Array<{ icd10_code: string | null; description: string }>)
    : []

  const age = computeAgeAtDate(patient.date_of_birth, proc.procedure_date)

  // Classify the baseline reference. "prior_missing_vitals" signals the AI
  // that a prior procedure is on the chart but its vitals are absent — distinct
  // from "no prior" (genuine first-in-series).
  //
  // Anchor precedence when no prior procedure exists (procedure #1): fall back
  // to intakeVitalsRes (most recent non-procedure vitals row). Intake pain is
  // the true pre-treatment anchor; using it lets the first procedure's note
  // narrate "intake 8/10 → today 6/10" instead of defaulting to baseline
  // framing.
  // Anchor selection skips priors with null pain_score_max and uses the next
  // valid candidate in the correct direction. Without this, a single missing
  // vitals row on the oldest or newest prior procedure forces the entire
  // baseline or per-session comparison into 'missing_vitals' even when other
  // priors have valid pain. 'missing_vitals' only fires when ALL priors lack
  // pain AND there's no intake-pain fallback.
  //
  // vsBaseline picks the earliest prior with non-null pain_score_max; falls
  // back to intakePain when no prior has pain; falls back to 'no_prior' when
  // nothing is recorded anywhere.
  // vsPrevious picks the most recent prior with non-null pain_score_max.
  const intakePainMax = intakeVitalsRes.data?.pain_score_max ?? null

  const firstValidPriorForBaseline = priorProcedureRows.find(
    (p) => priorVitalsByProcedureId.get(p.id)?.pain_score_max != null,
  ) ?? null
  let baselinePainMax: number | null = null
  let baselineContext: PainToneContext
  if (firstValidPriorForBaseline) {
    baselinePainMax = priorVitalsByProcedureId.get(firstValidPriorForBaseline.id)?.pain_score_max ?? null
    baselineContext = 'prior_with_vitals'
  } else if (priorProcedureRows.length > 0) {
    baselineContext = 'prior_missing_vitals'
    console.warn('[pain-tone] all prior procedures missing pain_score_max (baseline)', {
      caseId,
      procedureId,
      priorProcedureCount: priorProcedureRows.length,
    })
  } else if (intakePainMax != null) {
    baselinePainMax = intakePainMax
    baselineContext = 'prior_with_vitals'
  } else {
    baselineContext = 'no_prior'
  }
  const paintoneVsBaseline = computePainToneLabel(
    vitalsRes.data?.pain_score_max ?? null,
    baselinePainMax,
    baselineContext,
  )

  const mostRecentValidPriorForPrevious = [...priorProcedureRows].reverse().find(
    (p) => priorVitalsByProcedureId.get(p.id)?.pain_score_max != null,
  ) ?? null
  let paintoneVsPrevious: ReturnType<typeof computePainToneLabel> | null
  if (priorProcedureRows.length === 0) {
    paintoneVsPrevious = null
  } else if (mostRecentValidPriorForPrevious) {
    paintoneVsPrevious = computePainToneLabel(
      vitalsRes.data?.pain_score_max ?? null,
      priorVitalsByProcedureId.get(mostRecentValidPriorForPrevious.id)?.pain_score_max ?? null,
      'prior_with_vitals',
    )
  } else {
    console.warn('[pain-tone] all prior procedures missing pain_score_max (previous)', {
      caseId,
      procedureId,
      priorProcedureCount: priorProcedureRows.length,
    })
    paintoneVsPrevious = computePainToneLabel(null, null, 'prior_missing_vitals')
  }

  return {
    data: {
      patientInfo: {
        first_name: patient.first_name,
        last_name: patient.last_name,
        date_of_birth: patient.date_of_birth,
        gender: patient.gender,
      },
      age,
      caseDetails: {
        case_number: caseRes.data.case_number,
        accident_date: caseRes.data.accident_date,
        accident_type: caseRes.data.accident_type,
      },
      procedureRecord: {
        procedure_date: proc.procedure_date,
        procedure_name: proc.procedure_name,
        procedure_number: proc.procedure_number ?? 1,
        injection_site: proc.injection_site,
        sites: parseSitesJsonb(proc.sites),
        diagnoses,
        consent_obtained: proc.consent_obtained,
        blood_draw_volume_ml: proc.blood_draw_volume_ml,
        centrifuge_duration_min: proc.centrifuge_duration_min,
        prep_protocol: proc.prep_protocol,
        kit_lot_number: proc.kit_lot_number,
        anesthetic_agent: proc.anesthetic_agent,
        anesthetic_dose_ml: proc.anesthetic_dose_ml,
        patient_tolerance: proc.patient_tolerance,
        injection_volume_ml: proc.injection_volume_ml,
        needle_gauge: proc.needle_gauge,
        guidance_method: proc.guidance_method,
        target_structure: proc.target_structure,
        complications: proc.complications,
        supplies_used: proc.supplies_used,
        compression_bandage: proc.compression_bandage,
        activity_restriction_hrs: proc.activity_restriction_hrs,
        plan_deviation_reason: proc.plan_deviation_reason,
      },
      vitalSigns: vitalsRes.data ?? null,
      priorProcedures: priorProcedureRows.map((p) => ({
        procedure_date: p.procedure_date,
        procedure_number: p.procedure_number ?? 1,
        pain_score_min: priorVitalsByProcedureId.get(p.id)?.pain_score_min ?? null,
        pain_score_max: priorVitalsByProcedureId.get(p.id)?.pain_score_max ?? null,
      })),
      intakePain: intakeVitalsRes.data
        ? {
            recorded_at: intakeVitalsRes.data.recorded_at,
            pain_score_min: intakeVitalsRes.data.pain_score_min,
            pain_score_max: intakeVitalsRes.data.pain_score_max,
          }
        : null,
      // paintoneLabel is the series-baseline comparison (current vs first
      // procedure). All section-specific branching in the prompt reads this
      // field. priorProcedureRows is ascending (oldest first), so index 0 is
      // the series baseline and index length-1 is the immediately previous
      // procedure. When vsBaseline is 'missing_vitals', expose the full
      // label here too — the MISSING-VITALS BRANCH in the system prompt
      // handles it; existing 4-way branches are not triggered.
      paintoneLabel: paintoneVsBaseline,
      // paintoneSignals exposes both the baseline comparison and a per-session
      // comparison (current vs the immediately previous procedure). The PAIN
      // TONE MATRIX block in the system prompt reads vsPrevious to flag
      // interval regression — e.g. 9 → 6 → 4 → 6 still reads "improved" on
      // vsBaseline but "worsened" on vsPrevious.
      paintoneSignals: {
        vsBaseline: paintoneVsBaseline,
        vsPrevious: paintoneVsPrevious,
      },
      // Volatility over the completed prior procedures (chronological).
      // Current procedure is not in the series yet. When fewer than 2 priors
      // exist or any pain_score_max is null, label is 'insufficient_data'.
      seriesVolatility: computeSeriesVolatility(
        priorProcedureRows.map((p) => priorVitalsByProcedureId.get(p.id)?.pain_score_max ?? null),
      ),
      chiroProgress: deriveChiroProgress(chiroRes.data?.functional_outcomes),
      caseSummary: caseSummaryRes.data
        ? {
            chief_complaint: caseSummaryRes.data.chief_complaint ?? null,
            imaging_findings: caseSummaryRes.data.imaging_findings ?? null,
            prior_treatment: caseSummaryRes.data.prior_treatment ?? null,
            symptoms_timeline: caseSummaryRes.data.symptoms_timeline ?? null,
            suggested_diagnoses: caseSummaryRes.data.suggested_diagnoses ?? null,
          }
        : null,
      pmExtraction: pmRes.data
        ? (() => {
            const overrides = pmRes.data.provider_overrides as {
              chief_complaints?: unknown
              physical_exam?: unknown
              diagnoses?: unknown
              treatment_plan?: unknown
            } | null
            const pmUpdatedAt = pmRes.data.updated_at as string | null
            const procedureDate = proc.procedure_date as string | null
            const updatedAfterProcedure =
              !!(pmUpdatedAt && procedureDate && new Date(pmUpdatedAt).getTime() > new Date(procedureDate).getTime())
            return {
              chief_complaints: overrides?.chief_complaints ?? pmRes.data.chief_complaints,
              physical_exam: overrides?.physical_exam ?? pmRes.data.physical_exam,
              diagnoses: overrides?.diagnoses ?? pmRes.data.diagnoses,
              treatment_plan: overrides?.treatment_plan ?? pmRes.data.treatment_plan,
              diagnostic_studies_summary: pmRes.data.diagnostic_studies_summary,
              updated_after_procedure: updatedAfterProcedure,
            }
          })()
        : null,
      // Supplementary PM-sourced candidate codes: codes present in the
      // PM extraction but NOT already committed on procedureRecord.diagnoses.
      // Dedup keyed on uppercased icd10_code so the LLM sees each candidate
      // code at most once across the two sources. Preserves per-code
      // evidence tags (imaging_support, exam_support, source_quote) for
      // Filter F gating.
      pmSupplementaryDiagnoses: (() => {
        if (!pmRes.data) return []
        const overrides = pmRes.data.provider_overrides as { diagnoses?: unknown } | null
        const pmDxRaw = (overrides?.diagnoses ?? pmRes.data.diagnoses) as unknown
        if (!Array.isArray(pmDxRaw)) return []
        const committedCodes = new Set(
          diagnoses
            .map((d) => d.icd10_code?.toUpperCase())
            .filter((c): c is string => !!c),
        )
        return (pmDxRaw as Array<Record<string, unknown>>)
          .filter((d) => {
            const code = typeof d.icd10_code === 'string' ? d.icd10_code.toUpperCase() : null
            return code != null && !committedCodes.has(code)
          })
          .map((d) => ({
            icd10_code: (d.icd10_code as string) ?? null,
            description: (d.description as string) ?? '',
            imaging_support: (d.imaging_support as string | null | undefined) ?? null,
            exam_support: (d.exam_support as string | null | undefined) ?? null,
            source_quote: (d.source_quote as string | null | undefined) ?? null,
          }))
      })(),
      initialVisitNote: ivNoteRes.data
        ? {
            past_medical_history: ivNoteRes.data.past_medical_history,
            social_history: ivNoteRes.data.social_history,
            treatment_plan: ivNoteRes.data.treatment_plan ?? null,
          }
        : null,
      planAlignment: computePlanAlignment({
        performed: {
          injection_site: proc.injection_site,
          sites: parseSitesJsonb(proc.sites),
          guidance_method: proc.guidance_method as
            | 'ultrasound'
            | 'fluoroscopy'
            | 'landmark'
            | null,
        },
        pmTreatmentPlan: pmRes.data
          ? ((pmRes.data.provider_overrides as { treatment_plan?: unknown } | null)
              ?.treatment_plan ?? pmRes.data.treatment_plan)
          : null,
        initialVisitTreatmentPlan: ivNoteRes.data?.treatment_plan ?? null,
      }),
      priorProcedureNotes: priorProcedureRows
        .filter((p) => priorNotesByProcedureId.has(p.id))
        .map((p) => {
          const sections = priorNotesByProcedureId.get(p.id)!
          return {
            procedure_date: p.procedure_date,
            procedure_number: p.procedure_number ?? 1,
            sections: {
              subjective: sections.subjective,
              assessment_summary: sections.assessment_summary,
              procedure_injection: sections.procedure_injection,
              assessment_and_plan: sections.assessment_and_plan,
              prognosis: sections.prognosis,
            },
          }
        }),
      mriExtractions: (mriRes.data ?? []).map((m) => ({
        body_region: m.body_region,
        mri_date: m.mri_date,
        findings: m.findings,
        impression_summary: m.impression_summary,
      })),
      clinicInfo: {
        clinic_name: clinicRes.data?.clinic_name ?? null,
        address_line1: clinicRes.data?.address_line1 ?? null,
        address_line2: clinicRes.data?.address_line2 ?? null,
        city: clinicRes.data?.city ?? null,
        state: clinicRes.data?.state ?? null,
        zip_code: clinicRes.data?.zip_code ?? null,
        phone: clinicRes.data?.phone ?? null,
        fax: clinicRes.data?.fax ?? null,
      },
      providerInfo: {
        display_name: providerRes.data?.display_name ?? null,
        credentials: providerRes.data?.credentials ?? null,
        npi_number: providerRes.data?.npi_number ?? null,
      },
    },
    error: null,
  }
}

// --- Check prerequisites ---

export async function checkProcedureNotePrerequisites(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: ivNote } = await supabase
    .from('initial_visit_notes')
    .select('id')
    .eq('case_id', caseId)
    .eq('status', 'finalized')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()

  if (!ivNote) {
    return { data: { canGenerate: false, reason: 'A finalized Initial Visit Note is required before generating a procedure note.' } }
  }

  return { data: { canGenerate: true } }
}

// --- Generate procedure note ---

export async function generateProcedureNote(
  procedureId: string,
  caseId: string,
  toneHint?: string | null,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  await autoAdvanceFromIntake(supabase, caseId, user.id)

  // Check prerequisite
  const prereq = await checkProcedureNotePrerequisites(caseId)
  if (prereq.data && !prereq.data.canGenerate) {
    return { error: prereq.data.reason }
  }

  // Gather source data (always fresh — picks up edits to the procedure record since last generation)
  const { data: inputData, error: gatherError } = await gatherProcedureNoteSourceData(supabase, procedureId, caseId)
  if (gatherError || !inputData) return { error: gatherError || 'Failed to gather source data' }

  const sourceHash = computeSourceHash(inputData)

  // Look up existing active note for this procedure (also reads tone_hint for preservation on Retry)
  const { data: existingNote } = await supabase
    .from('procedure_notes')
    .select('id, status, tone_hint')
    .eq('procedure_id', procedureId)
    .is('deleted_at', null)
    .maybeSingle()

  if (existingNote && existingNote.status === 'finalized') {
    return { error: 'Note is finalized — unfinalize before regenerating' }
  }

  // Normalize tone hint; fall back to persisted value (e.g., Retry from failed state)
  const normalizedToneHint = toneHint?.trim() ? toneHint.trim() : null
  const effectiveToneHint =
    normalizedToneHint !== null ? normalizedToneHint : (existingNote?.tone_hint ?? null)

  let recordId: string

  if (existingNote) {
    // Acquire the row-level generation lock BEFORE clearing narrative content.
    // Prevents a second concurrent invocation from re-entering a generation
    // that is already in flight. Stale rows (updated_at > 5 min ago in
    // 'generating' state) are auto-recovered per acquireGenerationLock.
    const lock = await acquireGenerationLock(supabase, 'procedure_notes', existingNote.id, user.id)
    if (!lock.acquired) {
      return { error: lock.reason }
    }

    // Clear stale narrative + reset metadata. Status already transitioned to
    // 'generating' by the lock acquisition — we must not clobber it here.
    const { error: updateError } = await supabase
      .from('procedure_notes')
      .update({
        generation_attempts: 1,
        generation_error: null,
        source_data_hash: sourceHash,
        sections_done: 0,
        sections_total: PROCEDURE_NOTE_SECTIONS_TOTAL,
        subjective: null,
        past_medical_history: null,
        allergies: null,
        current_medications: null,
        social_history: null,
        review_of_systems: null,
        objective_vitals: null,
        objective_physical_exam: null,
        assessment_summary: null,
        procedure_indication: null,
        procedure_preparation: null,
        procedure_prp_prep: null,
        procedure_anesthesia: null,
        procedure_injection: null,
        procedure_post_care: null,
        procedure_followup: null,
        assessment_and_plan: null,
        patient_education: null,
        prognosis: null,
        clinician_disclaimer: null,
        ai_model: null,
        raw_ai_response: null,
        tone_hint: effectiveToneHint,
        plan_alignment_status: null,
        plan_deviation_acknowledged_at: null,
        updated_by_user_id: user.id,
      })
      .eq('id', existingNote.id)

    if (updateError) {
      revalidatePath(`/patients/${caseId}/procedures/${procedureId}/note`)
      return { error: 'Failed to start note generation' }
    }

    recordId = existingNote.id
  } else {
    // No existing row — create one. The unique partial index on procedure_id
    // (idx_procedure_notes_procedure_active) protects against concurrent
    // inserts: a second racer gets a unique-violation error, which we report
    // as "generation already in progress".
    const { data: record, error: insertError } = await supabase
      .from('procedure_notes')
      .insert({
        case_id: caseId,
        procedure_id: procedureId,
        status: 'generating',
        generation_attempts: 1,
        source_data_hash: sourceHash,
        sections_done: 0,
        sections_total: PROCEDURE_NOTE_SECTIONS_TOTAL,
        tone_hint: effectiveToneHint,
        created_by_user_id: user.id,
        updated_by_user_id: user.id,
      })
      .select('id')
      .single()

    if (insertError || !record) {
      revalidatePath(`/patients/${caseId}/procedures/${procedureId}/note`)
      const isUniqueViolation = insertError?.code === '23505'
      return {
        error: isUniqueViolation
          ? 'Generation already in progress — please wait a moment and try again.'
          : 'Failed to create note record',
      }
    }

    recordId = record.id
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
      .from('procedure_notes')
      .update({ sections_done: count })
      .eq('id', recordId)
  }

  // Call Claude
  const result = await generateProcedureNoteFromData(
    inputData,
    effectiveToneHint,
    (completedKeys) => writeProgress(completedKeys.length),
  )

  if (result.error || !result.data) {
    await supabase
      .from('procedure_notes')
      .update({
        status: 'failed',
        generation_error: result.error || 'Unknown error',
        generation_attempts: 1,
        raw_ai_response: result.rawResponse || null,
        updated_by_user_id: user.id,
      })
      .eq('id', recordId)

    revalidatePath(`/patients/${caseId}/procedures/${procedureId}/note`)
    return { error: result.error || 'Note generation failed' }
  }

  // Write success
  const data = result.data!
  await supabase
    .from('procedure_notes')
    .update({
      subjective: data.subjective,
      past_medical_history: data.past_medical_history,
      allergies: data.allergies,
      current_medications: data.current_medications,
      social_history: data.social_history,
      review_of_systems: data.review_of_systems,
      objective_vitals: data.objective_vitals,
      objective_physical_exam: data.objective_physical_exam,
      assessment_summary: data.assessment_summary,
      procedure_indication: data.procedure_indication,
      procedure_preparation: data.procedure_preparation,
      procedure_prp_prep: data.procedure_prp_prep,
      procedure_anesthesia: data.procedure_anesthesia,
      procedure_injection: data.procedure_injection,
      procedure_post_care: data.procedure_post_care,
      procedure_followup: data.procedure_followup,
      assessment_and_plan: data.assessment_and_plan,
      patient_education: data.patient_education,
      prognosis: data.prognosis,
      clinician_disclaimer: data.clinician_disclaimer,
      ai_model: 'claude-opus-4-6',
      raw_ai_response: result.rawResponse || null,
      status: 'draft',
      sections_done: PROCEDURE_NOTE_SECTIONS_TOTAL,
      source_data_hash: sourceHash,
      plan_alignment_status: inputData.planAlignment.status,
      // Reset any prior acknowledgement — this is a fresh draft that
      // the provider must re-acknowledge if it comes up unplanned.
      plan_deviation_acknowledged_at: null,
      updated_by_user_id: user.id,
    })
    .eq('id', recordId)

  revalidatePath(`/patients/${caseId}/procedures/${procedureId}/note`)
  return { data: { id: recordId } }
}

// --- Get procedure note ---

export async function getProcedureNote(procedureId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data, error } = await supabase
    .from('procedure_notes')
    .select('*')
    .eq('procedure_id', procedureId)
    .is('deleted_at', null)
    .single()

  if (error && error.code !== 'PGRST116') {
    return { error: 'Failed to fetch note' }
  }

  return { data: data || null }
}

// --- Save draft edits ---

export async function saveProcedureNote(procedureId: string, caseId: string, values: ProcedureNoteEditValues) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const validated = procedureNoteEditSchema.safeParse(values)
  if (!validated.success) return { error: 'Invalid form data' }

  const { error } = await supabase
    .from('procedure_notes')
    .update({
      ...validated.data,
      updated_by_user_id: user.id,
    })
    .eq('procedure_id', procedureId)
    .is('deleted_at', null)
    .eq('status', 'draft')

  if (error) return { error: 'Failed to save note' }

  revalidatePath(`/patients/${caseId}/procedures/${procedureId}/note`)
  return { data: { success: true } }
}

// --- Finalize note ---

export async function finalizeProcedureNote(procedureId: string, caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  // Fetch the draft note
  const { data: note, error: fetchError } = await supabase
    .from('procedure_notes')
    .select('*')
    .eq('procedure_id', procedureId)
    .is('deleted_at', null)
    .eq('status', 'draft')
    .single()

  if (fetchError || !note) return { error: 'No draft note found to finalize' }

  // Gate: block finalization of "unplanned" procedures unless provider
  // has explicitly acknowledged. This mirrors the consent_obtained
  // discipline — a dated attestation that the provider reviewed the
  // flag that this procedure was not part of the documented plan.
  if (
    note.plan_alignment_status === 'unplanned' &&
    !note.plan_deviation_acknowledged_at
  ) {
    return {
      error:
        'This procedure was not part of the documented treatment plan. Acknowledge the plan deviation on the note before finalizing.',
    }
  }

  // Clean up previous document if re-finalizing
  await softDeleteFinalizedDocument(supabase, note.document_id, user.id)

  // Render PDF
  const { renderProcedureNotePdf } = await import('@/lib/pdf/render-procedure-note-pdf')
  const pdfBuffer = await renderProcedureNotePdf({
    note: note as Record<string, unknown>,
    procedureId,
    caseId,
    userId: user.id,
  })

  // Upload PDF to Supabase Storage
  const storagePath = `cases/${caseId}/procedure-note-${procedureId}-${Date.now()}.pdf`
  const fileBlob = new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' })

  const { error: uploadError } = await supabase.storage
    .from('case-documents')
    .upload(storagePath, fileBlob, {
      contentType: 'application/pdf',
      upsert: false,
    })

  if (uploadError) return { error: `Failed to upload note: ${uploadError.message}` }

  // Create documents row
  const { data: doc, error: docError } = await supabase
    .from('documents')
    .insert({
      case_id: caseId,
      document_type: 'generated',
      file_name: 'PRP Procedure Note',
      file_path: storagePath,
      file_size_bytes: pdfBuffer.length,
      mime_type: 'application/pdf',
      status: 'reviewed',
      uploaded_by_user_id: user.id,
      created_by_user_id: user.id,
      updated_by_user_id: user.id,
    })
    .select('id')
    .single()

  if (docError || !doc) return { error: 'Failed to create document record' }

  // Update note as finalized
  const { error: updateError } = await supabase
    .from('procedure_notes')
    .update({
      status: 'finalized',
      finalized_by_user_id: user.id,
      finalized_at: new Date().toISOString(),
      document_id: doc.id,
      updated_by_user_id: user.id,
    })
    .eq('id', note.id)

  if (updateError) return { error: 'Failed to finalize note' }

  revalidatePath(`/patients/${caseId}/procedures/${procedureId}/note`)
  revalidatePath(`/patients/${caseId}/documents`)
  return { data: { success: true } }
}

// --- Acknowledge plan deviation (required before finalize when
// plan_alignment_status = 'unplanned') ---

export async function acknowledgePlanDeviation(
  procedureId: string,
  caseId: string,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const { error } = await supabase
    .from('procedure_notes')
    .update({
      plan_deviation_acknowledged_at: new Date().toISOString(),
      updated_by_user_id: user.id,
    })
    .eq('procedure_id', procedureId)
    .is('deleted_at', null)
    .eq('status', 'draft')

  if (error) return { error: 'Failed to record acknowledgement' }

  revalidatePath(`/patients/${caseId}/procedures/${procedureId}/note`)
  return { data: { success: true } }
}

// --- Unfinalize note ---

export async function unfinalizeProcedureNote(procedureId: string, caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const { data: note } = await supabase
    .from('procedure_notes')
    .select('id, document_id')
    .eq('procedure_id', procedureId)
    .is('deleted_at', null)
    .eq('status', 'finalized')
    .maybeSingle()

  if (!note) return { error: 'No finalized note to unfinalize' }

  await softDeleteFinalizedDocument(supabase, note.document_id, user.id)

  const { error } = await supabase
    .from('procedure_notes')
    .update({
      status: 'draft',
      finalized_by_user_id: null,
      finalized_at: null,
      document_id: null,
      updated_by_user_id: user.id,
    })
    .eq('id', note.id)

  if (error) return { error: 'Failed to unfinalize note' }

  revalidatePath(`/patients/${caseId}/procedures/${procedureId}/note`)
  revalidatePath(`/patients/${caseId}/documents`)
  return { data: { success: true } }
}

// --- Reset note (clear AI content, keep row) ---

export async function resetProcedureNote(procedureId: string, caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  // Only allow reset on draft or failed notes
  const { data: note } = await supabase
    .from('procedure_notes')
    .select('id, status')
    .eq('procedure_id', procedureId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!note) return { error: 'No note found to reset' }
  if (note.status !== 'draft' && note.status !== 'failed') {
    return { error: 'Only draft or failed notes can be reset' }
  }

  const { error } = await supabase
    .from('procedure_notes')
    .update({
      status: 'draft',
      subjective: null,
      past_medical_history: null,
      allergies: null,
      current_medications: null,
      social_history: null,
      review_of_systems: null,
      objective_vitals: null,
      objective_physical_exam: null,
      assessment_summary: null,
      procedure_indication: null,
      procedure_preparation: null,
      procedure_prp_prep: null,
      procedure_anesthesia: null,
      procedure_injection: null,
      procedure_post_care: null,
      procedure_followup: null,
      assessment_and_plan: null,
      patient_education: null,
      prognosis: null,
      clinician_disclaimer: null,
      ai_model: null,
      raw_ai_response: null,
      generation_error: null,
      generation_attempts: 0,
      source_data_hash: null,
      updated_by_user_id: user.id,
    })
    .eq('id', note.id)

  if (error) return { error: 'Failed to reset note' }

  revalidatePath(`/patients/${caseId}/procedures/${procedureId}/note`)
  return { data: { success: true } }
}

// --- Regenerate single section ---

export async function regenerateProcedureNoteSectionAction(
  procedureId: string,
  caseId: string,
  section: ProcedureNoteSection,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  // Fetch current note
  const { data: note, error: fetchError } = await supabase
    .from('procedure_notes')
    .select('*')
    .eq('procedure_id', procedureId)
    .is('deleted_at', null)
    .eq('status', 'draft')
    .single()

  if (fetchError || !note) return { error: 'No draft note found' }

  // Gather fresh source data
  const { data: inputData, error: gatherError } = await gatherProcedureNoteSourceData(supabase, procedureId, caseId)
  if (gatherError || !inputData) return { error: gatherError || 'Failed to gather source data' }

  const currentContent = (note[section] as string) || ''
  const toneHint = (note.tone_hint as string | null) ?? null
  const otherSections = Object.fromEntries(
    procedureNoteSections
      .filter((s) => s !== section)
      .map((s) => [s, (note[s] as string | null) ?? '']),
  ) as Partial<Record<ProcedureNoteSection, string>>

  const result = await regenerateSectionAI(inputData, section, currentContent, toneHint, otherSections)
  if (result.error || !result.data) {
    return { error: result.error || 'Section regeneration failed' }
  }

  // Update only the target section
  const { error: updateError } = await supabase
    .from('procedure_notes')
    .update({
      [section]: result.data,
      updated_by_user_id: user.id,
    })
    .eq('id', note.id)

  if (updateError) return { error: 'Failed to update section' }

  revalidatePath(`/patients/${caseId}/procedures/${procedureId}/note`)
  return { data: { content: result.data } }
}

// --- Save tone hint (auto-save from draft editor) ---

export async function saveProcedureNoteToneHint(
  procedureId: string,
  caseId: string,
  toneHint: string | null,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const normalized = toneHint?.trim() ? toneHint.trim() : null

  const { error } = await supabase
    .from('procedure_notes')
    .update({ tone_hint: normalized, updated_by_user_id: user.id })
    .eq('procedure_id', procedureId)
    .is('deleted_at', null)
    .in('status', ['draft', 'generating', 'failed'])

  if (error) return { error: 'Failed to save tone hint' }

  return {}
}
