'use server'

import { createHash } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireWritableEpisode, selectLatestCompletedEncounter } from '@/lib/clinical/episode-context'
import { requireReturnTeleVisitsMutation } from '@/lib/features/return-tele-visits'
import { generatePainFollowUp } from '@/lib/claude/generate-pain-follow-up'
import { painFollowUpNoteEditSchema, type PainFollowUpNoteEditValues } from '@/lib/validations/pain-follow-up-note'
import type { Json, Tables } from '@/types/database'
import {
  assertDiagnosisTextMatchesPool,
  assertRecommendationDiagnosesInPool,
  formatVisitDiagnoses,
  requireConfirmedVisitDiagnosisPool,
} from '@/lib/clinical/visit-diagnoses'

const NOTE_SECTIONS = ['subjective','interval_history','review_of_systems','telehealth_observations','imaging_review','assessment','diagnoses','treatment_plan','patient_education','follow_up','clinician_disclaimer'] as const
export type PainFollowUpSection = (typeof NOTE_SECTIONS)[number]

export async function getPainFollowUpNote(caseId: string, encounterId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.from('pain_follow_up_notes').select('*')
    .eq('case_id', caseId).eq('encounter_id', encounterId).is('deleted_at', null).maybeSingle()
  return error ? { error: 'Unable to load follow-up note' } : { data }
}

async function gatherSource(caseId: string, encounterId: string) {
  const supabase = await createClient()
  const { data: encounter } = await supabase.from('clinical_encounters')
    .select('id,case_id,episode_id,encounter_type,modality,status,scheduled_start,scheduled_end,encounter_date,completed_at,provider_id,reason_for_visit,provider_intake,patient_reported_pain_min,patient_reported_pain_max,patient_reported_measurements,telehealth_consent_obtained,telehealth_consent_at,patient_location_state,provider_location,connection_method,created_at,diagnoses,diagnoses_confirmed_at')
    .eq('id', encounterId).eq('case_id', caseId).eq('encounter_type', 'pain_follow_up')
    .is('deleted_at', null).maybeSingle()
  if (!encounter) return { error: 'Visit not found' as const }
  let visitDiagnosisPool
  try {
    visitDiagnosisPool = requireConfirmedVisitDiagnosisPool(encounter)
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Review and confirm diagnoses for this visit' }
  }
  const [{ data: caseData }, { data: episode }, { data: episodeEncounters }, { data: procedures }] = await Promise.all([
    supabase.from('cases').select('patient:patients(first_name,last_name,date_of_birth,gender)')
      .eq('id', caseId).is('deleted_at', null).single(),
    supabase.from('care_episodes').select('id,episode_number').eq('id', encounter.episode_id).eq('case_id', caseId).single(),
    supabase.from('clinical_encounters')
      .select('id,case_id,episode_id,encounter_type,modality,status,scheduled_start,scheduled_end,encounter_date,completed_at,provider_id,reason_for_visit,provider_intake,patient_reported_pain_min,patient_reported_pain_max,patient_reported_measurements,telehealth_consent_obtained,telehealth_consent_at,patient_location_state,provider_location,connection_method,created_at,updated_at,deleted_at,created_by_user_id,updated_by_user_id')
      .eq('episode_id', encounter.episode_id)
      .neq('id', encounterId).is('deleted_at', null),
    supabase.from('procedures').select('procedure_date,procedure_type,sites,procedure_number')
      .eq('episode_id', encounter.episode_id).eq('status', 'performed').is('deleted_at', null).order('procedure_date'),
  ])
  const previousEpisodeNumber = (episode?.episode_number ?? 1) - 1
  let priorEpisodeDischarge: Record<string, unknown> | null = null
  if (previousEpisodeNumber > 0) {
    const { data: previousEpisode } = await supabase.from('care_episodes').select('id')
      .eq('case_id', caseId).eq('episode_number', previousEpisodeNumber).is('deleted_at', null).maybeSingle()
    if (previousEpisode) {
      const { data } = await supabase.from('discharge_notes')
        .select('visit_date,subjective,assessment,plan_and_recommendations,prognosis')
        .eq('episode_id', previousEpisode.id).eq('status', 'finalized').is('deleted_at', null).maybeSingle()
      priorEpisodeDischarge = data
    }
  }
  let provider: Record<string, unknown> | null = null
  if (encounter.provider_id) {
    const { data } = await supabase.from('provider_profiles').select('display_name,credentials,npi_number')
      .eq('id', encounter.provider_id).is('deleted_at', null).maybeSingle()
    provider = data
  }
  return { data: {
    encounter: {
      id: encounter.id,
      modality: encounter.modality,
      scheduled_start: encounter.scheduled_start,
      encounter_date: encounter.encounter_date,
      reason_for_visit: encounter.reason_for_visit,
      provider_intake: encounter.provider_intake,
      patient_reported_pain_min: encounter.patient_reported_pain_min,
      patient_reported_pain_max: encounter.patient_reported_pain_max,
      patient_reported_measurements: encounter.patient_reported_measurements,
      telehealth_consent_obtained: encounter.telehealth_consent_obtained,
      telehealth_consent_at: encounter.telehealth_consent_at,
      patient_location_state: encounter.patient_location_state,
      provider_location: encounter.provider_location,
      connection_method: encounter.connection_method,
    },
    patient: (caseData?.patient ?? null) as unknown as Record<string, unknown> | null,
    provider,
    latestCompletedEncounter: selectLatestCompletedEncounter((episodeEncounters ?? []) as Tables<'clinical_encounters'>[]) as unknown as Record<string, unknown> | null,
    priorEpisodeDischarge,
    performedProcedures: (procedures ?? []) as unknown as Record<string, unknown>[],
    visitDiagnosisPool,
    visitDiagnosisConfirmedAt: encounter.diagnoses_confirmed_at!,
  }, encounter }
}

