// Deterministic discharge-note pain-trajectory builder.
//
// Phase-1 of the discharge pain-timeline precision work. Moves the
// arrow-chain assembly and the "-2 from latest procedure" discharge-endpoint
// fabrication out of the LLM prompt and into TypeScript so the output is
// reproducible, audit-persistable, and numerically consistent with the
// structured source data.
//
// No I/O. Pure functions. Called by `gatherDischargeNoteSourceData` in
// `src/actions/discharge-notes.ts`; the returned `DischargePainTrajectory`
// is included in `DischargeNoteInputData` and instructs the LLM to render
// the arrow chain + endpoint number verbatim.

export type TimelineSource = 'procedure' | 'discharge_vitals' | 'discharge_estimate'

export interface TimelineEntry {
  date: string | null
  label: string
  min: number | null
  max: number | null
  source: TimelineSource
  estimated: boolean
}

export interface DischargePainTrajectory {
  entries: TimelineEntry[]
  arrowChain: string
  baselineDisplay: string | null
  dischargeDisplay: string | null
  dischargeEntry: TimelineEntry | null
  dischargeEstimated: boolean
}

export interface ProcedureVitalsEntry {
  procedure_date: string
  procedure_number: number
  pain_score_min: number | null
  pain_score_max: number | null
}

export interface BuildTrajectoryInput {
  procedures: ProcedureVitalsEntry[]
  latestVitals: { pain_score_min: number | null; pain_score_max: number | null } | null
  dischargeVitals: { pain_score_min: number | null; pain_score_max: number | null } | null
  baselinePain: { procedure_date: string; pain_score_min: number | null; pain_score_max: number | null } | null
  overallPainTrend: 'baseline' | 'improved' | 'stable' | 'worsened'
  finalIntervalWorsened: boolean
}

export function formatPainValue(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null
  if (min == null) return `${max}/10`
  if (max == null) return `${min}/10`
  if (min === max) return `${min}/10`
  return `${min}-${max}/10`
}

// Apply the -2 rule with floor-at-0 to both bounds. When `min` is null but
// `max` is present, the result has a null min and a floored max. When both
// are null, returns { min: null, max: null }.
export function estimateDischargeFromLatest(
  latestMin: number | null,
  latestMax: number | null,
): { min: number | null; max: number | null } {
  const floor = (n: number | null): number | null => {
    if (n == null) return null
    return Math.max(0, n - 2)
  }
  return { min: floor(latestMin), max: floor(latestMax) }
}

function procedureEntryFromVitals(p: ProcedureVitalsEntry): TimelineEntry {
  return {
    date: p.procedure_date,
    label: `procedure ${p.procedure_number}`,
    min: p.pain_score_min,
    max: p.pain_score_max,
    source: 'procedure',
    estimated: false,
  }
}

function hasValue(entry: TimelineEntry): boolean {
  return entry.min != null || entry.max != null
}

export function buildDischargePainTrajectory(
  input: BuildTrajectoryInput,
): DischargePainTrajectory {
  const procEntries: TimelineEntry[] = input.procedures.map(procedureEntryFromVitals)

  // Endpoint determination mirrors the prompt rules in priority order:
  // 1) dischargeVitals non-null → verbatim endpoint (not estimated)
  // 2) finalIntervalWorsened OR overallPainTrend in {'stable','worsened'}
  //    → latestVitals verbatim (not estimated; suppresses -2)
  // 3) else → latestVitals -2 (estimated)
  // 4) no anchor → null endpoint
  let dischargeEntry: TimelineEntry | null = null
  let dischargeEstimated = false

  const hasDischargeVitals =
    input.dischargeVitals != null &&
    (input.dischargeVitals.pain_score_min != null || input.dischargeVitals.pain_score_max != null)

  if (hasDischargeVitals) {
    dischargeEntry = {
      date: null,
      label: "today's discharge evaluation",
      min: input.dischargeVitals!.pain_score_min,
      max: input.dischargeVitals!.pain_score_max,
      source: 'discharge_vitals',
      estimated: false,
    }
  } else if (input.latestVitals != null && (input.latestVitals.pain_score_min != null || input.latestVitals.pain_score_max != null)) {
    const suppressFabrication =
      input.finalIntervalWorsened ||
      input.overallPainTrend === 'stable' ||
      input.overallPainTrend === 'worsened'

    if (suppressFabrication) {
      dischargeEntry = {
        date: null,
        label: "today's discharge evaluation",
        min: input.latestVitals.pain_score_min,
        max: input.latestVitals.pain_score_max,
        source: 'discharge_vitals',
        estimated: false,
      }
    } else {
      const est = estimateDischargeFromLatest(input.latestVitals.pain_score_min, input.latestVitals.pain_score_max)
      dischargeEntry = {
        date: null,
        label: "today's discharge evaluation",
        min: est.min,
        max: est.max,
        source: 'discharge_estimate',
        estimated: true,
      }
      dischargeEstimated = true
    }
  }

  const entries: TimelineEntry[] = [...procEntries]
  if (dischargeEntry) entries.push(dischargeEntry)

  // Arrow chain — only procedures with values contribute to the chain. The
  // discharge endpoint is rendered as a trailing clause so a mid-series null
  // procedure is surfaced as a gap (omitted) rather than disabling the whole
  // string.
  const renderedProcEntries = procEntries.filter(hasValue)
  const proceduresChain = renderedProcEntries
    .map((e) => formatPainValue(e.min, e.max))
    .filter((s): s is string => s != null)
    .join(' → ')

  const dischargeDisplay = dischargeEntry ? formatPainValue(dischargeEntry.min, dischargeEntry.max) : null

  let arrowChain = ''
  if (proceduresChain && dischargeDisplay) {
    arrowChain = `${proceduresChain} across the injection series, ${dischargeDisplay} at today's discharge evaluation`
  } else if (proceduresChain) {
    arrowChain = `${proceduresChain} across the injection series`
  } else if (dischargeDisplay) {
    // Procedures had no recorded pain but discharge/latest vitals exist. Still
    // useful as a single anchor.
    arrowChain = `${dischargeDisplay} at today's discharge evaluation`
  }

  const baselineDisplay = input.baselinePain
    ? formatPainValue(input.baselinePain.pain_score_min, input.baselinePain.pain_score_max)
    : null

  return {
    entries,
    arrowChain,
    baselineDisplay,
    dischargeDisplay,
    dischargeEntry,
    dischargeEstimated,
  }
}
