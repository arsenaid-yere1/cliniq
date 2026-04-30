// Phrases the LLM must not emit as clinical claims about prognosis outcome
// across all note types. Listed in claim-form (not bare substrings) so the
// prompt rule does not collide with legitimate prose like "full recovery
// depends on the patient's response..." which is part of an existing
// reference template in the procedure-note prompt.
export const FORBIDDEN_PROGNOSIS_PHRASES = [
  'full recovery is expected',
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
  return `FORBIDDEN PHRASES (MANDATORY) in prognosis — do NOT use any of the following as a clinical claim about expected outcome: ${quoted}. Prognosis language must remain measured. Use "guarded", "guarded-to-favorable", "favorable", "meaningful and sustained improvement", "anticipated long-term symptom control" instead.`
}
