'use server'

import { loadExtractionSummaries } from '@/lib/documents/load-extraction-summaries'
import { randomUUID } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { documentUploadMetaSchema, documentRegistrationSchema, documentReconciliationSchema, uploadStoragePath, type DocumentUploadMeta } from '@/lib/validations/document'
import { revalidatePath } from 'next/cache'
import { assertCaseNotClosed, assertCaseWritable } from '@/actions/case-status'
import { deriveClinicalRevisionStates } from '@/lib/documents/clinical-revision-state'
import { deriveDischargeDocumentRevisionStates } from '@/lib/documents/discharge-revision-state'

export async function listDocuments(caseId: string, filters?: {
  search?: string
  documentType?: string
  status?: string
}) {
  const supabase = await createClient()

  let query = supabase
    .from('documents')
    .select('*, uploaded_by:users!uploaded_by_user_id(full_name), reviewed_by:users!reviewed_by_user_id(full_name)')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (filters?.documentType && filters.documentType !== 'all') {
    query = query.eq('document_type', filters.documentType)
  }

  if (filters?.status && filters.status !== 'all') {
    query = query.eq('status', filters.status)
  }

  if (filters?.search) {
    query = query.or(`file_name.ilike.%${filters.search}%,notes.ilike.%${filters.search}%`)
  }

  const { data, error } = await query

  if (error) return { error: error.message, data: [] }

  const summaries = await loadExtractionSummaries(supabase, caseId, data ?? [])
  const rows = (data ?? []).map(row => ({ ...row, extraction_summary: summaries.get(row.id)! }))
  const generatedIds = rows
    .filter((r) => r.document_type === 'generated')
    .map((r) => r.id)

  if (generatedIds.length === 0) {
    return { data: rows.map((r) => ({
      ...r,
      content_date: null,
      procedure_number: null,
      revision_status: null,
      revision_number: null,
    })) }
  }

  const [dischargeRes, initialVisitRes, painFollowUpRes, procedureNoteRes, clinicalOrderRes, correctionRes, resetRes] = await Promise.all([
    supabase.from('discharge_notes').select('document_id, visit_date').in('document_id', generatedIds),
    supabase.from('initial_visit_notes').select('document_id, visit_date').in('document_id', generatedIds),
    supabase.from('pain_follow_up_notes')
      .select('document_id, encounter:clinical_encounters!pain_follow_up_notes_encounter_ownership_fkey(encounter_date)')
      .in('document_id', generatedIds),
    supabase.from('procedure_notes').select('document_id, procedure:procedures(procedure_date, procedure_number)').in('document_id', generatedIds),
    supabase.from('clinical_orders').select('document_id').in('document_id', generatedIds),
    supabase.from('discharge_note_corrections')
      .select('revision_number,status,original_document_id,replacement_document_id')
      .or(`original_document_id.in.(${generatedIds.join(',')}),replacement_document_id.in.(${generatedIds.join(',')})`),
    supabase.from('clinical_note_revisions').select('*').eq('case_id', caseId),
  ])

  const contentDateByDocId = new Map<string, string>()
  const procedureNumberByDocId = new Map<string, number>()
  for (const r of dischargeRes.data ?? []) {
    if (r.document_id && r.visit_date) contentDateByDocId.set(r.document_id, r.visit_date)
  }
  for (const r of initialVisitRes.data ?? []) {
    if (r.document_id && r.visit_date) contentDateByDocId.set(r.document_id, r.visit_date)
  }
  for (const r of painFollowUpRes.data ?? []) {
    const encounterRaw = r.encounter as unknown as
      | { encounter_date: string | null }
      | { encounter_date: string | null }[]
      | null
    const encounter = Array.isArray(encounterRaw) ? encounterRaw[0] ?? null : encounterRaw
    if (r.document_id && encounter?.encounter_date) {
      contentDateByDocId.set(r.document_id, encounter.encounter_date)
    }
  }
  for (const r of procedureNoteRes.data ?? []) {
    const procRaw = r.procedure as unknown as
      | { procedure_date: string | null; procedure_number: number | null }
      | { procedure_date: string | null; procedure_number: number | null }[]
      | null
    const proc = Array.isArray(procRaw) ? procRaw[0] ?? null : procRaw
    if (r.document_id && proc?.procedure_date) contentDateByDocId.set(r.document_id, proc.procedure_date)
    if (r.document_id && proc?.procedure_number != null) procedureNumberByDocId.set(r.document_id, proc.procedure_number)
  }
  // clinical_orders has no content-date column; leave to fall back to created_at in the UI
  void clinicalOrderRes
  const revisionStates = deriveDischargeDocumentRevisionStates(correctionRes.data ?? [])

  if (resetRes.error) return { error: 'Unable to load signed document history', data: [] }
  const resetStates = deriveClinicalRevisionStates(resetRes.data ?? [])
  const operationIds = [...new Set((resetRes.data ?? []).map(r => r.operation_id))]
  const { data: operations } = operationIds.length
    ? await supabase.from('clinical_reset_operations').select('id,reason,created_at,actor_id').in('id', operationIds)
    : { data: [] }
  const { data: actors } = operations?.length
    ? await supabase.from('users').select('id,full_name').in('id', [...new Set(operations.map(o => o.actor_id))])
    : { data: [] }
  const historyByDoc = new Map((resetRes.data ?? []).map(r => {
    const operation = operations?.find(o => o.id === r.operation_id)
    const snapshot = r.original_snapshot as Record<string, unknown>
    const date = snapshot.visit_date ?? snapshot.procedure_date
    if (typeof date === 'string') contentDateByDocId.set(r.original_document_id, date)
    return [r.original_document_id, operation ? `${operation.reason} · ${actors?.find(a => a.id === operation.actor_id)?.full_name ?? 'Administrator'} · ${operation.created_at.slice(0, 10)}` : 'Signed revision retained']
  }))

  return {
    data: rows.map((r) => ({
      ...r,
      content_date: contentDateByDocId.get(r.id) ?? null,
      procedure_number: procedureNumberByDocId.get(r.id) ?? null,
      revision_status: resetStates.get(r.id) ?? revisionStates.get(r.id)?.revisionStatus ?? null,
      revision_history: historyByDoc.get(r.id) ?? null,
      revision_number: revisionStates.get(r.id)?.revisionNumber ?? null,
    })),
  }
}

