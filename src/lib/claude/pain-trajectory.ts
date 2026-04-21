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

export type TimelineSource = 'intake' | 'procedure' | 'discharge_vitals' | 'discharge_estimate'

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
  // Preferred "initial evaluation" anchor for assessment prose. Uses
  // intakePain when its pain_score_max is non-null; falls back to
  // baselinePain (first-procedure vitals) otherwise. Null when neither
  // anchor has a value.
  baselineDisplay: string | null
  // The actual source the baselineDisplay came from. 'intake' when the
  // intake vitals anchored it, 'procedure' when it fell back to
  // baselinePain, null when no anchor.
  baselineSource: 'intake' | 'procedure' | null
  // Intake-specific display. Always reads intakePain directly. Null when
  // intakePain or its pain_score_max is null.
  intakePainDisplay: string | null
  // First-procedure-specific display. Always reads baselinePain directly.
  // Null when baselinePain or its pain_score_max is null.
  firstProcedurePainDisplay: string | null
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
  intakePain: { recorded_at: string | null; pain_score_min: number | null; pain_score_max: number | null } | null
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

  // Intake entry leads the timeline when intakePain carries a numeric
  // reading. When intakePain is null or empty the chain starts at the
  // first procedure.
  const intakeHasValue =
    input.intakePain != null &&
    (input.intakePain.pain_score_min != null || input.intakePain.pain_score_max != null)
  const intakeEntry: TimelineEntry | null = intakeHasValue
    ? {
        date: input.intakePain!.recorded_at,
        label: 'initial evaluation',
        min: input.intakePain!.pain_score_min,
        max: input.intakePain!.pain_score_max,
        source: 'intake',
        estimated: false,
      }
    : null

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

  const entries: TimelineEntry[] = []
  if (intakeEntry) entries.push(intakeEntry)
  entries.push(...procEntries)
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

  const intakeDisplay = intakeEntry ? formatPainValue(intakeEntry.min, intakeEntry.max) : null

  let arrowChain = ''
  // Build chain in segments: intake → procedures → discharge. Each segment
  // is optional; joiners adapt to which segments are present.
  const segments: string[] = []
  if (intakeDisplay) {
    segments.push(`${intakeDisplay} at initial evaluation`)
  }
  if (proceduresChain) {
    segments.push(`${proceduresChain} across the injection series`)
  }
  if (dischargeDisplay) {
    segments.push(`${dischargeDisplay} at today's discharge evaluation`)
  }
  if (segments.length > 0) {
    arrowChain = segments.join(', ')
  }

  const firstProcedurePainDisplay = input.baselinePain
    ? formatPainValue(input.baselinePain.pain_score_min, input.baselinePain.pain_score_max)
    : null

  // Preferred baseline anchor: intake first, first-procedure reading as
  // fallback. The "source" field tells the caller which one was picked.
  let baselineDisplay: string | null = null
  let baselineSource: 'intake' | 'procedure' | null = null
  if (intakeDisplay) {
    baselineDisplay = intakeDisplay
    baselineSource = 'intake'
  } else if (firstProcedurePainDisplay) {
    baselineDisplay = firstProcedurePainDisplay
    baselineSource = 'procedure'
  }

  return {
    entries,
    arrowChain,
    baselineDisplay,
    baselineSource,
    intakePainDisplay: intakeDisplay,
    firstProcedurePainDisplay,
    dischargeDisplay,
    dischargeEntry,
    dischargeEstimated,
  }
}
