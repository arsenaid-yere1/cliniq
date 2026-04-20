import { describe, it, expect } from 'vitest'
import {
  painManagementExtractionResultSchema,
  painManagementReviewFormSchema,
} from '../pain-management-extraction'

const validExtraction = {
  report_date: '2025-02-10',
  date_of_injury: '2024-11-15',
  examining_provider: 'Dr. Williams, MD',
  chief_complaints: [
    {
      location: 'Lower back',
      pain_rating_min: 4,
      pain_rating_max: 8,
      radiation: 'Left leg to knee',
      aggravating_factors: ['sitting', 'bending', 'lifting'],
      alleviating_factors: ['lying down', 'ice'],
    },
  ],
  physical_exam: [
    {
      region: 'Lumbar spine',
      palpation_findings: 'Tenderness over L4-L5',
      range_of_motion: [
        {
          movement: 'Flexion',
          normal: 60,
          actual: 35,
          pain: true,
        },
      ],
      orthopedic_tests: [
        {
          name: 'Straight Leg Raise',
          result: 'positive' as const,
        },
      ],
      neurological_summary: 'Decreased sensation L5 dermatome',
    },
  ],
  diagnoses: [
    {
      icd10_code: 'M54.5',
      description: 'Low back pain',
    },
  ],
  treatment_plan: [
    {
      description: 'Epidural steroid injection L4-L5',
      type: 'injection' as const,
      estimated_cost_min: 1500,
      estimated_cost_max: 3000,
      body_region: 'Lumbar spine',
    },
  ],
  diagnostic_studies_summary: 'MRI shows L4-L5 disc protrusion',
  confidence: 'high' as const,
  extraction_notes: null,
}

describe('painManagementExtractionResultSchema', () => {
  it('accepts valid extraction data', () => {
    expect(painManagementExtractionResultSchema.safeParse(validExtraction).success).toBe(true)
  })

  it('accepts nullable fields as null', () => {
    const result = painManagementExtractionResultSchema.safeParse({
      ...validExtraction,
      report_date: null,
      date_of_injury: null,
      examining_provider: null,
      diagnostic_studies_summary: null,
      extraction_notes: null,
      chief_complaints: [{
        ...validExtraction.chief_complaints[0],
        pain_rating_min: null,
        pain_rating_max: null,
        radiation: null,
      }],
      treatment_plan: [{
        ...validExtraction.treatment_plan[0],
        type: null,
        estimated_cost_min: null,
        estimated_cost_max: null,
        body_region: null,
      }],
    })
    expect(result.success).toBe(true)
  })

  it('accepts empty arrays for optional collections', () => {
    const result = painManagementExtractionResultSchema.safeParse({
      ...validExtraction,
      chief_complaints: [],
      physical_exam: [],
      diagnoses: [],
      treatment_plan: [],
    })
    expect(result.success).toBe(true)
  })

  it('accepts string arrays for aggravating/alleviating factors', () => {
    const result = painManagementExtractionResultSchema.safeParse({
      ...validExtraction,
      chief_complaints: [{
        ...validExtraction.chief_complaints[0],
        aggravating_factors: [],
        alleviating_factors: [],
      }],
    })
    expect(result.success).toBe(true)
  })

  it('accepts ROM nested inside physical exam regions', () => {
    const result = painManagementExtractionResultSchema.safeParse({
      ...validExtraction,
      physical_exam: [{
        region: 'Cervical spine',
        palpation_findings: null,
        range_of_motion: [
          { movement: 'Flexion', normal: 50, actual: 30, pain: true },
          { movement: 'Extension', normal: 60, actual: 40, pain: false },
        ],
        orthopedic_tests: [],
        neurological_summary: null,
      }],
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid confidence value', () => {
    expect(
      painManagementExtractionResultSchema.safeParse({
        ...validExtraction,
        confidence: 'unknown',
      }).success,
    ).toBe(false)
  })

  it('accepts diagnosis support tags (imaging_support, exam_support, source_quote)', () => {
    const result = painManagementExtractionResultSchema.safeParse({
      ...validExtraction,
      diagnoses: [
        {
          icd10_code: 'M50.00',
          description: 'Cervical disc disorder with myelopathy',
          imaging_support: 'confirmed',
          exam_support: 'objective',
          source_quote: 'MRI demonstrates C5-C6 disc herniation with cord contact.',
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('accepts diagnosis when support tags are null', () => {
    const result = painManagementExtractionResultSchema.safeParse({
      ...validExtraction,
      diagnoses: [
        {
          icd10_code: 'M54.5',
          description: 'Low back pain',
          imaging_support: null,
          exam_support: null,
          source_quote: null,
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('rejects unknown enum values for imaging_support and exam_support', () => {
    const badImaging = painManagementExtractionResultSchema.safeParse({
      ...validExtraction,
      diagnoses: [{ icd10_code: 'M54.5', description: 'Low back pain', imaging_support: 'maybe' }],
    })
    expect(badImaging.success).toBe(false)

    const badExam = painManagementExtractionResultSchema.safeParse({
      ...validExtraction,
      diagnoses: [{ icd10_code: 'M54.5', description: 'Low back pain', exam_support: 'partial' }],
    })
    expect(badExam.success).toBe(false)
  })
})

describe('painManagementReviewFormSchema', () => {
  const { confidence, extraction_notes, ...reviewData } = validExtraction

  it('accepts valid review data', () => {
    expect(painManagementReviewFormSchema.safeParse(reviewData).success).toBe(true)
  })

  it('rejects empty location in chief_complaints', () => {
    const result = painManagementReviewFormSchema.safeParse({
      ...reviewData,
      chief_complaints: [{
        ...validExtraction.chief_complaints[0],
        location: '',
      }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty region in physical_exam', () => {
    const result = painManagementReviewFormSchema.safeParse({
      ...reviewData,
      physical_exam: [{
        ...validExtraction.physical_exam[0],
        region: '',
      }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty description in diagnoses', () => {
    const result = painManagementReviewFormSchema.safeParse({
      ...reviewData,
      diagnoses: [{ icd10_code: 'M54.5', description: '' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty description in treatment_plan', () => {
    const result = painManagementReviewFormSchema.safeParse({
      ...reviewData,
      treatment_plan: [{
        ...validExtraction.treatment_plan[0],
        description: '',
      }],
    })
    expect(result.success).toBe(false)
  })
})
