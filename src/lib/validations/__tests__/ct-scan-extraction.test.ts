import { describe, it, expect } from 'vitest'
import {
  ctScanFindingSchema,
  ctScanExtractionResultSchema,
  ctScanExtractionResponseSchema,
  ctScanReviewFormSchema,
} from '../ct-scan-extraction'

const validFinding = {
  level: 'C5-C6',
  description: 'Mild disc bulge',
  severity: 'mild' as const,
}

const validResult = {
  body_region: 'Cervical spine',
  scan_date: '2025-01-20',
  technique: 'Non-contrast CT',
  reason_for_study: 'Post-MVA cervical pain',
  findings: [validFinding],
  impression_summary: 'Mild degenerative changes at C5-C6',
  confidence: 'high' as const,
  extraction_notes: null,
}

describe('ctScanFindingSchema', () => {
  it('accepts a valid finding', () => {
    expect(ctScanFindingSchema.safeParse(validFinding).success).toBe(true)
  })

  it('accepts null severity', () => {
    expect(
      ctScanFindingSchema.safeParse({ ...validFinding, severity: null }).success,
    ).toBe(true)
  })

  it('accepts all severity values', () => {
    for (const val of ['mild', 'moderate', 'severe']) {
      expect(
        ctScanFindingSchema.safeParse({ ...validFinding, severity: val }).success,
      ).toBe(true)
    }
  })

  it('rejects invalid severity', () => {
    expect(
      ctScanFindingSchema.safeParse({ ...validFinding, severity: 'critical' }).success,
    ).toBe(false)
  })
})

describe('ctScanExtractionResultSchema', () => {
  it('accepts valid result', () => {
    expect(ctScanExtractionResultSchema.safeParse(validResult).success).toBe(true)
  })

  it('accepts nullable fields as null', () => {
    const result = ctScanExtractionResultSchema.safeParse({
      ...validResult,
      scan_date: null,
      technique: null,
      reason_for_study: null,
      impression_summary: null,
      extraction_notes: null,
    })
    expect(result.success).toBe(true)
  })

  it('accepts empty findings array', () => {
    expect(
      ctScanExtractionResultSchema.safeParse({ ...validResult, findings: [] }).success,
    ).toBe(true)
  })
})

describe('ctScanExtractionResponseSchema', () => {
  it('rejects empty reports array', () => {
    expect(
      ctScanExtractionResponseSchema.safeParse({ reports: [] }).success,
    ).toBe(false)
  })

  it('accepts single report', () => {
    expect(
      ctScanExtractionResponseSchema.safeParse({ reports: [validResult] }).success,
    ).toBe(true)
  })

  it('accepts multiple reports', () => {
    const secondReport = {
      ...validResult,
      body_region: 'Lumbar spine',
      findings: [{ level: 'L4-L5', description: 'Disc protrusion', severity: 'moderate' as const }],
    }
    expect(
      ctScanExtractionResponseSchema.safeParse({ reports: [validResult, secondReport] }).success,
    ).toBe(true)
  })
})

describe('ctScanReviewFormSchema', () => {
  const { confidence, extraction_notes, ...reviewData } = validResult

  it('accepts valid review data', () => {
    expect(ctScanReviewFormSchema.safeParse(reviewData).success).toBe(true)
  })

  it('rejects empty body_region', () => {
    expect(
      ctScanReviewFormSchema.safeParse({ ...reviewData, body_region: '' }).success,
    ).toBe(false)
  })

  it('rejects empty level in findings', () => {
    const result = ctScanReviewFormSchema.safeParse({
      ...reviewData,
      findings: [{ level: '', description: 'Some finding', severity: null }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty description in findings', () => {
    const result = ctScanReviewFormSchema.safeParse({
      ...reviewData,
      findings: [{ level: 'C5-C6', description: '', severity: null }],
    })
    expect(result.success).toBe(false)
  })
})
