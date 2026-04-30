import { rewriteASuffixToD, isInitialEncounterSuffix } from './seventh-character'
import { isExternalCauseCode } from './external-cause'

export type DiagnosisItem = { icd10_code: string; description: string }

// Apply the procedure-note-≥2 rule: A→D rewrite + external-cause strip.
// Pure function — returns a new array, does not mutate input.
//
// Per generate-procedure-note.ts:602 (Filter D) procedure notes after the
// first visit are subsequent encounters. Per generate-procedure-note.ts:593
// (Filter A) external-cause codes are absolute-omission on every procedure
// note. Today both rules live only in LLM prompts; this enforces them at
// storage so wrong codes never persist.
export function rewriteDiagnosesForProcedure(
  diagnoses: DiagnosisItem[],
  opts: { procedureNumber: number },
): DiagnosisItem[] {
  return diagnoses
    .filter((d) => !isExternalCauseCode(d.icd10_code))
    .map((d) =>
      opts.procedureNumber >= 2
        ? {
            icd10_code: rewriteASuffixToD(d.icd10_code),
            description: rewriteDescriptionForD(d.description, d.icd10_code),
          }
        : d,
    )
}

// When icd10 was rewritten A→D, also flip "initial encounter" to "subsequent
// encounter" in the description. The provider-entered description often
// contains the encounter qualifier verbatim; leaving "initial encounter"
// next to a D-suffix code reads inconsistent on coding review.
function rewriteDescriptionForD(
  description: string,
  originalCode: string,
): string {
  if (!isInitialEncounterSuffix(originalCode)) return description
  return description.replace(/initial encounter/gi, 'subsequent encounter')
}

// Discharge rule: A→D rewrite + external-cause strip + M54.5 parent upgrade.
// M54.5 → M54.50 is the only deterministic substitution allowed (per
// validation.ts NON_BILLABLE_PARENT_CODES); other parent-vs-child decisions
// stay with the LLM.
export function rewriteDiagnosesForDischarge(
  diagnoses: DiagnosisItem[],
): DiagnosisItem[] {
  return diagnoses
    .filter((d) => !isExternalCauseCode(d.icd10_code))
    .map((d) => {
      const code = d.icd10_code.trim().toUpperCase()
      if (code === 'M54.5') {
        return { icd10_code: 'M54.50', description: d.description }
      }
      if (isInitialEncounterSuffix(code)) {
        return {
          icd10_code: rewriteASuffixToD(code),
          description: rewriteDescriptionForD(d.description, code),
        }
      }
      return d
    })
}
