import { z } from 'zod'

export function visitDateSchema(opts?: {
  floorDate?: string | null
  ceilingDate?: string | null
  floorLabel?: string
  ceilingLabel?: string
}) {
  return z
    .string()
    .min(1, 'Visit date is required')
    .refine(
      (v) => !opts?.floorDate || v >= opts.floorDate,
      { message: `Visit date cannot precede the ${opts?.floorLabel ?? 'earliest allowed date'}.` },
    )
    .refine(
      (v) => !opts?.ceilingDate || v <= opts.ceilingDate,
      { message: `Visit date cannot exceed the ${opts?.ceilingLabel ?? 'latest allowed date'}.` },
    )
}

/** Calendar-date validation for persistence; leave existing editor bounds unchanged. */
export const persistedVisitDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date as YYYY-MM-DD')
  .refine(value => {
    const parsed = new Date(`${value}T00:00:00.000Z`)
    return value.slice(0, 4) !== '0000' && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }, 'Enter a valid calendar date')

export const preGenerationVisitDateSchema = z.object({
  caseId: z.string().uuid(),
  episodeId: z.string().uuid(),
  kind: z.enum(['initial_visit', 'pain_evaluation_visit', 'discharge']),
  visitDate: persistedVisitDateSchema,
  expectedNoteId: z.string().uuid().nullable(),
  expectedDate: persistedVisitDateSchema.nullable(),
})

export type PreGenerationVisitDateInput = z.infer<typeof preGenerationVisitDateSchema>
export type PreGenerationVisitKind = PreGenerationVisitDateInput['kind']
export type VisitDateToken = { noteId: string; visitDate: string; updatedAt: string }
export type VisitDateSaveResult =
  | { data: VisitDateToken; error?: never; code?: never; conflict?: never }
  | { error: string; code: 'invalid_date' | 'conflict' | 'locked' | 'save_failed'; conflict?: VisitDateToken; data?: never }
