// ICD-10-CM structural + specificity validation used by diagnosis suggestion merging
// and the DiagnosisCombobox free-type path. Scope: reject known non-billable parent
// codes that have billable children (e.g., M54.5 → M54.50/.51/.59), and reject codes
// whose structure does not match ICD-10-CM format.

// ICD-10-CM code structure: Letter, 2 digits, optional dot, up to 4 alphanumeric chars.
// Examples accepted: M54.5, M54.50, M50.121, S13.4XXA, V43.52XA, G47.9, R51.9.
const ICD10_STRUCTURAL_REGEX = /^[A-Z]\d{2}(\.\d{1,4}[A-Z]{0,2}|\.?[A-Z0-9]{0,4})?$/i

// Parent codes that have billable children in ICD-10-CM 2026. Using a parent at
// these points is always wrong — the child code is required for billing. The map
// value is the "default child to prefer" noted in prompts.
export const NON_BILLABLE_PARENT_CODES: Record<string, string> = {
  'M54.5': 'M54.50',
}

export type Icd10ValidationResult =
  | { ok: true; code: string }
  | { ok: false; code: string; reason: 'structure' | 'non_billable_parent'; suggestion?: string }

export function validateIcd10Code(raw: string): Icd10ValidationResult {
  const code = raw.trim().toUpperCase()

  if (!ICD10_STRUCTURAL_REGEX.test(code)) {
    return { ok: false, code, reason: 'structure' }
  }

  const suggestion = NON_BILLABLE_PARENT_CODES[code]
  if (suggestion) {
    return { ok: false, code, reason: 'non_billable_parent', suggestion }
  }

  return { ok: true, code }
}

export function normalizeIcd10Code(raw: string): string {
  const v = validateIcd10Code(raw)
  if (v.ok) return v.code
  if (v.reason === 'non_billable_parent' && v.suggestion) return v.suggestion
  return v.code
}
