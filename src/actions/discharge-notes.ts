'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { createHash } from 'node:crypto'
import {
  generateDischargeNoteFromData,
  DISCHARGE_NOTE_SECTIONS_TOTAL,
  regenerateDischargeNoteSection as regenerateSectionAI,
  type DischargeNoteInputData,
} from '@/lib/claude/generate-discharge-note'
import {
  dischargeNoteEditSchema,
  dischargeNoteSections,
  dischargeNoteVitalsSchema,
  type DischargeNoteEditValues,
  type DischargeNoteSection,
  type DischargeNoteVitalsValues,
} from '@/lib/validations/discharge-note'
import { assertCaseNotClosed, autoAdvanceFromIntake } from '@/actions/case-status'
import { softDeleteFinalizedDocument } from '@/lib/supabase/finalize-document'
import { computeAgeAtDate } from '@/lib/age'
import { computePainToneLabel, computeSeriesVolatility, type PainToneContext } from '@/lib/claude/pain-tone'
import { buildDischargePainTrajectory } from '@/lib/claude/pain-trajectory'
import { validateDischargeTrajectoryConsistency } from '@/lib/claude/pain-trajectory-validator'
import { parseSitesJsonb } from '@/lib/procedures/sites-helpers'
import { buildPainObservations } from '@/lib/claude/pain-observations'
import {
  rewriteDiagnosesForDischarge,
  type DiagnosisItem,
} from '@/lib/icd10/diagnosis-rewrite'
import { parseIvnDiagnoses } from '@/lib/icd10/parse-ivn-diagnoses'

// --- Helper: assemble discharge diagnosis pool ---
// Aggregates diagnoses from procedures.diagnoses + IVN.diagnoses (free-text)
// + pmExtraction.diagnoses, runs them through rewriteDiagnosesForDischarge
// (V/W/X/Y strip, A→D rewrite, M54.5 → M54.50), and dedupes by code.
// Last-write-wins precedence: procedures > pm > ivn.
function assembleDischargeDiagnosisPool(args: {
  procedureDiagnoses: Array<{ icd10_code: string | null; description: string }>
  pmDiagnoses: Array<{ icd10_code: string | null; description: string }>
  ivnDiagnosesText: string | null
}): DiagnosisItem[] {
  const ivnParsed: DiagnosisItem[] = parseIvnDiagnoses(args.ivnDiagnosesText)
  const proc: DiagnosisItem[] = args.procedureDiagnoses
    .filter((d): d is { icd10_code: string; description: string } =>
      typeof d.icd10_code === 'string' && d.icd10_code.length > 0,
    )
    .map((d) => ({ icd10_code: d.icd10_code, description: d.description }))
  const pm: DiagnosisItem[] = args.pmDiagnoses
    .filter((d): d is { icd10_code: string; description: string } =>
      typeof d.icd10_code === 'string' && d.icd10_code.length > 0,
    )
    .map((d) => ({ icd10_code: d.icd10_code, description: d.description }))

  // Order matters for last-write-wins dedupe: ivn first, pm second, procedures last.
  const merged = [...ivnParsed, ...pm, ...proc]
  const rewritten = rewriteDiagnosesForDischarge(merged)
  const byCode = new Map<string, DiagnosisItem>()
  for (const d of rewritten) {
    byCode.set(d.icd10_code.trim().toUpperCase(), d)
  }
  return [...byCode.values()]
}

// --- Helper: compute source data hash ---

function computeSourceHash(inputData: DischargeNoteInputData): string {
  const serialized = JSON.stringify(inputData)
  return createHash('sha256').update(serialized).digest('hex')
}

// --- Helper: gather all source data for note generation ---

