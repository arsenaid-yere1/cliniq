import { z } from 'zod'

// --- Imaging Orders ---

export const imagingOrderEntrySchema = z.object({
  body_region: z.string(),
  modality: z.string(),
  icd10_codes: z.array(z.string()),
  clinical_indication: z.string(),
})

export const imagingOrderResultSchema = z.object({
  patient_name: z.string(),
  date_of_order: z.string(),
  ordering_provider: z.string(),
  ordering_provider_npi: z.string().nullable(),
  orders: z.array(imagingOrderEntrySchema),
})

export type ImagingOrderResult = z.infer<typeof imagingOrderResultSchema>

// --- Chiropractic Therapy Order ---

export const chiropracticOrderResultSchema = z.object({
  patient_name: z.string(),
  date_of_order: z.string(),
  referring_provider: z.string(),
  referring_provider_npi: z.string().nullable(),
  diagnoses: z.array(z.object({
    code: z.string(),
    description: z.string(),
  })),
  treatment_plan: z.object({
    frequency: z.string(),
    duration: z.string(),
    modalities: z.array(z.string()),
    goals: z.array(z.string()),
  }),
  special_instructions: z.string().nullable(),
  precautions: z.string().nullable(),
})

export type ChiropracticOrderResult = z.infer<typeof chiropracticOrderResultSchema>

// --- Order types ---

export const ORDER_TYPES = ['imaging', 'chiropractic_therapy'] as const
export type OrderType = typeof ORDER_TYPES[number]

export const orderTypeLabels: Record<OrderType, string> = {
  imaging: 'Imaging Orders',
  chiropractic_therapy: 'Chiropractic Therapy Order',
}
