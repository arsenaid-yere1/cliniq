// Single-anatomy classifier. Maps a sites[] array label to one of the
// seeded anatomy_key values in procedure_defaults. When sites[] has
// multiple anatomies (e.g. knee + shoulder), returns null — caller
// should leave defaults blank and force the provider to commit values
// per-site via the existing A2 sites array.

const ANATOMY_PATTERNS: Array<[string, RegExp]> = [
  // Spine: vertebral level patterns + region keywords
  ['lumbar_facet',   /\b(L\d+[-/]?L?\d+|L\d+[-/]?S\d+|lumbar)\b/i],
  ['cervical_facet', /\b(C\d+[-/]?C?\d+|C\d+[-/]?T\d+|cervical)\b/i],
  ['thoracic_facet', /\b(T\d+[-/]?T?\d+|T\d+[-/]?L\d+|thoracic)\b/i],
  // Sacroiliac before joint patterns to keep "SI joint" classified correctly
  ['sacroiliac',     /\b(sacroiliac|si\s*joint)\b/i],
  // Joints
  ['knee',           /\bknee/i],
  ['shoulder',       /\bshoulder/i],
  ['hip',            /\bhip/i],
  ['ankle',          /\bankle/i],
]

export function classifyAnatomy(label: string): string | null {
  for (const [anatomy, pattern] of ANATOMY_PATTERNS) {
    if (pattern.test(label)) return anatomy
  }
  return null
}

// Single-anatomy classifier across an entire sites[] array. Returns the
// anatomy_key when ALL sites map to the same anatomy; null when sites is
// empty, when any site fails to classify, or when sites span multiple
// anatomies.
export function singleAnatomyFromSites(
  sites: Array<{ label: string }>,
): string | null {
  if (sites.length === 0) return null
  const first = classifyAnatomy(sites[0].label)
  if (!first) return null
  for (let i = 1; i < sites.length; i++) {
    if (classifyAnatomy(sites[i].label) !== first) return null
  }
  return first
}
