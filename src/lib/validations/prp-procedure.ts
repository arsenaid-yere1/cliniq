import { z } from 'zod'
import { procedureSiteSchema } from '@/lib/procedures/sites-helpers'

const diagnosisSchema = z.object({
  icd10_code: z.string().min(1, 'ICD-10 code is required'),
  description: z.string().min(1, 'Description is required'),
})

const vitalSignsSchema = z
  .object({
    bp_systolic: z.number().int().min(1).max(300).nullable(),
    bp_diastolic: z.number().int().min(1).max(200).nullable(),
    heart_rate: z.number().int().min(1).max(300).nullable(),
    respiratory_rate: z.number().int().min(1).max(60).nullable(),
    temperature_f: z.number().min(90).max(110).nullable(),
    spo2_percent: z.number().int().min(0).max(100).nullable(),
    pain_score_min: z.number().int().min(0).max(10).nullable(),
    pain_score_max: z.number().int().min(0).max(10).nullable(),
  })
  .refine(
    (v) =>
      v.pain_score_min == null ||
      v.pain_score_max == null ||
      v.pain_score_min <= v.pain_score_max,
    {
      message: 'Pain minimum cannot exceed pain maximum',
      path: ['pain_score_max'],
    },
  )

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
  injection_volume_ml: z.number().positive('Total injection volume is required'),
  needle_gauge: z.string().optional(),
  guidance_method: z.enum(['ultrasound', 'fluoroscopy', 'landmark']),
  // target_confirmed_imaging is now per-site on procedureSiteSchema
})

const postProcedureSchema = z.object({
  complications: z.string().min(1, 'Complications field is required'),
  supplies_used: z.string().optional(),
  compression_bandage: z.boolean().nullable(),
  activity_restriction_hrs: z.number().int().positive().nullable(),
})

export const prpProcedureFormSchema = (opts?: { earliestDate?: string | null }) =>
  z.object({
    // --- Story 4.1 fields ---
    procedure_date: z
      .string()
      .min(1, 'Procedure date is required')
      .refine(
        (v) => !opts?.earliestDate || v >= opts.earliestDate,
        {
          message: `Procedure date cannot precede the Initial Visit date${
            opts?.earliestDate ? ` (${opts.earliestDate})` : ''
          }`,
        }
      ),
    sites: z.array(procedureSiteSchema).min(1, 'At least one site is required'),
    diagnoses: z.array(diagnosisSchema).min(1, 'At least one diagnosis is required'),
    consent_obtained: z.boolean(),
    vital_signs: vitalSignsSchema,
    // --- Story 4.2 fields ---
    prp_preparation: prpPreparationSchema,
    anesthesia: anesthesiaSchema,
    injection: injectionSchema,
    post_procedure: postProcedureSchema,
    // Optional rationale entered by the provider when the performed
    // technique diverges from the documented treatment plan.
    plan_deviation_reason: z.string().optional(),
  }).superRefine((data, ctx) => {
    // When every site has a volume_ml, sum must equal the total within
    // 0.1 mL tolerance for float rounding.
    const allHaveVolume = data.sites.every((s) => s.volume_ml !== null)
    if (allHaveVolume) {
      const sum = data.sites.reduce((a, s) => a + (s.volume_ml ?? 0), 0)
      if (Math.abs(sum - data.injection.injection_volume_ml) > 0.1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Per-site volumes sum to ${sum.toFixed(1)} mL; total is ${data.injection.injection_volume_ml.toFixed(1)} mL. Adjust per-site values or the total.`,
          path: ['injection', 'injection_volume_ml'],
        })
      }
    }
  })

export type PrpProcedureFormValues = z.infer<ReturnType<typeof prpProcedureFormSchema>>
export type PrpDiagnosis = z.infer<typeof diagnosisSchema>
export type PrpVitalSigns = z.infer<typeof vitalSignsSchema>
export type PrpPreparationValues = z.infer<typeof prpPreparationSchema>
export type AnesthesiaValues = z.infer<typeof anesthesiaSchema>
export type InjectionValues = z.infer<typeof injectionSchema>
export type PostProcedureValues = z.infer<typeof postProcedureSchema>
