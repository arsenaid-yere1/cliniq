import { describe, it, expect } from 'vitest'
import {
  ptExtractionResultSchema,
  ptReviewFormSchema,
} from '../pt-extraction'

const validExtraction = {
  evaluation_date: '2025-01-15',
  date_of_injury: '2024-12-01',
  evaluating_therapist: 'Dr. Smith, PT',
  referring_provider: 'Dr. Jones, MD',
  chief_complaint: 'Low back pain radiating to left leg',
  mechanism_of_injury: 'Motor vehicle accident',
  pain_ratings: {
    at_rest: 4,
    with_activity: 7,
    worst: 9,
    best: 2,
  },
  functional_limitations: 'Unable to sit for more than 20 minutes',
  prior_treatment: 'Ibuprofen 800mg TID',
  work_status: 'Modified duty',
  postural_assessment: 'Mild thoracic kyphosis',
  gait_analysis: 'Antalgic gait, favoring left side',
  range_of_motion: [
    {
      region: 'Lumbar spine',
      movement: 'Flexion',
      measurement_type: 'AROM' as const,
      normal: 80,
      actual: 50,
      pain_at_end_range: true,
    },
  ],
  muscle_strength: [
    {
      muscle_group: 'Quadriceps',
      side: 'left' as const,
      grade: '4/5',
    },
  ],
  palpation_findings: [
    {
      location: 'L4-L5 paraspinals',
      tenderness_grade: 'moderate',
      spasm: true,
      trigger_points: false,
    },
  ],
  special_tests: [
    {
      name: 'Straight Leg Raise',
      result: 'positive' as const,
      side: 'left' as const,
      notes: 'Positive at 45 degrees',
    },
  ],
  neurological_screening: {
    reflexes: [
      {
        location: 'Patellar',
        grade: '2+',
        side: 'left' as const,
      },
    ],
    sensation: 'Decreased L5 dermatome left',
    motor_notes: 'EHL weakness left 4/5',
  },
  functional_tests: [
    {
      name: 'Timed Up and Go',
      value: '14 seconds',
      interpretation: 'Mildly impaired',
    },
  ],
  outcome_measures: [
    {
      instrument: 'Oswestry Disability Index',
      score: 42,
      max_score: 100,
      percentage: 42,
      interpretation: 'Moderate disability',
    },
  ],
  clinical_impression: 'Lumbar radiculopathy secondary to disc herniation',
  causation_statement: 'Injury is consistent with reported MVA mechanism',
  prognosis: 'Good with conservative treatment over 8-12 weeks',
  short_term_goals: [
    {
      description: 'Reduce pain to 4/10 with activity',
      timeframe: '4 weeks',
      baseline: '7/10',
      target: '4/10',
    },
  ],
  long_term_goals: [
    {
      description: 'Return to full work duties',
      timeframe: '12 weeks',
      baseline: 'Modified duty',
      target: 'Full duty',
    },
  ],
  plan_of_care: {
    frequency: '3x/week',
    duration: '8 weeks',
    modalities: [
      { name: 'Therapeutic exercise', cpt_code: '97110' },
      { name: 'Manual therapy', cpt_code: '97140' },
    ],
    home_exercise_program: true,
    re_evaluation_schedule: 'Every 4 weeks',
  },
  diagnoses: [
    {
      icd10_code: 'M54.5',
      description: 'Low back pain',
    },
  ],
  confidence: 'high' as const,
  extraction_notes: null,
}

describe('ptExtractionResultSchema', () => {
  it('accepts valid extraction data', () => {
    expect(ptExtractionResultSchema.safeParse(validExtraction).success).toBe(true)
  })

  it('accepts nullable fields as null', () => {
    const result = ptExtractionResultSchema.safeParse({
      ...validExtraction,
      evaluation_date: null,
      date_of_injury: null,
      evaluating_therapist: null,
      referring_provider: null,
      chief_complaint: null,
      mechanism_of_injury: null,
      functional_limitations: null,
      prior_treatment: null,
      work_status: null,
      postural_assessment: null,
      gait_analysis: null,
      clinical_impression: null,
      causation_statement: null,
      prognosis: null,
      extraction_notes: null,
    })
    expect(result.success).toBe(true)
  })

  it('accepts empty arrays for optional collections', () => {
    const result = ptExtractionResultSchema.safeParse({
      ...validExtraction,
      range_of_motion: [],
      muscle_strength: [],
      palpation_findings: [],
      special_tests: [],
      functional_tests: [],
      outcome_measures: [],
      short_term_goals: [],
      long_term_goals: [],
      diagnoses: [],
    })
    expect(result.success).toBe(true)
  })

  it('accepts nullable sub-schema fields', () => {
    const result = ptExtractionResultSchema.safeParse({
      ...validExtraction,
      pain_ratings: { at_rest: null, with_activity: null, worst: null, best: null },
      range_of_motion: [{
        region: 'Lumbar', movement: 'Flexion',
        measurement_type: null, normal: null, actual: null, pain_at_end_range: false,
      }],
      muscle_strength: [{ muscle_group: 'Quads', side: null, grade: '5/5' }],
      special_tests: [{
        name: 'SLR', result: 'negative' as const, side: null, notes: null,
      }],
    })
    expect(result.success).toBe(true)
  })

  it('accepts all confidence values', () => {
    for (const val of ['high', 'medium', 'low']) {
      expect(
        ptExtractionResultSchema.safeParse({ ...validExtraction, confidence: val }).success,
      ).toBe(true)
    }
  })

  it('rejects invalid confidence value', () => {
    expect(
      ptExtractionResultSchema.safeParse({ ...validExtraction, confidence: 'very_high' }).success,
    ).toBe(false)
  })
})

describe('ptReviewFormSchema', () => {
  const { confidence, extraction_notes, ...reviewData } = validExtraction

  it('accepts valid review data', () => {
    expect(ptReviewFormSchema.safeParse(reviewData).success).toBe(true)
  })

  it('rejects empty muscle_group in muscle_strength', () => {
    const result = ptReviewFormSchema.safeParse({
      ...reviewData,
      muscle_strength: [{ muscle_group: '', side: null, grade: '5/5' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty instrument in outcome_measures', () => {
    const result = ptReviewFormSchema.safeParse({
      ...reviewData,
      outcome_measures: [{
        instrument: '', score: 42, max_score: 100, percentage: 42, interpretation: null,
      }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty description in short_term_goals', () => {
    const result = ptReviewFormSchema.safeParse({
      ...reviewData,
      short_term_goals: [{ description: '', timeframe: null, baseline: null, target: null }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty description in long_term_goals', () => {
    const result = ptReviewFormSchema.safeParse({
      ...reviewData,
      long_term_goals: [{ description: '', timeframe: null, baseline: null, target: null }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty description in diagnoses', () => {
    const result = ptReviewFormSchema.safeParse({
      ...reviewData,
      diagnoses: [{ icd10_code: 'M54.5', description: '' }],
    })
    expect(result.success).toBe(false)
  })
})
