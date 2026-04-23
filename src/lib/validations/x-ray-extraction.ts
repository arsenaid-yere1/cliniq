import { z } from 'zod'

// --- AI extraction output schema (matches Claude structured output) ---

export const xRayFindingSchema = z.object({
  level: z.string(),
  description: z.string(),
  severity: z.enum(['mild', 'moderate', 'severe']).nullable(),
})

export const xRayExtractionResultSchema = z.object({
  body_region: z.string(),
  laterality: z.enum(['left', 'right', 'bilateral']).nullable(),
  scan_date: z.string().nullable(),
  procedure_description: z.string().nullable(),
  view_count: z.number().int().positive().nullable(),
  views_description: z.string().nullable(),
  reading_type: z.enum(['formal_radiology', 'in_office_alignment']).nullable(),
  ordering_provider: z.string().nullable(),
  reading_provider: z.string().nullable(),
  reason_for_study: z.string().nullable(),
  findings: z.array(xRayFindingSchema),
  impression_summary: z.string().nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  extraction_notes: z.string().nullable(),
})

// Multi-region response: Claude returns an array of reports (one per body region)
export const xRayExtractionResponseSchema = z.object({
  reports: z.array(xRayExtractionResultSchema).min(1),
})

export type XRayExtractionResult = z.infer<typeof xRayExtractionResultSchema>
export type XRayExtractionResponse = z.infer<typeof xRayExtractionResponseSchema>
export type XRayFinding = z.infer<typeof xRayFindingSchema>

// --- Provider review form schema ---

export const xRayReviewFormSchema = z.object({
  body_region: z.string().min(1, 'Body region is required'),
  laterality: z.enum(['left', 'right', 'bilateral']).nullable(),
  scan_date: z.string().nullable(),
  procedure_description: z.string().nullable(),
  view_count: z.number().int().positive().nullable(),
  views_description: z.string().nullable(),
  reading_type: z.enum(['formal_radiology', 'in_office_alignment']).nullable(),
  ordering_provider: z.string().nullable(),
  reading_provider: z.string().nullable(),
  reason_for_study: z.string().nullable(),
  findings: z.array(xRayFindingSchema.extend({
    level: z.string().min(1, 'Level is required'),
    description: z.string().min(1, 'Description is required'),
  })),
  impression_summary: z.string().nullable(),
})

export type XRayReviewFormValues = z.infer<typeof xRayReviewFormSchema>