async function gatherDischargeNoteSourceData(
  supabase: Awaited<ReturnType<typeof createClient>>,
  caseId: string,
  visitDate: string,
  dischargeVitals: DischargeNoteInputData['dischargeVitals'] = null,
): Promise<{ data: DischargeNoteInputData | null; error: string | null }> {
  const [
    caseRes,
    proceduresRes,
    caseSummaryRes,
    ivNoteRes,
    ivNoteDateRes,
    ptRes,
    pmRes,
    mriRes,
    chiroRes,
    clinicRes,
    intakeVitalsRes,
  ] = await Promise.all([
    supabase
      .from('cases')
      .select('case_number, accident_type, accident_date, assigned_provider_id, patient:patients!inner(first_name, last_name, date_of_birth, gender)')
      .eq('id', caseId)
      .is('deleted_at', null)
      .single(),
    supabase
      .from('procedures')
      .select('id, procedure_date, procedure_name, procedure_number, injection_site, sites, diagnoses')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .order('procedure_date', { ascending: true }),
    supabase
      .from('case_summaries')
      .select('chief_complaint, imaging_findings, prior_treatment, symptoms_timeline, suggested_diagnoses')
      .eq('case_id', caseId)
      .in('review_status', ['approved', 'edited'])
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('initial_visit_notes')
      .select('chief_complaint, physical_exam, diagnoses, treatment_plan')
      .eq('case_id', caseId)
      .eq('status', 'finalized')
      .is('deleted_at', null)
      .maybeSingle(),
    // Clinical visit_date for the initial evaluation — read from ANY
    // IV note (draft or finalized) so the Pain Timeline's "initial
    // evaluation" anchor reflects the true clinical event even when
    // the note is still being drafted. Separate from the finalized
    // narrative query above because narrative content should not be
    // pulled from unfinalized rows.
    supabase
      .from('initial_visit_notes')
      .select('visit_date')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('pt_extractions')
      .select('outcome_measures, short_term_goals, long_term_goals, clinical_impression, prognosis, diagnoses, pain_ratings, evaluation_date, created_at')
      .eq('case_id', caseId)
      .in('review_status', ['approved', 'edited'])
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('pain_management_extractions')
      .select('chief_complaints, physical_exam, diagnoses, treatment_plan, provider_overrides, created_at')
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
      .from('chiro_extractions')
      .select('diagnoses, treatment_modalities, functional_outcomes, plateau_statement')
      .eq('case_id', caseId)
      .eq('report_type', 'discharge_summary')
      .in('review_status', ['approved', 'edited'])
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('clinic_settings')
      .select('clinic_name, address_line1, address_line2, city, state, zip_code, phone, fax')
      .is('deleted_at', null)
      .maybeSingle(),
    // Intake vital_signs — procedure_id IS NULL rows are non-procedure
    // readings (initial visit / pre-PRP intake). Most recent wins. The
    // intake reading is NOT the same as the first-procedure reading:
    // intake happens before any injection, usually on the intake day; the
    // first procedure is a separate encounter. Splitting them lets the
    // discharge narrative cite a true "pain at initial evaluation" anchor
    // that corresponds to the intake visit rather than silently using the
    // pre-first-injection reading and calling it "initial evaluation".
    supabase
      .from('vital_signs')
      .select('pain_score_min, pain_score_max, recorded_at')
      .eq('case_id', caseId)
      .is('procedure_id', null)
      .is('deleted_at', null)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (caseRes.error || !caseRes.data) {
    return { data: null, error: 'Failed to fetch case details' }
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

  const patient = caseRes.data.patient as unknown as {
    first_name: string
    last_name: string
    date_of_birth: string | null
    gender: string | null
  }

  // Fetch vital_signs rows for all procedures in a single batched query so we
  // can attach per-procedure pain range to the summary array.
  const procRows = proceduresRes.data ?? []
  const procIds = procRows.map((p) => p.id)
  const { data: allVitalsRows } = procIds.length
    ? await supabase
        .from('vital_signs')
        .select('procedure_id, bp_systolic, bp_diastolic, heart_rate, respiratory_rate, temperature_f, spo2_percent, pain_score_min, pain_score_max')
        .in('procedure_id', procIds)
        .is('deleted_at', null)
    : { data: [] as Array<{
        procedure_id: string
        bp_systolic: number | null
        bp_diastolic: number | null
        heart_rate: number | null
        respiratory_rate: number | null
        temperature_f: number | null
        spo2_percent: number | null
        pain_score_min: number | null
        pain_score_max: number | null
      }> }

  const vitalsByProcedureId = new Map(
    (allVitalsRows ?? []).map((v) => [v.procedure_id, v]),
  )

  const procedures = procRows.map((p) => {
    const v = vitalsByProcedureId.get(p.id)
    return {
      procedure_date: p.procedure_date,
      procedure_name: p.procedure_name,
      procedure_number: p.procedure_number ?? 1,
      injection_site: p.injection_site,
      sites: parseSitesJsonb(p.sites),
      pain_score_min: v?.pain_score_min ?? null,
      pain_score_max: v?.pain_score_max ?? null,
      diagnoses: Array.isArray(p.diagnoses)
        ? (p.diagnoses as Array<{ icd10_code: string | null; description: string }>)
        : [],
    }
  })

  // Latest vitals come from the most recent procedure's vital_signs row
  const lastProcedure = procRows.at(-1)
  const lastVitals = lastProcedure ? vitalsByProcedureId.get(lastProcedure.id) : null
  const latestVitals: DischargeNoteInputData['latestVitals'] = lastVitals
    ? {
        bp_systolic: lastVitals.bp_systolic,
        bp_diastolic: lastVitals.bp_diastolic,
        heart_rate: lastVitals.heart_rate,
        respiratory_rate: lastVitals.respiratory_rate,
        temperature_f: lastVitals.temperature_f,
        spo2_percent: lastVitals.spo2_percent,
        pain_score_min: lastVitals.pain_score_min,
        pain_score_max: lastVitals.pain_score_max,
      }
    : null

  // Baseline pain = first procedure's vitals (pre-treatment anchor at the
  // first injection encounter — NOT the intake visit).
  const firstProcedure = procRows[0]
  const firstVitals = firstProcedure ? vitalsByProcedureId.get(firstProcedure.id) : null
  const baselinePain: DischargeNoteInputData['baselinePain'] = firstProcedure
    ? {
        procedure_date: firstProcedure.procedure_date,
        pain_score_min: firstVitals?.pain_score_min ?? null,
        pain_score_max: firstVitals?.pain_score_max ?? null,
      }
    : null

  // Intake pain = most recent non-procedure vital_signs row (procedure_id
  // IS NULL). This is the pre-PRP reading captured at the initial
  // evaluation visit. Kept distinct from baselinePain so the discharge
  // narrative can cite "pain at initial evaluation" against the true
  // intake anchor rather than silently against the first-procedure
  // reading. May be null when no intake vitals were recorded.
  //
  // Date source preference: initial_visit_notes.visit_date (clinical
  // event date) > vital_signs.recorded_at (DB timestamp). The DB
  // timestamp is the row creation time, which can drift if the vitals
  // were back-entered after the encounter; the clinical visit_date
  // reflects the actual day of the initial evaluation and is what the
  // narrative and day-axis labels should anchor on.
  const intakePain: DischargeNoteInputData['intakePain'] =
    intakeVitalsRes.data
      ? {
          recorded_at:
            (ivNoteDateRes.data?.visit_date as string | null | undefined) ??
            intakeVitalsRes.data.recorded_at ??
            null,
          pain_score_min: intakeVitalsRes.data.pain_score_min ?? null,
          pain_score_max: intakeVitalsRes.data.pain_score_max ?? null,
        }
      : null

  // Initial visit baseline — chief_complaint + physical_exam for pre-PRP pain narrative
  const initialVisitBaseline: DischargeNoteInputData['initialVisitBaseline'] = ivNoteRes.data
    ? {
        chief_complaint: ivNoteRes.data.chief_complaint,
        physical_exam: ivNoteRes.data.physical_exam,
      }
    : null

  // Two-signal pain trajectory:
  // - vsBaseline: last procedure pain vs first procedure pain (series-long arc).
  // - vsPrevious: last procedure pain vs second-to-last procedure pain (final-interval change).
  //   Null when only one procedure exists.
  // Context classification distinguishes "no prior" from "prior present but
  // vitals missing" so the prompt can flag data gaps instead of silently
  // falling back to baseline framing.
  const baselineContext: PainToneContext =
    firstProcedure == null
      ? 'no_prior'
      : firstVitals?.pain_score_max == null
        ? 'prior_missing_vitals'
        : 'prior_with_vitals'
  if (baselineContext === 'prior_missing_vitals') {
    console.warn('[pain-tone] discharge baseline anchor missing vitals', {
      caseId,
      baselineProcedureId: firstProcedure!.id,
    })
  }

  // vsPrevious anchor: walk backward from the second-to-last procedure looking
  // for the most recent prior with non-null pain_score_max. Without this walk,
  // a single missing vitals row on procedure (N-1) collapses vsPrevious into
  // 'missing_vitals' even when procedure (N-2), (N-3), etc. have valid pain.
  // The semantic meaning softens from "penultimate-to-final interval" toward
  // "most-recent-valid-prior to final interval" — acceptable because no
  // valid pain ⇒ no meaningful interval either way.
  let previousProcedureForSignal = null as (typeof procRows)[number] | null
  let previousPainMax: number | null = null
  let previousContext: PainToneContext = 'no_prior'
  if (procRows.length >= 2) {
    for (let i = procRows.length - 2; i >= 0; i--) {
      const candidate = procRows[i]
      const v = vitalsByProcedureId.get(candidate.id)
      if (v?.pain_score_max != null) {
        previousProcedureForSignal = candidate
        previousPainMax = v.pain_score_max
        previousContext = 'prior_with_vitals'
        break
      }
    }
    if (previousContext === 'no_prior') {
      // At least one prior exists but none has pain_score_max.
      previousContext = 'prior_missing_vitals'
      console.warn('[pain-tone] discharge previous anchor walk found no valid pain', {
        caseId,
        priorCount: procRows.length - 1,
      })
    }
  }

  const painTrendSignals: DischargeNoteInputData['painTrendSignals'] = {
    vsBaseline: computePainToneLabel(
      latestVitals?.pain_score_max ?? null,
      baselinePain?.pain_score_max ?? null,
      baselineContext,
    ),
    vsPrevious: procRows.length >= 2
      ? computePainToneLabel(
          latestVitals?.pain_score_max ?? null,
          previousPainMax,
          previousContext,
        )
      : null,
  }
  // Mark previousProcedureForSignal as intentionally retained for future
  // logging/diagnostics; currently unused beyond the walk.
  void previousProcedureForSignal

  // Full-series volatility: detects mid-series regressions that endpoints-only
  // signals miss. procedures[] is in chronological order (ascending) from the
  // initial query, so this maps directly to a chronological pain_score_max array.
  const seriesVolatility = computeSeriesVolatility(
    procedures.map((p) => p.pain_score_max),
  )

  // Deterministic pain trajectory — Phase 1 precision fix. The LLM used to
  // assemble the arrow chain and apply the -2 rule in prose; we now compute
  // both in TS and instruct the prompt to render the resulting strings
  // verbatim. The endpoint values are persisted alongside the note so edits
  // do not silently drift away from the computed anchor.
  // Fold the six-way vsBaseline label down to the four-way overallPainTrend
  // union consumed by the legacy PAIN TRAJECTORY rules. 'missing_vitals'
  // collapses to 'baseline' (data-gap branch); 'minimally_improved' collapses
  // to 'improved' so the -2 default and standard favorable framing still fire
  // on MCID-level drops. The full six-way painTrendSignals.vsBaseline is
  // still threaded to the prompt separately for tone modulation.
  const foldedOverallPainTrend: 'baseline' | 'improved' | 'stable' | 'worsened' =
    painTrendSignals.vsBaseline === 'missing_vitals'
      ? 'baseline'
      : painTrendSignals.vsBaseline === 'minimally_improved'
        ? 'improved'
        : painTrendSignals.vsBaseline
  const painTrajectory = buildDischargePainTrajectory({
    procedures: procedures.map((p) => ({
      procedure_date: p.procedure_date,
      procedure_number: p.procedure_number,
      pain_score_min: p.pain_score_min,
      pain_score_max: p.pain_score_max,
    })),
    latestVitals,
    dischargeVitals,
    baselinePain,
    intakePain,
    overallPainTrend: foldedOverallPainTrend,
    finalIntervalWorsened: painTrendSignals.vsPrevious === 'worsened',
    visitDate,
  })

  // Supplementary pain observations from PT/PM/chiro reports (R6). These
  // do NOT feed into the deterministic arrow chain — they are a sidecar
  // the LLM may cite in the subjective narrative for additional color.
  const painObservations = buildPainObservations({
    ptExtraction: ptRes.data as {
      pain_ratings?: unknown
      evaluation_date?: string | null
      created_at?: string | null
    } | null,
    pmExtraction: pmRes.data as {
      chief_complaints?: unknown
      created_at?: string | null
    } | null,
    chiroExtraction: chiroRes.data as {
      functional_outcomes?: unknown
    } | null,
  })

  const age = computeAgeAtDate(patient.date_of_birth, visitDate)

  // Aggregate the discharge diagnosis pool from procedures + pm + ivn,
  // run through deterministic rewriteDiagnosesForDischarge, dedupe by code.
  // pmExtraction.diagnoses prefers the provider_overrides shape when present
  // (matches the action-level pmExtraction merge below).
  const pmOverridesEarly = pmRes.data?.provider_overrides as {
    diagnoses?: unknown
  } | null
  const pmDiagnosesSource = pmOverridesEarly?.diagnoses ?? pmRes.data?.diagnoses
  const pmDiagnosesArray: Array<{ icd10_code: string | null; description: string }> =
    Array.isArray(pmDiagnosesSource)
      ? (pmDiagnosesSource as Array<{ icd10_code: string | null; description: string }>)
      : []
  const procedureDiagnosesAggregate: Array<{
    icd10_code: string | null
    description: string
  }> = procedures.flatMap((p) => p.diagnoses)
  const diagnosisPool = assembleDischargeDiagnosisPool({
    procedureDiagnoses: procedureDiagnosesAggregate,
    pmDiagnoses: pmDiagnosesArray,
    ivnDiagnosesText: ivNoteRes.data?.diagnoses ?? null,
  })

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
      visitDate,
      procedures,
      diagnosisPool: diagnosisPool.length > 0 ? diagnosisPool : null,
      latestVitals,
      dischargeVitals,
      baselinePain,
      intakePain,
      initialVisitBaseline,
      // overallPainTrend is kept as narrow 4-way label for PAIN TRAJECTORY
      // rules. When vsBaseline is 'missing_vitals', fold to 'baseline' so
      // existing suppression rules fire correctly. BASELINE DATA-GAP OVERRIDE
      // in the prompt reads painTrendSignals.vsBaseline directly for the
      // missing-vitals branch.
      overallPainTrend: foldedOverallPainTrend,
      painTrendSignals,
      seriesVolatility,
      painTrajectoryText: painTrajectory.arrowChain || null,
      dischargeVisitPainDisplay: painTrajectory.dischargeDisplay,
      dischargeVisitPainEstimated: painTrajectory.dischargeEstimated,
      baselinePainDisplay: painTrajectory.baselineDisplay,
      baselinePainSource: painTrajectory.baselineSource,
      intakePainDisplay: painTrajectory.intakePainDisplay,
      firstProcedurePainDisplay: painTrajectory.firstProcedurePainDisplay,
      dischargePainEstimateMin: painTrajectory.dischargeEntry?.min ?? null,
      dischargePainEstimateMax: painTrajectory.dischargeEntry?.max ?? null,
      painObservations,
      caseSummary: caseSummaryRes.data
        ? {
            chief_complaint: caseSummaryRes.data.chief_complaint,
            imaging_findings: caseSummaryRes.data.imaging_findings as string | null,
            prior_treatment: caseSummaryRes.data.prior_treatment as string | null,
            symptoms_timeline: caseSummaryRes.data.symptoms_timeline as string | null,
            suggested_diagnoses: caseSummaryRes.data.suggested_diagnoses,
          }
        : null,
      initialVisitNote: ivNoteRes.data
        ? {
            chief_complaint: ivNoteRes.data.chief_complaint,
            physical_exam: ivNoteRes.data.physical_exam,
            assessment_and_plan: [ivNoteRes.data.diagnoses, ivNoteRes.data.treatment_plan].filter(Boolean).join('\n\n'),
          }
        : null,
      ptExtraction: ptRes.data
        ? {
            outcome_measures: ptRes.data.outcome_measures,
            short_term_goals: JSON.stringify(ptRes.data.short_term_goals),
            long_term_goals: JSON.stringify(ptRes.data.long_term_goals),
            clinical_impression: ptRes.data.clinical_impression,
            prognosis: ptRes.data.prognosis,
            diagnoses: ptRes.data.diagnoses,
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
            return {
              chief_complaints: overrides?.chief_complaints ?? pmRes.data.chief_complaints,
              physical_exam: overrides?.physical_exam ?? pmRes.data.physical_exam,
              diagnoses: overrides?.diagnoses ?? pmRes.data.diagnoses,
              treatment_plan: overrides?.treatment_plan ?? pmRes.data.treatment_plan,
            }
          })()
        : null,
      mriExtractions: (mriRes.data ?? []).map((m) => ({
        body_region: m.body_region,
        mri_date: m.mri_date,
        findings: m.findings,
        impression_summary: m.impression_summary,
      })),
      chiroExtraction: chiroRes.data
        ? {
            diagnoses: chiroRes.data.diagnoses,
            treatment_modalities: chiroRes.data.treatment_modalities,
            functional_outcomes: chiroRes.data.functional_outcomes,
            plateau_statement: chiroRes.data.plateau_statement as string | null,
          }
        : null,
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

export async function checkDischargeNotePrerequisites(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: ivNotes } = await supabase
    .from('initial_visit_notes')
    .select('id')
    .eq('case_id', caseId)
    .eq('status', 'finalized')
    .is('deleted_at', null)
    .limit(1)

  const ivNote = ivNotes && ivNotes.length > 0 ? ivNotes[0] : null

  if (!ivNote) {
    return { data: { canGenerate: false, reason: 'A finalized Initial Visit Note is required before generating a discharge summary.' } }
  }

  return { data: { canGenerate: true } }
}

// --- Generate discharge note ---

export async function generateDischargeNote(
  caseId: string,
  toneHint?: string | null,
  visitDate?: string | null,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  await autoAdvanceFromIntake(supabase, caseId, user.id)

  // Check prerequisite
  const prereq = await checkDischargeNotePrerequisites(caseId)
  if (prereq.data && !prereq.data.canGenerate) {
    return { error: prereq.data.reason }
  }

  // Look up existing active discharge note to preserve visit_date, provider-entered
  // vitals, and the tone hint across regeneration. Also read status + updated_at
  // to guard against concurrent generations.
  const { data: existingNote } = await supabase
    .from('discharge_notes')
    .select('id, status, updated_at, visit_date, bp_systolic, bp_diastolic, heart_rate, respiratory_rate, temperature_f, spo2_percent, pain_score_min, pain_score_max, tone_hint')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .maybeSingle()

  // Concurrent-generation guard. Discharge uses a soft-delete + re-insert
  // pattern (not update-in-place), so the row-level lock helper does not
  // apply directly. Instead, reject when the existing row is already in
  // 'generating' state and was updated within the stale-recovery window.
  if (existingNote && existingNote.status === 'generating') {
    const updatedAt = existingNote.updated_at ? new Date(existingNote.updated_at) : null
    const staleBoundary = new Date(Date.now() - 5 * 60_000)
    if (updatedAt && updatedAt > staleBoundary) {
      console.warn('[generation-lock] discharge generation rejected — in flight', {
        caseId,
        recordId: existingNote.id,
      })
      return { error: 'Generation already in progress — please wait a moment and try again.' }
    }
    console.warn('[generation-lock] discharge stale generation recovered', {
      caseId,
      recordId: existingNote.id,
    })
  }

  const today = new Date().toISOString().slice(0, 10)
  const normalizedVisitDate = visitDate?.trim() ? visitDate.trim() : null
  const effectiveVisitDate = normalizedVisitDate ?? existingNote?.visit_date ?? today
  const normalizedToneHint = toneHint?.trim() ? toneHint.trim() : null
  const effectiveToneHint =
    normalizedToneHint !== null ? normalizedToneHint : (existingNote?.tone_hint ?? null)
  const preservedVitals: DischargeNoteInputData['dischargeVitals'] = existingNote
    ? {
        bp_systolic: existingNote.bp_systolic,
        bp_diastolic: existingNote.bp_diastolic,
        heart_rate: existingNote.heart_rate,
        respiratory_rate: existingNote.respiratory_rate,
        temperature_f: existingNote.temperature_f,
        spo2_percent: existingNote.spo2_percent,
        pain_score_min: existingNote.pain_score_min,
        pain_score_max: existingNote.pain_score_max,
      }
    : null

  // Gather source data
  const { data: inputData, error: gatherError } = await gatherDischargeNoteSourceData(
    supabase,
    caseId,
    effectiveVisitDate,
    preservedVitals,
  )
  if (gatherError || !inputData) return { error: gatherError || 'Failed to gather source data' }

  // Generation-time pain-anchor gate (Phase 1). When neither the deterministic
  // trajectory chain nor the discharge endpoint could be produced, the note
  // cannot be grounded numerically. Rather than silently emitting a qualitative
  // narrative that a reviewer may later mistake for numeric data, require the
  // provider to supply a discharge-visit pain reading or record pain on at
  // least one procedure before generation.
  if (inputData.painTrajectoryText == null && inputData.dischargeVisitPainDisplay == null) {
    return {
      error:
        'Cannot generate discharge summary: no pain score data is available. Enter the discharge-visit pain under Discharge Vitals, or record pain on at least one procedure, then retry.',
    }
  }

  // Soft-delete existing discharge note for this case
  await supabase
    .from('discharge_notes')
    .update({ deleted_at: new Date().toISOString(), updated_by_user_id: user.id })
    .eq('case_id', caseId)
    .is('deleted_at', null)

  // Insert generating record — carry forward preserved vitals so the provider's
  // entries survive regeneration.
  const sourceHash = computeSourceHash(inputData)
  const { data: record, error: insertError } = await supabase
    .from('discharge_notes')
    .insert({
      case_id: caseId,
      status: 'generating',
      generation_attempts: 1,
      source_data_hash: sourceHash,
      sections_done: 0,
      sections_total: DISCHARGE_NOTE_SECTIONS_TOTAL,
      visit_date: effectiveVisitDate,
      bp_systolic: preservedVitals?.bp_systolic ?? null,
      bp_diastolic: preservedVitals?.bp_diastolic ?? null,
      heart_rate: preservedVitals?.heart_rate ?? null,
      respiratory_rate: preservedVitals?.respiratory_rate ?? null,
      temperature_f: preservedVitals?.temperature_f ?? null,
      spo2_percent: preservedVitals?.spo2_percent ?? null,
      pain_score_min: preservedVitals?.pain_score_min ?? null,
      pain_score_max: preservedVitals?.pain_score_max ?? null,
      discharge_pain_estimate_min: inputData.dischargePainEstimateMin,
      discharge_pain_estimate_max: inputData.dischargePainEstimateMax,
      discharge_pain_estimated: inputData.dischargeVisitPainEstimated,
      pain_trajectory_text: inputData.painTrajectoryText,
      tone_hint: effectiveToneHint,
      created_by_user_id: user.id,
      updated_by_user_id: user.id,
    })
    .select('id')
    .single()

  if (insertError || !record) {
    revalidatePath(`/patients/${caseId}/discharge`)
    if (insertError?.code === '23505') {
      return { error: 'Generation already in progress — please wait a moment and try again.' }
    }
    return { error: 'Failed to create note record' }
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
      .from('discharge_notes')
      .update({ sections_done: count })
      .eq('id', record.id)
  }

  // Call Claude
  const result = await generateDischargeNoteFromData(
    inputData,
    effectiveToneHint,
    (completedKeys) => writeProgress(completedKeys.length),
  )

  if (result.error || !result.data) {
    await supabase
      .from('discharge_notes')
      .update({
        status: 'failed',
        generation_error: result.error || 'Unknown error',
        generation_attempts: 1,
        raw_ai_response: result.rawResponse || null,
        updated_by_user_id: user.id,
      })
      .eq('id', record.id)

    revalidatePath(`/patients/${caseId}/discharge`)
    return { error: result.error || 'Note generation failed' }
  }

  // Write success — includes a post-generation numeric consistency check so
  // LLM drift (fabricated pain numbers, missing endpoint in prose, Pain
  // bullet mismatch) is captured in raw_ai_response for audit. Warnings are
  // non-fatal today; they surface in logs and in the stored raw response.
  const data = result.data!

  // Rebuild the trajectory shape needed by the validator from the
  // deterministic fields already present on inputData. This keeps the
  // validator call site pure and avoids re-running the builder.
  const trajectoryForValidator = {
    entries: [
      ...(inputData.intakePain && (inputData.intakePain.pain_score_min != null || inputData.intakePain.pain_score_max != null)
        ? [
            {
              date: inputData.intakePain.recorded_at,
              label: 'initial evaluation',
              min: inputData.intakePain.pain_score_min,
              max: inputData.intakePain.pain_score_max,
              source: 'intake' as const,
              estimated: false,
              dayOffset: null,
            },
          ]
        : []),
      ...inputData.procedures.map((p) => ({
        date: p.procedure_date,
        label: `procedure ${p.procedure_number}`,
        min: p.pain_score_min,
        max: p.pain_score_max,
        source: 'procedure' as const,
        estimated: false,
        dayOffset: null,
      })),
      ...(inputData.dischargeVisitPainDisplay != null
        ? [
            {
              date: null,
              label: "today's discharge evaluation",
              min: inputData.dischargePainEstimateMin,
              max: inputData.dischargePainEstimateMax,
              source: (inputData.dischargeVisitPainEstimated ? 'discharge_estimate' : 'discharge_vitals') as 'discharge_estimate' | 'discharge_vitals',
              estimated: inputData.dischargeVisitPainEstimated,
              dayOffset: null,
            },
          ]
        : []),
    ],
    arrowChain: inputData.painTrajectoryText ?? '',
    baselineDisplay: inputData.baselinePainDisplay,
    baselineSource: inputData.baselinePainSource,
    intakePainDisplay: inputData.intakePainDisplay,
    firstProcedurePainDisplay: inputData.firstProcedurePainDisplay,
    dischargeDisplay: inputData.dischargeVisitPainDisplay,
    dischargeEntry: inputData.dischargeVisitPainDisplay
      ? {
          date: null,
          label: "today's discharge evaluation",
          min: inputData.dischargePainEstimateMin,
          max: inputData.dischargePainEstimateMax,
          source: (inputData.dischargeVisitPainEstimated ? 'discharge_estimate' : 'discharge_vitals') as 'discharge_estimate' | 'discharge_vitals',
          estimated: inputData.dischargeVisitPainEstimated,
          dayOffset: null,
        }
      : null,
    dischargeEstimated: inputData.dischargeVisitPainEstimated,
  }
  const validation = validateDischargeTrajectoryConsistency(data, trajectoryForValidator)
  if (validation.warnings.length > 0) {
    console.warn('[discharge-note] trajectory validator warnings', {
      caseId,
      recordId: record.id,
      warnings: validation.warnings,
    })
  }

  // Wrap raw_ai_response to carry the validator output alongside the raw LLM
  // payload. Readers downstream can still extract the original tool result
  // from `.raw`.
  const wrappedRawResponse = {
    raw: result.rawResponse ?? null,
    trajectory_warnings: validation.warnings,
    discharge_readings_found: validation.dischargeReadingsFound,
    pain_trajectory_text: inputData.painTrajectoryText,
    discharge_visit_pain_display: inputData.dischargeVisitPainDisplay,
    discharge_visit_pain_estimated: inputData.dischargeVisitPainEstimated,
  }

  await supabase
    .from('discharge_notes')
    .update({
      subjective: data.subjective,
      objective_vitals: data.objective_vitals,
      objective_general: data.objective_general,
      objective_cervical: data.objective_cervical,
      objective_lumbar: data.objective_lumbar,
      objective_neurological: data.objective_neurological,
      diagnoses: data.diagnoses,
      assessment: data.assessment,
      plan_and_recommendations: data.plan_and_recommendations,
      patient_education: data.patient_education,
      prognosis: data.prognosis,
      clinician_disclaimer: data.clinician_disclaimer,
      ai_model: 'claude-opus-4-6',
      raw_ai_response: wrappedRawResponse,
      status: 'draft',
      sections_done: DISCHARGE_NOTE_SECTIONS_TOTAL,
      source_data_hash: sourceHash,
      discharge_pain_estimate_min: inputData.dischargePainEstimateMin,
      discharge_pain_estimate_max: inputData.dischargePainEstimateMax,
      discharge_pain_estimated: inputData.dischargeVisitPainEstimated,
      pain_trajectory_text: inputData.painTrajectoryText,
      updated_by_user_id: user.id,
    })
    .eq('id', record.id)

  revalidatePath(`/patients/${caseId}/discharge`)
  return { data: { id: record.id } }
}

// --- Get discharge note ---

export async function getDischargeNote(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data, error } = await supabase
    .from('discharge_notes')
    .select('*')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .single()

  if (error && error.code !== 'PGRST116') {
    return { error: 'Failed to fetch note' }
  }

  return { data: data || null }
}

// --- Save draft edits ---

export async function saveDischargeNote(caseId: string, values: DischargeNoteEditValues) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const validated = dischargeNoteEditSchema.safeParse(values)
  if (!validated.success) return { error: 'Invalid form data' }

  const { error } = await supabase
    .from('discharge_notes')
    .update({
      ...validated.data,
      updated_by_user_id: user.id,
    })
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .eq('status', 'draft')

  if (error) return { error: 'Failed to save note' }

  revalidatePath(`/patients/${caseId}/discharge`)
  return { data: { success: true } }
}

