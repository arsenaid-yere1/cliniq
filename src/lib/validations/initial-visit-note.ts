import { z } from 'zod'

// --- Section names (16 sections matching provider template) ---

export const initialVisitSections = [
  'introduction',
  'history_of_accident',
  'post_accident_history',
  'chief_complaint',
  'past_medical_history',
  'social_history',
  'review_of_systems',
  'physical_exam',
  'imaging_findings',
  'diagnoses',
  'medical_necessity',
  'treatment_plan',
  'patient_education',
  'prognosis',
  'time_complexity_attestation',
  'clinician_disclaimer',
] as const

export type InitialVisitSection = typeof initialVisitSections[number]

// --- Section display labels ---

export const sectionLabels: Record<InitialVisitSection, string> = {
  introduction: 'Introduction',
  history_of_accident: 'History of the Accident',
  post_accident_history: 'Post-Accident History',
  chief_complaint: 'Chief Complaint',
  past_medical_history: 'Past Medical History',
  social_history: 'Social History',
  review_of_systems: 'Review of Systems',
  physical_exam: 'Physical Examination',
  imaging_findings: 'Radiological Imaging Findings',
  diagnoses: 'Diagnoses',
  medical_necessity: 'Medical Necessity',
  treatment_plan: 'Treatment Plan',
  patient_education: 'Patient Education',
  prognosis: 'Prognosis',
  time_complexity_attestation: 'Time & Complexity Attestation',
  clinician_disclaimer: 'Clinician Disclaimer',
}

// --- AI output schema (validates Claude's tool output) ---

export const initialVisitNoteResultSchema = z.object({
  introduction: z.string(),
  history_of_accident: z.string(),
  post_accident_history: z.string(),
  chief_complaint: z.string(),
  past_medical_history: z.string(),
  social_history: z.string(),
  review_of_systems: z.string(),
  physical_exam: z.string(),
  imaging_findings: z.string(),
  medical_necessity: z.string(),
  diagnoses: z.string(),
  treatment_plan: z.string(),
  patient_education: z.string(),
  prognosis: z.string(),
  time_complexity_attestation: z.string(),
  clinician_disclaimer: z.string(),
})

export type InitialVisitNoteResult = z.infer<typeof initialVisitNoteResultSchema>

// --- Provider edit form schema ---

export const initialVisitNoteEditSchema = z.object({
  introduction: z.string().min(1, 'Introduction is required'),
  history_of_accident: z.string().min(1, 'History of the accident is required'),
  post_accident_history: z.string().min(1, 'Post-accident history is required'),
  chief_complaint: z.string().min(1, 'Chief complaint is required'),
  past_medical_history: z.string().min(1, 'Past medical history is required'),
  social_history: z.string().min(1, 'Social history is required'),
  review_of_systems: z.string().min(1, 'Review of systems is required'),
  physical_exam: z.string().min(1, 'Physical exam is required'),
  imaging_findings: z.string().min(1, 'Imaging findings are required'),
  medical_necessity: z.string().min(1, 'Medical necessity is required'),
  diagnoses: z.string().min(1, 'Diagnoses are required'),
  treatment_plan: z.string().min(1, 'Treatment plan is required'),
  patient_education: z.string().min(1, 'Patient education is required'),
  prognosis: z.string().min(1, 'Prognosis is required'),
  time_complexity_attestation: z.string().min(1, 'Time & complexity attestation is required'),
  clinician_disclaimer: z.string().min(1, 'Clinician disclaimer is required'),
})

export type InitialVisitNoteEditValues = z.infer<typeof initialVisitNoteEditSchema>

// --- Initial visit vital signs schema ---

export const initialVisitVitalsSchema = z.object({
  bp_systolic: z.number().int().min(1).max(300).nullable(),
  bp_diastolic: z.number().int().min(1).max(200).nullable(),
  heart_rate: z.number().int().min(1).max(300).nullable(),
  respiratory_rate: z.number().int().min(1).max(60).nullable(),
  temperature_f: z.number().min(90).max(110).nullable(),
  spo2_percent: z.number().int().min(0).max(100).nullable(),
  pain_score_min: z.number().int().min(0).max(10).nullable(),
  pain_score_max: z.number().int().min(0).max(10).nullable(),
})