export async function generatePainFollowUpNote(caseId: string, encounterId: string) {
  const disabled = requireReturnTeleVisitsMutation()
  if (disabled) return disabled
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const source = await gatherSource(caseId, encounterId)
  if (!source.data || !source.encounter) return { error: source.error ?? 'Unable to gather visit data' }
  if (source.encounter.status !== 'in_progress') return { error: 'Start the visit before generating its note' }
  try { await requireWritableEpisode(caseId, source.encounter.episode_id, supabase) }
  catch (error) { return { error: error instanceof Error ? error.message : 'Episode is not writable' } }

  const sourceHash = createHash('sha256').update(JSON.stringify(source.data)).digest('hex')
  const { data: existing } = await supabase.from('pain_follow_up_notes').select('id,status,generation_attempts')
    .eq('encounter_id', encounterId).is('deleted_at', null).maybeSingle()
  if (existing?.status === 'finalized') return { error: 'Finalized notes cannot be regenerated' }
  let noteId = existing?.id
  if (noteId && existing) {
    await supabase.from('pain_follow_up_notes').update({ status: 'generating', generation_error: null,
      generation_attempts: (existing.generation_attempts ?? 0) + 1, sections_done: 0,
      sections_total: NOTE_SECTIONS.length, updated_by_user_id: user.id }).eq('id', noteId)
  } else {
    const { data: inserted, error } = await supabase.from('pain_follow_up_notes').insert({
      case_id: caseId, episode_id: source.encounter.episode_id, encounter_id: encounterId,
      status: 'generating', generation_attempts: 1, sections_total: NOTE_SECTIONS.length,
      created_by_user_id: user.id, updated_by_user_id: user.id,
    }).select('id').single()
    if (error || !inserted) return { error: 'Unable to start note generation' }
    noteId = inserted.id
  }
  const generated = await generatePainFollowUp(source.data)
  if (!generated.data) {
    await supabase.from('pain_follow_up_notes').update({ status: 'failed', generation_error: generated.error ?? 'Generation failed', updated_by_user_id: user.id }).eq('id', noteId)
    return { error: generated.error ?? 'Unable to generate follow-up note' }
  }
  const { data: latestEncounter } = await supabase.from('clinical_encounters')
    .select('diagnoses,diagnoses_confirmed_at')
    .eq('id', encounterId)
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .maybeSingle()
  let latestDiagnosisPool
  try {
    latestDiagnosisPool = latestEncounter ? requireConfirmedVisitDiagnosisPool(latestEncounter) : null
  } catch {
    latestDiagnosisPool = null
  }
  if (
    !latestDiagnosisPool
    || latestEncounter?.diagnoses_confirmed_at !== source.data.visitDiagnosisConfirmedAt
    || JSON.stringify(latestDiagnosisPool) !== JSON.stringify(source.data.visitDiagnosisPool)
  ) {
    await supabase.from('pain_follow_up_notes').update({
      status: 'failed',
      generation_error: 'Visit diagnoses changed during generation. Review them and generate again.',
      updated_by_user_id: user.id,
    }).eq('id', noteId)
    return { error: 'Visit diagnoses changed during generation. Review them and generate again.' }
  }
  try {
    assertRecommendationDiagnosesInPool(
      generated.data.procedure_recommendations,
      source.data.visitDiagnosisPool,
    )
  } catch (error) {
    await supabase.from('pain_follow_up_notes').update({
      status: 'failed',
      generation_error: error instanceof Error ? error.message : 'Recommendation diagnoses are invalid',
      updated_by_user_id: user.id,
    }).eq('id', noteId)
    return { error: error instanceof Error ? error.message : 'Recommendation diagnoses are invalid' }
  }
  const deterministicData = {
    ...generated.data,
    diagnoses: formatVisitDiagnoses(source.data.visitDiagnosisPool),
    diagnoses_snapshot: source.data.visitDiagnosisPool,
  }
  const { error } = await supabase.from('pain_follow_up_notes').update({
    ...deterministicData, status: 'draft', ai_model: 'claude-sonnet-4-6',
    raw_ai_response: (generated.rawResponse ?? null) as Json | null,
    source_data_hash: sourceHash, sections_done: NOTE_SECTIONS.length,
    generation_error: null, updated_by_user_id: user.id,
  }).eq('id', noteId)
  if (error) return { error: 'Unable to save generated note' }
  revalidatePath(`/patients/${caseId}/visits/${encounterId}`)
  return { data: { noteId } }
}

