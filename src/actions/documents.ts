'use server'

import { createClient } from '@/lib/supabase/server'
import { documentUploadMetaSchema, type DocumentUploadMeta } from '@/lib/validations/document'
import { revalidatePath } from 'next/cache'
import { assertCaseNotClosed, autoAdvanceFromIntake } from '@/actions/case-status'

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
  return { data: data ?? [] }
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

export async function getUploadSession(data: DocumentUploadMeta) {
  const parsed = documentUploadMetaSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: caseData, error: caseError } = await supabase
    .from('cases')
    .select('id')
    .eq('id', parsed.data.caseId)
    .is('deleted_at', null)
    .single()

  if (caseError || !caseData) return { error: 'Case not found' }

  const closedCheck = await assertCaseNotClosed(supabase, parsed.data.caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const sanitized = parsed.data.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `cases/${parsed.data.caseId}/${Date.now()}-${sanitized}`

  return {
    data: {
      storagePath,
      userId: user.id,
    },
  }
}

export async function saveDocumentMetadata(input: {
  caseId: string
  documentType: string
  fileName: string
  filePath: string
  fileSizeBytes: number
  mimeType: string
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, input.caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  await autoAdvanceFromIntake(supabase, input.caseId, user.id)

  const { data, error } = await supabase
    .from('documents')
    .insert({
      case_id: input.caseId,
      document_type: input.documentType,
      file_name: input.fileName,
      file_path: input.filePath,
      file_size_bytes: input.fileSizeBytes,
      mime_type: input.mimeType,
      status: 'pending_review',
      uploaded_by_user_id: user.id,
      created_by_user_id: user.id,
      updated_by_user_id: user.id,
    })
    .select()
    .single()

  if (error) return { error: error.message }

  revalidatePath(`/patients/${input.caseId}/documents`)
  return { data }
}

export async function getDocumentDownloadUrl(filePath: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.storage
    .from('case-documents')
    .createSignedUrl(filePath, 3600, { download: true })

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
