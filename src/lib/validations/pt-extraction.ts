import { z } from 'zod'

// --- Pain ratings ---

const painRatingsSchema = z.object({
  at_rest: z.number().nullable(),
  with_activity: z.number().nullable(),
  worst: z.number().nullable(),
  best: z.number().nullable(),
})

// --- ROM measurement ---

const romMeasurementSchema = z.object({
  region: z.string(),
  movement: z.string(),
  measurement_type: z.enum(['AROM', 'PROM']).nullable(),
  normal: z.number().nullable(),
  actual: z.number().nullable(),
  pain_at_end_range: z.boolean(),
})

// --- Muscle strength ---

const muscleStrengthSchema = z.object({
  muscle_group: z.string(),
  side: z.enum(['left', 'right', 'bilateral']).nullable(),
  grade: z.string(),
})

// --- Palpation finding ---

const palpationFindingSchema = z.object({
  location: z.string(),
  tenderness_grade: z.string().nullable(),
  spasm: z.boolean(),
  trigger_points: z.boolean(),
})

// --- Special test ---

const specialTestSchema = z.object({
  name: z.string(),
  result: z.enum(['positive', 'negative']),
  side: z.enum(['left', 'right', 'bilateral']).nullable(),
  notes: z.string().nullable(),
})

// --- Neurological screening ---

const neurologicalScreeningSchema = z.object({
  reflexes: z.array(z.object({
    location: z.string(),
    grade: z.string(),
    side: z.enum(['left', 'right', 'bilateral']).nullable(),
  })),
  sensation: z.string().nullable(),
  motor_notes: z.string().nullable(),
})

// --- Functional test ---

const functionalTestSchema = z.object({
  name: z.string(),
  value: z.string(),
  interpretation: z.string().nullable(),
})

// --- Outcome measure ---

const outcomeMeasureSchema = z.object({
  instrument: z.string(),
  score: z.number().nullable(),
  max_score: z.number().nullable(),
  percentage: z.number().nullable(),
  interpretation: z.string().nullable(),
})

// --- Treatment goal ---

const treatmentGoalSchema = z.object({
  description: z.string(),
  timeframe: z.string().nullable(),
  baseline: z.string().nullable(),
  target: z.string().nullable(),
})

// --- Plan of care ---

const planOfCareSchema = z.object({
  frequency: z.string().nullable(),
  duration: z.string().nullable(),
  modalities: z.array(z.object({
    name: z.string(),
    cpt_code: z.string().nullable(),
  })),
  home_exercise_program: z.boolean().nullable(),
  re_evaluation_schedule: z.string().nullable(),
})

// --- Diagnosis ---

const diagnosisSchema = z.object({
  icd10_code: z.string().nullable(),
  description: z.string(),
})

// --- AI extraction result schema ---

export const ptExtractionResultSchema = z.object({
  evaluation_date: z.string().nullable(),
  date_of_injury: z.string().nullable(),
  evaluating_therapist: z.string().nullable(),
  referring_provider: z.string().nullable(),
  chief_complaint: z.string().nullable(),
  mechanism_of_injury: z.string().nullable(),
  pain_ratings: painRatingsSchema,
  functional_limitations: z.string().nullable(),
  prior_treatment: z.string().nullable(),
  work_status: z.string().nullable(),
  postural_assessment: z.string().nullable(),
  gait_analysis: z.string().nullable(),
  range_of_motion: z.array(romMeasurementSchema),
  muscle_strength: z.array(muscleStrengthSchema),
  palpation_findings: z.array(palpationFindingSchema),
  special_tests: z.array(specialTestSchema),
  neurological_screening: neurologicalScreeningSchema,
  functional_tests: z.array(functionalTestSchema),
  outcome_measures: z.array(outcomeMeasureSchema),
  clinical_impression: z.string().nullable(),
  causation_statement: z.string().nullable(),
  prognosis: z.string().nullable(),
  short_term_goals: z.array(treatmentGoalSchema),
  long_term_goals: z.array(treatmentGoalSchema),
  plan_of_care: planOfCareSchema,
  diagnoses: z.array(diagnosisSchema),
  confidence: z.enum(['high', 'medium', 'low']),
  extraction_notes: z.string().nullable(),
})

export type PtExtractionResult = z.infer<typeof ptExtractionResultSchema>
export type PainRatings = z.infer<typeof painRatingsSchema>
export type PtRomMeasurement = z.infer<typeof romMeasurementSchema>
export type MuscleStrength = z.infer<typeof muscleStrengthSchema>
export type PalpationFinding = z.infer<typeof palpationFindingSchema>
export type SpecialTest = z.infer<typeof specialTestSchema>
export type NeurologicalScreening = z.infer<typeof neurologicalScreeningSchema>
export type FunctionalTest = z.infer<typeof functionalTestSchema>
export type OutcomeMeasure = z.infer<typeof outcomeMeasureSchema>
export type TreatmentGoal = z.infer<typeof treatmentGoalSchema>
export type PlanOfCare = z.infer<typeof planOfCareSchema>
export type PtDiagnosis = z.infer<typeof diagnosisSchema>

// --- Provider review form schema ---

export const ptReviewFormSchema = z.object({
  evaluation_date: z.string().nullable(),
  date_of_injury: z.string().nullable(),
  evaluating_therapist: z.string().nullable(),
  referring_provider: z.string().nullable(),
  chief_complaint: z.string().nullable(),
  mechanism_of_injury: z.string().nullable(),
  pain_ratings: painRatingsSchema,
  functional_limitations: z.string().nullable(),
  prior_treatment: z.string().nullable(),
  work_status: z.string().nullable(),
  postural_assessment: z.string().nullable(),
  gait_analysis: z.string().nullable(),
  range_of_motion: z.array(romMeasurementSchema),
  muscle_strength: z.array(muscleStrengthSchema.extend({
    muscle_group: z.string().min(1, 'Muscle group is required'),
  })),
  palpation_findings: z.array(palpationFindingSchema),
  special_tests: z.array(specialTestSchema),
  neurological_screening: neurologicalScreeningSchema,
  functional_tests: z.array(functionalTestSchema),
  outcome_measures: z.array(outcomeMeasureSchema.extend({
    instrument: z.string().min(1, 'Instrument name is required'),
  })),
  clinical_impression: z.string().nullable(),
  causation_statement: z.string().nullable(),
  prognosis: z.string().nullable(),
  short_term_goals: z.array(treatmentGoalSchema.extend({
    description: z.string().min(1, 'Goal description is required'),
  })),
  long_term_goals: z.array(treatmentGoalSchema.extend({
    description: z.string().min(1, 'Goal description is required'),
  })),
  plan_of_care: planOfCareSchema,
  diagnoses: z.array(diagnosisSchema.extend({
    description: z.string().min(1, 'Description is required'),
  })),
})

export type PtReviewFormValues = z.infer<typeof ptReviewFormSchema>
