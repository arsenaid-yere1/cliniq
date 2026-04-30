// External-cause ICD-10-CM codes: chapter XX (V00-Y99). Subset relevant to PI:
// V (transport accidents), W (other external causes of accidental injury),
// X (exposure / assault overlap), Y (other / late effects).
//
// Per generate-procedure-note.ts:593 (Filter A) and generate-discharge-note.ts:408
// (Filter A), these codes belong on the initial-visit note ONLY. Their presence
// on procedure or discharge notes is a defensibility liability at deposition.

export const EXTERNAL_CAUSE_CODE_PATTERN = /^[VWXY]\d{2}/i

export function isExternalCauseCode(code: string | null | undefined): boolean {
  if (!code) return false
  return EXTERNAL_CAUSE_CODE_PATTERN.test(code.trim())
}

export function findExternalCauseCodes(
  codes: Array<string | null | undefined>,
): string[] {
  const out: string[] = []
  for (const c of codes) {
    if (isExternalCauseCode(c)) out.push((c as string).trim().toUpperCase())
  }
  return out
}

// accident_type → expected external cause prefix (per generate-initial-visit.ts:130-134).
// Validator only checks that *some* external-cause code is present when the
// accident_type expects one — exact code variant is LLM-judged.
export const ACCIDENT_TYPE_EXPECTATIONS: Record<
  string,
  { prefix: string; example: string }
> = {
  auto: { prefix: 'V', example: 'V43.52XA' },
  slip_and_fall: { prefix: 'W01', example: 'W01.0XXA' },
  workplace: { prefix: 'W18', example: 'W18.49XA' },
}
