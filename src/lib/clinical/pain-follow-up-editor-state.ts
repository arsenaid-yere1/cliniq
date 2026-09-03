import {
  painFollowUpNoteSections,
  type PainFollowUpSection,
} from '@/lib/validations/pain-follow-up-note'

export type PainFollowUpEditorState =
  | 'empty'
  | 'generating'
  | 'failed'
  | 'draft'
  | 'finalized'

export type PainFollowUpEditorNote = {
  status: string
  procedure_recommendations: unknown
} & Partial<Record<PainFollowUpSection, string | null>>

export function getPainFollowUpEditorState(
  note: PainFollowUpEditorNote | null | undefined,
): PainFollowUpEditorState {
  if (!note) return 'empty'
  if (note.status === 'generating') return 'generating'
  if (note.status === 'failed') return 'failed'
  if (note.status === 'finalized') return 'finalized'

  const hasSectionContent = painFollowUpNoteSections.some(
    (section) => (note[section] ?? '').trim().length > 0,
  )
  const hasRecommendations = Array.isArray(note.procedure_recommendations)
    && note.procedure_recommendations.length > 0

  return hasSectionContent || hasRecommendations ? 'draft' : 'empty'
}
