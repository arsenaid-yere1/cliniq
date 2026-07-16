import { z } from 'zod'
import { procedureSiteSchema } from '@/lib/procedures/sites-helpers'
import { diagnosisSchema, vitalSignsSchema } from '@/lib/validations/prp-procedure'

// BOTOX (onabotulinumtoxinA) product/vial/reconstitution + unit-accounting block.
// Stored in procedures.botox_dosing jsonb.
export const botoxDosingSchema = z.object({
  product_name: z.string().min(1, 'Product name is required'), // "BOTOX Cosmetic (onabotulinumtoxinA)"
  ndc: z.string().optional(),
  lot_number: z.string().optional(),
  expiration: z.string().optional(), // "2028-03"
  reconstitution_units: z.number().positive('Vial unit total is required'), // 100
  reconstitution_diluent_ml: z.number().positive('Diluent volume is required'), // 3.0
  units_administered: z.number().positive('Units administered is required'), // 60
  units_discarded: z.number().min(0), // 40
})

export type BotoxDosingValues = z.infer<typeof botoxDosingSchema>

export const botoxProcedureFormSchema = (opts?: { earliestDate?: string | null }) =>
  z
    .object({
      procedure_date: z
        .string()
        .min(1, 'Procedure date is required')
        .refine((v) => !opts?.earliestDate || v >= opts.earliestDate, {
          message: `Procedure date cannot precede the Initial Visit date${
            opts?.earliestDate ? ` (${opts.earliestDate})` : ''
          }`,
        }),
      // Each site carries per-muscle points + units (BOTOX fields on the shared site schema).
      sites: z.array(procedureSiteSchema).min(1, 'At least one site is required'),
      diagnoses: z.array(diagnosisSchema).min(1, 'At least one diagnosis is required'),
      consent_obtained: z.boolean(),
      // Vitals optional for BOTOX — the packet note carries none; allow all-null.
      vital_signs: vitalSignsSchema,
      botox_dosing: botoxDosingSchema,
      needle_gauge: z.string().optional(), // "30-gauge"
      complications: z.string().optional(),
      plan_deviation_reason: z.string().optional(),
    })
    .superRefine((data, ctx) => {
      const d = data.botox_dosing

      // Vial reconciliation: administered + discarded must equal the reconstituted vial total.
      if (Math.abs(d.units_administered + d.units_discarded - d.reconstitution_units) > 0.001) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['botox_dosing', 'units_discarded'],
          message: `Administered (${d.units_administered} U) + discarded (${d.units_discarded} U) must equal the vial total (${d.reconstitution_units} U).`,
        })
      }

      // Per-site units must sum to units_administered when every site has units.
      if (data.sites.every((s) => s.units != null)) {
        const sum = data.sites.reduce((acc, s) => acc + (s.units ?? 0), 0)
        if (Math.abs(sum - d.units_administered) > 0.001) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['botox_dosing', 'units_administered'],
            message: `Per-site units sum to ${sum} U; administered is ${d.units_administered} U. Adjust per-site values or the total.`,
          })
        }
      }

      // Consent gate (mirrors PRP): plan deviation reason required when consent not obtained.
      if (data.consent_obtained === false && !data.plan_deviation_reason?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['plan_deviation_reason'],
          message: 'Plan deviation reason required when consent is not obtained.',
        })
      }
    })

export type BotoxProcedureFormValues = z.infer<ReturnType<typeof botoxProcedureFormSchema>>