export async function savePainFollowUpNote(caseId: string, values: PainFollowUpNoteEditValues) {
  const disabled = requireReturnTeleVisitsMutation()
  if (disabled) return disabled
  const parsed = painFollowUpNoteEditSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid note' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const { data: encounter } = await supabase.from('clinical_encounters')
    .select('episode_id,diagnoses,diagnoses_confirmed_at')
    .eq('id', parsed.data.encounter_id).eq('case_id', caseId).is('deleted_at', null).maybeSingle()
  if (!encounter) return { error: 'Visit not found' }
  try { await requireWritableEpisode(caseId, encounter.episode_id, supabase) }
  catch (error) { return { error: error instanceof Error ? error.message : 'Episode is not writable' } }
  const { encounter_id, ...note } = parsed.data
  let visitDiagnosisPool
  try {
    visitDiagnosisPool = requireConfirmedVisitDiagnosisPool(encounter)
    assertRecommendationDiagnosesInPool(note.procedure_recommendations, visitDiagnosisPool)
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Visit diagnoses are invalid' }
  }
  const { error } = await supabase.from('pain_follow_up_notes').update({
    ...note,
    diagnoses: formatVisitDiagnoses(visitDiagnosisPool),
    diagnoses_snapshot: visitDiagnosisPool,
    updated_by_user_id: user.id,
  })
    .eq('case_id', caseId).eq('encounter_id', encounter_id).eq('status', 'draft').is('deleted_at', null)
  if (error) return { error: 'Unable to save note' }
  revalidatePath(`/patients/${caseId}/visits/${encounter_id}`)
  return { data: { success: true } }
}

