import { z } from 'zod'

// --- AI extraction output schema (matches Claude structured output) ---

export const ctScanFindingSchema = z.object({
  level: z.string(),
  description: z.string(),
  severity: z.enum(['mild', 'moderate', 'severe']).nullable(),
})

export const ctScanExtractionResultSchema = z.object({
  body_region: z.string(),
  scan_date: z.string().nullable(),
  technique: z.string().nullable(),
  reason_for_study: z.string().nullable(),
  findings: z.array(ctScanFindingSchema),
  impression_summary: z.string().nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  extraction_notes: z.string().nullable(),
})

// Multi-region response: Claude returns an array of reports (one per body region)
export const ctScanExtractionResponseSchema = z.object({
  reports: z.array(ctScanExtractionResultSchema).min(1),
})

export type CtScanExtractionResult = z.infer<typeof ctScanExtractionResultSchema>
export type CtScanExtractionResponse = z.infer<typeof ctScanExtractionResponseSchema>
export type CtScanFinding = z.infer<typeof ctScanFindingSchema>

// --- Provider review form schema ---

export const ctScanReviewFormSchema = z.object({
  body_region: z.string().min(1, 'Body region is required'),
  scan_date: z.string().nullable(),
  technique: z.string().nullable(),
  reason_for_study: z.string().nullable(),
  findings: z.array(ctScanFindingSchema.extend({
    level: z.string().min(1, 'Level is required'),
    description: z.string().min(1, 'Description is required'),
  })),
  impression_summary: z.string().nullable(),
})

export type CtScanReviewFormValues = z.infer<typeof ctScanReviewFormSchema>