// --- Finalize note ---

export async function finalizeDischargeNote(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  // Fetch the draft note
  const { data: note, error: fetchError } = await supabase
    .from('discharge_notes')
    .select('*')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .eq('status', 'draft')
    .single()

  if (fetchError || !note) return { error: 'No draft note found to finalize' }

  // Defensibility guard: finalizing a discharge note requires provider-entered
  // discharge-visit vitals, at minimum pain_score_max. Without them, the note's
  // numeric pain endpoint is synthesized via the -2 default rule — defensible
  // clinically for drafting but unacceptable on a finalized medico-legal PDF.
  // Provider must either enter discharge vitals or explicitly acknowledge the
  // absence via a separate flow (not supported yet — force vitals for now).
  if (note.pain_score_max == null) {
    return {
      error: 'Discharge-visit pain score is required before finalization. Enter the patient\'s current pain rating in the Discharge Vitals section, then re-finalize.',
    }
  }

  // Clean up previous document if re-finalizing
  await softDeleteFinalizedDocument(supabase, note.document_id, user.id)

  // Render PDF
  const { renderDischargeNotePdf } = await import('@/lib/pdf/render-discharge-note-pdf')
  const pdfBuffer = await renderDischargeNotePdf({
    note: note as Record<string, unknown>,
    caseId,
    userId: user.id,
  })

  // Upload PDF to Supabase Storage
  const storagePath = `cases/${caseId}/discharge-note-${Date.now()}.pdf`
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
      file_name: 'Discharge Summary',
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
    .from('discharge_notes')
    .update({
      status: 'finalized',
      finalized_by_user_id: user.id,
      finalized_at: new Date().toISOString(),
      document_id: doc.id,
      updated_by_user_id: user.id,
    })
    .eq('id', note.id)

  if (updateError) return { error: 'Failed to finalize note' }

  revalidatePath(`/patients/${caseId}/discharge`)
  revalidatePath(`/patients/${caseId}/documents`)
  return { data: { success: true } }
}

