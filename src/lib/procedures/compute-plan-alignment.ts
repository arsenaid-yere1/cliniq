// Plan-vs-performed alignment for PRP procedure notes. Compares the
// performed technique captured on the procedures row against the planned
// procedure(s) described in the PM extraction's treatment_plan and the
// initial visit note's treatment_plan narrative.
//
// Status is computed deterministically in TypeScript (like paintoneLabel /
// seriesVolatility / pmSupplementaryDiagnoses) and fed to the SYSTEM_PROMPT's
// PLAN-COHERENCE RULE, which narrates based on the status + mismatches.

export type PlanAlignmentStatus =
  | 'aligned'
  | 'deviation'
  | 'unplanned'
  | 'no_plan_on_file'

export type PlannedProcedure = {
  source: 'pm_extraction' | 'initial_visit_note'
  body_region: string | null
  laterality: 'left' | 'right' | 'bilateral' | null
  guidance_hint: 'ultrasound' | 'fluoroscopy' | 'landmark' | null
  target_levels: string[]
  raw_description: string
}

export type PlanMismatchField =
  | 'body_region'
  | 'laterality'
  | 'guidance_method'
  | 'target_levels'

export type PlanMismatch = {
  field: PlanMismatchField
  planned: string | null
  performed: string | null
}

export type PlanAlignment = {
  status: PlanAlignmentStatus
  planned: PlannedProcedure | null
  mismatches: PlanMismatch[]
}

import { lateralityFromSites, type ProcedureSite } from './sites-helpers'

type PerformedInput = {
  injection_site: string | null
  sites: ProcedureSite[]
  guidance_method: 'ultrasound' | 'fluoroscopy' | 'landmark' | null
}

// Canonical regions — mirrors the informal taxonomy used elsewhere
// (parse-body-region.ts handles laterality; this handles anatomical
// grouping so "lumbar spine" / "lumbosacral" / "low back" all compare
// equal against "lumbar").
const REGION_SYNONYMS: Record<string, string> = {
  lumbar: 'lumbar',
  lumbosacral: 'lumbar',
  'low back': 'lumbar',
  'lower back': 'lumbar',
  'lumbar spine': 'lumbar',
  'l-spine': 'lumbar',
  ls: 'lumbar',
  cervical: 'cervical',
  'cervical spine': 'cervical',
  'c-spine': 'cervical',
  neck: 'cervical',
  thoracic: 'thoracic',
  'thoracic spine': 'thoracic',
  't-spine': 'thoracic',
  'mid back': 'thoracic',
  sacroiliac: 'sacroiliac',
  si: 'sacroiliac',
  'si joint': 'sacroiliac',
  'sacroiliac joint': 'sacroiliac',
  knee: 'knee',
  shoulder: 'shoulder',
  hip: 'hip',
  wrist: 'wrist',
  ankle: 'ankle',
  elbow: 'elbow',
}

const VERTEBRAL_LEVEL_RE = /\b([CTL])\s*(\d{1,2})\s*[-–/]\s*(?:([CTLS])?\s*)?(\d{1,2})\b/gi
const SIMPLE_LEVEL_RE = /\b([CTL])\s*(\d{1,2})\b/gi

// Map a vertebral-level prefix letter (C/T/L/S) to a canonical spine region.
// Used so a label like "C5-C6" or "L5-S1" classifies even when the label
// carries no synonym keyword. Sacral prefix collapses to lumbar because the
// only realistic sacral injection target in this pipeline is L-S transitional
// (sacroiliac joint is a separate canonical region).
function regionFromVertebralPrefix(prefix: string): string | null {
  const p = prefix.toUpperCase()
  if (p === 'C') return 'cervical'
  if (p === 'T') return 'thoracic'
  if (p === 'L' || p === 'S') return 'lumbar'
  return null
}

