import type { PlannedProcedure } from './compute-plan-alignment'
import type { ProcedureSite } from './sites-helpers'

function titleCase(s: string): string {
  return s.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

function sitesFromCandidate(c: PlannedProcedure): ProcedureSite[] {
  if (c.target_levels.length > 0) {
    return c.target_levels.map((level) => ({
      label: level,
      laterality: c.laterality,
      volume_ml: null,
      target_confirmed_imaging: null,
    }))
  }
  if (c.body_region) {
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
