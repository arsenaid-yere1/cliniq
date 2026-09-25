import { initialVisitSections } from '@/lib/validations/initial-visit-note'
import { procedureNoteSections } from '@/lib/validations/procedure-note'
import { dischargeNoteSections } from '@/lib/validations/discharge-note'
import { painFollowUpNoteSections } from '@/lib/validations/pain-follow-up-note'

export const REVIEW_VERSION = 'qc-v3' as const
export const reviewSections = {
  initial_visit: initialVisitSections,
  pain_evaluation: initialVisitSections,
  procedure: procedureNoteSections,
  discharge: dischargeNoteSections,
  pain_follow_up: painFollowUpNoteSections,
} as const
export type ReviewNoteStep = keyof typeof reviewSections
export type ReviewValue = null | boolean | number | string | ReviewValue[] | { [key: string]: ReviewValue }
export type ReviewSource = {
  id: string
  type: string
  scope: 'episode' | 'case' | 'historical_episode'
  date: string | null
  fields: Record<string, ReviewValue>
}
export type ReviewDecision = {
  state: 'current' | 'stale' | 'absent' | 'malformed'
  decision: string | null
  details: string | null
  reviewed_plan: string | null
  visit_date: string | null
}
export type ReviewNote = {
  id: string
  step: ReviewNoteStep
  episode_id: string
  encounter_id: string | null
  procedure_id: string | null
  status: string
  date: string | null
  sections: Record<string, string | null>
  context: Record<string, ReviewValue>
  decision: ReviewDecision
}
export type ReviewSnapshot = {
  version: typeof REVIEW_VERSION
  case_id: string
  episode_id: string
  episode_status: string
  notes: ReviewNote[]
  sources: ReviewSource[]
  coverage: { complete: boolean; limitations: string[] }
  versions: Array<{ source_id: string; updated_at: string | null; fingerprint?: string }>
}
