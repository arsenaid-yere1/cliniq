import { examExamples, normalizeExamText, templateKeys, type ExamField, type ExamExample } from './exam-finding-examples'

export interface ExamSegment { start: number; end: number; text: string }
export function examSegments(text: string): ExamSegment[] {
  const segments: ExamSegment[] = []
  let start = 0
  for (let end = 0; end <= text.length; end++) {
    if (end !== text.length && text[end] !== ';') continue
    segments.push({ start, end, text: text.slice(start, end) })
    start = end + 1
  }
  return segments
}
export function hasExamPhrase(text: string, phrase: string): boolean {
  return examSegments(text).some(segment => normalizeExamText(segment.text) === normalizeExamText(phrase))
}
export function appendExamPhrase(text: string, phrase: string): string {
  if (hasExamPhrase(text, phrase)) return text
  if (!text.trim()) return phrase
  return `${text}${/;\s*$/.test(text) ? ' ' : '; '}${phrase}`
}
export function removeExamSegments(text: string, removed: readonly ExamSegment[]): string {
  // Right-to-left offsets preserve all bytes outside the removed segments.
  for (const segment of [...removed].sort((a, b) => b.start - a.start)) {
    text = segment.end < text.length ? text.slice(0, segment.start) + text.slice(segment.end + 1)
      : text.slice(0, Math.max(0, segment.start - 1))
  }
  return text
}
export function removeExamPhrase(text: string, phrase: string): string {
  return removeExamSegments(text, examSegments(text).filter(segment => normalizeExamText(segment.text) === normalizeExamText(phrase)))
}
const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const parsers = [...examExamples, { ...examExamples.find(e => e.id === 'P01')!, template: 'Paraspinal tenderness at {site}' }].map(example => {
  const keys = templateKeys(example.template)
  const pieces = example.template.split(/\{[^}]+\}/)
  const pattern = pieces.map(escaped).join('([^;{}\\r\\n]+?)')
  return { example, keys, specificity: pieces.join('').length, pattern: new RegExp(`^${pattern}$`, 'i') }
})
export interface ParsedExamPhrase { example: ExamExample; values: Record<string, string>; unavailable: boolean }
export function parseExamPhrase(text: string, field?: ExamField): ParsedExamPhrase | undefined {
  const matches: (ParsedExamPhrase & { specificity: number })[] = []
  for (const { example, keys, pattern, specificity } of parsers) {
    if (field && example.field !== field) continue
    // Pulse observations have no conflict rules; their free-form grammar overlaps reflex grades.
    if (example.id === 'N18') continue
    let core = text.trim()
    let nerveSite = ''
    if (example.id.startsWith('T')) {
      core = core.replace(/ at \d+(?:\.\d+)? degrees$/, '')
      core = core.replace(/ \(symptom side: (?:Left|Right|Bilateral|No symptoms|Not tested)\)$/, '')
      core = core.replace(/ \(symptom response: (?:Back-only pain|Leg symptoms|No symptoms|Other response|Not tested)\)$/, '')
      core = core.replace(/ \(site: ([^;{}\r\n]+)\)$/, (_, site: string) => { nerveSite = site; return '' })
    }
    const match = pattern.exec(core)
    if (!match) continue
    const values = Object.fromEntries(keys.map((key, index) => [key, match[index + 1].trim()]))
    if (example.id === 'I11' && !/deformity|asymmetr/i.test(values['Deformity or asymmetry observed'])) continue
    if (example.id === 'N09' && !/^\d+\+?$/.test(values.grade)) continue
    if (values.Mode && !/^(Active|Passive)$/i.test(values.Mode)) continue
    if (values.mode && !/^(Active|Passive)$/i.test(values.mode)) continue
    if (values.value && !/^\d+(?:\.\d+)?$/.test(values.value)) continue
    if (values.unit && !/^(degrees|millimeters)$/.test(values.unit)) continue
    if (values.side && !/^(Left|Right|Bilateral|Midline|Not applicable)$/i.test(values.side)) continue
    if (example.id.startsWith('T') && !/^(Positive|Negative|Equivocal|Unable to complete|Not performed)$/i.test(values.result)) continue
    if (example.id === 'T18' && !nerveSite) continue
    if (nerveSite) values.nerveSite = nerveSite
    if (example.id === 'N01' && !/^[0-5]$/.test(values.grade)) continue
    const unavailable = ['P11', 'P12', 'I16', 'M06', 'F08'].includes(example.id) ||
      (example.id.startsWith('T') && /^(Unable to complete|Not performed)$/i.test(values.result))
    matches.push({ example, values, unavailable, specificity })
  }
  // Prefer literal-rich templates over free-leading placeholders (e.g. Task).
  // Equal-specificity ambiguity stays untouched.
  matches.sort((a, b) => b.specificity - a.specificity)
  return matches[0] && matches[0].specificity !== matches[1]?.specificity ? matches[0] : undefined
}
export function hasCompletedExamText(text: string | null | undefined, field?: ExamField): boolean {
  return examSegments(text ?? '').some(segment => segment.text.trim() && !parseExamPhrase(segment.text, field)?.unavailable)
}

