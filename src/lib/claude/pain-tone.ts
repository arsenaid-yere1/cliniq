export type PainToneLabel = 'baseline' | 'improved' | 'stable' | 'worsened'

export function computePainToneLabel(
  currentPainMax: number | null,
  priorPainMax: number | null,
): PainToneLabel {
  if (currentPainMax == null || priorPainMax == null) return 'baseline'
  const delta = currentPainMax - priorPainMax
  if (delta <= -2) return 'improved'
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