// --- Unfinalize note ---

export async function unfinalizeDischargeNote(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const { data: note } = await supabase
    .from('discharge_notes')
    .select('id, document_id')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .eq('status', 'finalized')
    .maybeSingle()

  if (!note) return { error: 'No finalized note to unfinalize' }

  await softDeleteFinalizedDocument(supabase, note.document_id, user.id)

  const { error } = await supabase
    .from('discharge_notes')
    .update({
      status: 'draft',
      finalized_by_user_id: null,
      finalized_at: null,
      document_id: null,
      updated_by_user_id: user.id,
    })
    .eq('id', note.id)

  if (error) return { error: 'Failed to unfinalize note' }

  revalidatePath(`/patients/${caseId}/discharge`)
  revalidatePath(`/patients/${caseId}/documents`)
  return { data: { success: true } }
}

// --- Regenerate single section ---

export async function regenerateDischargeNoteSectionAction(
  caseId: string,
  section: DischargeNoteSection,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  // Fetch current note
  const { data: note, error: fetchError } = await supabase
    .from('discharge_notes')
    .select('*')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .eq('status', 'draft')
    .single()

  if (fetchError || !note) return { error: 'No draft note found' }

  // Gather fresh source data (preserve the note's existing visit_date).
  // Thread the row's provider-entered discharge vitals through as
  // `dischargeVitals` so the trajectory builder grounds the discharge
  // endpoint on the entered value instead of falling through to the
  // latest-procedure-minus-2 fabrication. Mirrors the assembly used by
  // generateDischargeNote and getDischargePainTimeline.
  const visitDate = (note.visit_date as string | null) ?? new Date().toISOString().slice(0, 10)
  const preservedVitals: DischargeNoteInputData['dischargeVitals'] = {
    bp_systolic: note.bp_systolic,
    bp_diastolic: note.bp_diastolic,
    heart_rate: note.heart_rate,
    respiratory_rate: note.respiratory_rate,
    temperature_f: note.temperature_f,
    spo2_percent: note.spo2_percent,
    pain_score_min: note.pain_score_min,
    pain_score_max: note.pain_score_max,
  }
  const { data: inputData, error: gatherError } = await gatherDischargeNoteSourceData(
    supabase,
    caseId,
    visitDate,
    preservedVitals,
  )
  if (gatherError || !inputData) return { error: gatherError || 'Failed to gather source data' }

  const currentContent = (note[section] as string) || ''
  const toneHint = (note.tone_hint as string | null) ?? null
  const otherSections = Object.fromEntries(
    dischargeNoteSections
      .filter((s) => s !== section)
      .map((s) => [s, (note[s] as string | null) ?? '']),
  ) as Partial<Record<DischargeNoteSection, string>>

  const result = await regenerateSectionAI(inputData, section, currentContent, toneHint, otherSections)
  if (result.error || !result.data) {
    return { error: result.error || 'Section regeneration failed' }
  }

  // Run the trajectory validator against the merged note: the freshly
  // regenerated section plus the current content of the other sections.
  // Regen can refresh the deterministic trajectory (new vitals entered, new
  // procedure recorded, etc.), so both the note text and the audit columns
  // are updated atomically here — otherwise a stale pain_trajectory_text
  // can linger on the row while the regenerated section cites a newer arrow
  // chain.
  const mergedForValidation = {
    ...(Object.fromEntries(
      dischargeNoteSections.map((s) => [s, (note[s] as string | null) ?? '']),
    ) as Record<DischargeNoteSection, string>),
    [section]: result.data,
  } as unknown as import('@/lib/validations/discharge-note').DischargeNoteResult

  const trajectoryForValidator = {
    entries: [
      ...(inputData.intakePain && (inputData.intakePain.pain_score_min != null || inputData.intakePain.pain_score_max != null)
        ? [
            {
              date: inputData.intakePain.recorded_at,
              label: 'initial evaluation',
              min: inputData.intakePain.pain_score_min,
              max: inputData.intakePain.pain_score_max,
              source: 'intake' as const,
              estimated: false,
              dayOffset: null,
            },
          ]
        : []),
      ...inputData.procedures.map((p) => ({
        date: p.procedure_date,
        label: `procedure ${p.procedure_number}`,
        min: p.pain_score_min,
        max: p.pain_score_max,
        source: 'procedure' as const,
        estimated: false,
        dayOffset: null,
      })),
      ...(inputData.dischargeVisitPainDisplay != null
        ? [
            {
              date: null,
              label: "today's discharge evaluation",
              min: inputData.dischargePainEstimateMin,
              max: inputData.dischargePainEstimateMax,
              source: (inputData.dischargeVisitPainEstimated ? 'discharge_estimate' : 'discharge_vitals') as 'discharge_estimate' | 'discharge_vitals',
              estimated: inputData.dischargeVisitPainEstimated,
              dayOffset: null,
            },
          ]
        : []),
    ],
    arrowChain: inputData.painTrajectoryText ?? '',
    baselineDisplay: inputData.baselinePainDisplay,
    baselineSource: inputData.baselinePainSource,
    intakePainDisplay: inputData.intakePainDisplay,
    firstProcedurePainDisplay: inputData.firstProcedurePainDisplay,
    dischargeDisplay: inputData.dischargeVisitPainDisplay,
    dischargeEntry: inputData.dischargeVisitPainDisplay
      ? {
          date: null,
          label: "today's discharge evaluation",
          min: inputData.dischargePainEstimateMin,
          max: inputData.dischargePainEstimateMax,
          source: (inputData.dischargeVisitPainEstimated ? 'discharge_estimate' : 'discharge_vitals') as 'discharge_estimate' | 'discharge_vitals',
          estimated: inputData.dischargeVisitPainEstimated,
          dayOffset: null,
        }
      : null,
    dischargeEstimated: inputData.dischargeVisitPainEstimated,
  }
  const validation = validateDischargeTrajectoryConsistency(mergedForValidation, trajectoryForValidator)
  if (validation.warnings.length > 0) {
    console.warn('[discharge-note] section-regen trajectory validator warnings', {
      caseId,
      recordId: note.id,
      section,
      warnings: validation.warnings,
    })
  }

  // Merge the regenerated section into raw_ai_response.raw so the audit
  // blob reflects what is actually surfaced. Refresh trajectory_warnings
  // and the rest of the wrapper from the freshly-validated state.
  const existingRaw = note.raw_ai_response as {
    raw?: Record<string, unknown> | null
  } | null
  const mergedInnerRaw: Record<string, unknown> = {
    ...((existingRaw?.raw as Record<string, unknown> | null) ?? {}),
    [section]: result.data,
  }
  const wrappedRawResponse = {
    raw: mergedInnerRaw,
    trajectory_warnings: validation.warnings,
    discharge_readings_found: validation.dischargeReadingsFound,
    pain_trajectory_text: inputData.painTrajectoryText,
    discharge_visit_pain_display: inputData.dischargeVisitPainDisplay,
    discharge_visit_pain_estimated: inputData.dischargeVisitPainEstimated,
  }

  // Update the target section AND refresh the persisted trajectory columns
  // so the audit trail matches the current source data.
  const { error: updateError } = await supabase
    .from('discharge_notes')
    .update({
      [section]: result.data,
      raw_ai_response: wrappedRawResponse,
      discharge_pain_estimate_min: inputData.dischargePainEstimateMin,
      discharge_pain_estimate_max: inputData.dischargePainEstimateMax,
      discharge_pain_estimated: inputData.dischargeVisitPainEstimated,
      pain_trajectory_text: inputData.painTrajectoryText,
      updated_by_user_id: user.id,
    })
    .eq('id', note.id)

  if (updateError) return { error: 'Failed to update section' }

  revalidatePath(`/patients/${caseId}/discharge`)
  return { data: { content: result.data } }
}

