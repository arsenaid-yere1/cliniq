import { z } from 'zod'

export const procedureNoteSections = [
  'subjective',
  'past_medical_history',
  'allergies',
  'current_medications',
  'social_history',
  'review_of_systems',
  'objective_vitals',
  'objective_physical_exam',
  'assessment_summary',
  'procedure_indication',
  'procedure_preparation',
  'procedure_prp_prep',
  'procedure_anesthesia',
  'procedure_injection',
  'procedure_post_care',
  'procedure_followup',
  'assessment_and_plan',
  'patient_education',
  'prognosis',
  'clinician_disclaimer',
] as const

export type ProcedureNoteSection = typeof procedureNoteSections[number]

export const procedureNoteSectionLabels: Record<ProcedureNoteSection, string> = {
  subjective:              'Subjective',
  past_medical_history:    'Past Medical History',
  allergies:               'Allergies',
  current_medications:     'Current Medications',
  social_history:          'Social History',
  review_of_systems:       'Review of Systems',
  objective_vitals:        'Objective — Vital Signs',
  objective_physical_exam: 'Objective — Physical Examination',
  assessment_summary:      'Assessment Summary',
  procedure_indication:    'Procedure — Indication',
  procedure_preparation:   'Procedure — Preparation',
  procedure_prp_prep:      'Procedure — PRP Preparation',
  procedure_anesthesia:    'Procedure — Anesthesia',
  procedure_injection:     'Procedure — Injection',
  procedure_post_care:     'Procedure — Post-Procedure Care',
  procedure_followup:      'Procedure — Follow-Up Plan',
  assessment_and_plan:     'Assessment and Plan',
  patient_education:       'Patient Education',
  prognosis:               'Prognosis',
  clinician_disclaimer:    'Clinician Disclaimer',
}

// AI output schema (validates Claude tool output)
export const procedureNoteResultSchema = z.object({
  subjective:              z.string(),
  past_medical_history:    z.string(),
  allergies:               z.string(),
  current_medications:     z.string(),
  social_history:          z.string(),
  review_of_systems:       z.string(),
  objective_vitals:        z.string(),
  objective_physical_exam: z.string(),
  assessment_summary:      z.string(),
  procedure_indication:    z.string(),
  procedure_preparation:   z.string(),
  procedure_prp_prep:      z.string(),
  procedure_anesthesia:    z.string(),
  procedure_injection:     z.string(),
  procedure_post_care:     z.string(),
  procedure_followup:      z.string(),
  assessment_and_plan:     z.string(),
  patient_education:       z.string(),
  prognosis:               z.string(),
  clinician_disclaimer:    z.string(),
})

export type ProcedureNoteResult = z.infer<typeof procedureNoteResultSchema>

// Provider edit form schema
export const procedureNoteEditSchema = z.object({
  subjective:              z.string().min(1, 'Required'),
  past_medical_history:    z.string().min(1, 'Required'),
  allergies:               z.string().min(1, 'Required'),
  current_medications:     z.string().min(1, 'Required'),
  social_history:          z.string().min(1, 'Required'),
  review_of_systems:       z.string().min(1, 'Required'),
  objective_vitals:        z.string().min(1, 'Required'),
  objective_physical_exam: z.string().min(1, 'Required'),
  assessment_summary:      z.string().min(1, 'Required'),
  procedure_indication:    z.string().min(1, 'Required'),
  procedure_preparation:   z.string().min(1, 'Required'),
  procedure_prp_prep:      z.string().min(1, 'Required'),
  procedure_anesthesia:    z.string().min(1, 'Required'),
  procedure_injection:     z.string().min(1, 'Required'),
  procedure_post_care:     z.string().min(1, 'Required'),
  procedure_followup:      z.string().min(1, 'Required'),
  assessment_and_plan:     z.string().min(1, 'Required'),
  patient_education:       z.string().min(1, 'Required'),
  prognosis:               z.string().min(1, 'Required'),
  clinician_disclaimer:    z.string().min(1, 'Required'),
})

export type ProcedureNoteEditValues = z.infer<typeof procedureNoteEditSchema>
