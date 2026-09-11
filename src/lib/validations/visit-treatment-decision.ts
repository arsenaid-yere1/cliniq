import { z } from 'zod'

export const visitDecisionLabels = {
  accepted: 'Accepted',
  partially_accepted: 'Partially accepted',
  deferred: 'Deferred',
  declined: 'Declined',
  not_documented: 'Not documented',
} as const

export const visitTreatmentDecisionSchema = z.object({
  decision: z.enum(['accepted', 'partially_accepted', 'deferred', 'declined', 'not_documented']),
  details: z.string().trim().max(2000).nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.decision === 'partially_accepted' && !value.details?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['details'], message: 'Describe which treatments were accepted and which were deferred or declined.' })
  }
})
export type VisitTreatmentDecision = z.infer<typeof visitTreatmentDecisionSchema>
export const savedVisitDecisionSchema = z.object({
  schema_version: z.literal(1),
  decision: visitTreatmentDecisionSchema.shape.decision,
  details: z.string().nullable(),
  reviewed_plan_hash: z.string(),
  reviewed_plan: z.string(),
  visit_date: z.string().nullable(),
  confirmed_by: z.string().uuid(),
  confirmed_at: z.string(),
})
export type SavedVisitDecision = z.infer<typeof savedVisitDecisionSchema>
export function parseVisitDecision(value: unknown): SavedVisitDecision | null {
  const parsed = savedVisitDecisionSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
/** UI suggestions only. Never call this to populate a database or model input. */
export function visitDecisionDraft(value: unknown): VisitTreatmentDecision {
  const saved = parseVisitDecision(value)
  return saved ? { decision: saved.decision, details: saved.details } : { decision: 'accepted', details: null }
}
export function normalizeVisitPlan(plan: string) { return plan.trim().replace(/\s+/g, ' ') }
export function visitDecisionClosing(value: VisitTreatmentDecision | null): string {
  if (!value || value.decision === 'not_documented') return ''
  const closing = {
    accepted: 'The patient agreed to the treatment plan discussed at this visit, as outlined above.',
    partially_accepted: 'The patient partially agreed to the treatment plan discussed at this visit.',
    deferred: 'The patient deferred a decision on the treatment plan discussed at this visit.',
    declined: 'The patient declined the treatment plan discussed at this visit.',
  }[value.decision]
  return value.decision !== 'accepted' && value.details?.trim()
    ? `${closing} Decision details: ${value.details.trim()}` : closing
}

export const visitDecisionEditFields = {
  treatment_decision: visitTreatmentDecisionSchema.optional(),
  expected_updated_at: z.string().nullable().optional(),
}
