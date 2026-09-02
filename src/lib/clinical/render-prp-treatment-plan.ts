import type { PrpTargetEvidenceBundle, PrpTargetRecommendation } from './prp-target-evidence'
import { isSpineRegion } from './anatomic-normalization'

const TARGET_MARKER = '[[PRP_TARGET_RECOMMENDATIONS]]'
const TARGET_INTRO = 'Given the incomplete response to conservative measures, I am recommending a series of Platelet-Rich Plasma (PRP) injections targeting the following regions:'
const TARGET_FOLLOW_UP = 'An initial staged course of one to three injection sessions is planned. The patient will be re-evaluated after each injection; extension beyond the initial stage will occur only if the documented response and persistent functional impairment support additional treatment.'

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function joinClinicalList(values: string[]): string {
  if (values.length <= 1) return values[0] ?? ''
  return `${values.slice(0, -1).join(', ')} and ${values.at(-1)}`
}

function spineTargetSummary(descriptions: string[]): string {
  const text = descriptions.join(' ').toLowerCase()
  const hasDiscPathology = /disc|annular|herniat|protrusion|extrusion/.test(text)
  const hasFacetPathology = /facet|apophyseal|uncovertebral/.test(text)
  const target = hasDiscPathology && hasFacetPathology
    ? 'the facet-mediated and discogenic pain generators'
    : hasDiscPathology
      ? 'the discogenic pain generators'
      : hasFacetPathology
        ? 'the facet-mediated pain generators'
        : 'the clinically concordant pain generators'
  const support = hasDiscPathology && /foraminal narrowing|foraminal stenosis/.test(text)
    ? 'the most significant disc pathology and foraminal narrowing are documented'
    : hasDiscPathology
      ? 'the corresponding disc pathology is documented'
      : hasFacetPathology
        ? 'the corresponding facet pathology is documented'
        : 'the corresponding structural abnormalities are documented'
  return `${target}|${support}`
}

function nonSpineTargetSummary(region: string, locations: string[], descriptions: string[]): string {
  const text = descriptions.join(' ').toLowerCase()
  if (region === 'shoulder') {
    const targets: string[] = []
    if (/rotator cuff|supraspinatus|infraspinatus/.test(text)) {
      targets.push(/tear/.test(text) ? 'the rotator cuff tear' : 'the rotator cuff tendinopathy')
    }
    if (/subacromial|subdeltoid|burs/.test(text)) targets.push('the subacromial/subdeltoid bursa')
    if (/biceps|bicipital/.test(text)) targets.push('the biceps tendon sheath')
    if (/glenohumeral/.test(text)) targets.push('the glenohumeral joint')
    if (targets.length) return joinClinicalList(targets)
  }
  return joinClinicalList(locations.map((location) => `the documented ${location}`))
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
    const locationText = joinClinicalList(locations)
    if (isSpineRegion(first.region)) {
      const [targetText, supportText] = spineTargetSummary(descriptions).split('|')
      return `• ${label}: Ultrasound-guided PRP injections at ${locationText} targeting ${targetText} at ${locations.length === 1 ? 'this level' : 'these levels'}, where ${supportText}.`
    }
    return `• ${label}: Ultrasound-guided PRP injection targeting ${nonSpineTargetSummary(first.region, locations, descriptions)}.`
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
