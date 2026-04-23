'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { extractXRayFromPdf } from '@/lib/claude/extract-x-ray'
import type { XRayExtractionResult, XRayReviewFormValues } from '@/lib/validations/x-ray-extraction'
import { assertCaseNotClosed } from '@/actions/case-status'

// --- Trigger extraction for a document ---

export async function extractXRayReport(documentId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: doc, error: docError } = await supabase
    .from('documents')
    .select('id, case_id, file_path, document_type')
    .eq('id', documentId)
    .is('deleted_at', null)
    .single()

  if (docError || !doc) return { error: 'Document not found' }
  if (doc.document_type !== 'x_ray') return { error: 'Not an X-ray report' }

  const closedCheck = await assertCaseNotClosed(supabase, doc.case_id)
  if (closedCheck.error) return { error: closedCheck.error }

  await supabase
    .from('x_ray_extractions')
    .update({ deleted_at: new Date().toISOString(), updated_by_user_id: user.id })
    .eq('document_id', documentId)
    .is('deleted_at', null)

  const { data: extraction, error: insertError } = await supabase
    .from('x_ray_extractions')
    .insert({
      document_id: documentId,
      case_id: doc.case_id,
      extraction_status: 'processing',
      extraction_attempts: 1,
      created_by_user_id: user.id,
      updated_by_user_id: user.id,
    })
    .select()
    .single()

  if (insertError || !extraction) return { error: 'Failed to create extraction record' }

  const { data: fileData, error: downloadError } = await supabase.storage
    .from('case-documents')
    .download(doc.file_path)

  if (downloadError || !fileData) {
    await supabase.from('x_ray_extractions').update({
      extraction_status: 'failed',
      extraction_error: 'Failed to download PDF from storage',
      updated_by_user_id: user.id,
    }).eq('id', extraction.id)
    return { error: 'Failed to download PDF' }
  }

  const firstBytes = new Uint8Array(await fileData.slice(0, 8192).arrayBuffer())
  const headerStr = new TextDecoder().decode(firstBytes)
  if (headerStr.includes('/Encrypt')) {
    await supabase.from('x_ray_extractions').update({
      extraction_status: 'failed',
      extraction_error: 'PDF is encrypted/password-protected',
      updated_by_user_id: user.id,
    }).eq('id', extraction.id)
    return { error: 'PDF is encrypted. Please upload an unprotected version.' }
  }

  const arrayBuffer = await fileData.arrayBuffer()
  const pdfBase64 = Buffer.from(arrayBuffer).toString('base64')

  const result = await extractXRayFromPdf(pdfBase64)

  if (result.error || !result.data?.length) {
    await supabase.from('x_ray_extractions').update({
      extraction_status: 'failed',
      extraction_error: result.error ?? 'Extraction failed',
      extraction_attempts: 1,
      raw_ai_response: result.rawResponse ?? null,
      updated_by_user_id: user.id,
    }).eq('id', extraction.id)
    revalidatePath(`/patients/${doc.case_id}/clinical`)
    return { error: result.error }
  }

  const ids = await insertMultiRegionExtractions(
    supabase, extraction.id, documentId, doc.case_id, result, user.id, 1,
  )
  revalidatePath(`/patients/${doc.case_id}/clinical`)
  revalidatePath(`/patients/${doc.case_id}/documents`)
  return { data: { extractionIds: ids } }
}

/**
 * Creates one extraction record per body region.
 * First report updates the existing placeholder row; additional reports are inserted as new rows.
 */
async function insertMultiRegionExtractions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  placeholderId: string,
  documentId: string,
  caseId: string,
  result: { data?: XRayExtractionResult[]; rawResponse?: unknown },
  userId: string,
  attempts: number,
): Promise<string[]> {
  const reports = result.data!
  const ids: string[] = []
  const now = new Date().toISOString()

  for (let i = 0; i < reports.length; i++) {
    const report = reports[i]
    const fields = {
      extraction_status: 'completed' as const,
      body_region: report.body_region,
      laterality: report.laterality,
      scan_date: report.scan_date,
      procedure_description: report.procedure_description,
      view_count: report.view_count,
      views_description: report.views_description,
      reading_type: report.reading_type,
      ordering_provider: report.ordering_provider,
      reading_provider: report.reading_provider,
      reason_for_study: report.reason_for_study,
      findings: report.findings,
      impression_summary: report.impression_summary,
      ai_model: 'claude-sonnet-4-6',
      ai_confidence: report.confidence,
      extraction_notes: report.extraction_notes,
      raw_ai_response: result.rawResponse ?? null,
      extraction_attempts: attempts,
      extracted_at: now,
      updated_by_user_id: userId,
    }

    if (i === 0) {
      await supabase.from('x_ray_extractions').update(fields).eq('id', placeholderId)
      ids.push(placeholderId)
    } else {
      const { data } = await supabase.from('x_ray_extractions').insert({
        ...fields,
        document_id: documentId,
        case_id: caseId,
        created_by_user_id: userId,
      }).select('id').single()
      if (data) ids.push(data.id)
    }
  }

  return ids
}

