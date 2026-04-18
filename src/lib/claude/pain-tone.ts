export type PainToneLabel = 'baseline' | 'improved' | 'stable' | 'worsened'

export function computePainToneLabel(
  currentPainMax: number | null,
  priorPainMax: number | null,
): PainToneLabel {
  // Thresholds are asymmetric on purpose: "improved" requires a clinically
  // meaningful drop (≥3 points) because a 2-point drop on a high-severity
  // baseline (e.g. 9→7) still leaves the patient in moderate-severe pain and
  // the physical exam reads persistence-leaning; forcing "improved" tone on
  // that case produces output that contradicts the exam. "worsened" keeps the
  // ±2 threshold because any 2-point increase is reliably a negative signal.
  if (currentPainMax == null || priorPainMax == null) return 'baseline'
  const delta = currentPainMax - priorPainMax
  if (delta <= -3) return 'improved'
  if (delta >= 2) return 'worsened'
  return 'stable'
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
