import { z } from 'zod'

export const dischargeNoteSections = [
  'subjective',
  'objective_vitals',
  'objective_general',
  'objective_cervical',
  'objective_lumbar',
  'objective_neurological',
  'diagnoses',
  'assessment',
  'plan_and_recommendations',
  'patient_education',
  'prognosis',
  'clinician_disclaimer',
] as const

export type DischargeNoteSection = typeof dischargeNoteSections[number]

export const dischargeNoteSectionLabels: Record<DischargeNoteSection, string> = {
  subjective:              'Subjective',
  objective_vitals:        'Objective — Vital Signs',
  objective_general:       'General',
  objective_cervical:      'Cervical Spine Examination',
  objective_lumbar:        'Lumbar Spine Examination',
  objective_neurological:  'Neurological Examination',
  diagnoses:               'Diagnoses',
  assessment:              'Assessment',
  plan_and_recommendations: 'Plan and Discharge Recommendations',
  patient_education:       'Patient Education',
  prognosis:               'Prognosis',
  clinician_disclaimer:    'Clinician Disclaimer',
}

// AI output schema (validates Claude tool output)
export const dischargeNoteResultSchema = z.object({
  subjective:              z.string(),
  objective_vitals:        z.string(),
  objective_general:       z.string(),
  objective_cervical:      z.string(),
  objective_lumbar:        z.string(),
  objective_neurological:  z.string(),
  diagnoses:               z.string(),
  assessment:              z.string(),
  plan_and_recommendations: z.string(),
  patient_education:       z.string(),
  prognosis:               z.string(),
  clinician_disclaimer:    z.string(),
})

export type DischargeNoteResult = z.infer<typeof dischargeNoteResultSchema>

// Provider edit form schema
export const dischargeNoteEditSchema = z.object({
  visit_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Visit date must be YYYY-MM-DD')
    .nullable(),
  subjective:              z.string().min(1, 'Required'),
  objective_vitals:        z.string().min(1, 'Required'),
  objective_general:       z.string().min(1, 'Required'),
  objective_cervical:      z.string().min(1, 'Required'),
  objective_lumbar:        z.string().min(1, 'Required'),
  objective_neurological:  z.string().min(1, 'Required'),
  diagnoses:               z.string().min(1, 'Required'),
  assessment:              z.string().min(1, 'Required'),
  plan_and_recommendations: z.string().min(1, 'Required'),
  patient_education:       z.string().min(1, 'Required'),
  prognosis:               z.string().min(1, 'Required'),
  clinician_disclaimer:    z.string().min(1, 'Required'),
})

export type DischargeNoteEditValues = z.infer<typeof dischargeNoteEditSchema>