// --- List extractions for a case ---

export async function listXRayExtractions(caseId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('x_ray_extractions')
    .select('*, document:documents!document_id(file_name, file_path)')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) return { error: error.message, data: [] }
  return { data: data ?? [] }
}

// --- Get single extraction ---

export async function getXRayExtraction(extractionId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('x_ray_extractions')
    .select('*, document:documents!document_id(file_name, file_path)')
    .eq('id', extractionId)
    .is('deleted_at', null)
    .single()

  if (error) return { error: error.message }
  return { data }
}

// --- Approve extraction (no edits) ---

export async function approveXRayExtraction(extractionId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: ext } = await supabase.from('x_ray_extractions').select('case_id').eq('id', extractionId).is('deleted_at', null).single()
  if (!ext) return { error: 'Extraction not found' }
  const closedCheck = await assertCaseNotClosed(supabase, ext.case_id)
  if (closedCheck.error) return { error: closedCheck.error }

  const { data, error } = await supabase
    .from('x_ray_extractions')
    .update({
      review_status: 'approved',
      reviewed_by_user_id: user.id,
      reviewed_at: new Date().toISOString(),
      updated_by_user_id: user.id,
    })
    .eq('id', extractionId)
    .is('deleted_at', null)
    .select('case_id, document_id')
    .single()

  if (error) return { error: error.message }

  await syncDocumentReviewed(supabase, data.document_id, user.id)

  revalidatePath(`/patients/${data.case_id}/clinical`)
  revalidatePath(`/patients/${data.case_id}/documents`)
  return { data }
}

// --- Save edits and approve ---

export async function saveAndApproveXRayExtraction(
  extractionId: string,
  overrides: XRayReviewFormValues,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: ext } = await supabase.from('x_ray_extractions').select('case_id').eq('id', extractionId).is('deleted_at', null).single()
  if (!ext) return { error: 'Extraction not found' }
  const closedCheck = await assertCaseNotClosed(supabase, ext.case_id)
  if (closedCheck.error) return { error: closedCheck.error }

  const { data, error } = await supabase
    .from('x_ray_extractions')
    .update({
      review_status: 'edited',
      provider_overrides: overrides,
      reviewed_by_user_id: user.id,
      reviewed_at: new Date().toISOString(),
      updated_by_user_id: user.id,
    })
    .eq('id', extractionId)
    .is('deleted_at', null)
    .select('case_id, document_id')
    .single()

  if (error) return { error: error.message }

  await syncDocumentReviewed(supabase, data.document_id, user.id)

  revalidatePath(`/patients/${data.case_id}/clinical`)
  revalidatePath(`/patients/${data.case_id}/documents`)
  return { data }
}

// --- Sync document status to reviewed ---

async function syncDocumentReviewed(
  supabase: Awaited<ReturnType<typeof createClient>>,
  documentId: string,
  userId: string,
) {
  await supabase
    .from('documents')
    .update({
      status: 'reviewed',
      reviewed_by_user_id: userId,
      reviewed_at: new Date().toISOString(),
      updated_by_user_id: userId,
    })
    .eq('id', documentId)
    .is('deleted_at', null)
}

// --- Reject extraction ---

export async function rejectXRayExtraction(extractionId: string, reason: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: ext } = await supabase.from('x_ray_extractions').select('case_id').eq('id', extractionId).is('deleted_at', null).single()
  if (!ext) return { error: 'Extraction not found' }
  const closedCheck = await assertCaseNotClosed(supabase, ext.case_id)
  if (closedCheck.error) return { error: closedCheck.error }

  const { data, error } = await supabase
    .from('x_ray_extractions')
    .update({
      review_status: 'rejected',
      extraction_notes: reason,
      reviewed_by_user_id: user.id,
      reviewed_at: new Date().toISOString(),
      updated_by_user_id: user.id,
    })
    .eq('id', extractionId)
    .is('deleted_at', null)
    .select('case_id')
    .single()

  if (error) return { error: error.message }
  revalidatePath(`/patients/${data.case_id}/clinical`)
  return { data }
}
