// Shared voice & style charter for all clinical-note generators (initial
// visit, procedure, discharge). Prepended to every note's system prompt so
// drafts read with a consistent reviewer-perceived voice instead of drifting
// between Opus generation runs.
//
// Scope of this charter: voice rules only — banned hedges, tense/person,
// sentence structure. Section-specific rules, length targets, and clinical
// guardrails remain in each generator's own system prompt.

export const BANNED_HEDGE_WORDS = [
  'very',
  'quite',
  'somewhat',
  'fairly',
  'potentially',
  'it appears that',
  'it seems that',
  'arguably',
  'seemingly',
] as const

export const APPROVED_TRANSITIONS = [
  'Additionally',
  'Furthermore',
  'However',
  'Subsequently',
  'Notably',
  'Of note',
  'In contrast',
  'Consistent with',
] as const

export function voiceCharterPromptBlock(): string {
  const bannedQuoted = BANNED_HEDGE_WORDS.map((w) => `"${w}"`).join(', ')
  const transitionsQuoted = APPROVED_TRANSITIONS.map((w) => `"${w}"`).join(', ')

  return `=== VOICE & STYLE CHARTER (MANDATORY — applies to every narrative section) ===

These rules govern voice consistency across all clinical notes. Section-specific length and content rules in the sections below override length here, but never override voice.

SENTENCE STRUCTURE
• Prefer simple declarative sentences. One clinical concept per sentence.
• Avoid stacked subordinate clauses. If a sentence has three or more commas, split it.
• Never start a section with a participial phrase ("Presenting with...", "Reporting...") — lead with the subject.

VERB TENSE
• Past tense for completed procedure actions and historical events ("the patient underwent", "the injection was performed", "symptoms began").
• Present tense for current status ("the patient reports", "examination reveals", "pain is rated").
• Present perfect for trajectory across the series ("pain has decreased", "function has improved").
• Do NOT mix tenses within a single sentence.

PERSON
• Third-person clinical narrative everywhere EXCEPT the time/complexity attestation and the clinician disclaimer (those are first-person, as specified in their section rules).
• Refer to the patient as "the patient" or by surname (with appropriate title) — never "Pt." or first name alone.

BANNED HEDGE WORDS (do NOT use anywhere in any section)
${bannedQuoted}.
These weaken clinical prose. Replace with specifics: instead of "the pain is quite severe", write "the pain is rated 8/10". Instead of "potentially related to the accident", write "consistent with the accident mechanism" or state what is and is not supported by findings.

APPROVED TRANSITIONS
Use only from this list when joining clinical observations across sentences: ${transitionsQuoted}. Do NOT invent transitions ("Moving on,", "On another note,", "It's worth noting that"). Most clinical sentences need no transition at all — prefer juxtaposition.

CONCRETE OVER ABSTRACT
• Use specific findings, measurements, and observations. Abstractions like "the patient is doing better" or "good progress" are forbidden — substitute the numeric or behavioral evidence ("pain decreased from 8/10 to 4/10", "tolerates 30 minutes of seated work without flare").
• Good: "Cervical rotation improved from 60° to 75° bilaterally, with reduced reproduction of radicular symptoms on Spurling's."
• Bad: "Cervical mobility appears to have improved somewhat and the patient seems to be doing better overall."

NO MARKETING LANGUAGE
• Do NOT use promotional phrases for PRP, regenerative therapy, or conservative care ("cutting-edge", "advanced", "state-of-the-art", "promotes natural healing", "harnesses the body's own"). State what was done and why in clinical terms only.

`
}