// --- Reset ---

export async function resetDischargeNote(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const { data: note } = await supabase
    .from('discharge_notes')
    .select('id, status')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!note) return { error: 'No note found to reset' }
  if (note.status !== 'draft' && note.status !== 'failed') {
    return { error: 'Only draft or failed notes can be reset' }
  }

  const { error } = await supabase
    .from('discharge_notes')
    .update({
      status: 'draft',
      subjective: null,
      objective_vitals: null,
      objective_general: null,
      objective_cervical: null,
      objective_lumbar: null,
      objective_neurological: null,
      diagnoses: null,
      assessment: null,
      plan_and_recommendations: null,
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

  revalidatePath(`/patients/${caseId}/discharge`)
  return { data: { success: true } }
}

// --- Discharge-visit vital signs ---

export async function getDischargeVitals(caseId: string): Promise<{
  data?: DischargeNoteVitalsValues | null
  error?: string
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data, error } = await supabase
    .from('discharge_notes')
    .select('bp_systolic, bp_diastolic, heart_rate, respiratory_rate, temperature_f, spo2_percent, pain_score_min, pain_score_max')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) return { error: 'Failed to fetch vitals' }
  return { data: data ?? null }
}

export async function saveDischargeVitals(caseId: string, vitals: DischargeNoteVitalsValues) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const validated = dischargeNoteVitalsSchema.safeParse(vitals)
  if (!validated.success) return { error: 'Invalid vitals data' }

  // Upsert pattern: update the active discharge_notes row if one exists,
  // otherwise create a pre-generation draft row holding only these vitals.
  const { data: existing } = await supabase
    .from('discharge_notes')
    .select('id, status')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .maybeSingle()

  if (existing) {
    if (existing.status === 'finalized') {
      return { error: 'Cannot edit vitals on a finalized note' }
    }
    const { error } = await supabase
      .from('discharge_notes')
      .update({
        ...validated.data,
        updated_by_user_id: user.id,
      })
      .eq('id', existing.id)
    if (error) return { error: 'Failed to save vitals' }
  } else {
    const { error } = await supabase
      .from('discharge_notes')
      .insert({
        case_id: caseId,
        status: 'draft',
        ...validated.data,
        created_by_user_id: user.id,
        updated_by_user_id: user.id,
      })
    if (error) return { error: 'Failed to save vitals' }
  }

  revalidatePath(`/patients/${caseId}/discharge`)
  return { data: { success: true } }
}

