import { getPainFollowUpEditorState, type PainFollowUpEditorNote } from './pain-follow-up-editor-state'

export function buildPainFollowUpEditorKey(
  caseId: string,
  encounterId: string,
  note: (PainFollowUpEditorNote & { id: string }) | null | undefined,
): string {
  return `pain-follow-up:${caseId}:${encounterId}:${note?.id ?? 'new'}:${getPainFollowUpEditorState(note)}`
}