const families: Record<string, [string, string]> = {
  P01: ['tenderness', 'present'], P02: ['tenderness', 'absent'], P08: ['tenderness', 'present'], P09: ['tenderness', 'present'], P10: ['tenderness', 'present'],
  P03: ['warmth', 'present'], P04: ['warmth', 'absent'], P05: ['palpable-swelling', 'present'], P06: ['palpable-swelling', 'absent'],
  I01: ['visible-swelling', 'absent'], I02: ['visible-swelling', 'present'], I04: ['erythema', 'present'], I05: ['erythema', 'absent'],
  I08: ['effusion', 'present'], I09: ['effusion', 'absent'], I10: ['deformity', 'absent'], I11: ['deformity', 'present'],
  I12: ['bulk', 'reduced'], I13: ['bulk', 'symmetric'], M01: ['motion', 'preserved'], M02: ['motion', 'limited'], M03: ['measurement', 'value'],
  M04: ['movement-pain', 'present'], M05: ['movement-pain', 'absent'], M07: ['resisted-pain', 'present'], M08: ['resisted-pain', 'absent'],
  N01: ['strength', 'grade'], N04: ['light-touch', 'intact'], N05: ['light-touch', 'reduced'], N06: ['light-touch', 'absent'],
  N09: ['reflex', 'grade'], N10: ['reflex', 'grade'], N11: ['reflex', 'grade'], F07: ['function', 'performed'], F08: ['function', 'unavailable'],
}
function scopeOf(parsed: ParsedExamPhrase): { site: string; side: string; dimensions: string } {
  const values = parsed.values
  const location = values.site ?? values['examined site'] ?? values.scope ?? values['joint and side'] ?? values['joint and side, aspect'] ??
    values['examined paired sites'] ?? values['Muscle or movement'] ?? values.Reflex ?? values['Named paired reflexes'] ?? values['Named reflex'] ?? values['Named reflexes'] ?? values.Task ?? ''
  const normalized = normalizeExamText(location)
  const match = normalized.match(/^(left|right|bilateral|midline)\s+(.+)$/)
  const site = match ? match[2] : normalized
  const paired = ['I13', 'N10', 'N11'].includes(parsed.example.id)
  const side = match?.[1] ?? normalizeExamText(values.side ?? (paired ? 'Bilateral' : ''))
  const dimensions = [values.Mode ?? values.mode ?? '', values.movement ?? '', values.nerveSite ?? ''].map(normalizeExamText).join('|')
  return { site, side, dimensions }
}
function conflicts(a: ParsedExamPhrase, b: ParsedExamPhrase): boolean {
  if (a.example.field !== b.example.field) return false
  const sa = scopeOf(a), sb = scopeOf(b)
  if (sa.site !== sb.site || sa.dimensions !== sb.dimensions) return false
  if (sa.side !== sb.side && !(sa.side === 'bilateral' && ['left', 'right'].includes(sb.side)) && !(sb.side === 'bilateral' && ['left', 'right'].includes(sa.side))) return false
  const aid = a.example.id, bid = b.example.id
  if (aid.startsWith('T') || bid.startsWith('T')) return aid === bid && normalizeExamText(a.values.result) !== normalizeExamText(b.values.result)
  const unassessed = (id: string) => ['P11', 'P12', 'I16', 'M06', 'F08', 'N03', 'N08', 'N12'].includes(id)
  const assessment = (id: string) => id[0] !== 'N' ? id[0] : Number(id.slice(1)) <= 3 ? 'motor' : Number(id.slice(1)) <= 8 ? 'sensory' : 'reflex'
  if ((unassessed(aid) || unassessed(bid)) && assessment(aid) === assessment(bid)) return unassessed(aid) !== unassessed(bid)
  const fa = families[aid], fb = families[bid]
  if (!fa || !fb || fa[0] !== fb[0]) return false
  if (aid === 'N06' && normalizeExamText(a.values['tested modality'] ?? '') !== 'light touch') return false
  if (bid === 'N06' && normalizeExamText(b.values['tested modality'] ?? '') !== 'light touch') return false
  if (fa[0] === 'strength') return a.values.grade !== b.values.grade
  if (fa[0] === 'reflex') {
    const grades = (p: ParsedExamPhrase, side: string) => p.example.id === 'N11' ? p.values[`${side} grade`]
      : p.example.id === 'N10' ? p.values['recorded grades'] : p.values.grade
    return ['left', 'right'].some(side => {
      if (![side, 'bilateral'].includes(sa.side) || ![side, 'bilateral'].includes(sb.side)) return false
      const first = grades(a, side), second = grades(b, side)
      return /^\d+\+?$/.test(first ?? '') && /^\d+\+?$/.test(second ?? '') && first !== second
    })
  }
  if (fa[0] === 'measurement') return Number(a.values.value) !== Number(b.values.value) || a.values.unit !== b.values.unit
  return fa[1] !== fb[1]
}
export function conflictingExamSegments(text: string, incoming: string, field?: ExamField): ExamSegment[] {
  const next = parseExamPhrase(incoming, field)
  if (!next) return []
  return examSegments(text).filter(segment => {
    const previous = parseExamPhrase(segment.text, field ?? next.example.field)
    return previous && conflicts(previous, next)
  })
}
export function replaceConflictingExamPhrases(text: string, incoming: string, field?: ExamField): string {
  return appendExamPhrase(removeExamSegments(text, conflictingExamSegments(text, incoming, field)), incoming)
}
