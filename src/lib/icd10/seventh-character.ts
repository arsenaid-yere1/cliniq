// ICD-10-CM 7th-character semantics (subset relevant to PI/musculoskeletal):
//   A — initial encounter
//   D — subsequent encounter
//   S — sequela
// Per generate-discharge-note.ts:419 (Filter D), A-suffix codes are forbidden
// at discharge. Per generate-procedure-note.ts:602 (Filter D), A-suffix codes
// on procedure notes ≥2 should be replaced with D-suffix.

const SEVENTH_CHARACTER_REGEX = /^[A-Z]\d{2}\.[A-Z0-9]{1,4}([ADS])$/i

export function getSeventhCharacter(
  code: string | null | undefined,
): 'A' | 'D' | 'S' | null {
  if (!code) return null
  const m = code.trim().toUpperCase().match(SEVENTH_CHARACTER_REGEX)
  return m ? (m[1] as 'A' | 'D' | 'S') : null
}

export function isInitialEncounterSuffix(
  code: string | null | undefined,
): boolean {
  return getSeventhCharacter(code) === 'A'
}

export function isSubsequentEncounterSuffix(
  code: string | null | undefined,
): boolean {
  return getSeventhCharacter(code) === 'D'
}

export function isSequelaSuffix(code: string | null | undefined): boolean {
  return getSeventhCharacter(code) === 'S'
}

// M54.5 parent guard. Per validation.ts NON_BILLABLE_PARENT_CODES + the
// DIAGNOSTIC-SUPPORT RULE (A) at generate-initial-visit.ts:192-195, the parent
// M54.5 must always be replaced with .50/.51/.59. Returns true ONLY for the
// bare parent — M54.50 and friends return false.
export function isM545Parent(code: string | null | undefined): boolean {
  if (!code) return false
  return code.trim().toUpperCase() === 'M54.5'
}

// Rewrite an A-suffix code to its D-suffix counterpart. The A is always the
// last character per SEVENTH_CHARACTER_REGEX. Returns the input unchanged
// when not an A-suffix code OR when external-cause (V/W/X/Y).
//
// External-cause codes keep their A-suffix forever — they describe the
// causation event, not the encounter for the patient's injury. Strip happens
// at procedure/discharge instead via isExternalCauseCode.
export function rewriteASuffixToD(code: string): string {
  if (!code) return code
  const c = code.trim().toUpperCase()
  if (/^[VWXY]\d{2}/.test(c)) return c
  if (getSeventhCharacter(c) === 'A') return c.slice(0, -1) + 'D'
  return c
}

// S-suffix variant. Used at discharge when the symptom is fully resolved
// (Filter G at generate-discharge-note.ts:425). Phase 3 prefers D as the
// safe default; LLM still owns the symptom-resolution → S decision in prose.
export function rewriteASuffixToS(code: string): string {
  if (!code) return code
  const c = code.trim().toUpperCase()
  if (/^[VWXY]\d{2}/.test(c)) return c
  if (getSeventhCharacter(c) === 'A') return c.slice(0, -1) + 'S'
  return c
}
