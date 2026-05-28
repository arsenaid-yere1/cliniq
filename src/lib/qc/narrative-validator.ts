// Post-generation narrative validator. Runs after the LLM returns and
// produces non-fatal warnings about prose quality the deterministic numeric
// validators cannot catch:
//   - banned hedge words (from voice charter)
//   - forbidden phrases (extending the prognosis list note-wide)
//   - cross-section duplicate sentences (>70% Jaccard token overlap)
//   - non-MM/DD/YYYY date formats
//   - very short sections (model bailed)
//
// Pure function. No I/O. Caller is responsible for persisting warnings into
// the note's raw_ai_response wrapper alongside any existing numeric warnings.

import { BANNED_HEDGE_WORDS } from './voice-charter'

export interface NarrativeWarning {
  section: string
  code:
    | 'banned_hedge'
    | 'forbidden_phrase'
    | 'duplicate_across_sections'
    | 'bad_date_format'
    | 'section_too_short'
  message: string
  evidence?: string | null
}

const FORBIDDEN_NOTE_WIDE = [
  'full recovery',
  'complete resolution of symptoms',
  'definitive healing',
  'guaranteed improvement',
  'cutting-edge',
  'state-of-the-art',
  'promotes natural healing',
  "harnesses the body's own",
  'regenerative capacity',
  'highly concentrated growth factors',
] as const

const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g
const LONG_DATE_RE = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/g

const SECTION_MIN_CHARS = 60

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function tokensOf(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .split(/\s+/)
      .filter((t) => t.length > 2),
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter += 1
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

export interface ValidateNarrativeOptions {
  // Sections eligible for the duplicate-detection pass. Defaults to all.
  // Caller may pass a subset when a generator's schema has known overlap
  // (e.g. discharge subjective/assessment both cite the pain trajectory).
  duplicateScope?: string[]
}

export function validateNarrative(
  sections: Record<string, string | null | undefined>,
  opts: ValidateNarrativeOptions = {},
): NarrativeWarning[] {
  const warnings: NarrativeWarning[] = []
  const entries = Object.entries(sections).filter(
    (kv): kv is [string, string] => typeof kv[1] === 'string' && kv[1].trim().length > 0,
  )

  // Banned hedges + forbidden phrases (case-insensitive whole-text scan).
  for (const [section, text] of entries) {
    const lower = text.toLowerCase()
    for (const w of BANNED_HEDGE_WORDS) {
      // word boundary to avoid "potentially" matching inside "potentialities"
      const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'i')
      if (re.test(lower)) {
        warnings.push({
          section,
          code: 'banned_hedge',
          message: `Banned hedge word "${w}" present in ${section}.`,
          evidence: w,
        })
      }
    }
    for (const p of FORBIDDEN_NOTE_WIDE) {
      if (lower.includes(p.toLowerCase())) {
        warnings.push({
          section,
          code: 'forbidden_phrase',
          message: `Forbidden phrase "${p}" present in ${section}.`,
          evidence: p,
        })
      }
    }
  }

  // Date format violations. ISO `YYYY-MM-DD` and "March 5, 2026" are not
  // permitted by the global formatting rule.
  for (const [section, text] of entries) {
    const iso = text.match(ISO_DATE_RE)
    if (iso) {
      warnings.push({
        section,
        code: 'bad_date_format',
        message: `Non-MM/DD/YYYY date(s) in ${section}: ${iso.join(', ')}.`,
        evidence: iso[0],
      })
    }
    const long = text.match(LONG_DATE_RE)
    if (long) {
      warnings.push({
        section,
        code: 'bad_date_format',
        message: `Long-form date(s) in ${section}: ${long.join(', ')}. Use MM/DD/YYYY.`,
        evidence: long[0],
      })
    }
  }

  // Section length floor — catches sections where the model bailed out.
  // Boilerplate single-line sections (e.g. allergies "NKDA") are exempted by
  // scope: the duplicate-scope option doubles as the section-length filter.
  const lengthScope = opts.duplicateScope ?? entries.map(([k]) => k)
  for (const [section, text] of entries) {
    if (!lengthScope.includes(section)) continue
    if (text.trim().length < SECTION_MIN_CHARS) {
      warnings.push({
        section,
        code: 'section_too_short',
        message: `Section ${section} is only ${text.trim().length} chars; below floor (${SECTION_MIN_CHARS}).`,
      })
    }
  }

  // Cross-section sentence duplication. Compute Jaccard token overlap on
  // each sentence pair across the duplicateScope; flag >= 0.7 overlap. This
  // catches both verbatim copies and light paraphrases.
  const scoped = entries.filter(([k]) => (opts.duplicateScope ?? entries.map(([x]) => x)).includes(k))
  type SentenceRecord = { section: string; sentence: string; tokens: Set<string> }
  const sentenceIndex: SentenceRecord[] = []
  for (const [section, text] of scoped) {
    for (const sentence of sentencesOf(text)) {
      if (sentence.length < 30) continue
      sentenceIndex.push({ section, sentence, tokens: tokensOf(sentence) })
    }
  }
  for (let i = 0; i < sentenceIndex.length; i += 1) {
    for (let j = i + 1; j < sentenceIndex.length; j += 1) {
      const a = sentenceIndex[i]
      const b = sentenceIndex[j]
      if (a.section === b.section) continue
      const score = jaccard(a.tokens, b.tokens)
      if (score >= 0.7) {
        warnings.push({
          section: `${a.section}+${b.section}`,
          code: 'duplicate_across_sections',
          message: `Sentences in ${a.section} and ${b.section} overlap ${(score * 100).toFixed(0)}% — paraphrase or move information into one section.`,
          evidence: a.sentence,
        })
      }
    }
  }

  return warnings
}
