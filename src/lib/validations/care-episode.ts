import { z } from 'zod'
import { CARE_EPISODE_STATUSES } from '@/lib/constants/care-episode'
import { firstReturnEncounterSchema } from '@/lib/validations/clinical-encounter'

export const careEpisodeSchema = z.object({
  id: z.string().uuid().optional(),
  case_id: z.string().uuid(),
  episode_number: z.number().int().positive(),
  status: z.enum(CARE_EPISODE_STATUSES),
  opened_at: z.string().datetime({ offset: true }),
  ended_at: z.string().datetime({ offset: true }).nullable(),
  end_reason: z.string().trim().max(2000).nullable(),
  return_reason: z.string().trim().max(2000).nullable(),
}).superRefine((value, context) => {
  if (value.ended_at && Date.parse(value.ended_at) < Date.parse(value.opened_at)) {
    context.addIssue({
      code: 'custom',
      path: ['ended_at'],
      message: 'Episode end must be on or after episode open',
    })
  }

  if (value.status === 'active' && value.ended_at) {
    context.addIssue({
      code: 'custom',
      path: ['ended_at'],
      message: 'An active episode cannot have an end timestamp',
    })
  }
})

export const startReturnCareEpisodeSchema = z.object({
  case_id: z.string().uuid(),
  return_reason: z.string().trim().min(1, 'Return reason is required').max(2000),
  idempotency_key: z.string().trim().min(8).max(200),
  first_encounter: firstReturnEncounterSchema,
}).superRefine((value, context) => {
  if (value.first_encounter.case_id !== value.case_id) {
    context.addIssue({
      code: 'custom',
      path: ['first_encounter', 'case_id'],
      message: 'The encounter must belong to the same case',
    })
  }
})

export type CareEpisode = z.infer<typeof careEpisodeSchema>
export type StartReturnCareEpisodeInput = z.infer<typeof startReturnCareEpisodeSchema>