export type InitialVisitVitalsValues = z.infer<typeof initialVisitVitalsSchema>

// --- ROM measurement schemas ---

export const romMovementSchema = z.object({
  movement: z.string().min(1, 'Movement is required'),
  normal: z.number().int().min(0).max(360).nullable(),
  actual: z.number().int().min(0).max(360).nullable(),
  pain: z.boolean(),
})

export type RomMovement = z.infer<typeof romMovementSchema>

export const romRegionSchema = z.object({
  region: z.string().min(1, 'Region is required'),
  movements: z.array(romMovementSchema).min(1, 'At least one movement is required'),
})

export type RomRegion = z.infer<typeof romRegionSchema>

export const initialVisitRomSchema = z.array(romRegionSchema)

export type InitialVisitRomValues = z.infer<typeof initialVisitRomSchema>

// --- Default ROM template (pre-populated for new entries) ---

export const defaultRomData: InitialVisitRomValues = [
  {
    region: 'Cervical Spine',
    movements: [
      { movement: 'Flexion', normal: 60, actual: null, pain: false },
      { movement: 'Extension', normal: 75, actual: null, pain: false },
      { movement: 'Left Lateral Flexion', normal: 45, actual: null, pain: false },
      { movement: 'Right Lateral Flexion', normal: 45, actual: null, pain: false },
      { movement: 'Left Rotation', normal: 80, actual: null, pain: false },
      { movement: 'Right Rotation', normal: 80, actual: null, pain: false },
    ],
  },
  {
    region: 'Thoracic Spine',
    movements: [
      { movement: 'Flexion', normal: 45, actual: null, pain: false },
      { movement: 'Extension', normal: 25, actual: null, pain: false },
      { movement: 'Left Rotation', normal: 30, actual: null, pain: false },
      { movement: 'Right Rotation', normal: 30, actual: null, pain: false },
    ],
  },
  {
    region: 'Lumbar Spine',
    movements: [
      { movement: 'Flexion', normal: 60, actual: null, pain: false },
      { movement: 'Extension', normal: 25, actual: null, pain: false },
      { movement: 'Left Lateral Flexion', normal: 25, actual: null, pain: false },
      { movement: 'Right Lateral Flexion', normal: 25, actual: null, pain: false },
      { movement: 'Left Rotation', normal: 30, actual: null, pain: false },
      { movement: 'Right Rotation', normal: 30, actual: null, pain: false },
    ],
  },
  {
    region: 'Left Shoulder',
    movements: [
      { movement: 'Flexion', normal: 180, actual: null, pain: false },
      { movement: 'Extension', normal: 60, actual: null, pain: false },
      { movement: 'Abduction', normal: 180, actual: null, pain: false },
      { movement: 'Adduction', normal: 45, actual: null, pain: false },
      { movement: 'Internal Rotation', normal: 70, actual: null, pain: false },
      { movement: 'External Rotation', normal: 90, actual: null, pain: false },
    ],
  },
  {
    region: 'Right Shoulder',
    movements: [
      { movement: 'Flexion', normal: 180, actual: null, pain: false },
      { movement: 'Extension', normal: 60, actual: null, pain: false },
      { movement: 'Abduction', normal: 180, actual: null, pain: false },
      { movement: 'Adduction', normal: 45, actual: null, pain: false },
      { movement: 'Internal Rotation', normal: 70, actual: null, pain: false },
      { movement: 'External Rotation', normal: 90, actual: null, pain: false },
    ],
  },
  {
    region: 'Left Knee',
    movements: [
      { movement: 'Flexion', normal: 140, actual: null, pain: false },
      { movement: 'Extension', normal: 0, actual: null, pain: false },
    ],
  },
  {
    region: 'Right Knee',
    movements: [
      { movement: 'Flexion', normal: 140, actual: null, pain: false },
      { movement: 'Extension', normal: 0, actual: null, pain: false },
    ],
  },
  {
    region: 'Left Hip',
    movements: [
      { movement: 'Flexion', normal: 120, actual: null, pain: false },
      { movement: 'Extension', normal: 30, actual: null, pain: false },
      { movement: 'Abduction', normal: 45, actual: null, pain: false },
      { movement: 'Adduction', normal: 30, actual: null, pain: false },
      { movement: 'Internal Rotation', normal: 45, actual: null, pain: false },
      { movement: 'External Rotation', normal: 45, actual: null, pain: false },
    ],
  },
  {
    region: 'Right Hip',
    movements: [
      { movement: 'Flexion', normal: 120, actual: null, pain: false },
      { movement: 'Extension', normal: 30, actual: null, pain: false },
      { movement: 'Abduction', normal: 45, actual: null, pain: false },
      { movement: 'Adduction', normal: 30, actual: null, pain: false },
      { movement: 'Internal Rotation', normal: 45, actual: null, pain: false },
      { movement: 'External Rotation', normal: 45, actual: null, pain: false },
    ],
  },
]

