import { z } from 'zod'

// --- Chief complaint schema ---

const chiefComplaintSchema = z.object({
  location: z.string(),
  pain_rating_min: z.number().nullable(),
  pain_rating_max: z.number().nullable(),
  radiation: z.string().nullable(),
  aggravating_factors: z.array(z.string()),
  alleviating_factors: z.array(z.string()),
})

// --- Range of motion measurement ---

const romMeasurementSchema = z.object({
  movement: z.string(),
  normal: z.number().nullable(),
  actual: z.number().nullable(),
  pain: z.boolean(),
})

// --- Orthopedic test ---

const orthopedicTestSchema = z.object({
  name: z.string(),
  result: z.enum(['positive', 'negative']),
})

// --- Physical exam region ---

const physicalExamRegionSchema = z.object({
  region: z.string(),
  palpation_findings: z.string().nullable(),
  range_of_motion: z.array(romMeasurementSchema),
  orthopedic_tests: z.array(orthopedicTestSchema),
  neurological_summary: z.string().nullable(),
})

// --- Diagnosis ---

const diagnosisSchema = z.object({
  icd10_code: z.string().nullable(),
  description: z.string(),
})

// --- Treatment plan item ---

const treatmentPlanItemSchema = z.object({
  description: z.string(),
  type: z.enum([
    'continuation', 'injection', 'therapy', 'medication',
    'surgery', 'monitoring', 'alternative', 'other',
  ]).nullable(),
  estimated_cost_min: z.number().nullable(),
  estimated_cost_max: z.number().nullable(),
  body_region: z.string().nullable(),
})

// --- AI extraction result schema ---

export const painManagementExtractionResultSchema = z.object({
  report_date: z.string().nullable(),
  date_of_injury: z.string().nullable(),
  examining_provider: z.string().nullable(),
  chief_complaints: z.array(chiefComplaintSchema),
  physical_exam: z.array(physicalExamRegionSchema),
  diagnoses: z.array(diagnosisSchema),
  treatment_plan: z.array(treatmentPlanItemSchema),
  diagnostic_studies_summary: z.string().nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  extraction_notes: z.string().nullable(),
})

export type PainManagementExtractionResult = z.infer<typeof painManagementExtractionResultSchema>
export type ChiefComplaint = z.infer<typeof chiefComplaintSchema>
export type PhysicalExamRegion = z.infer<typeof physicalExamRegionSchema>
export type RomMeasurement = z.infer<typeof romMeasurementSchema>
export type OrthopedicTest = z.infer<typeof orthopedicTestSchema>
export type PmDiagnosis = z.infer<typeof diagnosisSchema>
export type TreatmentPlanItem = z.infer<typeof treatmentPlanItemSchema>

// --- Provider review form schema ---

export const painManagementReviewFormSchema = z.object({
  report_date: z.string().nullable(),
  date_of_injury: z.string().nullable(),
  examining_provider: z.string().nullable(),
  chief_complaints: z.array(chiefComplaintSchema.extend({
    location: z.string().min(1, 'Location is required'),
  })),
  physical_exam: z.array(physicalExamRegionSchema.extend({
    region: z.string().min(1, 'Region is required'),
  })),
  diagnoses: z.array(diagnosisSchema.extend({
    description: z.string().min(1, 'Description is required'),
  })),
  treatment_plan: z.array(treatmentPlanItemSchema.extend({
    description: z.string().min(1, 'Description is required'),
  })),
  diagnostic_studies_summary: z.string().nullable(),
})

export type PainManagementReviewFormValues = z.infer<typeof painManagementReviewFormSchema>
