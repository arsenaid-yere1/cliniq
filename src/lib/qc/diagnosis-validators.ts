import {
  defaultScoreForSeverity,
  type QualityFinding,
} from '@/lib/validations/case-quality-review'
import type { QualityReviewInputData } from '@/lib/claude/generate-quality-review'

// Deterministic validators emit findings without picking a per-violation
// numeric score; they always sit at the severity-tier default. Provider can
// edit-up via the UI override if a particular violation deserves emphasis.
function withDefaultScore(
  finding: Omit<QualityFinding, 'score'>,
): QualityFinding {
  return { ...finding, score: defaultScoreForSeverity(finding.severity) }
}
import { parseIvnDiagnoses } from '@/lib/icd10/parse-ivn-diagnoses'
import {
  isExternalCauseCode,
  findExternalCauseCodes,
  ACCIDENT_TYPE_EXPECTATIONS,
} from '@/lib/icd10/external-cause'
import {
  isInitialEncounterSuffix,
  isM545Parent,
} from '@/lib/icd10/seventh-character'
import {
  assertRecommendationDiagnosesInPool,
  formatVisitDiagnoses,
  normalizeVisitDiagnoses,
} from '@/lib/clinical/visit-diagnoses'
import { assertProcedureDiagnosisBlockMatches } from '@/lib/clinical/procedure-diagnoses'

// Synthetic section_key sentinels — used for finding hash stability and
// verifyFinding dispatch. Not real form sections; UI does not route on these.
// Leading underscore signals "synthetic". Same hash for the same violation
// across runs because section_key + step + note_id + procedure_id + message
// are all stable.
export const SECTION_QC_EXTERNAL_CAUSE_CHAIN = '_qc_external_cause_chain'
export const SECTION_QC_SEVENTH_CHARACTER_INTEGRITY =
  '_qc_seventh_character_integrity'
export const SECTION_QC_VISIT_DIAGNOSIS_UNCONFIRMED = '_qc_visit_diagnosis_unconfirmed'
export const SECTION_QC_NOTE_DIAGNOSIS_MISMATCH = '_qc_note_diagnosis_mismatch'
export const SECTION_QC_RECOMMENDATION_DIAGNOSIS_OUTSIDE_POOL = '_qc_recommendation_diagnosis_outside_pool'
export const SECTION_QC_PROCEDURE_DIAGNOSIS_MISMATCH = '_qc_procedure_diagnosis_mismatch'

function diagnosesFromProcedure(proc: { diagnoses: unknown }): string[] {
  if (!Array.isArray(proc.diagnoses)) return []
  return proc.diagnoses
    .map((d) => (d as { icd10_code?: string | null }).icd10_code)
    .filter((c): c is string => typeof c === 'string' && c.length > 0)
}

// External-cause-chain validator. Three sub-rules:
// (a) IV must carry a V/W code matching accident_type (if accident_type set).
// (b) Procedure notes must NOT carry any V/W/X/Y code (Filter A).
// (c) Discharge must NOT carry any V/W/X/Y code (Filter A).
export function validateExternalCauseChain(
  input: QualityReviewInputData,
): QualityFinding[] {
  const findings: QualityFinding[] = []

  const accidentType = input.caseDetails.accident_type
  const expectation = accidentType
    ? ACCIDENT_TYPE_EXPECTATIONS[accidentType]
    : null
  const ivCodes = input.initialVisitNote
    ? parseIvnDiagnoses(input.initialVisitNote.diagnoses).map(
        (d) => d.icd10_code,
      )
    : []
  if (expectation && input.initialVisitNote) {
    const hasExpected = ivCodes.some((c) =>
      c.toUpperCase().startsWith(expectation.prefix),
    )
    if (!hasExpected) {
      findings.push(withDefaultScore({
        severity: 'warning',
        step: 'initial_visit',
        note_id: input.initialVisitNote.id,
        procedure_id: null,
        section_key: SECTION_QC_EXTERNAL_CAUSE_CHAIN,
        message: `External cause code missing at initial visit (accident_type=${accidentType} expects ${expectation.example})`,
        rationale:
          'Initial-visit note must carry the accident-type-matched V/W external cause code per coding policy.',
        suggested_tone_hint: `Add ${expectation.example} to the diagnosis list as the final entry.`,
      }))
    }
  }

  for (const pn of input.procedureNotes) {
    const candidateCodes = diagnosesFromProcedure({ diagnoses: pn.diagnoses })
    const offending = findExternalCauseCodes(candidateCodes)
    for (const code of offending) {
      findings.push(withDefaultScore({
        severity: 'critical',
        step: 'procedure',
        note_id: pn.id,
        procedure_id: pn.procedure_id,
        section_key: SECTION_QC_EXTERNAL_CAUSE_CHAIN,
        message: `External cause code ${code} appears in procedure note ${pn.procedure_number} — must omit per coding policy`,
        rationale:
          'External-cause codes establish causation and belong in the initial-visit note only. Their presence on procedure notes reads as aggressive billing and is a defensibility liability at deposition.',
        suggested_tone_hint: `Regenerate the procedure note diagnoses; the note prompt's Filter (A) requires omitting ${code}.`,
      }))
    }
  }

  if (input.dischargeNote) {
    const dcCodes = parseIvnDiagnoses(input.dischargeNote.diagnoses).map(
      (d) => d.icd10_code,
    )
    const offending = findExternalCauseCodes(dcCodes)
    for (const code of offending) {
      findings.push(withDefaultScore({
        severity: 'critical',
        step: 'discharge',
        note_id: input.dischargeNote.id,
        procedure_id: null,
        section_key: SECTION_QC_EXTERNAL_CAUSE_CHAIN,
        message: `External cause code ${code} appears in discharge note — must omit per coding policy`,
        rationale:
          'External-cause codes belong in the initial-visit note only. Their presence on the discharge note reads as aggressive billing and is a defensibility liability at deposition.',
        suggested_tone_hint: `Regenerate the discharge diagnoses; Filter (A) requires omitting ${code}.`,
      }))
    }
  }

  return findings
}

