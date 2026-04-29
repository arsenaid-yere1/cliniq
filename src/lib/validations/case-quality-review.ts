import { createHash } from 'node:crypto'
import { z } from 'zod'

export const qcSeverityValues = ['info', 'warning', 'critical'] as const
export type QcSeverity = (typeof qcSeverityValues)[number]

export const qcStepValues = [
  'initial_visit',
  'pain_evaluation',
  'procedure',
  'discharge',
  'case_summary',
  'cross_step',
] as const
export type QcStep = (typeof qcStepValues)[number]

export const qcOverallAssessmentValues = [
  'clean',
  'minor_issues',
  'major_issues',
  'incomplete',
] as const
export type QcOverallAssessment = (typeof qcOverallAssessmentValues)[number]

// Single finding from AI tool output
export const qualityFindingSchema = z.object({
  severity: z.enum(qcSeverityValues),
  step: z.enum(qcStepValues),
  note_id: z.string().uuid().nullable(),
  procedure_id: z.string().uuid().nullable(),
  section_key: z.string().nullable(),
  message: z.string().min(1),
  rationale: z.string().nullable(),
  suggested_tone_hint: z.string().nullable(),
})
export type QualityFinding = z.infer<typeof qualityFindingSchema>

// Full AI tool output schema
export const qualityReviewResultSchema = z.object({
  findings: z.array(qualityFindingSchema),
  summary: z.string().nullable(),
  overall_assessment: z.enum(qcOverallAssessmentValues),
})
export type QualityReviewResult = z.infer<typeof qualityReviewResultSchema>

// Provider-override layer
export const findingOverrideStatusValues = [
  'acknowledged',
  'dismissed',
  'edited',
] as const
export type FindingOverrideStatus = (typeof findingOverrideStatusValues)[number]

export const findingOverrideEntrySchema = z.object({
  status: z.enum(findingOverrideStatusValues),
  dismissed_reason: z.string().nullable(),
  edited_message: z.string().nullable(),
  edited_rationale: z.string().nullable(),
  edited_suggested_tone_hint: z.string().nullable(),
  actor_user_id: z.string().uuid(),
  set_at: z.string(),
})
export type FindingOverrideEntry = z.infer<typeof findingOverrideEntrySchema>

export const findingOverridesMapSchema = z.record(z.string(), findingOverrideEntrySchema)
export type FindingOverridesMap = z.infer<typeof findingOverridesMapSchema>

export const findingEditFormSchema = z.object({
  edited_message: z.string().min(1, 'Required'),
  edited_rationale: z.string().nullable(),
  edited_suggested_tone_hint: z.string().nullable(),
})
export type FindingEditFormValues = z.infer<typeof findingEditFormSchema>

export const findingDismissFormSchema = z.object({
  dismissed_reason: z.string().nullable(),
})
export type FindingDismissFormValues = z.infer<typeof findingDismissFormSchema>

// Stable hash for a finding — used as the key into FindingOverridesMap.
// Inputs are exactly the fields a regen would re-emit identically when the
// underlying drift has not changed; messages reordered or slightly reworded
// will hash differently, which is acceptable: the override layer is wiped
// on regen anyway.
export function computeFindingHash(finding: QualityFinding): string {
  const parts = [
    finding.severity,
    finding.step,
    finding.note_id ?? '',
    finding.procedure_id ?? '',
    finding.section_key ?? '',
    finding.message,
  ].join('|')
  return createHash('sha256').update(parts).digest('hex')
}
