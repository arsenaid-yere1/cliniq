import { normalizeIcd10Code, validateIcd10Code } from './validation'

export type ParsedIvnDiagnosis = {
  icd10_code: string
  description: string
}

// Parse ICD-10 codes from Initial Visit Note `diagnoses` free-text.
// Format per line: "• M54.5 — Low back pain" or "M54.5 - Low back pain".
// Structurally invalid codes are skipped.
export function parseIvnDiagnoses(text: string | null | undefined): ParsedIvnDiagnosis[] {
  if (!text) return []
  const out: ParsedIvnDiagnosis[] = []
  for (const line of text.split('\n')) {
    const match = line.match(/^[•\-\d.]*\s*([A-Z]\d{1,2}\.?\d{0,4}[A-Z]{0,2})\s*[—–\-]\s*(.+)$/i)
    if (!match) continue
    const v = validateIcd10Code(match[1])
    if (!v.ok && v.reason === 'structure') continue
    out.push({
      icd10_code: normalizeIcd10Code(match[1]),
      description: match[2].trim(),
    })
  }
  return out
}
