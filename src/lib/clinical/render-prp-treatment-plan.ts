import type { PrpTargetEvidenceBundle, PrpTargetRecommendation } from './prp-target-evidence'

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatStudyDate(value: string | null): string {
  if (!value) return ''
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  return match ? `${match[2]}/${match[3]}/${match[1]}` : value
}

export function renderPrpTargetBlock(
  recommendations: PrpTargetRecommendation[],
  evidence: PrpTargetEvidenceBundle,
): string {
  if (recommendations.length === 0) {
    return 'PRP TARGET ASSESSMENT:\nNo PRP treatment target is established from the currently documented anatomic abnormalities and current clinical findings. Continue non-interventional care and further evaluation as clinically indicated.'
  }
  const anatomyById = new Map(evidence.anatomic_evidence.map((item) => [item.id, item]))
  const clinicalById = new Map(evidence.clinical_evidence.map((item) => [item.id, item]))
  const bullets = recommendations.map((recommendation) => {
    const anatomy = recommendation.anatomic_evidence_ids.map((id) => anatomyById.get(id)).filter(Boolean)
    const clinical = recommendation.clinical_evidence_ids.map((id) => clinicalById.get(id)).filter(Boolean)
    const anatomyText = anatomy.map((item) => `${item!.modality}${item!.study_date ? ` ${formatStudyDate(item!.study_date)}` : ''}: ${item!.description}`).join('; ')
    const clinicalText = clinical.map((item) => item!.description).join('; ')
    const side = recommendation.laterality ? `${titleCase(recommendation.laterality)} ` : ''
    return `• ${side}${recommendation.level_or_location} (${titleCase(recommendation.region)}): ${recommendation.guidance_method}-guided ${recommendation.approach} PRP targeting ${recommendation.target_structure}. Anatomic abnormality — ${anatomyText}. Clinical target justification — ${clinicalText}. ${recommendation.clinical_rationale}`
  })
  return `EVIDENCE-BACKED PRP TARGETS:\n${bullets.join('\n')}`
}

export function renderPrpTreatmentPlan(
  narrative: string,
  recommendations: PrpTargetRecommendation[],
  evidence: PrpTargetEvidenceBundle,
): string {
  const targetBlock = renderPrpTargetBlock(recommendations, evidence)
  const trimmed = narrative.trim()
  return trimmed ? `${targetBlock}\n\n${trimmed}` : targetBlock
}

export function stripPrpTargetBlock(text: string): string {
  const trimmed = text.trim()
  if (!/^(EVIDENCE-BACKED PRP TARGETS|PRP TARGET ASSESSMENT):/i.test(trimmed)) return trimmed
  const separator = trimmed.indexOf('\n\n')
  return separator === -1 ? '' : trimmed.slice(separator + 2).trim()
}
