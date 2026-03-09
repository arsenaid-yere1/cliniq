import { z } from 'zod'

// --- Section names (used for per-section regeneration) ---

export const initialVisitSections = [
  'patient_info',
  'chief_complaint',
  'history_of_present_illness',
  'imaging_review',
  'prior_treatment_summary',
  'physical_exam',
  'assessment',
  'treatment_plan',
] as const

export type InitialVisitSection = typeof initialVisitSections[number]

// --- Section display labels ---

export const sectionLabels: Record<InitialVisitSection, string> = {
  patient_info: 'Patient Information',
  chief_complaint: 'Chief Complaint',
  history_of_present_illness: 'History of Present Illness',
  imaging_review: 'Imaging Review',
  prior_treatment_summary: 'Prior Treatment Summary',
  physical_exam: 'Physical Examination',
  assessment: 'Assessment',
  treatment_plan: 'Treatment Plan',
}

// --- AI output schema (validates Claude's tool output) ---

export const initialVisitNoteResultSchema = z.object({
  patient_info: z.string(),
  chief_complaint: z.string(),
  history_of_present_illness: z.string(),
  imaging_review: z.string(),
  prior_treatment_summary: z.string(),
  physical_exam: z.string(),
  assessment: z.string(),
  treatment_plan: z.string(),
})

export type InitialVisitNoteResult = z.infer<typeof initialVisitNoteResultSchema>

// --- Provider edit form schema ---

export const initialVisitNoteEditSchema = z.object({
  patient_info: z.string().min(1, 'Patient information is required'),
  chief_complaint: z.string().min(1, 'Chief complaint is required'),
  history_of_present_illness: z.string().min(1, 'History is required'),
  imaging_review: z.string().min(1, 'Imaging review is required'),
  prior_treatment_summary: z.string().min(1, 'Prior treatment is required'),
  physical_exam: z.string().min(1, 'Physical exam is required'),
  assessment: z.string().min(1, 'Assessment is required'),
  treatment_plan: z.string().min(1, 'Treatment plan is required'),
})

export type InitialVisitNoteEditValues = z.infer<typeof initialVisitNoteEditSchema>
