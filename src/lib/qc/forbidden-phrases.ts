// Phrases the LLM must not emit anywhere in any prognosis section across
// all note types. Substrings are matched in case-insensitive prompt
// instructions; `cure` is the only entry that requires word-boundary
// framing because it collides with benign tokens (`cured`, `curettage`).
export const FORBIDDEN_PROGNOSIS_PHRASES = [
  'full recovery',
  'complete resolution of symptoms',
  'definitive healing',
  'guaranteed improvement',
  'cure',
] as const

// Render the canonical FORBIDDEN PHRASES (MANDATORY) block for embedding
// in any generator's prognosis-section prompt. Centralizing the wording
// keeps the call sites byte-identical so QC review behavior is uniform
// across note types.
export function forbiddenPrognosisPromptBlock(): string {
  const quoted = FORBIDDEN_PROGNOSIS_PHRASES.map((p) => `"${p}"`).join(', ')
  return `FORBIDDEN PHRASES (MANDATORY) in prognosis — do NOT use any of the following anywhere in the prognosis section: ${quoted}. Prognosis language must remain measured. Use "guarded", "guarded-to-favorable", "favorable", "meaningful and sustained improvement", "anticipated long-term symptom control" instead.`
}
