import { z } from 'zod'
import { SCHEDULABLE_PROCEDURE_TYPES } from '@/lib/constants/procedure-scheduling'

export const procedureRecommendationSchema = z.object({
  recommendation_id: z.string().uuid(),
  procedure_type: z.enum(SCHEDULABLE_PROCEDURE_TYPES),
  sites: z.array(z.string().trim().min(1)).min(1),
  diagnoses: z.array(z.object({
    icd10_code: z.string().trim().min(1),
    description: z.string().trim().min(1),
  })).default([]),
  rationale: z.string().trim().min(1),
  suggested_timing: z.string().trim().nullable().optional(),
})

export const painFollowUpNoteResultSchema = z.object({
  subjective: z.string(),
  interval_history: z.string(),
  review_of_systems: z.string(),
  telehealth_observations: z.string(),
  imaging_review: z.string(),
  assessment: z.string(),
  diagnoses: z.string(),
  treatment_plan: z.string(),
  patient_education: z.string(),
  follow_up: z.string(),
  clinician_disclaimer: z.string(),
  procedure_recommendations: z.array(procedureRecommendationSchema),
})

export const painFollowUpNoteEditSchema = painFollowUpNoteResultSchema.extend({
  encounter_id: z.string().uuid(),
}).superRefine((value, context) => {
  const recommendationIds = value.procedure_recommendations.map(
    (recommendation) => recommendation.recommendation_id,
  )
  if (new Set(recommendationIds).size !== recommendationIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['procedure_recommendations'],
      message: 'Procedure recommendation IDs must be unique',
    })
  }
})

export type ProcedureRecommendation = z.infer<typeof procedureRecommendationSchema>
export type PainFollowUpNoteResult = z.infer<typeof painFollowUpNoteResultSchema>
export type PainFollowUpNoteEditValues = z.infer<typeof painFollowUpNoteEditSchema>
