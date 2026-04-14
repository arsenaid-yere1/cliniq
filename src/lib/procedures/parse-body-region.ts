// Parse a free-text body_region from the intake chief complaints into a
// structured injection_site + laterality. Handles common laterality prefixes
// ("Left", "Lt", "L", "Right", "Rt", "R", "Bilateral", "Bilat", "Both") with
// an optional trailing period. Title-cases the resulting site. For bilateral,
// strips a trailing plural 's' so "Bilateral knees" → "Knee".
export function parseBodyRegion(raw: string): {
  injection_site: string
  laterality: 'left' | 'right' | 'bilateral' | null
} {
  const region = (raw ?? '').trim()
  if (!region) return { injection_site: '', laterality: null }

  const match = region.match(
    /^(left|lt|l|right|rt|r|bilateral|bilat|both)\.?\s+(.+)$/i,
  )

  if (!match) {
    return { injection_site: titleCaseRegion(region), laterality: null }
  }

  const token = match[1].toLowerCase()
  let rest = match[2].trim()
  let laterality: 'left' | 'right' | 'bilateral'

  if (token === 'left' || token === 'lt' || token === 'l') laterality = 'left'
  else if (token === 'right' || token === 'rt' || token === 'r') laterality = 'right'
  else laterality = 'bilateral'

  if (laterality === 'bilateral' && /[a-z]s$/i.test(rest)) {
    rest = rest.slice(0, -1)
  }

  return { injection_site: titleCaseRegion(rest), laterality }
}

function titleCaseRegion(s: string): string {
  return s.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}
