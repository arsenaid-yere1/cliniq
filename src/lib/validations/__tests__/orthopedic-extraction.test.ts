import { describe, it, expect } from 'vitest'
import {
  orthopedicExtractionResultSchema,
  orthopedicReviewFormSchema,
} from '../orthopedic-extraction'

const validExtraction = {
  report_date: '2025-03-01',
  date_of_injury: '2024-10-20',
  examining_provider: 'Dr. Anderson, MD',
  provider_specialty: 'Orthopedic Surgery',
  patient_age: 45,
  patient_sex: 'Male',
  hand_dominance: 'Right',
  height: '5\'10"',
  weight: '185 lbs',
  current_employment: 'Warehouse worker',
  history_of_injury: 'Slip and fall at workplace',
  past_medical_history: 'Hypertension',
  surgical_history: 'None',
  previous_complaints: null,
  subsequent_complaints: null,
  allergies: 'NKDA',
  social_history: 'Non-smoker',
  family_history: 'No significant musculoskeletal history',
  present_complaints: [
    {
      location: 'Right shoulder',
      description: 'Pain with overhead activities',
      radiation: 'Down to elbow',
      pre_existing: false,
    },
  ],
  current_medications: [
    {
      name: 'Ibuprofen',
      details: '800mg TID',
    },
  ],
  physical_exam: [
    {
      region: 'Right shoulder',
      rom_summary: 'Limited flexion and abduction',
      tenderness: 'Anterior and lateral',
      strength: '4/5 abduction',
      neurovascular: 'Intact',
      special_tests: 'Positive Neer and Hawkins',
    },
  ],
  diagnostics: [
    {
      modality: 'MRI',
      body_region: 'Right shoulder',
      study_date: '2025-02-15',
      findings: 'Partial thickness rotator cuff tear',
      films_available: true,
    },
  ],
  diagnoses: [
    {
      icd10_code: 'M75.11',
      description: 'Incomplete rotator cuff tear of right shoulder',
    },
  ],
  recommendations: [
    {
      description: 'Physical therapy 3x/week for 6 weeks',
      type: 'therapy' as const,
      estimated_cost_min: 2000,
      estimated_cost_max: 4000,
      body_region: 'Right shoulder',
      follow_up_timeframe: '6 weeks',
    },
  ],
  confidence: 'high' as const,
  extraction_notes: null,
}

describe('orthopedicExtractionResultSchema', () => {
  it('accepts valid extraction data', () => {
    expect(orthopedicExtractionResultSchema.safeParse(validExtraction).success).toBe(true)
  })

  it('accepts nullable fields as null', () => {
    const result = orthopedicExtractionResultSchema.safeParse({
      ...validExtraction,
      report_date: null,
      date_of_injury: null,
      examining_provider: null,
      provider_specialty: null,
      patient_age: null,
      patient_sex: null,
      hand_dominance: null,
      height: null,
      weight: null,
      current_employment: null,
      history_of_injury: null,
      past_medical_history: null,
      surgical_history: null,
      allergies: null,
      social_history: null,
      family_history: null,
      extraction_notes: null,
      present_complaints: [{
        ...validExtraction.present_complaints[0],
        radiation: null,
      }],
      recommendations: [{
        ...validExtraction.recommendations[0],
        type: null,
        estimated_cost_min: null,
        estimated_cost_max: null,
        body_region: null,
        follow_up_timeframe: null,
      }],
    })
    expect(result.success).toBe(true)
  })

  it('accepts empty arrays for optional collections', () => {
    const result = orthopedicExtractionResultSchema.safeParse({
      ...validExtraction,
      present_complaints: [],
      current_medications: [],
      physical_exam: [],
      diagnostics: [],
      diagnoses: [],
      recommendations: [],
    })
    expect(result.success).toBe(true)
  })

  it('accepts films_available as boolean', () => {
    const result = orthopedicExtractionResultSchema.safeParse({
      ...validExtraction,
      diagnostics: [{
        ...validExtraction.diagnostics[0],
        films_available: false,
      }],
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid confidence value', () => {
    expect(
      orthopedicExtractionResultSchema.safeParse({
        ...validExtraction,
        confidence: 'critical',
      }).success,
    ).toBe(false)
  })
})

describe('orthopedicReviewFormSchema', () => {
  const { confidence, extraction_notes, ...reviewData } = validExtraction

  it('accepts valid review data', () => {
    expect(orthopedicReviewFormSchema.safeParse(reviewData).success).toBe(true)
  })

  it('rejects empty location in present_complaints', () => {
    const result = orthopedicReviewFormSchema.safeParse({
      ...reviewData,
      present_complaints: [{
        ...validExtraction.present_complaints[0],
        location: '',
      }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty name in current_medications', () => {
    const result = orthopedicReviewFormSchema.safeParse({
      ...reviewData,
      current_medications: [{ name: '', details: null }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty region in physical_exam', () => {
    const result = orthopedicReviewFormSchema.safeParse({
      ...reviewData,
      physical_exam: [{
        ...validExtraction.physical_exam[0],
        region: '',
      }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty fields in diagnostics', () => {
    const result = orthopedicReviewFormSchema.safeParse({
      ...reviewData,
      diagnostics: [{
        modality: '',
        body_region: '',
        study_date: null,
        findings: '',
        films_available: true,
      }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty description in diagnoses', () => {
    const result = orthopedicReviewFormSchema.safeParse({
      ...reviewData,
      diagnoses: [{ icd10_code: 'M75.11', description: '' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty description in recommendations', () => {
    const result = orthopedicReviewFormSchema.safeParse({
      ...reviewData,
      recommendations: [{
        ...validExtraction.recommendations[0],
        description: '',
      }],
    })
    expect(result.success).toBe(false)
  })
})
