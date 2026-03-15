import { describe, it, expect } from 'vitest'
import {
  reportTypeEnum,
  chiroExtractionResultSchema,
  chiroReviewFormSchema,
} from '../chiro-extraction'

const validExtraction = {
  report_type: 'initial_evaluation' as const,
  report_date: '2026-01-10',
  treatment_dates: {
    first_visit: '2026-01-10',
    last_visit: '2026-03-01',
    total_visits: 12,
    visit_dates: ['2026-01-10', '2026-01-17'],
    treatment_gaps: [],
  },
  diagnoses: [{
    icd10_code: 'M54.2',
    description: 'Cervicalgia',
    region: 'cervical' as const,
    is_primary: true,
  }],
  treatment_modalities: [{
    modality: 'Spinal manipulation',
    cpt_code: '98941',
    regions_treated: ['cervical', 'thoracic'],
    frequency: '3x/week',
  }],
  functional_outcomes: {
    pain_levels: [{
      date: '2026-01-10',
      scale: 'VAS',
      score: 7,
      max_score: 10,
      context: 'At rest',
    }],
    disability_scores: [],
    progress_status: 'improving' as const,
  },
  plateau_statement: {
    present: false,
    mmi_reached: null,
    date: null,
    verbatim_statement: null,
    residual_complaints: [],
    permanent_restrictions: [],
    impairment_rating_percent: null,
    future_care_recommended: null,
  },
  confidence: 'high' as const,
  extraction_notes: null,
}

describe('reportTypeEnum', () => {
  it('accepts all valid report types', () => {
    for (const t of ['initial_evaluation', 'soap_note', 're_evaluation', 'discharge_summary', 'other']) {
      expect(reportTypeEnum.safeParse(t).success).toBe(true)
    }
  })

  it('rejects invalid report type', () => {
    expect(reportTypeEnum.safeParse('progress_note').success).toBe(false)
  })
})

describe('chiroExtractionResultSchema', () => {
  it('accepts valid extraction data', () => {
    const result = chiroExtractionResultSchema.safeParse(validExtraction)
    expect(result.success).toBe(true)
  })

  it('accepts nullable fields as null', () => {
    const result = chiroExtractionResultSchema.safeParse({
      ...validExtraction,
      report_date: null,
      extraction_notes: null,
    })
    expect(result.success).toBe(true)
  })

  it('requires confidence field', () => {
    const { confidence, ...withoutConfidence } = validExtraction
    const result = chiroExtractionResultSchema.safeParse(withoutConfidence)
    expect(result.success).toBe(false)
  })

  it('accepts treatment gaps with proper structure', () => {
    const result = chiroExtractionResultSchema.safeParse({
      ...validExtraction,
      treatment_dates: {
        ...validExtraction.treatment_dates,
        treatment_gaps: [{ from: '2026-01-24', to: '2026-02-07', days: 14 }],
      },
    })
    expect(result.success).toBe(true)
  })

  it('validates diagnosis region enum', () => {
    const result = chiroExtractionResultSchema.safeParse({
      ...validExtraction,
      diagnoses: [{
        icd10_code: null,
        description: 'Pain',
        region: 'invalid_region',
        is_primary: true,
      }],
    })
    expect(result.success).toBe(false)
  })
})

describe('chiroReviewFormSchema', () => {
  it('accepts valid review form data (no confidence/extraction_notes)', () => {
    const { confidence, extraction_notes, ...reviewData } = validExtraction
    const result = chiroReviewFormSchema.safeParse(reviewData)
    expect(result.success).toBe(true)
  })

  it('rejects empty diagnosis description', () => {
    const { confidence, extraction_notes, ...reviewData } = validExtraction
    const result = chiroReviewFormSchema.safeParse({
      ...reviewData,
      diagnoses: [{
        icd10_code: null,
        description: '',
        region: 'cervical',
        is_primary: true,
      }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty modality name', () => {
    const { confidence, extraction_notes, ...reviewData } = validExtraction
    const result = chiroReviewFormSchema.safeParse({
      ...reviewData,
      treatment_modalities: [{
        modality: '',
        cpt_code: null,
        regions_treated: [],
        frequency: null,
      }],
    })
    expect(result.success).toBe(false)
  })
})
