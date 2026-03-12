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

const prpPreparationSchema = z.object({
  blood_draw_volume_ml: z.number().positive('Blood draw volume is required'),
  centrifuge_duration_min: z.number().int().positive().nullable(),
  prep_protocol: z.string().optional(),
  kit_lot_number: z.string().optional(),
})

const anesthesiaSchema = z.object({
  anesthetic_agent: z.string().min(1, 'Anesthetic agent is required'),
  anesthetic_dose_ml: z.number().positive().nullable(),
  patient_tolerance: z.enum(['tolerated_well', 'adverse_reaction']).nullable(),
})

const injectionSchema = z.object({
  injection_volume_ml: z.number().positive('Injection volume is required'),
  needle_gauge: z.string().optional(),
  guidance_method: z.enum(['ultrasound', 'fluoroscopy', 'landmark']),
  target_confirmed_imaging: z.boolean().nullable(),
})

const postProcedureSchema = z.object({
  complications: z.string().min(1, 'Complications field is required'),
  supplies_used: z.string().optional(),
  compression_bandage: z.boolean().nullable(),
  activity_restriction_hrs: z.number().int().positive().nullable(),
})

export const prpProcedureFormSchema = z.object({
  // --- Story 4.1 fields (unchanged) ---
  procedure_date: z.string().min(1, 'Procedure date is required'),
  injection_site: z.string().min(1, 'Injection site is required'),
  laterality: z.enum(['left', 'right', 'bilateral']),
  diagnoses: z.array(diagnosisSchema).min(1, 'At least one diagnosis is required'),
  consent_obtained: z.boolean(),
  pain_rating: z.number().int().min(0).max(10).nullable(),
  vital_signs: vitalSignsSchema,
  // --- Story 4.2 fields ---
  prp_preparation: prpPreparationSchema,
  anesthesia: anesthesiaSchema,
  injection: injectionSchema,
  post_procedure: postProcedureSchema,
})

export type PrpProcedureFormValues = z.infer<typeof prpProcedureFormSchema>
export type PrpDiagnosis = z.infer<typeof diagnosisSchema>
export type PrpVitalSigns = z.infer<typeof vitalSignsSchema>
export type PrpPreparationValues = z.infer<typeof prpPreparationSchema>
export type AnesthesiaValues = z.infer<typeof anesthesiaSchema>
export type InjectionValues = z.infer<typeof injectionSchema>
export type PostProcedureValues = z.infer<typeof postProcedureSchema>
