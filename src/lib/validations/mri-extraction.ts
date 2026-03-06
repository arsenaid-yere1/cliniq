import { z } from 'zod'

// --- AI extraction output schema (matches Claude structured output) ---

export const findingSchema = z.object({
  level: z.string(),
  description: z.string(),
  severity: z.enum(['mild', 'moderate', 'severe']).nullable(),
})

export const mriExtractionResultSchema = z.object({
  body_region: z.string(),
  mri_date: z.string().nullable(),
  findings: z.array(findingSchema),
  impression_summary: z.string().nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  extraction_notes: z.string().nullable(),
})

export type MriExtractionResult = z.infer<typeof mriExtractionResultSchema>
export type Finding = z.infer<typeof findingSchema>

// --- Provider review form schema ---

export const mriReviewFormSchema = z.object({
  body_region: z.string().min(1, 'Body region is required'),
  mri_date: z.string().nullable(),
  findings: z.array(findingSchema.extend({
    level: z.string().min(1, 'Level is required'),
    description: z.string().min(1, 'Description is required'),
  })),
  impression_summary: z.string().nullable(),
})

export type MriReviewFormValues = z.infer<typeof mriReviewFormSchema>

// --- Extraction status enums ---

export const extractionStatusEnum = z.enum(['pending', 'processing', 'completed', 'failed'])
export const reviewStatusEnum = z.enum(['pending_review', 'approved', 'edited', 'rejected'])
export const confidenceEnum = z.enum(['high', 'medium', 'low'])
