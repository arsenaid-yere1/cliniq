import { z } from 'zod'

// --- Section names (15 sections matching provider template) ---

export const initialVisitSections = [
  'introduction',
  'history_of_accident',
  'chief_complaint',
  'past_medical_history',
  'social_history',
  'review_of_systems',
  'physical_exam',
  'imaging_findings',
  'motor_sensory_reflex',
  'medical_necessity',
  'diagnoses',
  'treatment_plan',
  'patient_education',
  'prognosis',
  'clinician_disclaimer',
] as const

export type InitialVisitSection = typeof initialVisitSections[number]

// --- Section display labels ---

export const sectionLabels: Record<InitialVisitSection, string> = {
  introduction: 'Introduction',
  history_of_accident: 'History of the Accident',
  chief_complaint: 'Chief Complaint',
  past_medical_history: 'Past Medical History',
  social_history: 'Social History',
  review_of_systems: 'Review of Systems',
  physical_exam: 'Physical Examination',
  imaging_findings: 'Radiological Imaging Findings',
  motor_sensory_reflex: 'Motor / Sensory / Reflex Summary',
  medical_necessity: 'Medical Necessity',
  diagnoses: 'Diagnoses',
  treatment_plan: 'Treatment Plan',
  patient_education: 'Patient Education',
  prognosis: 'Prognosis',
  clinician_disclaimer: 'Clinician Disclaimer',
}

// --- AI output schema (validates Claude's tool output) ---

export const initialVisitNoteResultSchema = z.object({
  introduction: z.string(),
  history_of_accident: z.string(),
  chief_complaint: z.string(),
  past_medical_history: z.string(),
  social_history: z.string(),
  review_of_systems: z.string(),
  physical_exam: z.string(),
  imaging_findings: z.string(),
  motor_sensory_reflex: z.string(),
  medical_necessity: z.string(),
  diagnoses: z.string(),
  treatment_plan: z.string(),
  patient_education: z.string(),
  prognosis: z.string(),
  clinician_disclaimer: z.string(),
})

export type InitialVisitNoteResult = z.infer<typeof initialVisitNoteResultSchema>

// --- Provider edit form schema ---

export const initialVisitNoteEditSchema = z.object({
  introduction: z.string().min(1, 'Introduction is required'),
  history_of_accident: z.string().min(1, 'History of the accident is required'),
  chief_complaint: z.string().min(1, 'Chief complaint is required'),
  past_medical_history: z.string().min(1, 'Past medical history is required'),
  social_history: z.string().min(1, 'Social history is required'),
  review_of_systems: z.string().min(1, 'Review of systems is required'),
  physical_exam: z.string().min(1, 'Physical exam is required'),
  imaging_findings: z.string().min(1, 'Imaging findings are required'),
  motor_sensory_reflex: z.string().min(1, 'Motor/sensory/reflex summary is required'),
  medical_necessity: z.string().min(1, 'Medical necessity is required'),
  diagnoses: z.string().min(1, 'Diagnoses are required'),
  treatment_plan: z.string().min(1, 'Treatment plan is required'),
  patient_education: z.string().min(1, 'Patient education is required'),
  prognosis: z.string().min(1, 'Prognosis is required'),
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
