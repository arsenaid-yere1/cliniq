// Map ICD-10 codes to procedure_defaults anatomy_key. Used as fallback when
// sites[] does not resolve to a single anatomy via singleAnatomyFromSites.
//
// Patterns are evaluated in order; first match wins. Spine codes precede
// joint codes so an L4-L5 disc disorder isn't shadowed by a generic
// musculoskeletal pattern. Sacroiliac (M53.2x, M53.3) precedes generic
// lumbar so SI joint dysfunction routes correctly.

const ICD10_ANATOMY_PATTERNS: Array<[string, RegExp]> = [
  // Sacroiliac — must precede lumbar to win on M53.x range overlap
  ['sacroiliac',     /^(M53\.2|M53\.3|M46\.1|M99\.04)/i],
  // Cervical spine — disc, radiculopathy, cervicalgia, myelopathy
  ['cervical_facet', /^(M50|M54\.2|M99\.01|M48\.0[12]|M53\.0|M53\.1|M47\.[01]2)/i],
  // Thoracic spine
  ['thoracic_facet', /^(M51\.[0-9]4|M54\.6|M99\.02|M48\.04|M47\.[01]4)/i],
  // Lumbar spine — disc, radiculopathy, low back pain, lumbago, sciatica
  ['lumbar_facet',   /^(M51\.[0-9]6|M51\.[0-9]7|M54\.4|M54\.5|M99\.03|M48\.0[567]|M47\.[01]6|M47\.[01]7|M54\.16|M54\.17|M54\.3|M54\.4)/i],
  // Knee
  ['knee',           /^(M17|M22|M23|M25\.36|M25\.46|M25\.56|M25\.66|S83)/i],
  // Shoulder
  ['shoulder',       /^(M19\.01|M75|M25\.31|M25\.41|M25\.51|M25\.61|S43|S46)/i],
  // Hip
  ['hip',            /^(M16|M24\.15|M24\.25|M25\.35|M25\.45|M25\.55|M25\.65|S73|S76)/i],
  // Ankle
  ['ankle',          /^(M19\.07|M24\.17|M25\.37|M25\.47|M25\.57|M25\.67|M19\.27|S93)/i],
  // Elbow / Wrist intentionally omitted — no procedure_defaults rows yet
]

export function classifyAnatomyFromIcd10(code: string | null | undefined): string | null {
  if (!code) return null
  const normalized = code.trim().toUpperCase()
  for (const [anatomy, pattern] of ICD10_ANATOMY_PATTERNS) {
    if (pattern.test(normalized)) return anatomy
  }
  return null
}

// Single-anatomy classifier across a diagnoses[] array. Mirrors
// singleAnatomyFromSites: returns the anatomy_key when ALL classifiable
// diagnoses agree; null when the array is empty, when no diagnosis
// classifies, or when diagnoses span multiple anatomies. Unclassified
// codes (e.g. external-cause V/W/X/Y, sprains S-codes filtered above)
// are ignored — they don't veto a single-anatomy match drawn from the
// remaining codes.
export function singleAnatomyFromDiagnoses(
  diagnoses: Array<{ icd10_code: string | null }>,
): string | null {
  const classified: string[] = []
  for (const d of diagnoses) {
    const a = classifyAnatomyFromIcd10(d.icd10_code)
    if (a) classified.push(a)
  }
  if (classified.length === 0) return null
  const set = new Set(classified)
  if (set.size === 1) return [...set][0]
  return null
}
