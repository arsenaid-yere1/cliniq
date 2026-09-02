import type { PrpTargetEvidenceBundle, PrpTargetRecommendation } from './prp-target-evidence'

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function renderPrpTargetBlock(
  recommendations: PrpTargetRecommendation[],
  _evidence: PrpTargetEvidenceBundle,
): string {
  void _evidence
  if (recommendations.length === 0) return ''
  const bullets = recommendations.map((recommendation) => {
    const side = recommendation.laterality ? `${titleCase(recommendation.laterality)} ` : ''
    return `• ${side}${titleCase(recommendation.region)} at ${recommendation.level_or_location}: ${recommendation.guidance_method}-guided ${recommendation.approach} PRP targeting ${recommendation.target_structure}.`
  })
  return `PRP INJECTION TARGETS:\n${bullets.join('\n')}`
}

export function renderPrpTreatmentPlan(
  narrative: string,
  recommendations: PrpTargetRecommendation[],
  evidence: PrpTargetEvidenceBundle,
): string {
  const targetBlock = renderPrpTargetBlock(recommendations, evidence)
  const trimmed = narrative.trim()
  if (!targetBlock) return trimmed
  return trimmed ? `${targetBlock}\n\n${trimmed}` : targetBlock
}

export function stripPrpTargetBlock(text: string): string {
  const trimmed = text.trim()
  if (!/^(PRP INJECTION TARGETS|EVIDENCE-BACKED PRP TARGETS|PRP TARGET ASSESSMENT):/i.test(trimmed)) return trimmed
  const separator = trimmed.indexOf('\n\n')
  return separator === -1 ? '' : trimmed.slice(separator + 2).trim()
}