// --- Provider Intake Schemas ---

export const chiefComplaintEntrySchema = z.object({
  body_region: z.string(),
  pain_character: z.string(),
  severity_min: z.number().int().min(0).max(10).nullable(),
  severity_max: z.number().int().min(0).max(10).nullable(),
  is_persistent: z.boolean(),
  radiates_to: z.string().nullable(),
  aggravating_factors: z.string(),
  alleviating_factors: z.string(),
})

export const chiefComplaintsSchema = z.object({
  complaints: z.array(chiefComplaintEntrySchema),
  sleep_disturbance: z.boolean(),
  additional_notes: z.string().nullable(),
})

export const accidentDetailsSchema = z.object({
  vehicle_position: z.string().nullable(),
  impact_type: z.string().nullable(),
  seatbelt_worn: z.boolean().nullable(),
  airbag_deployed: z.boolean().nullable(),
  lost_consciousness: z.boolean().nullable(),
  er_visit: z.boolean().nullable(),
  er_details: z.string().nullable(),
  immediate_symptoms: z.string().nullable(),
  narrative: z.string().nullable(),
})

export const pastMedicalHistorySchema = z.object({
  medical_conditions: z.string(),
  prior_surgeries: z.string(),
  current_medications: z.string(),
  allergies: z.string(),
})

export const socialHistorySchema = z.object({
  smoking_status: z.enum(['never', 'former', 'current']),
  alcohol_use: z.enum(['denies', 'social', 'regular']),
  drug_use: z.enum(['denies', 'other']),
  occupation: z.string().nullable(),
})

export const examRegionSchema = z.object({
  region: z.string(),
  palpation_findings: z.string(),
  muscle_spasm: z.boolean(),
  additional_findings: z.string().nullable(),
})

export const examFindingsSchema = z.object({
  general_appearance: z.string().nullable(),
  regions: z.array(examRegionSchema),
  neurological_notes: z.string().nullable(),
})

export const providerIntakeSchema = z.object({
  chief_complaints: chiefComplaintsSchema,
  accident_details: accidentDetailsSchema,
  past_medical_history: pastMedicalHistorySchema,
  social_history: socialHistorySchema,
  exam_findings: examFindingsSchema,
})

export type ProviderIntakeValues = z.infer<typeof providerIntakeSchema>
export type ChiefComplaintEntry = z.infer<typeof chiefComplaintEntrySchema>
export type ExamRegion = z.infer<typeof examRegionSchema>

// --- Default Provider Intake template ---

export const defaultProviderIntake: ProviderIntakeValues = {
  chief_complaints: {
    complaints: [
      {
        body_region: 'Neck',
        pain_character: '',
        severity_min: null,
        severity_max: null,
        is_persistent: true,
        radiates_to: null,
        aggravating_factors: '',
        alleviating_factors: '',
      },
    ],
    sleep_disturbance: false,
    additional_notes: null,
  },
  accident_details: {
    vehicle_position: null,
    impact_type: null,
    seatbelt_worn: null,
    airbag_deployed: null,
    lost_consciousness: null,
    er_visit: null,
    er_details: null,
    immediate_symptoms: null,
    narrative: null,
  },
  past_medical_history: {
    medical_conditions: 'None reported',
    prior_surgeries: 'None',
    current_medications: '',
    allergies: 'No known drug allergies',
  },
  social_history: {
    smoking_status: 'never',
    alcohol_use: 'denies',
    drug_use: 'denies',
    occupation: null,
  },
  exam_findings: {
    general_appearance: 'Alert and oriented, in no acute distress',
    regions: [],
    neurological_notes: null,
  },
}
