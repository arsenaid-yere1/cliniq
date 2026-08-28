import { normalizeIcd10Code, validateIcd10Code } from '@/lib/icd10/validation'
import { parseIvnDiagnoses } from '@/lib/icd10/parse-ivn-diagnoses'
import {
  visitDiagnosisListSchema,
  type VisitDiagnosis,
} from '@/lib/validations/clinical-encounter'

export const CONFIRMED_EMPTY_VISIT_DIAGNOSES = 'No diagnoses selected for this encounter.'

function normalizedDescription(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

export function normalizeVisitDiagnoses(input: unknown): VisitDiagnosis[] {
  const diagnoses = visitDiagnosisListSchema.parse(input)
  const seen = new Set<string>()
  const normalized: VisitDiagnosis[] = []

  for (const diagnosis of diagnoses) {
    const validation = validateIcd10Code(diagnosis.icd10_code)
    if (!validation.ok && validation.reason === 'structure') {
      throw new Error(`Invalid ICD-10 code: ${diagnosis.icd10_code}`)
    }

    const code = normalizeIcd10Code(diagnosis.icd10_code)
    if (seen.has(code)) continue
    seen.add(code)
    normalized.push({
      icd10_code: code,
      description: normalizedDescription(diagnosis.description),
    })
  }

  return normalized
}

export function formatVisitDiagnoses(diagnoses: VisitDiagnosis[]): string {
  const normalized = normalizeVisitDiagnoses(diagnoses)
  if (normalized.length === 0) return CONFIRMED_EMPTY_VISIT_DIAGNOSES
  return normalized
    .map(({ icd10_code, description }) => `• ${icd10_code} — ${description}`)
    .join('\n')
}

function diagnosesEqual(left: VisitDiagnosis[], right: VisitDiagnosis[]) {
  if (left.length !== right.length) return false
  return left.every((diagnosis, index) => (
    diagnosis.icd10_code === right[index]?.icd10_code
    && diagnosis.description === right[index]?.description
  ))
}

export function assertDiagnosisTextMatchesPool(
  text: string | null | undefined,
  diagnoses: VisitDiagnosis[],
): void {
  const normalized = normalizeVisitDiagnoses(diagnoses)
  if (normalized.length === 0) {
    if (text !== CONFIRMED_EMPTY_VISIT_DIAGNOSES) {
      throw new Error('Diagnosis text does not match the confirmed visit diagnoses')
    }
    return
  }

  const parsed = normalizeVisitDiagnoses(parseIvnDiagnoses(text))
  if (!diagnosesEqual(parsed, normalized)) {
    throw new Error('Diagnosis text does not match the confirmed visit diagnoses')
  }
}

type RecommendationDiagnosis = {
  icd10_code?: string | null
  description?: string | null
}

type ProcedureRecommendation = {
  diagnoses?: RecommendationDiagnosis[] | null
}

export function assertRecommendationDiagnosesInPool(
  recommendations: ProcedureRecommendation[],
  diagnoses: VisitDiagnosis[],
): void {
  const allowed = new Set(normalizeVisitDiagnoses(diagnoses).map((item) => item.icd10_code))

  for (const recommendation of recommendations) {
    for (const diagnosis of recommendation.diagnoses ?? []) {
      if (!diagnosis.icd10_code?.trim()) {
        throw new Error('Procedure recommendation diagnoses require an ICD-10 code')
      }
      const validation = validateIcd10Code(diagnosis.icd10_code)
      if (!validation.ok && validation.reason === 'structure') {
        throw new Error(`Invalid recommendation ICD-10 code: ${diagnosis.icd10_code}`)
      }
      const code = normalizeIcd10Code(diagnosis.icd10_code)
      if (!allowed.has(code)) {
        throw new Error(`Recommendation diagnosis ${code} is not confirmed for this visit`)
      }
    }
  }
}

export function requireConfirmedVisitDiagnosisPool(input: {
  diagnoses: unknown
  diagnoses_confirmed_at: string | null
}): VisitDiagnosis[] {
  if (!input.diagnoses_confirmed_at) {
    throw new Error('Review and confirm diagnoses for this visit')
  }
  return normalizeVisitDiagnoses(input.diagnoses)
}
