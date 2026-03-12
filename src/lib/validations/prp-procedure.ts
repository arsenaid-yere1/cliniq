import { z } from 'zod'

const diagnosisSchema = z.object({
  icd10_code: z.string().min(1, 'ICD-10 code is required'),
  description: z.string().min(1, 'Description is required'),
})

const vitalSignsSchema = z.object({
  bp_systolic: z.number().int().min(1).max(300).nullable(),
  bp_diastolic: z.number().int().min(1).max(200).nullable(),
  heart_rate: z.number().int().min(1).max(300).nullable(),
  respiratory_rate: z.number().int().min(1).max(60).nullable(),
  temperature_f: z.number().min(90).max(110).nullable(),
  spo2_percent: z.number().int().min(0).max(100).nullable(),
})

export const prpProcedureFormSchema = z.object({
  procedure_date: z.string().min(1, 'Procedure date is required'),
  injection_site: z.string().min(1, 'Injection site is required'),
  laterality: z.enum(['left', 'right', 'bilateral']),
  diagnoses: z.array(diagnosisSchema).min(1, 'At least one diagnosis is required'),
  consent_obtained: z.boolean(),
  pain_rating: z.number().int().min(0).max(10).nullable(),
  vital_signs: vitalSignsSchema,
})

export type PrpProcedureFormValues = z.infer<typeof prpProcedureFormSchema>
export type PrpDiagnosis = z.infer<typeof diagnosisSchema>
export type PrpVitalSigns = z.infer<typeof vitalSignsSchema>
