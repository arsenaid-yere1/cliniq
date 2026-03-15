import { describe, it, expect } from 'vitest'
import {
  findingSchema,
  mriExtractionResultSchema,
  mriExtractionResponseSchema,
  mriReviewFormSchema,
  extractionStatusEnum,
  reviewStatusEnum,
  confidenceEnum,
} from '../mri-extraction'

describe('findingSchema', () => {
  it('accepts valid finding', () => {
    const result = findingSchema.safeParse({
      level: 'C5-C6',
      description: 'Disc herniation',
      severity: 'moderate',
    })
    expect(result.success).toBe(true)
  })

  it('accepts null severity', () => {
    const result = findingSchema.safeParse({
      level: 'L4-L5',
      description: 'Disc bulge',
      severity: null,
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid severity', () => {
    const result = findingSchema.safeParse({
      level: 'C5-C6',
      description: 'Herniation',
      severity: 'critical',
    })
    expect(result.success).toBe(false)
  })
})

describe('mriExtractionResultSchema', () => {
  const validResult = {
    body_region: 'Cervical Spine',
    mri_date: '2026-02-15',
    findings: [{ level: 'C5-C6', description: 'Disc herniation', severity: 'moderate' as const }],
    impression_summary: 'Multi-level disc disease',
    confidence: 'high' as const,
    extraction_notes: null,
  }

  it('accepts valid extraction result', () => {
    const result = mriExtractionResultSchema.safeParse(validResult)
    expect(result.success).toBe(true)
  })

  it('accepts empty findings array', () => {
    const result = mriExtractionResultSchema.safeParse({
      ...validResult,
      findings: [],
    })
    expect(result.success).toBe(true)
  })

  it('accepts nullable fields as null', () => {
    const result = mriExtractionResultSchema.safeParse({
      ...validResult,
      mri_date: null,
      impression_summary: null,
      extraction_notes: null,
    })
    expect(result.success).toBe(true)
  })
})

describe('mriExtractionResponseSchema', () => {
  it('requires at least one report', () => {
    const result = mriExtractionResponseSchema.safeParse({ reports: [] })
    expect(result.success).toBe(false)
  })

  it('accepts multiple reports', () => {
    const report = {
      body_region: 'Cervical',
      mri_date: null,
      findings: [],
      impression_summary: null,
      confidence: 'medium' as const,
      extraction_notes: null,
    }
    const result = mriExtractionResponseSchema.safeParse({
      reports: [report, { ...report, body_region: 'Lumbar' }],
    })
    expect(result.success).toBe(true)
  })
})

describe('mriReviewFormSchema', () => {
  it('requires non-empty body_region', () => {
    const result = mriReviewFormSchema.safeParse({
      body_region: '',
      mri_date: null,
      findings: [],
      impression_summary: null,
    })
    expect(result.success).toBe(false)
  })

  it('requires non-empty level and description in findings', () => {
    const result = mriReviewFormSchema.safeParse({
      body_region: 'Cervical',
      mri_date: null,
      findings: [{ level: '', description: '', severity: null }],
      impression_summary: null,
    })
    expect(result.success).toBe(false)
  })

  it('accepts valid review form data', () => {
    const result = mriReviewFormSchema.safeParse({
      body_region: 'Cervical Spine',
      mri_date: '2026-02-15',
      findings: [{ level: 'C5-C6', description: 'Herniation', severity: 'severe' }],
      impression_summary: 'Significant findings',
    })
    expect(result.success).toBe(true)
  })
})

describe('status enums', () => {
  it('extractionStatusEnum accepts valid values', () => {
    for (const v of ['pending', 'processing', 'completed', 'failed']) {
      expect(extractionStatusEnum.safeParse(v).success).toBe(true)
    }
  })

  it('reviewStatusEnum accepts valid values', () => {
    for (const v of ['pending_review', 'approved', 'edited', 'rejected']) {
      expect(reviewStatusEnum.safeParse(v).success).toBe(true)
    }
  })

  it('confidenceEnum accepts valid values', () => {
    for (const v of ['high', 'medium', 'low']) {
      expect(confidenceEnum.safeParse(v).success).toBe(true)
    }
  })
})