// --- Save tone hint (auto-save from draft editor) ---

export async function saveDischargeNoteToneHint(
  caseId: string,
  toneHint: string | null,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const normalized = toneHint?.trim() ? toneHint.trim() : null

  // Upsert pattern: update active row if present, otherwise create a pre-generation
  // draft row holding only the tone hint.
  const { data: existing } = await supabase
    .from('discharge_notes')
    .select('id, status')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .maybeSingle()

  if (existing) {
    if (existing.status === 'finalized') {
      return { error: 'Cannot edit tone hint on a finalized note' }
    }
    const { error } = await supabase
      .from('discharge_notes')
      .update({ tone_hint: normalized, updated_by_user_id: user.id })
      .eq('id', existing.id)
    if (error) return { error: 'Failed to save tone hint' }
  } else {
    const { error } = await supabase
      .from('discharge_notes')
      .insert({
        case_id: caseId,
        status: 'draft',
        tone_hint: normalized,
        created_by_user_id: user.id,
        updated_by_user_id: user.id,
      })
    if (error) return { error: 'Failed to save tone hint' }
  }

  return {}
}

// --- Read-only pain timeline payload for the editor widget (R10) ---

import type { DischargePainTrajectory } from '@/lib/claude/pain-trajectory'
import type { PainObservation } from '@/lib/claude/pain-observations'