// 7th-character integrity validator. Three sub-rules:
// (a) A-suffix at discharge → critical (Filter D).
// (b) A-suffix on procedure_number ≥ 2 → warning (Filter D — first procedure
//     is intake encounter and permits A-suffix).
// (c) M54.5 parent (no 5th-character subcode) at any step → warning.
//
// Skips external-cause codes (handled by validateExternalCauseChain).
export function validateSeventhCharacterIntegrity(
  input: QualityReviewInputData,
): QualityFinding[] {
  const findings: QualityFinding[] = []

  if (input.dischargeNote) {
    const dcParsed = parseIvnDiagnoses(input.dischargeNote.diagnoses)
    for (const { icd10_code } of dcParsed) {
      if (isExternalCauseCode(icd10_code)) continue
      if (isInitialEncounterSuffix(icd10_code)) {
        findings.push(withDefaultScore({
          severity: 'critical',
          step: 'discharge',
          note_id: input.dischargeNote.id,
          procedure_id: null,
          section_key: SECTION_QC_SEVENTH_CHARACTER_INTEGRITY,
          message: `A-suffix initial-encounter code ${icd10_code} persists at discharge — replace with D or S suffix`,
          rationale:
            'Discharge encounters are subsequent (D) or sequela (S). Initial-encounter (A) codes at discharge contradict the encounter context and will be flagged on coding review.',
          suggested_tone_hint: `Regenerate discharge diagnoses; Filter (D) requires replacing ${icd10_code} with the D- or S-suffix variant.`,
        }))
      }
      if (isM545Parent(icd10_code)) {
        findings.push(withDefaultScore({
          severity: 'warning',
          step: 'discharge',
          note_id: input.dischargeNote.id,
          procedure_id: null,
          section_key: SECTION_QC_SEVENTH_CHARACTER_INTEGRITY,
          message: `M54.5 parent code at discharge — emit M54.50/.51/.59 5th-character subcode`,
          rationale:
            'M54.5 is a non-billable parent. Always pick a 5th-character subcode (.50 default, .51 vertebrogenic, .59 other) per Filter (F).',
          suggested_tone_hint:
            'Regenerate discharge diagnoses with M54.50 (default).',
        }))
      }
    }
  }

  for (const pn of input.procedureNotes) {
    const candidateCodes = diagnosesFromProcedure({ diagnoses: pn.diagnoses })
    for (const code of candidateCodes) {
      if (isExternalCauseCode(code)) continue
      if (isM545Parent(code)) {
        findings.push(withDefaultScore({
          severity: 'warning',
          step: 'procedure',
          note_id: pn.id,
          procedure_id: pn.procedure_id,
          section_key: SECTION_QC_SEVENTH_CHARACTER_INTEGRITY,
          message: `M54.5 parent code on procedure note ${pn.procedure_number} — emit M54.50/.51/.59 5th-character subcode`,
          rationale: 'M54.5 is a non-billable parent.',
          suggested_tone_hint: 'Regenerate procedure note diagnoses with M54.50.',
        }))
      }
      if (pn.procedure_number >= 2 && isInitialEncounterSuffix(code)) {
        findings.push(withDefaultScore({
          severity: 'warning',
          step: 'procedure',
          note_id: pn.id,
          procedure_id: pn.procedure_id,
          section_key: SECTION_QC_SEVENTH_CHARACTER_INTEGRITY,
          message: `A-suffix initial-encounter code ${code} on procedure note #${pn.procedure_number} (≥2) — replace with D suffix`,
          rationale:
            'Procedure notes after the first visit are subsequent encounters. A-suffix codes here contradict the encounter context.',
          suggested_tone_hint: `Regenerate procedure note diagnoses; Filter (D) prefers the D-suffix variant of ${code}.`,
        }))
      }
    }
  }

  if (input.initialVisitNote) {
    const ivParsed = parseIvnDiagnoses(input.initialVisitNote.diagnoses)
    for (const { icd10_code } of ivParsed) {
      if (isExternalCauseCode(icd10_code)) continue
      if (isM545Parent(icd10_code)) {
        findings.push(withDefaultScore({
          severity: 'warning',
          step: 'initial_visit',
          note_id: input.initialVisitNote.id,
          procedure_id: null,
          section_key: SECTION_QC_SEVENTH_CHARACTER_INTEGRITY,
          message: `M54.5 parent code at initial visit — emit M54.50/.51/.59 5th-character subcode`,
          rationale: 'M54.5 is a non-billable parent.',
          suggested_tone_hint: 'Regenerate IV diagnoses with M54.50.',
        }))
      }
    }
  }

  return findings
}

