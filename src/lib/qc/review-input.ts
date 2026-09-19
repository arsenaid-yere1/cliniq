import type { ReviewNoteStep, ReviewSnapshot } from './review-types'

// Memory guards, not model context estimates. Model capacity is checked with
// the token-counting API against the complete request before generation.
export const MAX_REVIEW_COLLECTION_BYTES = 16_000_000
export const MAX_REVIEW_SNAPSHOT_BYTES = 32_000_000
export const MAX_REVIEW_INPUT_TOKENS = 900_000

const noteTables: Record<ReviewNoteStep, string> = {
  initial_visit: 'initial_visit_notes',
  pain_evaluation: 'initial_visit_notes',
  procedure: 'procedure_notes',
  pain_follow_up: 'pain_follow_up_notes',
  discharge: 'discharge_notes',
}

/** Remove only exact duplicates; the authoritative snapshot is never mutated. */
export function serializeReviewInput(snapshot: ReviewSnapshot): string {
  const sources = new Map(snapshot.sources.map(source => [source.id, source]))
  const notes = snapshot.notes.map(note => {
    const sourceId = `${noteTables[note.step]}:${note.id}`
    const source = sources.get(sourceId)
    if (!source) return note
    const duplicated = (values: Record<string, unknown>) => Object.entries(values).every(
      ([key, value]) => Object.hasOwn(source.fields, key)
        && JSON.stringify(source.fields[key]) === JSON.stringify(value),
    )
    return {
      ...note,
      source_id: sourceId,
      section_keys: Object.keys(note.sections),
      sections: duplicated(note.sections) ? undefined : note.sections,
      context: duplicated(note.context) ? undefined : note.context,
      decision: duplicated({ decision: note.decision }) ? undefined : note.decision,
    }
  })
  return JSON.stringify({ ...snapshot, notes, versions: undefined })
}