export async function getDischargePainTimeline(caseId: string): Promise<{
  data?: {
    trajectory: DischargePainTrajectory
    painObservations: PainObservation[]
    painTrajectoryText: string | null
    dischargeVisitPainDisplay: string | null
    dischargeVisitPainEstimated: boolean
    baselinePainSource: 'intake' | 'procedure' | null
  }
  error?: string
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Preserve provider-entered discharge vitals so the trajectory returned
  // here matches what generation would see. Match the same precedence
  // logic as generateDischargeNote.
  const { data: existingNote } = await supabase
    .from('discharge_notes')
    .select('visit_date, bp_systolic, bp_diastolic, heart_rate, respiratory_rate, temperature_f, spo2_percent, pain_score_min, pain_score_max')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .maybeSingle()

  const today = new Date().toISOString().slice(0, 10)
  const visitDate = existingNote?.visit_date ?? today
  const preservedVitals: DischargeNoteInputData['dischargeVitals'] = existingNote
    ? {
        bp_systolic: existingNote.bp_systolic,
        bp_diastolic: existingNote.bp_diastolic,
        heart_rate: existingNote.heart_rate,
        respiratory_rate: existingNote.respiratory_rate,
        temperature_f: existingNote.temperature_f,
        spo2_percent: existingNote.spo2_percent,
        pain_score_min: existingNote.pain_score_min,
        pain_score_max: existingNote.pain_score_max,
      }
    : null

  const { data: inputData, error } = await gatherDischargeNoteSourceData(
    supabase,
    caseId,
    visitDate,
    preservedVitals,
  )
  if (error || !inputData) return { error: error || 'Failed to gather source data' }

  // Rebuild the trajectory from the input payload so the widget receives
  // the full entry array (only the arrow-chain string is persisted on
  // DischargeNoteInputData — we need the entries for the table).
  const trajectory = buildDischargePainTrajectory({
    procedures: inputData.procedures.map((p) => ({
      procedure_date: p.procedure_date,
      procedure_number: p.procedure_number,
      pain_score_min: p.pain_score_min,
      pain_score_max: p.pain_score_max,
    })),
    latestVitals: inputData.latestVitals,
    dischargeVitals: inputData.dischargeVitals,
    baselinePain: inputData.baselinePain,
    intakePain: inputData.intakePain,
    overallPainTrend: inputData.overallPainTrend,
    finalIntervalWorsened: inputData.painTrendSignals.vsPrevious === 'worsened',
    visitDate,
  })

  return {
    data: {
      trajectory,
      painObservations: inputData.painObservations,
      painTrajectoryText: inputData.painTrajectoryText,
      dischargeVisitPainDisplay: inputData.dischargeVisitPainDisplay,
      dischargeVisitPainEstimated: inputData.dischargeVisitPainEstimated,
      baselinePainSource: inputData.baselinePainSource,
    },
  }
}
