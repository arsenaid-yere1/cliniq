// Static catalog used by the SitesEditor combobox. Future work (B1) will
// replace this constant with a DB-backed fetch from procedure_defaults.
const JOINTS = ['Knee', 'Shoulder', 'Hip', 'Ankle', 'Elbow', 'Wrist', 'Sacroiliac Joint'] as const
const SPINE_REGIONS = ['Cervical Facet', 'Thoracic Facet', 'Lumbar Facet'] as const

function generateVertebralLevels(): string[] {
  const levels: string[] = []
  // C2-C3 ... C6-C7, C7-T1
  for (let i = 2; i <= 7; i++) {
    const next = i + 1 > 7 ? 'T1' : `C${i + 1}`
    levels.push(`C${i}-${next}`)
  }
  // T1-T2 ... T11-T12, T12-L1
  for (let i = 1; i <= 12; i++) {
    const next = i + 1 > 12 ? 'L1' : `T${i + 1}`
    levels.push(`T${i}-${next}`)
  }
  // L1-L2 ... L4-L5, L5-S1
  for (let i = 1; i <= 4; i++) {
    levels.push(`L${i}-L${i + 1}`)
  }
  levels.push('L5-S1')
  return levels
}

export const SITE_CATALOG: readonly string[] = [
  ...JOINTS,
  ...SPINE_REGIONS,
  ...generateVertebralLevels(),
] as const
