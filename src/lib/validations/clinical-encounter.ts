import { z } from 'zod'
import {
  CLINICAL_ENCOUNTER_MODALITIES,
  CLINICAL_ENCOUNTER_STATUSES,
  CLINICAL_ENCOUNTER_TYPES,
} from '@/lib/constants/clinical-encounter'

const optionalUuid = z.string().uuid().nullable().optional()
const optionalDateTime = z.string().datetime({ offset: true }).nullable().optional()

export const patientReportedMeasurementsSchema = z.record(
  z.string(),
  z.object({
    value: z.union([z.string(), z.number(), z.boolean()]),
    unit: z.string().nullable().optional(),
    source: z.literal('patient_reported'),
    recorded_at: z.string().datetime({ offset: true }).nullable().optional(),
  }),
)

const clinicalEncounterBaseSchema = z.object({
  case_id: z.string().uuid(),
  episode_id: z.string().uuid(),
  encounter_type: z.enum(CLINICAL_ENCOUNTER_TYPES),
  modality: z.enum(CLINICAL_ENCOUNTER_MODALITIES),
  status: z.enum(CLINICAL_ENCOUNTER_STATUSES).default('scheduled'),
  scheduled_start: optionalDateTime,
  scheduled_end: optionalDateTime,
  encounter_date: z.iso.date().nullable().optional(),
  provider_id: optionalUuid,
  reason_for_visit: z.string().trim().max(2000).nullable().optional(),
  provider_intake: z.record(z.string(), z.unknown()).default({}),
  patient_reported_pain_min: z.number().int().min(0).max(10).nullable().optional(),
  patient_reported_pain_max: z.number().int().min(0).max(10).nullable().optional(),
  patient_reported_measurements: patientReportedMeasurementsSchema.default({}),
  telehealth_consent_obtained: z.boolean().nullable().optional(),
  telehealth_consent_at: optionalDateTime,
  patient_location_state: z.string().trim().max(100).nullable().optional(),
  provider_location: z.string().trim().max(500).nullable().optional(),
  connection_method: z.string().trim().max(200).nullable().optional(),
})

type EncounterCrossFieldValues = {
  scheduled_start?: string | null
  scheduled_end?: string | null
  status?: string
  encounter_date?: string | null
  patient_reported_pain_min?: number | null
  patient_reported_pain_max?: number | null
  modality?: string
  telehealth_consent_obtained?: boolean | null
}

function validateEncounterCrossFields(
  value: EncounterCrossFieldValues,
  context: z.RefinementCtx,
) {
  if (value.scheduled_start && value.scheduled_end) {
    if (Date.parse(value.scheduled_end) <= Date.parse(value.scheduled_start)) {
      context.addIssue({
        code: 'custom',
        path: ['scheduled_end'],
        message: 'Scheduled end must be after scheduled start',
      })
    }
  }

  if (value.status === 'completed' && !value.encounter_date) {
    context.addIssue({
      code: 'custom',
      path: ['encounter_date'],
      message: 'Completed encounters require an encounter date',
    })
  }

  if (
    value.patient_reported_pain_min != null
    && value.patient_reported_pain_max != null
    && value.patient_reported_pain_min > value.patient_reported_pain_max
  ) {
    context.addIssue({
      code: 'custom',
      path: ['patient_reported_pain_max'],
      message: 'Maximum pain must be greater than or equal to minimum pain',
    })
  }

  if (value.modality !== 'telehealth' && value.telehealth_consent_obtained === true) {
    context.addIssue({
      code: 'custom',
      path: ['telehealth_consent_obtained'],
      message: 'Telehealth consent can only be recorded for a telehealth encounter',
    })
  }
}

export const clinicalEncounterInputSchema = clinicalEncounterBaseSchema
  .superRefine(validateEncounterCrossFields)

export const firstReturnEncounterSchema = clinicalEncounterBaseSchema
  .omit({ episode_id: true, encounter_type: true, status: true })
  .extend({
    modality: z.enum(CLINICAL_ENCOUNTER_MODALITIES).default('telehealth'),
  })
  .superRefine(validateEncounterCrossFields)

export type ClinicalEncounterInput = z.infer<typeof clinicalEncounterInputSchema>
export type FirstReturnEncounterInput = z.infer<typeof firstReturnEncounterSchema>
