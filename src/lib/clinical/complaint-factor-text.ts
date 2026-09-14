export const factorStatuses = ['None reported', 'Not assessed'] as const
export type FactorStatus = typeof factorStatuses[number]

const normalized = (text: string) => text.trim().toLowerCase()

export function isFactorStatus(text: string): boolean {
  return factorStatuses.some(status => normalized(status) === normalized(text))
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

export function hasFactorExample(text: string, label: string): boolean {
  return findSegment(text, label) !== null
}

export function toggleFactorExample(text: string, label: string): string {
  const segment = findSegment(text, label)
  if (segment) {
    // Remove one standalone segment plus one adjacent separator. Other prose is untouched.
    if (segment.end < text.length) return text.slice(0, segment.start) + text.slice(segment.end + 1)
    return text.slice(0, segment.start > 0 ? segment.start - 1 : 0)
  }
  if (!text.trim() || isFactorStatus(text)) return label
  return `${text}${/;\s*$/.test(text) ? ' ' : '; '}${label}`
}
