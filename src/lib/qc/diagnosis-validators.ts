import type { QualityFinding } from '@/lib/validations/case-quality-review'
import type { QualityReviewInputData } from '@/lib/claude/generate-quality-review'
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

// Synthetic section_key sentinels — used for finding hash stability and
// verifyFinding dispatch. Not real form sections; UI does not route on these.
// Leading underscore signals "synthetic". Same hash for the same violation
// across runs because section_key + step + note_id + procedure_id + message
// are all stable.
export const SECTION_QC_EXTERNAL_CAUSE_CHAIN = '_qc_external_cause_chain'
export const SECTION_QC_SEVENTH_CHARACTER_INTEGRITY =
  '_qc_seventh_character_integrity'

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
      findings.push({
        severity: 'warning',
        step: 'initial_visit',
        note_id: input.initialVisitNote.id,
        procedure_id: null,
        section_key: SECTION_QC_EXTERNAL_CAUSE_CHAIN,
        message: `External cause code missing at initial visit (accident_type=${accidentType} expects ${expectation.example})`,
        rationale:
          'Initial-visit note must carry the accident-type-matched V/W external cause code per coding policy.',
        suggested_tone_hint: `Add ${expectation.example} to the diagnosis list as the final entry.`,
      })
    }
  }

  for (const pn of input.procedureNotes) {
    const candidateCodes = diagnosesFromProcedure({ diagnoses: pn.diagnoses })
    const offending = findExternalCauseCodes(candidateCodes)
    for (const code of offending) {
      findings.push({
        severity: 'critical',
        step: 'procedure',
        note_id: pn.id,
        procedure_id: pn.procedure_id,
        section_key: SECTION_QC_EXTERNAL_CAUSE_CHAIN,
        message: `External cause code ${code} appears in procedure note ${pn.procedure_number} — must omit per coding policy`,
        rationale:
          'External-cause codes establish causation and belong in the initial-visit note only. Their presence on procedure notes reads as aggressive billing and is a defensibility liability at deposition.',
        suggested_tone_hint: `Regenerate the procedure note diagnoses; the note prompt's Filter (A) requires omitting ${code}.`,
      })
    }
  }

  if (input.dischargeNote) {
    const dcCodes = parseIvnDiagnoses(input.dischargeNote.diagnoses).map(
      (d) => d.icd10_code,
    )
    const offending = findExternalCauseCodes(dcCodes)
    for (const code of offending) {
      findings.push({
        severity: 'critical',
        step: 'discharge',
        note_id: input.dischargeNote.id,
        procedure_id: null,
        section_key: SECTION_QC_EXTERNAL_CAUSE_CHAIN,
        message: `External cause code ${code} appears in discharge note — must omit per coding policy`,
        rationale:
          'External-cause codes belong in the initial-visit note only. Their presence on the discharge note reads as aggressive billing and is a defensibility liability at deposition.',
        suggested_tone_hint: `Regenerate the discharge diagnoses; Filter (A) requires omitting ${code}.`,
      })
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
        findings.push({
          severity: 'critical',
          step: 'discharge',
          note_id: input.dischargeNote.id,
          procedure_id: null,
          section_key: SECTION_QC_SEVENTH_CHARACTER_INTEGRITY,
          message: `A-suffix initial-encounter code ${icd10_code} persists at discharge — replace with D or S suffix`,
          rationale:
            'Discharge encounters are subsequent (D) or sequela (S). Initial-encounter (A) codes at discharge contradict the encounter context and will be flagged on coding review.',
          suggested_tone_hint: `Regenerate discharge diagnoses; Filter (D) requires replacing ${icd10_code} with the D- or S-suffix variant.`,
        })
      }
      if (isM545Parent(icd10_code)) {
        findings.push({
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
        })
      }
    }
  }

  for (const pn of input.procedureNotes) {
    const candidateCodes = diagnosesFromProcedure({ diagnoses: pn.diagnoses })
    for (const code of candidateCodes) {
      if (isExternalCauseCode(code)) continue
      if (isM545Parent(code)) {
        findings.push({
          severity: 'warning',
          step: 'procedure',
          note_id: pn.id,
          procedure_id: pn.procedure_id,
          section_key: SECTION_QC_SEVENTH_CHARACTER_INTEGRITY,
          message: `M54.5 parent code on procedure note ${pn.procedure_number} — emit M54.50/.51/.59 5th-character subcode`,
          rationale: 'M54.5 is a non-billable parent.',
          suggested_tone_hint: 'Regenerate procedure note diagnoses with M54.50.',
        })
      }
      if (pn.procedure_number >= 2 && isInitialEncounterSuffix(code)) {
        findings.push({
          severity: 'warning',
          step: 'procedure',
          note_id: pn.id,
          procedure_id: pn.procedure_id,
          section_key: SECTION_QC_SEVENTH_CHARACTER_INTEGRITY,
          message: `A-suffix initial-encounter code ${code} on procedure note #${pn.procedure_number} (≥2) — replace with D suffix`,
          rationale:
            'Procedure notes after the first visit are subsequent encounters. A-suffix codes here contradict the encounter context.',
          suggested_tone_hint: `Regenerate procedure note diagnoses; Filter (D) prefers the D-suffix variant of ${code}.`,
        })
      }
    }
  }

  if (input.initialVisitNote) {
    const ivParsed = parseIvnDiagnoses(input.initialVisitNote.diagnoses)
    for (const { icd10_code } of ivParsed) {
      if (isExternalCauseCode(icd10_code)) continue
      if (isM545Parent(icd10_code)) {
        findings.push({
          severity: 'warning',
          step: 'initial_visit',
          note_id: input.initialVisitNote.id,
          procedure_id: null,
          section_key: SECTION_QC_SEVENTH_CHARACTER_INTEGRITY,
          message: `M54.5 parent code at initial visit — emit M54.50/.51/.59 5th-character subcode`,
          rationale: 'M54.5 is a non-billable parent.',
          suggested_tone_hint: 'Regenerate IV diagnoses with M54.50.',
        })
      }
    }
  }

  return findings
}
