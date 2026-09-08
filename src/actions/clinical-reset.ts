'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireReturnTeleVisitsMutation } from '@/lib/features/return-tele-visits'
import { clinicalNoteKindSchema, clinicalResetRequestSchema, type ClinicalResetPreview, type ClinicalResetRequest } from '@/lib/validations/clinical-reset'
import type { Json } from '@/types/database'
import { z } from 'zod'

function resetError(error: { code?: string; message: string }) {
  if (['40001', '40P01', '23505'].includes(error.code ?? '')) return 'The case changed. Refresh and try again.'
  const allowed = ['Active user', 'Administrator', 'Case not found', 'Care episode', 'Note changed', 'Case or episode changed', 'Only the latest', 'Reactivate', 'Resolve billing', 'Finish or cancel', 'Signed PDF', 'Visit is not writable', 'Generating notes', 'Note does not belong', 'Request key', 'Select a note', 'Only finalized']
  return allowed.some(s => error.message.includes(s)) ? error.message : 'Unable to reset clinical records. Refresh and try again.'
}

export async function previewClinicalReset(caseId: string, episodeId?: string, target?: { kind: string; id: string }): Promise<{ data?: ClinicalResetPreview; error?: string }> {
  if (!z.string().uuid().safeParse(caseId).success || (episodeId && !z.string().uuid().safeParse(episodeId).success)) return { error: 'Invalid case or episode' }
  const supabase = await createClient()
  if (target) {
    if (!clinicalNoteKindSchema.safeParse(target.kind).success || !z.string().uuid().safeParse(target.id).success) return { error: 'Invalid note' }
    const { data: note } = await supabase.from(clinicalNoteKindSchema.parse(target.kind)).select('*').eq('id', target.id).is('deleted_at', null).maybeSingle()
    if (!note) return { error: 'Clinical note not found' }
    if ('procedure_id' in note) {
      const { data: procedure } = await supabase.from('procedures').select('case_id,episode_id').eq('id', note.procedure_id).is('deleted_at', null).maybeSingle()
      if (!procedure || procedure.case_id !== caseId) return { error: 'Clinical note not found' }
      episodeId = procedure.episode_id ?? undefined
    } else {
      if (note.case_id !== caseId) return { error: 'Clinical note not found' }
      episodeId = note.episode_id ?? undefined
    }
    if (!episodeId) return { error: 'Care episode not found' }
  }
  const { data, error } = await supabase.rpc('preview_clinical_reset', { p_case_id: caseId, ...(episodeId ? { p_episode_id: episodeId } : {}) })
  if (error) return { error: resetError(error) }
  return { data: data as unknown as ClinicalResetPreview }
}

export async function applyClinicalReset(input: ClinicalResetRequest) {
  const parsed = clinicalResetRequestSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid reset request' }
  if (parsed.data.notes.some(n => n.kind === 'pain_follow_up_notes')) {
    const disabled = requireReturnTeleVisitsMutation()
    if (disabled) return disabled
  }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('apply_clinical_reset', { p_request: parsed.data as unknown as Json })
  if (error) return { error: resetError(error) }
  revalidatePath(`/patients/${input.case_id}`, 'layout')
  revalidatePath('/patients')
  return { data: { operationId: data } }
}

export async function getCaseReactivationStatus(caseId: string) {
  if (!z.string().uuid().safeParse(caseId).success) return { episodeNumber: null }
  const supabase = await createClient()
  const { data: episode } = await supabase.from('care_episodes').select('id,episode_number,status')
    .eq('case_id', caseId).is('deleted_at', null).order('episode_number', { ascending: false }).limit(1).maybeSingle()
  if (!episode || episode.status !== 'active') return { episodeNumber: null }
  const { data: operation } = await supabase.from('clinical_reset_operations').select('id')
    .eq('case_id', caseId).eq('episode_id', episode.id).contains('request', { reactivate: true }).contains('before_state', { episode: { status: 'discharged' } }).limit(1).maybeSingle()
  return { episodeNumber: operation ? episode.episode_number : null }
}

// Compatibility for draft-reset callers that predate the reviewed dialog.
export async function resetDraftClinicalNote(caseId: string, kind: string, noteId: string) {
  const result = await previewClinicalReset(caseId, undefined, { kind, id: noteId })
  if (!result.data) return { error: result.error ?? 'Unable to preview note reset' }
  const preview = result.data
  const note = preview.notes.find(n => n.kind === kind && n.id === noteId)
  if (!note || !['draft', 'failed'].includes(note.status)) return { error: 'Only draft or failed notes can be reset' }
  const reset = await applyClinicalReset({
    case_id: caseId, episode_id: preview.episode_id,
    case_version: preview.case_version, episode_version: preview.episode_version,
    reactivate: false, reason: '', request_key: crypto.randomUUID(),
    notes: [{ kind: note.kind, id: note.id, updated_at: note.updated_at }],
  })
  if ('error' in reset) return reset
  return { data: { success: true } }
}
