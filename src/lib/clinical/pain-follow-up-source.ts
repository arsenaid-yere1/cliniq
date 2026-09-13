import { painFollowUpNoteResultSchema } from '@/lib/validations/pain-follow-up-note'
import { z } from 'zod'
import type { PainFollowUpSourceData } from '@/lib/claude/generate-pain-follow-up'

const record = z.record(z.string(), z.unknown())
export const followUpSourceSnapshotSchema = z.object({
  schema_version: z.literal(1),
  fingerprint: z.string().min(1),
  manifest: z.array(z.object({
    kind: z.string(), id: z.string(), date: z.string().nullable(),
    label: z.string(), fingerprint: z.string(),
  })),
  data: z.object({
    encounter: record, patient: record.nullable(), provider: record.nullable(),
    latestCompletedEncounter: record.nullable(), priorEpisodeDischarge: record.nullable(),
    performedProcedures: z.array(record),
  }),
})
export type FollowUpSourceSnapshot = z.infer<typeof followUpSourceSnapshotSchema>
export type FollowUpFreshness = 'current' | 'changed' | 'unknown' | 'unavailable'

export function followUpPromptSource(snapshot: FollowUpSourceSnapshot): PainFollowUpSourceData {
  return snapshot.data
}

export function changedFollowUpSources(
  previous: FollowUpSourceSnapshot | null,
  current: FollowUpSourceSnapshot,
): string[] {
  if (!previous) return []
  const before = new Map(previous.manifest.map((item) => [`${item.kind}:${item.id}`, item]))
  const after = new Map(current.manifest.map((item) => [`${item.kind}:${item.id}`, item]))
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((key) => before.get(key)?.fingerprint !== after.get(key)?.fingerprint)
    .map((key) => (after.get(key) ?? before.get(key))!.label)
}

export const followUpReviewStateSchema = z.object({
  snapshot: followUpSourceSnapshotSchema,
  baseline: followUpSourceSnapshotSchema.nullable(),
  freshness: z.enum(['current', 'changed', 'unknown']),
  reviewed: z.boolean(),
  note_version: z.string().nullable(),
  proposal: z.object({
    id: z.string(), status: z.enum(['pending', 'ready', 'failed']), scope: z.string(),
    base_version: z.string(), source_fingerprint: z.string(), proposed: painFollowUpNoteResultSchema.nullable(),
    error: z.string().nullable(), created_at: z.string(),
  }).nullable(),
})
export type FollowUpReviewState = z.infer<typeof followUpReviewStateSchema>
