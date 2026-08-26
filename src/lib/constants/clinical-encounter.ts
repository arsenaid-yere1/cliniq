export const CLINICAL_ENCOUNTER_TYPES = [
  'initial_evaluation',
  'pain_evaluation',
  'pain_follow_up',
  'discharge',
] as const

export const CLINICAL_ENCOUNTER_MODALITIES = [
  'unknown',
  'in_person',
  'telehealth',
  'phone',
] as const

export const CLINICAL_ENCOUNTER_STATUSES = [
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
] as const

export type ClinicalEncounterType = (typeof CLINICAL_ENCOUNTER_TYPES)[number]
export type ClinicalEncounterModality = (typeof CLINICAL_ENCOUNTER_MODALITIES)[number]
export type ClinicalEncounterStatus = (typeof CLINICAL_ENCOUNTER_STATUSES)[number]
