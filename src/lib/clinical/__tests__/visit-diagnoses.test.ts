import { describe, expect, it } from 'vitest'
import {
  assertDiagnosisTextMatchesPool,
  assertRecommendationDiagnosesInPool,
  CONFIRMED_EMPTY_VISIT_DIAGNOSES,
  formatVisitDiagnoses,
  normalizeVisitDiagnoses,
  requireConfirmedVisitDiagnosisPool,
} from '../visit-diagnoses'

describe('visit diagnoses', () => {
  it('normalizes parent codes and performs stable case-insensitive deduplication', () => {
    expect(normalizeVisitDiagnoses([
      { icd10_code: ' m54.5 ', description: ' Low   back pain ' },
      { icd10_code: 'M54.50', description: 'Duplicate description' },
      { icd10_code: 'g44.209', description: 'Tension-type headache' },
    ])).toEqual([
      { icd10_code: 'M54.50', description: 'Low back pain' },
      { icd10_code: 'G44.209', description: 'Tension-type headache' },
    ])
  })

  it('rejects structurally invalid ICD-10 codes', () => {
    expect(() => normalizeVisitDiagnoses([
      { icd10_code: 'not-a-code', description: 'Invalid' },
    ])).toThrow('Invalid ICD-10 code')
  })

  it('formats the authoritative list and confirmed-empty sentinel', () => {
    expect(formatVisitDiagnoses([])).toBe(CONFIRMED_EMPTY_VISIT_DIAGNOSES)
    expect(formatVisitDiagnoses([
      { icd10_code: 'm54.50', description: 'Low back pain' },
    ])).toBe('• M54.50 — Low back pain')
  })

  it('compares both code and description against diagnosis text', () => {
    const pool = [{ icd10_code: 'M54.50', description: 'Low back pain' }]
    expect(() => assertDiagnosisTextMatchesPool('• M54.50 — Low back pain', pool)).not.toThrow()
    expect(() => assertDiagnosisTextMatchesPool('• M54.50 — Different description', pool))
      .toThrow('does not match')
    expect(() => assertDiagnosisTextMatchesPool('', [])).toThrow('does not match')
    expect(() => assertDiagnosisTextMatchesPool(CONFIRMED_EMPTY_VISIT_DIAGNOSES, []))
      .not.toThrow()
  })

  it('requires every recommendation diagnosis to belong to the visit pool', () => {
    const pool = [{ icd10_code: 'M54.50', description: 'Low back pain' }]
    expect(() => assertRecommendationDiagnosesInPool([
      { diagnoses: [{ icd10_code: 'm54.50', description: 'Low back pain' }] },
    ], pool)).not.toThrow()
    expect(() => assertRecommendationDiagnosesInPool([
      { diagnoses: [{ icd10_code: 'M54.12', description: 'Cervical radiculopathy' }] },
    ], pool)).toThrow('not confirmed')
    expect(() => assertRecommendationDiagnosesInPool([
      { diagnoses: [{ icd10_code: null, description: 'Low back pain' }] },
    ], pool)).toThrow('require an ICD-10 code')
  })

  it('distinguishes an unconfirmed list from a confirmed empty list', () => {
    expect(() => requireConfirmedVisitDiagnosisPool({
      diagnoses: [],
      diagnoses_confirmed_at: null,
    })).toThrow('Review and confirm diagnoses')
    expect(requireConfirmedVisitDiagnosisPool({
      diagnoses: [],
      diagnoses_confirmed_at: '2026-08-28T12:00:00Z',
    })).toEqual([])
  })
})