export async function regeneratePainFollowUpSectionAction(
  caseId: string,
  encounterId: string,
  section: PainFollowUpSection,
  findingFix?: { message: string; rationale: string | null },
) {
  const disabled = requireReturnTeleVisitsMutation()
  if (disabled) return disabled
  if (!NOTE_SECTIONS.includes(section)) return { error: 'Invalid follow-up note section' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const source = await gatherSource(caseId, encounterId)
  if (!source.data || !source.encounter) return { error: source.error ?? 'Unable to gather visit data' }
  if (source.encounter.status !== 'in_progress') return { error: 'Only an in-progress visit can be regenerated' }
  try { await requireWritableEpisode(caseId, source.encounter.episode_id, supabase) }
  catch (error) { return { error: error instanceof Error ? error.message : 'Episode is not writable' } }
  const { data: note } = await supabase.from('pain_follow_up_notes').select('id,status')
    .eq('case_id', caseId).eq('encounter_id', encounterId).is('deleted_at', null).maybeSingle()
  if (!note || note.status !== 'draft') return { error: 'No draft follow-up note found' }
  if (section === 'diagnoses') {
    const content = formatVisitDiagnoses(source.data.visitDiagnosisPool)
    const { error } = await supabase.from('pain_follow_up_notes').update({
      diagnoses: content,
      diagnoses_snapshot: source.data.visitDiagnosisPool,
      updated_by_user_id: user.id,
    }).eq('id', note.id).eq('status', 'draft')
    if (error) return { error: 'Unable to save regenerated diagnoses' }
    revalidatePath(`/patients/${caseId}/visits/${encounterId}`)
    return { data: { success: true, content } }
  }
  const generated = await generatePainFollowUp(source.data, findingFix
    ? { section, message: findingFix.message, rationale: findingFix.rationale }
    : undefined)
  if (!generated.data) return { error: generated.error ?? 'Unable to regenerate follow-up section' }
  const { error } = await supabase.from('pain_follow_up_notes').update({
    [section]: generated.data[section],
    raw_ai_response: (generated.rawResponse ?? null) as Json | null,
    updated_by_user_id: user.id,
  }).eq('id', note.id).eq('status', 'draft')
  if (error) return { error: 'Unable to save regenerated section' }
  revalidatePath(`/patients/${caseId}/visits/${encounterId}`)
  return { data: { success: true } }
}

export async function finalizePainFollowUpNote(caseId: string, encounterId: string) {
  const disabled = requireReturnTeleVisitsMutation()
  if (disabled) return disabled
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const { data: note } = await supabase.from('pain_follow_up_notes').select('*')
    .eq('case_id', caseId).eq('encounter_id', encounterId).is('deleted_at', null).maybeSingle()
  if (!note) return { error: 'No draft follow-up note found' }
  if (note.status === 'finalized') return { data: { success: true, replayed: true } }
  if (note.status !== 'draft') return { error: 'No draft follow-up note found' }
  const { data: encounter } = await supabase.from('clinical_encounters')
    .select('diagnoses,diagnoses_confirmed_at')
    .eq('id', encounterId)
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .maybeSingle()
  try {
    const visitDiagnosisPool = encounter ? requireConfirmedVisitDiagnosisPool(encounter) : null
    if (!visitDiagnosisPool) throw new Error('Visit encounter not found')
    assertDiagnosisTextMatchesPool(note.diagnoses, visitDiagnosisPool)
    if (JSON.stringify(note.diagnoses_snapshot) !== JSON.stringify(visitDiagnosisPool)) {
      throw new Error('Diagnosis snapshot does not match the confirmed visit diagnoses')
    }
    assertRecommendationDiagnosesInPool(
      note.procedure_recommendations as unknown as PainFollowUpNoteEditValues['procedure_recommendations'],
      visitDiagnosisPool,
    )
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Visit diagnoses do not match this note' }
  }
  const { renderPainFollowUpPdf } = await import('@/lib/pdf/render-pain-follow-up-pdf')
  const buffer = await renderPainFollowUpPdf(caseId, encounterId, note as unknown as Record<string, unknown>)
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
  const { error } = await supabase.rpc('finalize_pain_follow_up', {
    p_case_id: caseId, p_encounter_id: encounterId, p_note_id: note.id, p_document_id: document.id,
  })
  if (error) {
    await supabase.storage.from('case-documents').remove([path])
    await supabase.from('documents').update({ deleted_at: new Date().toISOString(), updated_by_user_id: user.id }).eq('id', document.id)
    return { error: error.message.includes('not writable') ? 'This visit is no longer writable' : 'Unable to finalize follow-up note' }
  }
  revalidatePath(`/patients/${caseId}/visits`)
  revalidatePath(`/patients/${caseId}/visits/${encounterId}`)
  revalidatePath(`/patients/${caseId}/documents`)
  revalidatePath(`/patients/${caseId}/timeline`)
  return { data: { success: true } }
}

export async function unfinalizePainFollowUpNote(caseId: string, noteId: string) {
  const disabled = requireReturnTeleVisitsMutation()
  if (disabled) return disabled
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const { data: existing } = await supabase.from('pain_follow_up_notes')
    .select('document:documents(file_path)').eq('id', noteId).eq('case_id', caseId)
    .eq('status', 'finalized').is('deleted_at', null).maybeSingle()
  const { data, error } = await supabase.rpc('unfinalize_pain_follow_up', { p_case_id: caseId, p_note_id: noteId })
  if (error) return { error: error.message.includes('Remove procedure') ? error.message : 'Unable to reopen note' }
  const document = existing?.document as unknown as { file_path: string | null } | null
  if (document?.file_path) await supabase.storage.from('case-documents').remove([document.file_path])
  revalidatePath(`/patients/${caseId}/visits/${data}`)
  return { data: { encounterId: data } }
}
