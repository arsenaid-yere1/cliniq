import { z } from 'zod'
import {
  PROCEDURE_ORDER_PRIORITIES,
  SCHEDULABLE_PROCEDURE_TYPES,
} from '@/lib/constants/procedure-scheduling'

export const createProcedureOrderSchema = z.object({
  case_id: z.string().uuid(),
  episode_id: z.string().uuid(),
  source_encounter_id: z.string().uuid(),
  source_recommendation_id: z.string().uuid(),
  procedure_series_id: z.string().uuid(),
  procedure_type: z.enum(SCHEDULABLE_PROCEDURE_TYPES),
  sites: z.array(z.string().trim().min(1)).min(1),
  diagnoses: z.array(z.object({
    icd10_code: z.string().trim().nullable(),
    description: z.string().trim().min(1),
  })).default([]),
  clinical_rationale: z.string().trim().min(1),
  priority: z.enum(PROCEDURE_ORDER_PRIORITIES).default('routine'),
})

export const cancelProcedureOrderSchema = z.object({
  order_id: z.string().uuid(),
  reason: z.string().trim().min(1).max(2000),
})

export type CreateProcedureOrderInput = z.infer<typeof createProcedureOrderSchema>
export type CancelProcedureOrderInput = z.infer<typeof cancelProcedureOrderSchema>
