export interface ClinicalRevisionRef {
  original_document_id: string
  replacement_document_id: string | null
}
export type ClinicalRevisionStatus = 'reset_pending' | 'superseded_note'

export function deriveClinicalRevisionStates(revisions: ClinicalRevisionRef[]) {
  const states = new Map<string, ClinicalRevisionStatus>()
  for (const revision of revisions) {
    states.set(revision.original_document_id, revision.replacement_document_id ? 'superseded_note' : 'reset_pending')
  }
  return states
}
