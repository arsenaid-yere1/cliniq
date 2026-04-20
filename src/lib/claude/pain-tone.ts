export type PainToneLabel =
  | 'baseline'        // first in series / no prior procedure exists
  | 'missing_vitals'  // prior procedure exists but its pain_score_max is null
  | 'improved'
  | 'stable'
  | 'worsened'

/**
 * Context for the reference anchor. Distinguishes the three null-reference causes:
 * - 'no_prior': there is no prior procedure. Current → 'baseline'.
 * - 'prior_with_vitals': prior procedure exists and has a pain_score_max.
 *   Delta math applies.
 * - 'prior_missing_vitals': prior procedure exists but its vitals row is missing
 *   or pain_score_max is null. Distinct from 'no_prior' — the note is NOT first
 *   in the series; the data is just incomplete. Returns 'missing_vitals' so the
 *   prompt can flag the data gap rather than silently describe the visit as
 *   first-in-series.
 */
export type PainToneContext = 'no_prior' | 'prior_with_vitals' | 'prior_missing_vitals'

/**
 * Compares `currentPainMax` to a `referencePainMax` anchor and returns a
 * five-way tone label. Callers choose the anchor AND the context:
 * - Procedure-note generation passes the FIRST procedure's pain_score_max
 *   (the series baseline) so cumulative progress across multiple injections
 *   earns the "improved" label.
 * - Discharge-note generation passes baselinePain.pain_score_max (same
 *   semantics — first procedure in the series).
 *
 * Thresholds are asymmetric on purpose: "improved" requires a clinically
 * meaningful drop (≥3 points) because a 2-point drop on a high-severity
 * baseline (e.g. 9→7) still leaves the patient in moderate-severe pain and
 * the physical exam reads persistence-leaning; forcing "improved" tone on
 * that case produces output that contradicts the exam. "worsened" keeps the
 * ±2 threshold because any 2-point increase is reliably a negative signal.
 *
 * When `context === 'prior_missing_vitals'` the function returns
 * 'missing_vitals' regardless of the numeric inputs — data-gap signalling
 * takes precedence over delta math.
 *
 * `context` defaults to 'no_prior' to preserve legacy behavior (any null
 * input → 'baseline') for call sites that haven't migrated yet.
 */
export function computePainToneLabel(
  currentPainMax: number | null,
  referencePainMax: number | null,
  context: PainToneContext = 'no_prior',
): PainToneLabel {
  if (context === 'prior_missing_vitals') return 'missing_vitals'
  if (currentPainMax == null || referencePainMax == null) return 'baseline'
  const delta = currentPainMax - referencePainMax
  if (delta <= -3) return 'improved'
  if (delta >= 2) return 'worsened'
  return 'stable'
}

/**
 * Two-signal pain tone payload passed to AI generators.
 * - vsBaseline: current pain vs the FIRST procedure in the series (cumulative arc).
 * - vsPrevious: current pain vs the IMMEDIATELY PREVIOUS procedure (per-session change).
 *   Null when no prior procedure exists (first in series).
 *
 * Either signal may be 'missing_vitals' when the respective reference
 * procedure exists on the chart but its vitals row is absent or its
 * pain_score_max is null. Prompt branching must treat 'missing_vitals'
 * distinctly from 'baseline'.
 *
 * Both signals use `computePainToneLabel` with the same thresholds. Callers are
 * responsible for picking the right reference anchor AND the right context.
 */
export type PainToneSignals = {
  vsBaseline: PainToneLabel
  vsPrevious: PainToneLabel | null
}

/**
 * Volatility classification for a full procedure pain_score_max series.
 * Endpoints-only signals (vsBaseline / vsPrevious) miss mid-series regressions;
 * this label surfaces them. Used exclusively by discharge generation today.
 *
 * - 'monotone_improved': every consecutive delta ≤ 0 AND at least one delta < 0.
 * - 'monotone_worsened': every consecutive delta ≥ 0 AND at least one delta > 0.
 * - 'monotone_stable':   every consecutive delta is 0 (flat series).
 * - 'mixed_with_regression': any consecutive delta ≥ +2 (the worsened threshold
 *   from computePainToneLabel). Signals an intra-series regression even when
 *   endpoints suggest improvement — e.g. 9 → 5 → 7 → 3.
 * - 'insufficient_data': fewer than 2 non-null pain scores in the series.
 */
export type SeriesVolatility =
  | 'monotone_improved'
  | 'monotone_stable'
  | 'monotone_worsened'
  | 'mixed_with_regression'
  | 'insufficient_data'

/**
 * Scans a pain_score_max series in chronological order and classifies its
 * volatility. Any null entry collapses the classification to
 * 'insufficient_data' because the series cannot be fully scanned — partial
 * classification would be misleading.
 */
export function computeSeriesVolatility(
  painSeries: Array<number | null>,
): SeriesVolatility {
  if (painSeries.length < 2) return 'insufficient_data'
  if (painSeries.some((p) => p == null)) return 'insufficient_data'
  const series = painSeries as number[]

  let anyDrop = false
  let anyRise = false
  let anyRegression = false // any ≥+2 rise

  for (let i = 1; i < series.length; i++) {
    const delta = series[i] - series[i - 1]
    if (delta < 0) anyDrop = true
    if (delta > 0) anyRise = true
    if (delta >= 2) anyRegression = true
  }

  // "mixed_with_regression" is reserved for a non-monotone series that
  // contains at least one ≥+2 rise. A strictly non-decreasing series is
  // "monotone_worsened" even when every delta is ≥+2 — the rise is the whole
  // story, not an unexpected regression.
  if (anyRegression && anyDrop) return 'mixed_with_regression'
  if (!anyRise && anyDrop) return 'monotone_improved'
  if (!anyDrop && anyRise) return 'monotone_worsened'
  return 'monotone_stable'
}

export type ChiroProgress = 'improving' | 'stable' | 'plateauing' | 'worsening' | null

export function deriveChiroProgress(functionalOutcomes: unknown): ChiroProgress {
  if (!functionalOutcomes || typeof functionalOutcomes !== 'object') return null
  const status = (functionalOutcomes as { progress_status?: unknown }).progress_status
  if (status === 'improving' || status === 'stable' || status === 'plateauing' || status === 'worsening') {
    return status
  }
  return null
}
