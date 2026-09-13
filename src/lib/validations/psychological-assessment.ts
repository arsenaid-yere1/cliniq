import { z } from 'zod'

export const psychologicalSymptoms = [
  'Fear / anxiety', 'Recurrent recollections', 'Flashbacks', 'Nightmares',
  'Shakiness', 'Avoidance / travel fear', 'Low mood', 'Irritability',
  'Concentration difficulty', 'Other',
] as const

const narrative = z.string().max(6000)

export const psychologicalAssessmentSchema = z.object({
  symptom_status: z.enum(['not_assessed', 'none_reported', 'reported', 'declined']),
  symptoms: z.array(z.enum(psychologicalSymptoms)).max(psychologicalSymptoms.length),
  patient_description: narrative,
  onset: narrative,
  triggers: narrative,
  functional_impact: narrative,
  sleep_details: narrative,
  assessment_status: z.enum(['not_assessed', 'partial', 'assessed']),
  observations: narrative,
  clinical_impression: narrative,
  confirmed_diagnoses: narrative,
  relevant_history: narrative,
  safety_status: z.enum(['not_assessed', 'no_concerns', 'concerns', 'unable']),
  safety_details: narrative,
  safety_actions: narrative,
  safety_disposition: narrative,
  follow_up: z.enum(['not_documented', 'monitor', 'discuss_referral', 'referral_recommended', 'existing_care', 'other']),
  referral_reason: narrative,
  follow_up_timeframe: narrative,
  education: narrative,
  patient_response: narrative,
  // Server-managed: saving source changes never silently replaces generated prose.
  note_review_required: z.boolean(),
}).superRefine((value, ctx) => {
  const error = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
  if (value.symptom_status === 'reported' &&
    (!value.symptoms.length || value.symptoms.includes('Other')) && !value.patient_description.trim()) {
    error('patient_description', 'Describe the reported symptoms.')
  }
  if (value.symptom_status !== 'reported' && (value.symptoms.length ||
    [value.patient_description, value.onset, value.triggers, value.functional_impact, value.sleep_details].some(v => v.trim()))) {
    error('symptom_status', 'Clear symptom details before changing the reporting status.')
  }
  if (value.assessment_status === 'assessed' && !value.clinical_impression.trim()) {
    error('clinical_impression', 'Enter a clinical impression or select Partial assessment.')
  }
  if (value.safety_status !== 'concerns' &&
    [value.safety_details, value.safety_actions, value.safety_disposition].some(v => v.trim())) {
    error('safety_status', 'Clear concern details before changing the safety status.')
  }
  if (value.follow_up === 'not_documented' && (value.referral_reason.trim() || value.follow_up_timeframe.trim())) {
    error('follow_up', 'Select a follow-up plan or clear the follow-up details.')
  }
})

export type PsychologicalAssessment = z.infer<typeof psychologicalAssessmentSchema>

export const defaultPsychologicalAssessment: PsychologicalAssessment = {
  symptom_status: 'not_assessed', symptoms: [], patient_description: '', onset: '',
  triggers: '', functional_impact: '', sleep_details: '', assessment_status: 'not_assessed',
  observations: '', clinical_impression: '', confirmed_diagnoses: '', relevant_history: '',
  safety_status: 'not_assessed', safety_details: '', safety_actions: '', safety_disposition: '',
  follow_up: 'not_documented', referral_reason: '', follow_up_timeframe: '', education: '',
  patient_response: '', note_review_required: false,
}

export function psychologicalFinalizationError(value: unknown): string | null {
  if (value == null) return null
  const parsed = psychologicalAssessmentSchema.safeParse(value)
  if (!parsed.success) return 'Review the psychological assessment fields before finalizing.'
  const assessment = parsed.data
  if (assessment.note_review_required) return 'Psychological assessment changed. Review the affected note sections and acknowledge the review before finalizing.'
  if (assessment.safety_status === 'concerns' &&
    (!assessment.safety_details.trim() || !assessment.safety_actions.trim() || !assessment.safety_disposition.trim())) {
    return 'Document the safety concern, actions taken, and disposition (or why unavailable) before finalizing.'
  }
  return null
}
