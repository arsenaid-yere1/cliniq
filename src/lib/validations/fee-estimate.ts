import { z } from 'zod'

export const feeEstimateItemSchema = z.object({
  id: z.string().uuid().optional(),
  description: z.string().min(1, 'Description is required'),
  fee_category: z.enum(['professional', 'practice_center']),
  price_min: z.coerce.number().min(0, 'Min price must be non-negative'),
  price_max: z.coerce.number().min(0, 'Max price must be non-negative'),
  sort_order: z.coerce.number().int().optional(),
})

export type FeeEstimateItemFormValues = z.infer<typeof feeEstimateItemSchema>

// Aggregated fee ranges passed to AI generation
export interface FeeEstimateTotals {
  professional_min: number
  professional_max: number
  practice_center_min: number
  practice_center_max: number
}
