// Supplementary pain observations extracted from PT, PM, chiro, and
// case-summary sources for discharge-note narrative enrichment. These are
// NOT used to override or modify the deterministic arrow chain built by
// pain-trajectory.ts — they are passed as a sidecar the LLM may cite in
// the subjective narrative when at least two observations exist.
//
// No I/O. Pure functions operating on already-fetched extraction rows.

export type PainObservationSource = 'pt' | 'pm' | 'chiro' | 'case_summary'

export interface PainObservation {
  date: string | null
  source: PainObservationSource
  label: string
  min: number | null
  max: number | null
  scale: 'nrs10' | 'vas100' | 'other'
  context: string | null
}

// Narrow-typing helpers — extraction inputs are `unknown` JSONB from the
// DB. Use structural checks rather than forcing the validators' full
// schemas through here (the validators are lenient; this module must be
// defensive about shape).
function pickNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
function pickString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}
function pickArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function normalizeScale(raw: string | null): 'nrs10' | 'vas100' | 'other' {
  if (!raw) return 'nrs10'
  const s = raw.toLowerCase()
  if (s.includes('nrs') || s.includes('/10') || s === '10') return 'nrs10'
  if (s.includes('vas') || s.includes('/100') || s === '100') return 'vas100'
  return 'other'
}

export function extractPtPainObservation(
  pt: {
    pain_ratings?: unknown
    created_at?: string | null
    evaluation_date?: string | null
  } | null | undefined,
): PainObservation | null {
  if (!pt) return null
  const pr = pt.pain_ratings as Record<string, unknown> | null | undefined
  if (!pr || typeof pr !== 'object') return null
  const atRest = pickNumber((pr as Record<string, unknown>).at_rest)
  const withActivity = pickNumber((pr as Record<string, unknown>).with_activity)
  const worst = pickNumber((pr as Record<string, unknown>).worst)
  const best = pickNumber((pr as Record<string, unknown>).best)

  const values = [atRest, withActivity, worst, best].filter((v): v is number => v != null)
  if (values.length === 0) return null

  // Collapse the four readings into a span: best..worst covers the range
  // the patient described; at-rest vs with-activity are reflected in the
  // context string so the narrative can cite them specifically.
  const min = best ?? (values.length ? Math.min(...values) : null)
  const max = worst ?? (values.length ? Math.max(...values) : null)

  const contextParts: string[] = []
  if (atRest != null) contextParts.push(`at rest ${atRest}/10`)
  if (withActivity != null) contextParts.push(`with activity ${withActivity}/10`)
  if (worst != null) contextParts.push(`worst ${worst}/10`)
  if (best != null) contextParts.push(`best ${best}/10`)

  return {
    date: pickString(pt.evaluation_date) ?? pickString(pt.created_at),
    source: 'pt',
    label: 'PT evaluation',
    min,
    max,
    scale: 'nrs10',
    context: contextParts.join('; ') || null,
  }
}

export function extractPmPainObservations(
  pm: {
    chief_complaints?: unknown
    created_at?: string | null
  } | null | undefined,
): PainObservation[] {
  if (!pm) return []
  const date = pickString(pm.created_at)
  const complaints = pickArray(pm.chief_complaints)
  const observations: PainObservation[] = []
  for (const c of complaints) {
    if (!c || typeof c !== 'object') continue
    const cc = c as Record<string, unknown>
    const min = pickNumber(cc.pain_rating_min)
    const max = pickNumber(cc.pain_rating_max)
    if (min == null && max == null) continue
    const location = pickString(cc.location) ?? 'unspecified region'
    observations.push({
      date,
      source: 'pm',
      label: `PM chief complaint: ${location}`,
      min,
      max,
      scale: 'nrs10',
      context: null,
    })
  }
  return observations
}

export function extractChiroPainObservations(
  chiro: { functional_outcomes?: unknown } | null | undefined,
): PainObservation[] {
  if (!chiro) return []
  const fo = chiro.functional_outcomes as Record<string, unknown> | null | undefined
  if (!fo || typeof fo !== 'object') return []
  const levels = pickArray((fo as Record<string, unknown>).pain_levels)
  const observations: PainObservation[] = []
  for (const lvl of levels) {
    if (!lvl || typeof lvl !== 'object') continue
    const l = lvl as Record<string, unknown>
    const score = pickNumber(l.score)
    const maxScore = pickNumber(l.max_score)
    if (score == null) continue
    const scaleRaw = pickString(l.scale)
    const scale = normalizeScale(scaleRaw)
    observations.push({
      date: pickString(l.date),
      source: 'chiro',
      label: 'chiro pain level',
      min: score,
      max: score,
      scale: scale === 'other' && maxScore === 10 ? 'nrs10' : scale,
      context: pickString(l.context),
    })
  }
  return observations
}

// Sort observations chronologically ascending. Entries without dates go
// to the END (stable sort) so dated entries lead the timeline.
export function sortPainObservations(observations: PainObservation[]): PainObservation[] {
  return [...observations].sort((a, b) => {
    if (a.date && b.date) {
      const tA = new Date(a.date).getTime()
      const tB = new Date(b.date).getTime()
      if (Number.isFinite(tA) && Number.isFinite(tB)) return tA - tB
      if (Number.isFinite(tA)) return -1
      if (Number.isFinite(tB)) return 1
      return 0
    }
    if (a.date) return -1
    if (b.date) return 1
    return 0
  })
}

export function buildPainObservations(input: {
  ptExtraction: { pain_ratings?: unknown; evaluation_date?: string | null; created_at?: string | null } | null
  pmExtraction: { chief_complaints?: unknown; created_at?: string | null } | null
  chiroExtraction: { functional_outcomes?: unknown } | null
}): PainObservation[] {
  const merged: PainObservation[] = []
  const pt = extractPtPainObservation(input.ptExtraction)
  if (pt) merged.push(pt)
  merged.push(...extractPmPainObservations(input.pmExtraction))
  merged.push(...extractChiroPainObservations(input.chiroExtraction))
  return sortPainObservations(merged)
}
