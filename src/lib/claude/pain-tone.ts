export type PainToneLabel = 'baseline' | 'improved' | 'stable' | 'worsened'

/**
 * Compares `currentPainMax` to a `referencePainMax` anchor and returns a
 * four-way tone label. Callers choose the anchor:
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
 */
export function computePainToneLabel(
  currentPainMax: number | null,
  referencePainMax: number | null,
): PainToneLabel {
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
 * Both signals use `computePainToneLabel` with the same thresholds. Callers are
 * responsible for picking the right reference anchor for each.
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
