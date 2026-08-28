import { describe, expect, it } from 'vitest'
import {
  assertProcedureDiagnosisBlockMatches,
  replaceDiagnosisBlock,
  stripDiagnosisBlock,
} from '../procedure-diagnoses'

const diagnoses = [{ icd10_code: 'M54.50', description: 'Low back pain' }]

describe('procedure diagnosis blocks', () => {
  it('replaces generated diagnoses while preserving the plan', () => {
    expect(replaceDiagnosisBlock(
      'DIAGNOSES:\nM54.12 - Cervical radiculopathy\n\nPLAN:\nContinue care.',
      diagnoses,
    )).toBe('DIAGNOSES:\nM54.50 - Low back pain\n\nPLAN:\nContinue care.')
  })

  it('uses a canonical empty diagnosis block', () => {
    expect(replaceDiagnosisBlock('PLAN:\nObserve.', []))
      .toBe('DIAGNOSES:\nNo diagnoses selected for this procedure.\n\nPLAN:\nObserve.')
  })

  it('strips diagnosis text from historical procedure-note context', () => {
    expect(stripDiagnosisBlock('DIAGNOSES:\nM54.12 - Old\n\nPLAN:\nHistorical plan.'))
      .toBe('Historical plan.')
  })

  it('rejects a mismatched block', () => {
    expect(() => assertProcedureDiagnosisBlockMatches(
      'DIAGNOSES:\nM54.12 - Cervical radiculopathy\n\nPLAN:\nContinue care.',
      diagnoses,
    )).toThrow('do not match')
  })
})
