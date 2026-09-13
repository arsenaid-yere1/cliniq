'use server'

import { saveVisitDecision } from '@/lib/clinical/save-visit-decision'

import { removeUnreferencedGeneratedDocument } from '@/lib/supabase/finalize-document'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireWritableEpisode } from '@/lib/clinical/episode-context'
import { requireReturnTeleVisitsMutation } from '@/lib/features/return-tele-visits'
import { followUpSourceSnapshotSchema, followUpReviewStateSchema, followUpPromptSource } from '@/lib/clinical/pain-follow-up-source'
import { generatePainFollowUp } from '@/lib/claude/generate-pain-follow-up'
import {
  painFollowUpNoteEditSchema,
  painFollowUpNoteSections,
  type PainFollowUpNoteEditValues,
  type PainFollowUpSection,
} from '@/lib/validations/pain-follow-up-note'
import type { Json } from '@/types/database'

export type { PainFollowUpSection } from '@/lib/validations/pain-follow-up-note'

export async function getPainFollowUpNote(caseId: string, encounterId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.from('pain_follow_up_notes').select('*')
    .eq('case_id', caseId).eq('encounter_id', encounterId).is('deleted_at', null).maybeSingle()
  return error ? { error: 'Unable to load follow-up note' } : { data }
}

async function reviewRpc(caseId: string, encounterId: string, action: string, version?: string | null, proposalId?: string, payload: Json = {}): Promise<{ error?: string; data?: Json }> {
  const disabled = requireReturnTeleVisitsMutation()
  if (disabled) return disabled
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('follow_up_review', {
    p_action: action, p_case_id: caseId, p_encounter_id: encounterId,
    p_expected_updated_at: version ?? null, p_proposal_id: proposalId ?? null, p_payload: payload,
  })
  if (error) return { error: error.code === '55P03' ? 'Visit information is being edited. Refresh and try again.' : error.message }
  return { data }
}

export async function getPainFollowUpReview(caseId: string, encounterId: string) {
  try {
    const result = await reviewRpc(caseId, encounterId, 'read')
    if (result.error) return { error: result.error }
    const parsed = followUpReviewStateSchema.safeParse(result.data)
    return parsed.success ? { data: parsed.data } : { error: 'Unable to check visit information' }
  } catch { return { error: 'Unable to check visit information' } }
}

async function propose(caseId: string, encounterId: string, version: string | undefined, scope: string,
  findingFix?: { message: string; rationale: string | null }) {
  const prepared = await reviewRpc(caseId, encounterId, 'prepare', version, undefined, { scope })
  if (prepared.error) return prepared
  if (!prepared.data || typeof prepared.data !== 'object' || !('snapshot' in prepared.data)) return { error: 'Unable to read visit sources' }
  const preparation = prepared.data as { id: string; version: string; snapshot: unknown }
  const source = followUpSourceSnapshotSchema.safeParse(preparation.snapshot)
  if (!source.success) return { error: 'Unable to read visit sources' }
  try {
    const generated = await generatePainFollowUp(followUpPromptSource(source.data), findingFix ? { section: scope, ...findingFix } : undefined)
    if (!generated.data) {
      await reviewRpc(caseId, encounterId, 'fail', preparation.version, preparation.id)
      return { error: generated.error ?? 'Unable to generate proposed draft' }
    }
    const result = await reviewRpc(caseId, encounterId, 'complete', preparation.version, preparation.id, {
      content: generated.data as Json, raw_response: (generated.rawResponse ?? null) as Json,
      model: generated.model ?? null,
    })
    return result.error ? result : { data: { proposalId: preparation.id } }
  } catch {
    await reviewRpc(caseId, encounterId, 'fail', preparation.version, preparation.id)
    return { error: 'Generation failed. Your saved draft has been kept.' }
  } finally {
    revalidatePath(`/patients/${caseId}/visits/${encounterId}`)
  }
}

export async function generatePainFollowUpNote(caseId: string, encounterId: string, expectedVersion?: string) {
  return propose(caseId, encounterId, expectedVersion, 'full')
}

export async function applyPainFollowUpProposal(caseId: string, encounterId: string, version: string, proposalId: string) {
  const result = await reviewRpc(caseId, encounterId, 'apply', version, proposalId)
  revalidatePath(`/patients/${caseId}/visits/${encounterId}`)
  return result
}

export async function discardPainFollowUpProposal(caseId: string, encounterId: string, version: string, proposalId: string) {
  const result = await reviewRpc(caseId, encounterId, 'discard', version, proposalId)
  revalidatePath(`/patients/${caseId}/visits/${encounterId}`)
  return result
}

export async function reviewPainFollowUpSources(caseId: string, encounterId: string, version: string, fingerprint: string) {
  const result = await reviewRpc(caseId, encounterId, 'review', version, undefined, { source_fingerprint: fingerprint })
  revalidatePath(`/patients/${caseId}/visits/${encounterId}`)
  return result
}