export async function getDocumentCount(caseId: string) {
  const supabase = await createClient()

  const { count, error } = await supabase
    .from('documents')
    .select('*', { count: 'exact', head: true })
    .eq('case_id', caseId)
    .is('deleted_at', null)

  if (error) return { error: error.message, count: 0 }
  return { count: count ?? 0 }
}

async function checkUploadAccess(
  supabase: Awaited<ReturnType<typeof createClient>>, caseId: string, allowLocked?: boolean,
) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const { data: actor } = await supabase.from('users').select('is_active').eq('id', user.id).single()
  if (!actor?.is_active) return { error: 'Active user required' }
  const { data: caseData, error } = await supabase.from('cases').select('id')
    .eq('id', caseId).is('deleted_at', null).single()
  if (error || !caseData) return { error: 'Case not found' }
  const writable = await assertCaseWritable(supabase, caseId, { allowLockedForAdmin: allowLocked })
  return writable.error ? { error: writable.error } : { userId: user.id }
}

export async function getUploadSession(data: DocumentUploadMeta, options?: { allowLocked?: boolean }) {
  const parsed = documentUploadMetaSchema.safeParse(data)
  if (!parsed.success) return { error: 'Invalid document metadata' }
  const supabase = await createClient()
  const access = await checkUploadAccess(supabase, parsed.data.caseId, options?.allowLocked)
  if (access.error) return { error: access.error }
  const { caseId, uploadId, fileName } = parsed.data
  return { data: {
    storagePath: uploadStoragePath(caseId, uploadId ?? String(Date.now()), fileName),
    userId: access.userId,
  } }
}

export async function reconcileDocumentUpload(
  input: DocumentUploadMeta & { uploadId: string; filePath: string },
  options?: { allowLocked?: boolean },
) {
  const parsed = documentReconciliationSchema.safeParse(input)
  if (!parsed.success) return { error: 'Invalid document metadata or path' }
  const supabase = await createClient()
  const access = await checkUploadAccess(supabase, parsed.data.caseId, options?.allowLocked)
  if (access.error) return { error: access.error }
  try {
    const { data, error } = await supabase.storage.from('case-documents').info(parsed.data.filePath)
    if (error) {
      const code = 'code' in error ? error.code : undefined
      const status = 'statusCode' in error ? String(error.statusCode) : undefined
      if (code === 'NoSuchKey' || (status === '404' && (code === 'not_found' || code === undefined))) {
        return { data: { state: 'missing' as const } }
      }
      return { error: 'Unable to confirm file transfer. Retry to check again.' }
    }
    if (data?.size === undefined || !data.contentType) {
      return { error: 'File details are unavailable. Retry to check again.' }
    }
    if (data.size !== parsed.data.fileSize || data.contentType !== parsed.data.mimeType) {
      return { error: 'Upload identity conflict: stored file details do not match.' }
    }
    return { data: { state: 'present' as const } }
  } catch {
    return { error: 'Unable to confirm file transfer. Retry to check again.' }
  }
}

