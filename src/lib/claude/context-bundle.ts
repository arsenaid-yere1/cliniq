// Curated context bundle helpers. Convert raw inputData blobs into a leaner
// JSON shape before they enter the user message:
//   - Drop top-level null / empty-array fields (Claude no longer spends
//     attention deciding whether a null value is meaningful).
//   - Summarize prior procedure-note section text to its first 3 sentences
//     so the model is less tempted to copy/paraphrase verbatim.
//
// All prompt rules that read structured field names (paintoneLabel,
// dischargeVisitPainDisplay, painObservations, planAlignment, etc.) continue
// to operate unchanged — those fields are never stripped.

const PRESERVED_KEYS_EVEN_IF_EMPTY = new Set<string>([
  // Pain/trajectory contracts that the prompt expects to read directly.
  'paintoneLabel',
  'paintoneSignals',
  'painTrajectoryText',
  'baselinePainDisplay',
  'baselinePainSource',
  'dischargeVisitPainDisplay',
  'dischargeVisitPainEstimated',
  'intakePain',
  'intakePainDisplay',
  'firstProcedurePainDisplay',
  'priorProcedures',
  'priorProcedureNotes',
  'vitalSigns',
  'procedureRecord',
  'pmExtraction',
  'initialVisitNote',
  'painObservations',
  'overallPainTrend',
  'seriesVolatility',
  'chiroProgress',
  'planAlignment',
  // Diagnosis pool — empty array still informs the prompt that no pre-filter
  // was applied.
  'diagnosisPool',
  // Patient/case identifying fields — always preserved for prompt correctness.
  'patientInfo',
  'caseDetails',
  'visitDate',
  'age',
  'clinicInfo',
  'providerInfo',
])

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (Array.isArray(v) && v.length === 0) return true
  if (typeof v === 'string' && v.trim().length === 0) return true
  return false
}

function summarizePriorNoteSection(text: string | null | undefined, maxSentences = 3): string | null {
  if (!text || typeof text !== 'string') return null
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  const sentences = trimmed
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (sentences.length <= maxSentences) return trimmed
  return sentences.slice(0, maxSentences).join(' ') + ' …'
}

// Returns a shallow copy of inputData with empty top-level fields dropped
// (except those in PRESERVED_KEYS_EVEN_IF_EMPTY) and prior-note section text
// summarized.
export function curateInputDataForPrompt<T extends Record<string, unknown>>(inputData: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(inputData)) {
    if (isEmpty(value) && !PRESERVED_KEYS_EVEN_IF_EMPTY.has(key)) continue
    out[key] = value
  }

  // Summarize priorProcedureNotes section bodies.
  const prior = out.priorProcedureNotes
  if (Array.isArray(prior)) {
    out.priorProcedureNotes = prior.map((entry) => {
      if (!entry || typeof entry !== 'object') return entry
      const e = entry as Record<string, unknown>
      const sections = e.sections as Record<string, string | null> | undefined
      if (!sections) return entry
      return {
        ...e,
        sections: {
          subjective: summarizePriorNoteSection(sections.subjective),
          assessment_summary: summarizePriorNoteSection(sections.assessment_summary),
          procedure_injection: summarizePriorNoteSection(sections.procedure_injection),
          assessment_and_plan: summarizePriorNoteSection(sections.assessment_and_plan),
          prognosis: summarizePriorNoteSection(sections.prognosis),
        },
      }
    })
  }

  return out as T
}