export async function savePainFollowUpNote(caseId: string, values: PainFollowUpNoteEditValues) {
  const disabled = requireReturnTeleVisitsMutation()
  if (disabled) return disabled
  const parsed = painFollowUpNoteEditSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid note' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const { data: encounter } = await supabase.from('clinical_encounters').select('episode_id')
    .eq('id', parsed.data.encounter_id).eq('case_id', caseId).is('deleted_at', null).maybeSingle()
  if (!encounter) return { error: 'Visit not found' }
  try { await requireWritableEpisode(caseId, encounter.episode_id, supabase) }
  catch (error) { return { error: error instanceof Error ? error.message : 'Episode is not writable' } }
  if (parsed.data.treatment_decision) {
    const { encounter_id, ...patch } = parsed.data
    const result = await saveVisitDecision(supabase, 'pain_follow_up_notes', caseId, { column: 'encounter_id', value: encounter_id }, patch)
    if (result.error) return { error: result.error }
    revalidatePath(`/patients/${caseId}/visits/${encounter_id}`)
    return { data: { success: true, savedNote: result.savedNote } }
  }
  const { encounter_id, reviewed_visit_date: _date, treatment_decision: _decision, expected_updated_at, ...note } = parsed.data
  void _decision; void _date
  const result = await reviewRpc(caseId, encounter_id, 'save', expected_updated_at, undefined, note)
  if (result.error) return result
  revalidatePath(`/patients/${caseId}/visits/${encounter_id}`)
  return { data: { success: true, savedNote: (result.data as { note: Record<string, unknown> }).note } }
}

export async function regeneratePainFollowUpSectionAction(
  caseId: string, encounterId: string, section: PainFollowUpSection,
  findingFix?: { message: string; rationale: string | null }, expectedVersion?: string,
) {
  if (!painFollowUpNoteSections.includes(section)) return { error: 'Invalid follow-up note section' }
  return propose(caseId, encounterId, expectedVersion, section, findingFix)
}

export async function finalizePainFollowUpNote(caseId: string, encounterId: string, expectedSavedVersion?: string) {
  const disabled = requireReturnTeleVisitsMutation()
  if (disabled) return disabled
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const { data: note } = await supabase.from('pain_follow_up_notes').select('*')
    .eq('case_id', caseId).eq('encounter_id', encounterId).is('deleted_at', null).maybeSingle()
  if (!note) return { error: 'No draft follow-up note found' }
  if (expectedSavedVersion && note.updated_at !== expectedSavedVersion) return { error: 'The note changed after saving. Review it before finalizing.' }
  if (note.status === 'finalized') return { data: { success: true, replayed: true } }
  if (note.status !== 'draft') return { error: 'No draft follow-up note found' }
  const review = await getPainFollowUpReview(caseId, encounterId)
  if (!review.data || !review.data.reviewed || review.data.note_version !== note.updated_at) return { error: review.error ?? 'Review the saved note against current visit information before signing.' }
  const { renderPainFollowUpPdf } = await import('@/lib/pdf/render-pain-follow-up-pdf')
  const buffer = await renderPainFollowUpPdf(caseId, encounterId, note as unknown as Record<string, unknown>, review.data.snapshot)
  const path = `cases/${caseId}/pain-follow-up-${encounterId}-${Date.now()}.pdf`
  const { error: uploadError } = await supabase.storage.from('case-documents').upload(
    path, new Blob([new Uint8Array(buffer)], { type: 'application/pdf' }),
    { contentType: 'application/pdf', upsert: false },
  )
  if (uploadError) return { error: `Unable to upload note: ${uploadError.message}` }
  const { data: document, error: documentError } = await supabase.from('documents').insert({
    case_id: caseId, episode_id: note.episode_id, encounter_id: encounterId,
    document_type: 'generated', file_name: 'Pain Management Follow-Up', file_path: path,
    file_size_bytes: buffer.length, mime_type: 'application/pdf', status: 'reviewed',
    uploaded_by_user_id: user.id, created_by_user_id: user.id, updated_by_user_id: user.id,
  }).select('id').single()
  if (documentError || !document) {
    await supabase.storage.from('case-documents').remove([path])
    return { error: 'Unable to create follow-up document' }
  }
  const signed = await reviewRpc(caseId, encounterId, 'finalize', note.updated_at, undefined, {
    document_id: document.id, source_fingerprint: review.data.snapshot.fingerprint,
  })
  const error = signed.error ? { message: signed.error } : null
  if (error) {
    await removeUnreferencedGeneratedDocument(supabase, document.id, path, user.id)
    if (error.message.includes('changed')) {
      return { error: 'The follow-up note changed. Review it and try finalizing again.' }
    }
    return { error: error.message.includes('not writable') ? 'This visit is no longer writable' : 'Unable to finalize follow-up note' }
  }
  revalidatePath(`/patients/${caseId}/visits`)
  revalidatePath(`/patients/${caseId}/visits/${encounterId}`)
  revalidatePath(`/patients/${caseId}/documents`)
  revalidatePath(`/patients/${caseId}/timeline`)
  return { data: { success: true } }
}

export async function resetPainFollowUpNote(caseId: string, encounterId: string) {
  const disabled = requireReturnTeleVisitsMutation()
  if (disabled) return disabled
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: noteId, error } = await supabase.rpc('reset_pain_follow_up', {
    p_case_id: caseId,
    p_encounter_id: encounterId,
  })
  if (error) {
    if (error.message.includes('Follow-up note not found')) {
      return { error: 'No follow-up note to reset' }
    }
    if (error.message.includes('Only draft or failed')) {
      return { error: 'Only draft or failed follow-up notes can be reset' }
    }
    if (error.message.includes('not writable')) {
      return { error: 'This visit is no longer writable' }
    }
    return { error: 'Unable to reset follow-up note' }
  }

  revalidatePath(`/patients/${caseId}/visits/${encounterId}`)
  return { data: { success: true, noteId } }
}

export async function unfinalizePainFollowUpNote(_caseId: string, _noteId: string) {
  void _caseId; void _noteId
  return { error: 'Use the audited Edit control and provide a reason' }
}
