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

export type ChiroProgress = 'improving' | 'stable' | 'plateauing' | 'worsening' | null

export function deriveChiroProgress(functionalOutcomes: unknown): ChiroProgress {
  if (!functionalOutcomes || typeof functionalOutcomes !== 'object') return null
  const status = (functionalOutcomes as { progress_status?: unknown }).progress_status
  if (status === 'improving' || status === 'stable' || status === 'plateauing' || status === 'worsening') {
    return status
  }
  return null
}
