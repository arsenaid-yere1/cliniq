import type { PlannedProcedure } from './compute-plan-alignment'
import type { ProcedureSite } from './sites-helpers'

// Canonical region labels accepted as site labels. Mirrors the values of
// REGION_SYNONYMS in compute-plan-alignment.ts. Any other body_region (e.g.
// a free-text sentence that normalizeRegion failed to canonicalize) is
// rejected so hint labels stay clean. Vertebral-level codes go through a
// separate regex path.
const CANONICAL_REGIONS = new Set([
  'lumbar',
  'cervical',
  'thoracic',
  'sacroiliac',
  'knee',
  'shoulder',
  'hip',
  'wrist',
  'ankle',
  'elbow',
])

const VERTEBRAL_LEVEL_RE = /^[CTL]\d{1,2}(-[CTLS]?\d{1,2})?$/i

function titleCase(s: string): string {
  return s.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

function isCleanLevelCode(s: string): boolean {
  return VERTEBRAL_LEVEL_RE.test(s.trim())
}

function isCanonicalRegion(s: string): boolean {
  return CANONICAL_REGIONS.has(s.trim().toLowerCase())
}

function sitesFromCandidate(c: PlannedProcedure): ProcedureSite[] {
  if (c.target_levels.length > 0) {
    return c.target_levels
      .filter(isCleanLevelCode)
      .map((level) => ({
        label: level,
        laterality: c.laterality,
        volume_ml: null,
        target_confirmed_imaging: null,
      }))
  }
  if (c.body_region && isCanonicalRegion(c.body_region)) {
    return [{
      label: titleCase(c.body_region),
      laterality: c.laterality,
      volume_ml: null,
      target_confirmed_imaging: null,
    }]
  }
  return []
}

export function sitesFromPlan(
  pmCandidates: PlannedProcedure[],
  ivCandidates: PlannedProcedure[],
): ProcedureSite[] {
  const combined = [...pmCandidates, ...ivCandidates].flatMap(sitesFromCandidate)
  const seen = new Set<string>()
  const out: ProcedureSite[] = []
  for (const s of combined) {
    const key = `${s.label.toLowerCase()}|${s.laterality ?? 'null'}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}
