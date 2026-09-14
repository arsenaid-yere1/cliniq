export const radiationStatuses = ['No radiation', 'Not assessed'] as const
export type RadiationStatus = typeof radiationStatuses[number]

const normalized = (text: string) => text.trim().toLowerCase()

export function isRadiationStatus(text: string): boolean {
  return radiationStatuses.some(status => normalized(status) === normalized(text))
}

function findSegment(text: string, label: string): { start: number; end: number } | null {
  let start = 0
  for (let end = 0; end <= text.length; end++) {
    if (end !== text.length && text[end] !== ';') continue
    if (normalized(text.slice(start, end)) === normalized(label)) return { start, end }
    start = end + 1
  }
  return null
}

export function hasRadiationExample(text: string, label: string): boolean {
  return findSegment(text, label) !== null
}

export function toggleRadiationExample(text: string, label: string): string {
  const segment = findSegment(text, label)
  if (segment) {
    if (segment.end < text.length) return text.slice(0, segment.start) + text.slice(segment.end + 1)
    return text.slice(0, segment.start > 0 ? segment.start - 1 : 0)
  }
  if (!text.trim() || isRadiationStatus(text)) return label
  return `${text}${/;\s*$/.test(text) ? ' ' : '; '}${label}`
}