export async function saveDocumentMetadata(input: {
  caseId: string
  uploadId?: string
  documentType: string
  fileName: string
  filePath: string
  fileSizeBytes: number
  mimeType: string
}, options?: { allowLocked?: boolean }) {
  const parsed = documentRegistrationSchema.safeParse({ ...input, fileSize: input.fileSizeBytes })
  if (!parsed.success) return { error: 'Invalid document metadata or path' }
  const supabase = await createClient()
  const access = await checkUploadAccess(supabase, parsed.data.caseId, options?.allowLocked)
  if (access.error) return { error: access.error }
  const value = parsed.data
  const { data, error } = await supabase.rpc('register_uploaded_document', {
    p_upload_id: value.uploadId ?? randomUUID(),
    p_case_id: value.caseId,
    p_document_type: value.documentType,
    p_file_name: value.fileName,
    p_file_path: value.filePath,
    p_file_size_bytes: value.fileSize,
    p_mime_type: value.mimeType,
    p_allow_locked: options?.allowLocked === true,
    p_legacy_path: !value.uploadId,
  })
  if (error) {
    const known = ['Upload identity conflict', 'This case is locked', 'Case not found', 'Active user required', 'Not authenticated']
    return { error: known.find((message) => error.message.includes(message)) ?? 'Unable to save document. Retry saving with the same upload.' }
  }
  const result = data?.[0]
  if (!result?.document_id) return { error: 'Document registration was not confirmed. Retry saving document.' }
  revalidatePath(`/patients/${value.caseId}`, 'layout')
  revalidatePath('/patients')
  return { data: { id: result.document_id, created: result.created } }
}

export async function getDocumentDownloadUrl(filePath: string, downloadName?: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.storage
    .from('case-documents')
    .createSignedUrl(filePath, 3600, { download: downloadName ?? true })

  if (error) return { error: error.message }
  return { url: data.signedUrl }
}

export async function removeDocument(documentId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Fetch case_id to check closure
  const { data: docInfo } = await supabase
    .from('documents')
    .select('case_id')
    .eq('id', documentId)
    .is('deleted_at', null)
    .single()

  if (!docInfo) return { error: 'Document not found' }

  const { data: retained, error: retentionError } = await supabase.from('clinical_note_revisions').select('id')
    .or(`original_document_id.eq.${documentId},replacement_document_id.eq.${documentId}`).limit(1)
  if (retentionError) return { error: 'Unable to verify document history' }
  if (retained?.length) return { error: 'Signed revision documents are retained and cannot be removed.' }

  const { data: correctionDocument } = await supabase.from('discharge_note_corrections')
    .select('id')
    .or(`original_document_id.eq.${documentId},replacement_document_id.eq.${documentId}`)
    .limit(1)
  if (correctionDocument?.length) {
    return { error: 'Discharge correction documents are retained for audit and cannot be removed.' }
  }

  const closedCheck = await assertCaseNotClosed(supabase, docInfo.case_id)
  if (closedCheck.error) return { error: closedCheck.error }

  const { data, error } = await supabase
    .from('documents')
    .update({
      deleted_at: new Date().toISOString(),
      updated_by_user_id: user.id,
    })
    .eq('id', documentId)
    .is('deleted_at', null)
    .select('case_id')
    .single()

  if (error) return { error: error.message }

  // Cascade soft-delete to linked clinical extractions
  const now = new Date().toISOString()
  await Promise.all([
    supabase
      .from('chiro_extractions')
      .update({ deleted_at: now, updated_by_user_id: user.id })
      .eq('document_id', documentId)
      .is('deleted_at', null),
    supabase
      .from('mri_extractions')
      .update({ deleted_at: now, updated_by_user_id: user.id })
      .eq('document_id', documentId)
      .is('deleted_at', null),
    supabase
      .from('pain_management_extractions')
      .update({ deleted_at: now, updated_by_user_id: user.id })
      .eq('document_id', documentId)
      .is('deleted_at', null),
    supabase
      .from('pt_extractions')
      .update({ deleted_at: now, updated_by_user_id: user.id })
      .eq('document_id', documentId)
      .is('deleted_at', null),
    supabase
      .from('orthopedic_extractions')
      .update({ deleted_at: now, updated_by_user_id: user.id })
      .eq('document_id', documentId)
      .is('deleted_at', null),
    supabase
      .from('ct_scan_extractions')
      .update({ deleted_at: now, updated_by_user_id: user.id })
      .eq('document_id', documentId)
      .is('deleted_at', null),
    supabase
      .from('x_ray_extractions')
      .update({ deleted_at: now, updated_by_user_id: user.id })
      .eq('document_id', documentId)
      .is('deleted_at', null),
  ])

  revalidatePath(`/patients/${data.case_id}/documents`)
  revalidatePath(`/patients/${data.case_id}/clinical`)
  return { data }
}

export async function getDocumentPreviewUrl(filePath: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.storage
    .from('case-documents')
    .createSignedUrl(filePath, 3600)

  if (error) return { error: error.message }
  return { url: data.signedUrl }
}
