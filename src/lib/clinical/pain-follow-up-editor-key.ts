export interface PainFollowUpNoteVersion {
  id: string
  updated_at: string
}

export function buildPainFollowUpEditorKey(
  note: PainFollowUpNoteVersion | null | undefined,
): string {
  return note ? `pain-follow-up:${note.id}:${note.updated_at}` : 'pain-follow-up:new'
}
