import { z } from 'zod'

// --- AI extraction output schema (matches Claude structured output) ---

export const reportTypeEnum = z.enum([
  'initial_evaluation', 'soap_note', 're_evaluation',
  'discharge_summary', 'other',
])

const treatmentGapSchema = z.object({
  from: z.string(),
  to: z.string(),
  days: z.number(),
})

const treatmentDatesSchema = z.object({
  first_visit: z.string().nullable(),
  last_visit: z.string().nullable(),
  total_visits: z.number().nullable(),
  visit_dates: z.array(z.string()),
  treatment_gaps: z.array(treatmentGapSchema),
})

const diagnosisSchema = z.object({
  icd10_code: z.string().nullable(),
  description: z.string(),
  region: z.enum([
    'cervical', 'thoracic', 'lumbar', 'sacral',
    'upper_extremity', 'lower_extremity', 'other',
  ]).nullable(),
  is_primary: z.boolean(),
})

const treatmentModalitySchema = z.object({
  modality: z.string(),
  cpt_code: z.string().nullable(),
  regions_treated: z.array(z.string()),
  frequency: z.string().nullable(),
})

const painLevelSchema = z.object({
  date: z.string().nullable(),
  scale: z.string(),
  score: z.number(),
  max_score: z.number(),
  context: z.string().nullable(),
})

const disabilityScoreSchema = z.object({
  date: z.string().nullable(),
  instrument: z.string(),
  score: z.number(),
  max_score: z.number(),
  percent_disability: z.number().nullable(),
  interpretation: z.string().nullable(),
})

const functionalOutcomesSchema = z.object({
  pain_levels: z.array(painLevelSchema),
  disability_scores: z.array(disabilityScoreSchema),
  progress_status: z.enum([
    'improving', 'stable', 'plateauing', 'worsening',
  ]).nullable(),
})

const plateauStatementSchema = z.object({
  present: z.boolean(),
  mmi_reached: z.boolean().nullable(),
  date: z.string().nullable(),
  verbatim_statement: z.string().nullable(),
  residual_complaints: z.array(z.string()),
  permanent_restrictions: z.array(z.string()),
  impairment_rating_percent: z.number().nullable(),
  future_care_recommended: z.boolean().nullable(),
})

export const chiroExtractionResultSchema = z.object({
  report_type: reportTypeEnum,
  report_date: z.string().nullable(),
  treatment_dates: treatmentDatesSchema,
  diagnoses: z.array(diagnosisSchema),
  treatment_modalities: z.array(treatmentModalitySchema),
  functional_outcomes: functionalOutcomesSchema,
  plateau_statement: plateauStatementSchema,
  confidence: z.enum(['high', 'medium', 'low']),
  extraction_notes: z.string().nullable(),
})

export type ChiroExtractionResult = z.infer<typeof chiroExtractionResultSchema>
export type Diagnosis = z.infer<typeof diagnosisSchema>
export type TreatmentModality = z.infer<typeof treatmentModalitySchema>
export type PainLevel = z.infer<typeof painLevelSchema>
export type DisabilityScore = z.infer<typeof disabilityScoreSchema>
export type TreatmentDates = z.infer<typeof treatmentDatesSchema>
export type FunctionalOutcomes = z.infer<typeof functionalOutcomesSchema>
export type PlateauStatement = z.infer<typeof plateauStatementSchema>

// --- Provider review form schema ---

export const chiroReviewFormSchema = z.object({
  report_type: reportTypeEnum,
  report_date: z.string().nullable(),
  treatment_dates: treatmentDatesSchema,
  diagnoses: z.array(diagnosisSchema.extend({
    description: z.string().min(1, 'Description is required'),
  })),
  treatment_modalities: z.array(treatmentModalitySchema.extend({
    modality: z.string().min(1, 'Modality is required'),
  })),
  functional_outcomes: functionalOutcomesSchema,
  plateau_statement: plateauStatementSchema,
})

export type ChiroReviewFormValues = z.infer<typeof chiroReviewFormSchema>