function sameJson(left: unknown, right: unknown) {
  try {
    return JSON.stringify(normalizeVisitDiagnoses(left)) === JSON.stringify(normalizeVisitDiagnoses(right))
  } catch {
    return false
  }
}

export function validateVisitDiagnosisAuthority(input: QualityReviewInputData): QualityFinding[] {
  const findings: QualityFinding[] = []
  const visitNotes = [
    input.initialVisitNote && { ...input.initialVisitNote, step: 'initial_visit' as const },
    input.painEvaluationNote && { ...input.painEvaluationNote, step: 'pain_evaluation' as const },
    ...(input.painFollowUpNotes ?? []).map((note) => ({ ...note, step: 'pain_follow_up' as const })),
  ].filter((note): note is NonNullable<typeof note> => Boolean(note))

  for (const note of visitNotes) {
    if (note.status !== 'finalized' && !note.diagnoses_confirmed_at) {
      findings.push(withDefaultScore({
        severity: 'warning',
        step: note.step,
        note_id: note.id,
        procedure_id: null,
        encounter_id: note.encounter_id,
        section_key: SECTION_QC_VISIT_DIAGNOSIS_UNCONFIRMED,
        message: 'Visit diagnosis selection has not been confirmed',
        rationale: 'Generation and finalization require an explicit clinician review, including for an empty list.',
        suggested_tone_hint: null,
      }))
      continue
    }
    if (note.diagnoses_confirmed_at) {
      let expected = ''
      try { expected = formatVisitDiagnoses(normalizeVisitDiagnoses(note.encounter_diagnoses)) }
      catch { expected = '' }
      if (note.diagnoses !== expected || !sameJson(note.diagnoses_snapshot, note.encounter_diagnoses)) {
        findings.push(withDefaultScore({
          severity: 'critical',
          step: note.step,
          note_id: note.id,
          procedure_id: null,
          encounter_id: note.encounter_id,
          section_key: SECTION_QC_NOTE_DIAGNOSIS_MISMATCH,
          message: 'Note diagnoses do not match the confirmed encounter selection',
          rationale: 'The structured encounter selection is the diagnosis source of truth for this visit.',
          suggested_tone_hint: null,
        }))
      }
    }
    if (note.step === 'pain_follow_up' && note.diagnoses_confirmed_at) {
      try {
        assertRecommendationDiagnosesInPool(
          Array.isArray(note.procedure_recommendations) ? note.procedure_recommendations as never[] : [],
          normalizeVisitDiagnoses(note.encounter_diagnoses),
        )
      } catch {
        findings.push(withDefaultScore({
          severity: 'critical',
          step: note.step,
          note_id: note.id,
          procedure_id: null,
          encounter_id: note.encounter_id,
          section_key: SECTION_QC_RECOMMENDATION_DIAGNOSIS_OUTSIDE_POOL,
          message: 'Procedure recommendation references a diagnosis outside the confirmed visit pool',
          rationale: 'Recommendations may only use diagnoses explicitly confirmed for this encounter.',
          suggested_tone_hint: null,
        }))
      }
    }
  }

  for (const note of input.procedureNotes) {
    try {
      const diagnoses = normalizeVisitDiagnoses(note.diagnoses)
      if (!sameJson(note.diagnoses_snapshot, diagnoses)) throw new Error('snapshot mismatch')
      assertProcedureDiagnosisBlockMatches(note.assessment_and_plan, diagnoses)
    } catch {
      if (note.status === 'finalized' && Array.isArray(note.diagnoses_snapshot) && note.diagnoses_snapshot.length === 0) {
        continue
      }
      findings.push(withDefaultScore({
        severity: 'critical',
        step: 'procedure',
        note_id: note.id,
        procedure_id: note.procedure_id,
        encounter_id: null,
        section_key: SECTION_QC_PROCEDURE_DIAGNOSIS_MISMATCH,
        message: `Procedure note ${note.procedure_number} diagnoses do not match the procedure record`,
        rationale: 'The procedure record is the sole diagnosis authority for its generated note.',
        suggested_tone_hint: null,
      }))
    }
  }

  return findings
}
