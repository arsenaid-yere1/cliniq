import { z } from 'zod'

// --- Present complaint schema ---

const presentComplaintSchema = z.object({
  location: z.string(),
  description: z.string(),
  radiation: z.string().nullable(),
  pre_existing: z.boolean(),
})

// --- Current medication schema ---

const currentMedicationSchema = z.object({
  name: z.string(),
  details: z.string().nullable(),
})

// --- Physical exam region schema ---

const physicalExamRegionSchema = z.object({
  region: z.string(),
  rom_summary: z.string().nullable(),
  tenderness: z.string().nullable(),
  strength: z.string().nullable(),
  neurovascular: z.string().nullable(),
  special_tests: z.string().nullable(),
})

// --- Diagnostic study schema ---

const diagnosticStudySchema = z.object({
  modality: z.string(),
  body_region: z.string(),
  study_date: z.string().nullable(),
  findings: z.string(),
  films_available: z.boolean(),
})

// --- Diagnosis schema ---

const diagnosisSchema = z.object({
  icd10_code: z.string().nullable(),
  description: z.string(),
})

// --- Recommendation schema ---

const recommendationSchema = z.object({
  description: z.string(),
  type: z.enum([
    'therapy', 'injection', 'referral', 'monitoring', 'surgery', 'other',
  ]).nullable(),
  estimated_cost_min: z.number().nullable(),
  estimated_cost_max: z.number().nullable(),
  body_region: z.string().nullable(),
  follow_up_timeframe: z.string().nullable(),
})

// --- AI extraction result schema ---

export const orthopedicExtractionResultSchema = z.object({
  report_date: z.string().nullable(),
  date_of_injury: z.string().nullable(),
  examining_provider: z.string().nullable(),
  provider_specialty: z.string().nullable(),
  patient_age: z.number().nullable(),
  patient_sex: z.string().nullable(),
  hand_dominance: z.string().nullable(),
  height: z.string().nullable(),
  weight: z.string().nullable(),
  current_employment: z.string().nullable(),
  history_of_injury: z.string().nullable(),
  past_medical_history: z.string().nullable(),
  surgical_history: z.string().nullable(),
  previous_complaints: z.string().nullable(),
  subsequent_complaints: z.string().nullable(),
  allergies: z.string().nullable(),
  social_history: z.string().nullable(),
  family_history: z.string().nullable(),
  present_complaints: z.array(presentComplaintSchema),
  current_medications: z.array(currentMedicationSchema),
  physical_exam: z.array(physicalExamRegionSchema),
  diagnostics: z.array(diagnosticStudySchema),
  diagnoses: z.array(diagnosisSchema),
  recommendations: z.array(recommendationSchema),
  confidence: z.enum(['high', 'medium', 'low']),
  extraction_notes: z.string().nullable(),
})

export type OrthopedicExtractionResult = z.infer<typeof orthopedicExtractionResultSchema>
export type PresentComplaint = z.infer<typeof presentComplaintSchema>
export type CurrentMedication = z.infer<typeof currentMedicationSchema>
export type OrthoPhysicalExamRegion = z.infer<typeof physicalExamRegionSchema>
export type DiagnosticStudy = z.infer<typeof diagnosticStudySchema>
export type OrthoDiagnosis = z.infer<typeof diagnosisSchema>
export type Recommendation = z.infer<typeof recommendationSchema>

// --- Provider review form schema ---

export const orthopedicReviewFormSchema = z.object({
  report_date: z.string().nullable(),
  date_of_injury: z.string().nullable(),
  examining_provider: z.string().nullable(),
  provider_specialty: z.string().nullable(),
  patient_age: z.number().nullable(),
  patient_sex: z.string().nullable(),
  hand_dominance: z.string().nullable(),
  height: z.string().nullable(),
  weight: z.string().nullable(),
  current_employment: z.string().nullable(),
  history_of_injury: z.string().nullable(),
  past_medical_history: z.string().nullable(),
  surgical_history: z.string().nullable(),
  previous_complaints: z.string().nullable(),
  subsequent_complaints: z.string().nullable(),
  allergies: z.string().nullable(),
  social_history: z.string().nullable(),
  family_history: z.string().nullable(),
  present_complaints: z.array(presentComplaintSchema.extend({
    location: z.string().min(1, 'Location is required'),
  })),
  current_medications: z.array(currentMedicationSchema.extend({
    name: z.string().min(1, 'Name is required'),
  })),
  physical_exam: z.array(physicalExamRegionSchema.extend({
    region: z.string().min(1, 'Region is required'),
  })),
  diagnostics: z.array(diagnosticStudySchema.extend({
    modality: z.string().min(1, 'Modality is required'),
    body_region: z.string().min(1, 'Body region is required'),
    findings: z.string().min(1, 'Findings are required'),
  })),
  diagnoses: z.array(diagnosisSchema.extend({
    description: z.string().min(1, 'Description is required'),
  })),
  recommendations: z.array(recommendationSchema.extend({
    description: z.string().min(1, 'Description is required'),
  })),
})

export type OrthopedicReviewFormValues = z.infer<typeof orthopedicReviewFormSchema>
