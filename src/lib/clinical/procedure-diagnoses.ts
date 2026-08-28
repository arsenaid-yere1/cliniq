import { normalizeVisitDiagnoses } from '@/lib/clinical/visit-diagnoses'
import type { VisitDiagnosis } from '@/lib/validations/clinical-encounter'

export const EMPTY_PROCEDURE_DIAGNOSES = 'No diagnoses selected for this procedure.'

export function formatProcedureDiagnoses(diagnoses: VisitDiagnosis[]) {
  const normalized = normalizeVisitDiagnoses(diagnoses)
  if (normalized.length === 0) return EMPTY_PROCEDURE_DIAGNOSES
  return normalized.map((diagnosis) => (
    `${diagnosis.icd10_code} - ${diagnosis.description}`
  )).join('\n')
}

export function stripDiagnosisBlock(value: string | null | undefined) {
  if (!value) return null
  const planMatch = value.match(/(?:^|\n)PLAN:\s*/i)
  if (!planMatch || planMatch.index == null) return value
  return value.slice(planMatch.index + planMatch[0].length).trim()
}

export function replaceDiagnosisBlock(
  value: string | null | undefined,
  diagnoses: VisitDiagnosis[],
) {
  const plan = stripDiagnosisBlock(value)?.trim() ?? ''
  const prefix = `DIAGNOSES:\n${formatProcedureDiagnoses(diagnoses)}\n\nPLAN:`
  return plan ? `${prefix}\n${plan}` : prefix
}

export function assertProcedureDiagnosisBlockMatches(
  value: string | null | undefined,
  diagnoses: VisitDiagnosis[],
) {
  const expected = `DIAGNOSES:\n${formatProcedureDiagnoses(diagnoses)}\n\nPLAN:`
  if (!value?.startsWith(expected)) {
    throw new Error('Procedure-note diagnoses do not match the procedure record')
  }
}
