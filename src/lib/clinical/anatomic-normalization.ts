export type ClinicalLaterality = 'left' | 'right' | 'bilateral' | null

const REGION_SYNONYMS: Record<string, string> = {
  lumbar: 'lumbar', lumbosacral: 'lumbar', 'low back': 'lumbar',
  'lower back': 'lumbar', 'lumbar spine': 'lumbar', 'l-spine': 'lumbar', ls: 'lumbar',
  cervical: 'cervical', 'cervical spine': 'cervical', 'c-spine': 'cervical', neck: 'cervical',
  thoracic: 'thoracic', 'thoracic spine': 'thoracic', 't-spine': 'thoracic', 'mid back': 'thoracic',
  sacroiliac: 'sacroiliac', si: 'sacroiliac', 'si joint': 'sacroiliac',
  'sacroiliac joint': 'sacroiliac', knee: 'knee', shoulder: 'shoulder', hip: 'hip',
  wrist: 'wrist', ankle: 'ankle', elbow: 'elbow',
}

const LEVEL_RE = /\b([CTL])\s*(\d{1,2})\s*[-–—\/]\s*(?:([CTLS])?\s*)?(\d{1,2})\b/gi
const SINGLE_LEVEL_RE = /\b([CTL])\s*(\d{1,2})\b/gi

function regionFromPrefix(prefix: string): string | null {
  const value = prefix.toUpperCase()
  if (value === 'C') return 'cervical'
  if (value === 'T') return 'thoracic'
  if (value === 'L' || value === 'S') return 'lumbar'
  return null
}

export function extractLaterality(raw: string | null | undefined): ClinicalLaterality {
  if (!raw) return null
  const text = raw.toLowerCase()
  if (/\bbilateral\b|\bbilat\b|\bboth(?:\s+sides?)?\b/.test(text)) return 'bilateral'
  if (/\b(left|lt\.?)\b/.test(text)) return 'left'
  if (/\b(right|rt\.?)\b/.test(text)) return 'right'
  return null
}

export function lateralityCompatible(a: ClinicalLaterality, b: ClinicalLaterality): boolean {
  if (a === null || b === null || a === 'bilateral' || b === 'bilateral') return true
  return a === b
}

export function normalizeRegion(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = raw.toLowerCase()
    .replace(/^(left|right|bilateral|bilat|both|lt\.?|rt\.?|l\.?|r\.?)\s+/i, '')
    .replace(/\s+/g, ' ').trim()
  if (!cleaned) return null
  if (REGION_SYNONYMS[cleaned]) return REGION_SYNONYMS[cleaned]
  for (const [key, canonical] of Object.entries(REGION_SYNONYMS)) {
    if (cleaned.includes(key)) return canonical
  }
  const match = cleaned.match(/\b([ctls])\s*\d{1,2}\b/i)
  return match ? regionFromPrefix(match[1]) : cleaned
}

export function normalizeSpinalLevel(raw: string | null | undefined): string | null {
  if (!raw) return null
  LEVEL_RE.lastIndex = 0
  const match = LEVEL_RE.exec(raw)
  LEVEL_RE.lastIndex = 0
  if (!match) return null
  return `${match[1].toUpperCase()}${match[2]}-${(match[3] ?? match[1]).toUpperCase()}${match[4]}`
}

export function extractSpinalLevels(raw: string | null | undefined): string[] {
  if (!raw) return []
  const levels = new Set<string>()
  LEVEL_RE.lastIndex = 0
  for (const match of raw.matchAll(LEVEL_RE)) {
    levels.add(`${match[1].toUpperCase()}${match[2]}-${(match[3] ?? match[1]).toUpperCase()}${match[4]}`)
  }
  LEVEL_RE.lastIndex = 0
  if (levels.size === 0) {
    SINGLE_LEVEL_RE.lastIndex = 0
    for (const match of raw.matchAll(SINGLE_LEVEL_RE)) levels.add(`${match[1].toUpperCase()}${match[2]}`)
    SINGLE_LEVEL_RE.lastIndex = 0
  }
  return [...levels]
}

export function isSpineRegion(region: string | null): boolean {
  return region === 'cervical' || region === 'thoracic' || region === 'lumbar'
}

export function normalizeAnatomicLocation(raw: string | null | undefined): string | null {
  if (!raw) return null
  return raw.toLowerCase().replace(/\s+/g, ' ').trim() || null
}