export function normalizeRegion(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = raw
    .toLowerCase()
    .replace(/^(left|right|bilateral|bilat|both|lt\.?|rt\.?|l\.?|r\.?)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return null
  if (REGION_SYNONYMS[cleaned]) return REGION_SYNONYMS[cleaned]
  // Try keyword contains
  for (const [key, canonical] of Object.entries(REGION_SYNONYMS)) {
    if (cleaned.includes(key)) return canonical
  }
  // Fall back to vertebral-level prefix (e.g. "c5-c6" → cervical, "l5-s1"
  // → lumbar, "s1" → lumbar). Captures C/T/L/S level patterns.
  const levelMatch = cleaned.match(/\b([ctls])\s*\d{1,2}\b/i)
  if (levelMatch) {
    const region = regionFromVertebralPrefix(levelMatch[1])
    if (region) return region
  }
  return cleaned
}

// Derive the set of canonical regions implied by a sites[] array. Every site
// is normalized independently so a multi-region procedure (e.g. cervical +
// lumbar PRP in one session) classifies as covering both regions, instead of
// the legacy single-string injection_site collapsing into one bucket.
export function regionsFromSites(sites: ProcedureSite[]): Set<string> {
  const regions = new Set<string>()
  for (const site of sites) {
    const r = normalizeRegion(site.label)
    if (r) regions.add(r)
  }
  return regions
}

function extractLevels(text: string): string[] {
  const levels = new Set<string>()
  const multi = text.matchAll(VERTEBRAL_LEVEL_RE)
  for (const m of multi) {
    const prefix = m[1].toUpperCase()
    const endPrefix = (m[3] ?? prefix).toUpperCase()
    levels.add(`${prefix}${m[2]}-${endPrefix}${m[4]}`)
  }
  if (levels.size === 0) {
    const single = text.matchAll(SIMPLE_LEVEL_RE)
    for (const m of single) {
      levels.add(`${m[1].toUpperCase()}${m[2]}`)
    }
  }
  return [...levels]
}

function extractGuidanceHint(text: string): PlannedProcedure['guidance_hint'] {
  const t = text.toLowerCase()
  if (/\bfluoro(scopy|scopic)?\b/.test(t)) return 'fluoroscopy'
  if (/\bultrasound|\bus[- ]guided|sonograph/.test(t)) return 'ultrasound'
  if (/\blandmark|palpation-guided|blind technique/.test(t)) return 'landmark'
  return null
}

function extractLaterality(
  text: string,
): 'left' | 'right' | 'bilateral' | null {
  const t = text.toLowerCase()
  if (/\bbilateral\b|\bbilat\b|\bboth sides\b/.test(t)) return 'bilateral'
  if (/\b(left|lt\.?)\b/.test(t)) return 'left'
  if (/\b(right|rt\.?)\b/.test(t)) return 'right'
  return null
}

// Parse PM extraction treatment_plan items (structured jsonb array).
// Returns only items whose type == 'injection' or whose description
// clearly implies an injection (PRP, epidural, facet injection, etc.).
type PmPlanItem = {
  description?: string | null
  type?: string | null
  body_region?: string | null
}

function parsePmTreatmentPlan(
  raw: unknown,
): PlannedProcedure[] {
  if (!Array.isArray(raw)) return []
  const candidates: PlannedProcedure[] = []
  for (const item of raw as PmPlanItem[]) {
    if (!item || typeof item !== 'object') continue
    const type = (item.type ?? '').toLowerCase()
    const description = item.description ?? ''
    const descLower = description.toLowerCase()
    const looksLikeInjection =
      type === 'injection' ||
      /\bprp\b|\binject|epidural|facet block|nerve block|transforaminal|intradiscal/.test(
        descLower,
      )
    if (!looksLikeInjection) continue
    const region = normalizeRegion(item.body_region ?? null) ??
      normalizeRegion(description)
    candidates.push({
      source: 'pm_extraction',
      body_region: region,
      laterality: extractLaterality(description),
      guidance_hint: extractGuidanceHint(description),
      target_levels: extractLevels(description),
      raw_description: description,
    })
  }
  return candidates
}

// Parse the initial visit note treatment_plan narrative text. Free prose.
// We look for sentences mentioning PRP/injection, and pull body region +
// levels + guidance + laterality out of the sentence.
function parseInitialVisitTreatmentPlan(
  text: string | null | undefined,
): PlannedProcedure[] {
  if (!text || typeof text !== 'string') return []
  const candidates: PlannedProcedure[] = []
  const sentences = text.split(/(?<=[.!?])\s+/)
  for (const sentence of sentences) {
    const s = sentence.toLowerCase()
    if (!/\bprp\b|\binject|epidural|facet block|nerve block|transforaminal|intradiscal/.test(s)) {
      continue
    }
    const region = normalizeRegion(sentence)
    candidates.push({
      source: 'initial_visit_note',
      body_region: region,
      laterality: extractLaterality(sentence),
      guidance_hint: extractGuidanceHint(sentence),
      target_levels: extractLevels(sentence),
      raw_description: sentence.trim(),
    })
  }
  return candidates
}

// Pick the single best planned-procedure candidate for comparison against
// the performed technique. Preference order:
//   1. PM extraction candidate whose body_region is in the performed region set
//   2. Initial-visit candidate whose body_region is in the performed region set
//   3. First PM extraction candidate
//   4. First initial-visit candidate
function selectBestCandidate(
  pmCandidates: PlannedProcedure[],
  ivCandidates: PlannedProcedure[],
  performedRegions: Set<string>,
): PlannedProcedure | null {
  if (performedRegions.size > 0) {
    const pmMatch = pmCandidates.find(
      (c) => c.body_region && performedRegions.has(c.body_region),
    )
    if (pmMatch) return pmMatch
    const ivMatch = ivCandidates.find(
      (c) => c.body_region && performedRegions.has(c.body_region),
    )
    if (ivMatch) return ivMatch
  }
  if (pmCandidates.length > 0) return pmCandidates[0]
  if (ivCandidates.length > 0) return ivCandidates[0]
  return null
}

function computeMismatches(
  planned: PlannedProcedure,
  performed: PerformedInput,
  performedRegions: Set<string>,
  allMatchingPlans: PlannedProcedure[],
): PlanMismatch[] {
  const mismatches: PlanMismatch[] = []
  if (
    planned.body_region &&
    performedRegions.size > 0 &&
    !performedRegions.has(planned.body_region)
  ) {
    mismatches.push({
      field: 'body_region',
      planned: planned.body_region,
      performed: [...performedRegions].join(', '),
    })
  }
  // Derive performed laterality from sites[]. 'mixed' is incomparable —
  // treat as null so a multi-site mixed-laterality procedure does not fire
  // a laterality mismatch against a single-laterality plan.
  const performedLaterality = lateralityFromSites(performed.sites)
  const comparablePerformedLat =
    performedLaterality === 'mixed' ? null : performedLaterality
  if (
    planned.laterality &&
    comparablePerformedLat &&
    planned.laterality !== comparablePerformedLat
  ) {
    mismatches.push({
      field: 'laterality',
      planned: planned.laterality,
      performed: comparablePerformedLat,
    })
  }
  if (
    planned.guidance_hint &&
    performed.guidance_method &&
    planned.guidance_hint !== performed.guidance_method
  ) {
    mismatches.push({
      field: 'guidance_method',
      planned: planned.guidance_hint,
      performed: performed.guidance_method,
    })
  }
  // Target-level comparison uses the UNION of target_levels across all plan
  // candidates whose body_region is in the performed region set. A multi-
  // region procedure (e.g. cervical C5-C6 + lumbar L5-S1) draws levels from
  // both the cervical and lumbar plan sentences and only flags genuine extras.
  const plannedLevelsUnion = new Set<string>()
  for (const cand of allMatchingPlans) {
    for (const lvl of cand.target_levels) plannedLevelsUnion.add(lvl)
  }
  if (plannedLevelsUnion.size > 0 && performed.injection_site) {
    const performedLevels = extractLevels(performed.injection_site)
    if (performedLevels.length > 0) {
      const missing = [...plannedLevelsUnion].filter(
        (l) => !performedLevels.includes(l),
      )
      const extra = performedLevels.filter((l) => !plannedLevelsUnion.has(l))
      if (missing.length > 0 || extra.length > 0) {
        mismatches.push({
          field: 'target_levels',
          planned: [...plannedLevelsUnion].join(', ') || null,
          performed: performedLevels.join(', ') || null,
        })
      }
    }
  }
  return mismatches
}

export function computePlanAlignment(input: {
  performed: PerformedInput
  pmTreatmentPlan: unknown
  initialVisitTreatmentPlan: string | null | undefined
}): PlanAlignment {
  const pmCandidates = parsePmTreatmentPlan(input.pmTreatmentPlan)
  const ivCandidates = parseInitialVisitTreatmentPlan(
    input.initialVisitTreatmentPlan,
  )

  // Performed regions = union of regions from sites[]. Falls back to the
  // legacy injection_site string when sites[] is empty so existing rows
  // without a sites array still classify.
  const performedRegions =
    input.performed.sites.length > 0
      ? regionsFromSites(input.performed.sites)
      : (() => {
          const single = normalizeRegion(input.performed.injection_site)
          return single ? new Set([single]) : new Set<string>()
        })()

  if (pmCandidates.length === 0 && ivCandidates.length === 0) {
    return { status: 'no_plan_on_file', planned: null, mismatches: [] }
  }

  const planned = selectBestCandidate(pmCandidates, ivCandidates, performedRegions)
  if (!planned) {
    return { status: 'no_plan_on_file', planned: null, mismatches: [] }
  }

  // unplanned: plan exists on file, but no plan candidate shares any of the
  // performed body regions (and at least one performed region is known).
  const anyRegionMatch = [...pmCandidates, ...ivCandidates].some(
    (c) => c.body_region && performedRegions.has(c.body_region),
  )
  if (performedRegions.size > 0 && !anyRegionMatch) {
    return {
      status: 'unplanned',
      planned,
      mismatches: [
        {
          field: 'body_region',
          planned: planned.body_region,
          performed: [...performedRegions].join(', '),
        },
      ],
    }
  }

  const allMatchingPlans = [...pmCandidates, ...ivCandidates].filter(
    (c) => c.body_region && performedRegions.has(c.body_region),
  )
  const mismatches = computeMismatches(
    planned,
    input.performed,
    performedRegions,
    allMatchingPlans.length > 0 ? allMatchingPlans : [planned],
  )
  if (mismatches.length === 0) {
    return { status: 'aligned', planned, mismatches: [] }
  }
  return { status: 'deviation', planned, mismatches }
}
