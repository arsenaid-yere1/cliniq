import type { PrpTargetEvidenceBundle, PrpTargetRecommendation } from './prp-target-evidence'
import { isSpineRegion } from './anatomic-normalization'

const TARGET_MARKER = '[[PRP_TARGET_RECOMMENDATIONS]]'
const TARGET_INTRO = 'Given the incomplete response to conservative measures, I am recommending a series of Platelet-Rich Plasma (PRP) injections targeting the following regions:'
const TARGET_FOLLOW_UP = 'Treatment will proceed in stages, with reassessment of pain, function, examination findings, and tolerance after each injection. Any additional injection is not predetermined and will require documented continued medical necessity and renewed informed consent.'

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function renderPrpTargetBlock(
  recommendations: PrpTargetRecommendation[],
  evidence: PrpTargetEvidenceBundle,
): string {
  if (recommendations.length === 0) return ''
  const evidenceById = new Map(evidence.anatomic_evidence.map((item) => [item.id, item]))
  const groups = new Map<string, PrpTargetRecommendation[]>()
  for (const recommendation of recommendations) {
    const key = `${recommendation.region}|${recommendation.laterality ?? ''}`
    groups.set(key, [...(groups.get(key) ?? []), recommendation])
  }
  const bullets = [...groups.values()].map((group) => {
    const first = group[0]
    const side = first.laterality ? `${titleCase(first.laterality)} ` : ''
    const label = `${side}${titleCase(first.region)}${isSpineRegion(first.region) ? ' Spine' : ''}`
    const locations = [...new Set(group.map((item) => item.level_or_location))]
    const descriptions = [...new Set(group.flatMap((item) => item.anatomic_evidence_ids)
      .map((id) => evidenceById.get(id)?.description).filter((value): value is string => Boolean(value)))]
    const locationText = locations.length === 1 ? locations[0] : `${locations.slice(0, -1).join(', ')} and ${locations.at(-1)}`
    const pathologyText = descriptions.join('; ')
    if (isSpineRegion(first.region)) {
      return `• ${label}: Ultrasound-guided PRP injections at ${locationText} targeting the documented pain generators at ${locations.length === 1 ? 'this level' : 'these levels'}, where ${pathologyText} ${descriptions.length === 1 ? 'is' : 'are'} documented and clinically concordant.`
    }
    return `• ${label}: Ultrasound-guided PRP injection targeting the documented ${pathologyText} at ${locationText}, which is clinically concordant.`
  })
  return `${TARGET_INTRO}\n${bullets.join('\n')}\n${TARGET_FOLLOW_UP}`
}

export function renderPrpTreatmentPlan(
  narrative: string,
  recommendations: PrpTargetRecommendation[],
  evidence: PrpTargetEvidenceBundle,
): string {
  const targetBlock = renderPrpTargetBlock(recommendations, evidence)
  const trimmed = stripPrpTargetBlock(narrative)
  if (trimmed.includes(TARGET_MARKER)) {
    return trimmed.replace(TARGET_MARKER, targetBlock).replace(/\n{3,}/g, '\n\n').trim()
  }
  if (!targetBlock) return trimmed
  const firstBreak = trimmed.indexOf('\n\n')
  return firstBreak === -1
    ? `${trimmed}\n\n${targetBlock}`.trim()
    : `${trimmed.slice(0, firstBreak)}\n\n${targetBlock}\n\n${trimmed.slice(firstBreak + 2)}`.trim()
}

export function stripPrpTargetBlock(text: string): string {
  const trimmed = text.trim()
  const newStart = trimmed.indexOf(TARGET_INTRO)
  if (newStart !== -1) {
    const followUpStart = trimmed.indexOf(TARGET_FOLLOW_UP, newStart)
    if (followUpStart !== -1) {
      return `${trimmed.slice(0, newStart)}${trimmed.slice(followUpStart + TARGET_FOLLOW_UP.length)}`
        .replace(/\n{3,}/g, '\n\n').trim()
    }
  }
  if (!/^(PRP INJECTION TARGETS|EVIDENCE-BACKED PRP TARGETS|PRP TARGET ASSESSMENT):/i.test(trimmed)) return trimmed
  const separator = trimmed.indexOf('\n\n')
  return separator === -1 ? '' : trimmed.slice(separator + 2).trim()
}
