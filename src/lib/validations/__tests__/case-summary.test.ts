import { describe, it, expect } from 'vitest'
import {
  caseSummaryResultSchema,
  caseSummaryEditSchema,
} from '../case-summary'

const validCaseSummary = {
  chief_complaint: 'Low back pain following MVA',
  imaging_findings: [
    {
      body_region: 'Lumbar spine',
      summary: 'L4-L5 disc herniation',
      key_findings: ['disc herniation', 'foraminal narrowing'],
      severity: 'moderate' as const,
    },
  ],
  prior_treatment: {
    modalities: ['Physical therapy', 'Chiropractic'],
    total_visits: 24,
    treatment_period: '3 months',
    gaps: [
      { from: '2025-01-15', to: '2025-02-10', days: 26 },
    ],
  },
  symptoms_timeline: {
    onset: '2024-12-01',
    progression: [
      { date: '2024-12-15', description: 'Initial improvement with PT' },
    ],
    current_status: 'Persistent pain with functional limitations',
    pain_levels: [
      { date: '2024-12-01', level: 8, context: 'Initial presentation' },
      { date: '2025-02-15', level: 5, context: 'After treatment' },
    ],
  },
  suggested_diagnoses: [
    {
      diagnosis: 'Lumbar disc herniation',
      icd10_code: 'M51.16',
      confidence: 'high' as const,
      supporting_evidence: 'MRI findings and clinical presentation',
    },
  ],
  confidence: 'high' as const,
  extraction_notes: null,
}

describe('caseSummaryResultSchema', () => {
  it('accepts valid case summary', () => {
    expect(caseSummaryResultSchema.safeParse(validCaseSummary).success).toBe(true)
  })

  it('accepts nullable fields as null', () => {
    const result = caseSummaryResultSchema.safeParse({
      ...validCaseSummary,
      chief_complaint: null,
      extraction_notes: null,
      imaging_findings: [{
        ...validCaseSummary.imaging_findings[0],
        severity: null,
      }],
      prior_treatment: {
        ...validCaseSummary.prior_treatment,
        total_visits: null,
        treatment_period: null,
      },
      symptoms_timeline: {
        ...validCaseSummary.symptoms_timeline,
        onset: null,
        current_status: null,
        progression: [{ date: null, description: 'Some change' }],
        pain_levels: [{ date: null, level: 5, context: null }],
      },
      suggested_diagnoses: [{
        ...validCaseSummary.suggested_diagnoses[0],
        icd10_code: null,
        supporting_evidence: null,
      }],
    })
    expect(result.success).toBe(true)
  })

  it('accepts empty arrays', () => {
    const result = caseSummaryResultSchema.safeParse({
      ...validCaseSummary,
      imaging_findings: [],
      suggested_diagnoses: [],
      prior_treatment: {
        ...validCaseSummary.prior_treatment,
        modalities: [],
        gaps: [],
      },
      symptoms_timeline: {
        ...validCaseSummary.symptoms_timeline,
        progression: [],
        pain_levels: [],
      },
    })
    expect(result.success).toBe(true)
  })

  it('accepts all severity values', () => {
    for (const val of ['mild', 'moderate', 'severe']) {
      const result = caseSummaryResultSchema.safeParse({
        ...validCaseSummary,
        imaging_findings: [{
          ...validCaseSummary.imaging_findings[0],
          severity: val,
        }],
      })
      expect(result.success).toBe(true)
    }
  })

  it('rejects invalid severity', () => {
    const result = caseSummaryResultSchema.safeParse({
      ...validCaseSummary,
      imaging_findings: [{
        ...validCaseSummary.imaging_findings[0],
        severity: 'critical',
      }],
    })
    expect(result.success).toBe(false)
  })

  it('accepts all confidence values on suggested diagnoses', () => {
    for (const val of ['high', 'medium', 'low']) {
      const result = caseSummaryResultSchema.safeParse({
        ...validCaseSummary,
        suggested_diagnoses: [{
          ...validCaseSummary.suggested_diagnoses[0],
          confidence: val,
        }],
      })
      expect(result.success).toBe(true)
    }
  })
})

describe('caseSummaryEditSchema', () => {
  const { confidence, extraction_notes, ...editData } = validCaseSummary

  it('accepts valid edit data', () => {
    expect(caseSummaryEditSchema.safeParse(editData).success).toBe(true)
  })

  it('rejects empty body_region in imaging_findings', () => {
    const result = caseSummaryEditSchema.safeParse({
      ...editData,
      imaging_findings: [{
        ...validCaseSummary.imaging_findings[0],
        body_region: '',
      }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty summary in imaging_findings', () => {
    const result = caseSummaryEditSchema.safeParse({
      ...editData,
      imaging_findings: [{
        ...validCaseSummary.imaging_findings[0],
        summary: '',
      }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty diagnosis in suggested_diagnoses', () => {
    const result = caseSummaryEditSchema.safeParse({
      ...editData,
      suggested_diagnoses: [{
        ...validCaseSummary.suggested_diagnoses[0],
        diagnosis: '',
      }],
    })
    expect(result.success).toBe(false)
  })
})
