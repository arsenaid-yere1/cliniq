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
  // Days since the trajectory anchor date (intake > first procedure >
  // null). Null when neither the anchor nor this entry has a usable date.
  // Populated by the builder; never edited post-hoc.
  dayOffset: number | null
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
  // Date of today's discharge follow-up visit (ISO YYYY-MM-DD). Used to
  // compute the dayOffset on the synthetic discharge entry so the arrow
  // chain can render "(day N)" on the trailing segment. Optional to
  // preserve back-compat with callers that do not yet thread visitDate.
  visitDate?: string | null
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
    dayOffset: null,
  }
}

// Parse an ISO date-or-datetime string into a UTC day number (ms / 86400000
// floored). Returns null on any parse failure so downstream math skips the
// entry instead of crashing. Truncating to UTC day avoids timezone drift
// when an intake row was stored with a local-time datetime and a procedure
// row was stored as a YYYY-MM-DD string.
function parseDateToUtcDay(raw: string | null | undefined): number | null {
  if (!raw) return null
  const d = new Date(raw)
  const ms = d.getTime()
  if (!Number.isFinite(ms)) return null
  return Math.floor(ms / 86_400_000)
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
        dayOffset: null,
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
      dayOffset: null,
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
        dayOffset: null,
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
        dayOffset: null,
      }
      dischargeEstimated = true
    }
  }

  // Stamp the discharge entry with today's visitDate so the day-offset pass
  // can annotate it. The discharge entry has no DB date of its own (it
  // represents the current visit), so callers that want a day-axis label
  // must supply visitDate.
  if (dischargeEntry && input.visitDate) {
    dischargeEntry.date = input.visitDate
  }

  const entries: TimelineEntry[] = []
  if (intakeEntry) entries.push(intakeEntry)
  entries.push(...procEntries)
  if (dischargeEntry) entries.push(dischargeEntry)

  // Anchor for the time axis: the EARLIEST parseable date among intake +
  // first procedure. Using min() (rather than "intake if present else
  // first proc") guarantees non-negative dayOffsets even when the intake
  // vitals row was back-entered with a clinical visit_date later than
  // the first procedure, or when the initial_visit_notes.visit_date
  // happens to be wrong relative to the procedure order. Day labels
  // only render when the caller supplies visitDate AND an anchor date
  // is derivable.
  const candidateAnchors = input.visitDate
    ? [intakeEntry?.date ?? null, procEntries[0]?.date ?? null]
        .map(parseDateToUtcDay)
        .filter((d): d is number => d != null)
    : []
  const anchorDay = candidateAnchors.length > 0 ? Math.min(...candidateAnchors) : null
  if (anchorDay != null) {
    for (const e of entries) {
      const day = parseDateToUtcDay(e.date)
      if (day != null) e.dayOffset = day - anchorDay
    }
  }

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

  // Date-label helpers — render natural medical-legal date strings
  // ("January 3, 2026", "Jun 4 – Sep 8, 2026") rather than engineering
  // "(day N)" offsets in the arrow-chain prose. The dayOffset column in
  // the Pain Timeline table still carries the numeric day axis for the
  // chart-style readout; the narrative stays in deposition-grade voice.
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const formatLongDate = (raw: string | null | undefined): string | null => {
    if (!raw) return null
    const d = new Date(raw)
    if (!Number.isFinite(d.getTime())) return null
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
  }
  const formatShortDate = (raw: string | null | undefined): string | null => {
    if (!raw) return null
    const d = new Date(raw)
    if (!Number.isFinite(d.getTime())) return null
    return `${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
  }
  // Date annotations only render when the caller opted into the time-
  // axis pipeline via visitDate. This preserves backward compatibility
  // for callers (and historical tests) that do not thread visitDate —
  // those see the pre-R9 "arrow chain only" format.
  const emitDateLabels = !!input.visitDate
  const dateLabel = (entry: TimelineEntry | null | undefined): string => {
    if (!emitDateLabels) return ''
    const label = formatLongDate(entry?.date ?? null)
    return label ? ` (${label})` : ''
  }
  const dateRangeLabel = (firstEntry: TimelineEntry | null | undefined, lastEntry: TimelineEntry | null | undefined): string => {
    if (!emitDateLabels) return ''
    if (!firstEntry || !lastEntry) return ''
    const first = formatShortDate(firstEntry.date)
    const last = formatShortDate(lastEntry.date)
    if (!first || !last) return ''
    if (first === last) return ` (${first})`
    return ` (${first} – ${last})`
  }

  let arrowChain = ''
  // Build chain in segments: intake → procedures → discharge. Each segment
  // is optional; joiners adapt to which segments are present. Date
  // annotations appear only when an entry has a parseable date.
  const segments: string[] = []
  if (intakeDisplay) {
    segments.push(`${intakeDisplay} at initial evaluation${dateLabel(intakeEntry)}`)
  }
  if (proceduresChain) {
    const firstProc = renderedProcEntries[0]
    const lastProc = renderedProcEntries[renderedProcEntries.length - 1]
    const rangeLabel = renderedProcEntries.length > 1
      ? dateRangeLabel(firstProc, lastProc)
      : dateLabel(firstProc)
    segments.push(`${proceduresChain} across the injection series${rangeLabel}`)
  }
  if (dischargeDisplay) {
    segments.push(`${dischargeDisplay} at today's discharge evaluation${dateLabel(dischargeEntry)}`)
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
