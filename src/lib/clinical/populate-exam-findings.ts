import type { ChiefComplaintEntry, ProviderIntakeValues } from '@/lib/validations/initial-visit-note'
import { getExamRegion, normalizeExamText } from './exam-finding-examples'

type Findings = ProviderIntakeValues['exam_findings']

function area(raw: string) {
  const name = raw.trim().replace(/\s+pain$/i, '')
  const match = name.match(/^(left|lt|l|right|rt|r|bilateral|bilat|both)\.?\s+/i)
  const token = match?.[1].toLowerCase()
  const side = !token ? '' : ['left', 'lt', 'l'].includes(token) ? 'Left'
    : ['right', 'rt', 'r'].includes(token) ? 'Right' : 'Bilateral'
  const known = getExamRegion(name)
  const label = known ? `${side ? `${side} ` : ''}${known.label}` : name
  return { key: known ? `${side}:${known.key}` : normalizeExamText(name), label, known, side }
}

function painLevel(complaint: ChiefComplaintEntry): number | null {
  const { severity_min: min, severity_max: max } = complaint
  if ([min, max].some(n => n !== null && (!Number.isInteger(n) || n < 0 || n > 10)) ||
    (min !== null && max !== null && min > max)) {
    throw new Error('Check Chief Complaints pain levels: use 0–10, with minimum no greater than maximum.')
  }
  return max ?? min
}

// Illustrative templates only: scores select wording, never recorded assessment
// states, test outcomes, or measured range of motion.
function paragraphs(region: ReturnType<typeof area>, score: number | null) {
  if (score === null || score === 0) return { palpation: '', additional: null }
  const degree = score <= 3 ? 'Mild' : score <= 6 ? 'Moderate' : 'Marked'
  const sites: Record<string, string> = {
    cervical: 'cervical paraspinal muscles, upper trapezius, and levator scapulae',
    thoracic: 'thoracic paraspinal and periscapular muscles',
    lumbar: 'lumbar paraspinal muscles',
  }
  const site = region.known && sites[region.known.key]
  const location = site ? `${region.side ? `${region.side.toLowerCase()} ` : ''}${site}` : region.label.toLowerCase()
  return {
    palpation: `${degree} tenderness over the ${location}.`,
    additional: score <= 3
      ? `Mild discomfort with movement of the ${region.label.toLowerCase()}.`
      : `${score <= 6 ? 'Pain' : 'Pain and guarding'} with movement of the ${region.label.toLowerCase()}, with ${score <= 6 ? 'moderate' : 'marked'} limitation due to discomfort.`,
  }
}

// Editable neurological example wording follows anatomy, not pain severity.
function neurologicalParagraph(regions: ReturnType<typeof area>[]): string {
  const upper = new Set(['cervical', 'shoulder', 'scapula', 'upper_arm', 'elbow', 'forearm', 'wrist', 'hand'])
  const lower = new Set(['lumbar', 'si', 'coccyx', 'hip', 'thigh', 'knee', 'lower_leg', 'ankle', 'heel', 'foot'])
  const sentences: string[] = []
  for (const [keys, label] of [[upper, 'upper-extremity'], [lower, 'lower-extremity']] as const) {
    const matching = regions.filter(region => region.known && keys.has(region.known.key))
    if (!matching.length) continue
    const sides = new Set(matching.map(region => region.side))
    const side = sides.size === 1 && (sides.has('Left') || sides.has('Right')) ? `${matching[0].side} ` : ''
    const scope = side ? `${side}${label}` : `${label[0].toUpperCase()}${label.slice(1)}`
    sentences.push(`${scope} motor and sensory examination grossly intact.`)
  }
  return sentences.join(' ') || 'Motor and sensory examination grossly intact.'
}

export function populateExamFindings(current: Findings, complaints: ChiefComplaintEntry[]): Findings {
  const areas = new Map<string, { region: ReturnType<typeof area>; score: number | null }>()
  for (const complaint of complaints) {
    if (!complaint.body_region.trim()) continue
    const region = area(complaint.body_region)
    if (!region.label) continue
    const score = painLevel(complaint)
    const previous = areas.get(region.key)
    areas.set(region.key, { region, score: previous?.score == null ? score : Math.max(previous.score, score ?? 0) })
  }
  if (!areas.size) throw new Error('Add a body region in Chief Complaints first.')

  const result: Findings = { ...current, regions: current.regions.map(row => ({ ...row })) }
  if (!result.neurological_notes?.trim()) {
    result.neurological_notes = neurologicalParagraph(Array.from(areas.values(), item => item.region))
  }
  const highest = Math.max(0, ...Array.from(areas.values(), item => item.score ?? 0))
  if (!result.general_appearance?.trim() && highest > 0) {
    result.general_appearance = 'Alert and oriented, cooperative. ' + (highest <= 3
      ? 'Appears comfortable at rest, with mild discomfort during movement.'
      : highest <= 6 ? 'Appears uncomfortable with movement and position changes.'
        : 'Appears uncomfortable with movement and demonstrates guarding during position changes.')
  }
  for (const { region, score } of areas.values()) {
    let row = result.regions.find(row => area(row.region).key === region.key)
    if (!row) {
      row = { region: region.label, palpation_findings: '', additional_findings: null, muscle_spasm: null }
      result.regions.push(row)
    }
    const example = paragraphs(region, score)
    if (!row.palpation_findings.trim()) row.palpation_findings = example.palpation
    if (!row.additional_findings?.trim()) row.additional_findings = example.additional
  }
  return result
}
