'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { extractMriFromPdf } from '@/lib/claude/extract-mri'
import type { MriExtractionResult, MriReviewFormValues } from '@/lib/validations/mri-extraction'
import { assertCaseNotClosed } from '@/actions/case-status'

// --- Trigger extraction for a document ---

export async function extractMriReport(documentId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Get document metadata
  const { data: doc, error: docError } = await supabase
    .from('documents')
    .select('id, case_id, file_path, document_type')
    .eq('id', documentId)
    .is('deleted_at', null)
    .single()

  if (docError || !doc) return { error: 'Document not found' }
  if (doc.document_type !== 'mri_report') return { error: 'Not an MRI report' }

  const closedCheck = await assertCaseNotClosed(supabase, doc.case_id)
  if (closedCheck.error) return { error: closedCheck.error }

  // Soft-delete any existing extraction for this document
  await supabase
    .from('mri_extractions')
    .update({ deleted_at: new Date().toISOString(), updated_by_user_id: user.id })
    .eq('document_id', documentId)
    .is('deleted_at', null)

  // Create pending extraction record
  const { data: extraction, error: insertError } = await supabase
    .from('mri_extractions')
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

  // Download PDF from Supabase Storage
  const { data: fileData, error: downloadError } = await supabase.storage
    .from('case-documents')
    .download(doc.file_path)

  if (downloadError || !fileData) {
    await supabase.from('mri_extractions').update({
      extraction_status: 'failed',
      extraction_error: 'Failed to download PDF from storage',
      updated_by_user_id: user.id,
    }).eq('id', extraction.id)
    return { error: 'Failed to download PDF' }
  }

  // Check for encrypted PDF
  const firstBytes = new Uint8Array(await fileData.slice(0, 8192).arrayBuffer())
  const headerStr = new TextDecoder().decode(firstBytes)
  if (headerStr.includes('/Encrypt')) {
    await supabase.from('mri_extractions').update({
      extraction_status: 'failed',
      extraction_error: 'PDF is encrypted/password-protected',
      updated_by_user_id: user.id,
    }).eq('id', extraction.id)
    return { error: 'PDF is encrypted. Please upload an unprotected version.' }
  }

  // Convert to base64 and call Claude
  const arrayBuffer = await fileData.arrayBuffer()
  const pdfBase64 = Buffer.from(arrayBuffer).toString('base64')

  const result = await extractMriFromPdf(pdfBase64)

  if (result.error || !result.data?.length) {
    await supabase.from('mri_extractions').update({
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
 * - First report updates the existing placeholder row (avoids orphan on failure)
 * - Additional reports are inserted as new rows
 * - All share the same document_id and raw_ai_response
 */
async function insertMultiRegionExtractions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  placeholderId: string,
  documentId: string,
  caseId: string,
  result: { data?: MriExtractionResult[]; rawResponse?: unknown },
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
      mri_date: report.mri_date,
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
      // Update the placeholder row with first report
      await supabase.from('mri_extractions').update(fields).eq('id', placeholderId)
      ids.push(placeholderId)
    } else {
      // Insert additional rows for subsequent body regions
      const { data } = await supabase.from('mri_extractions').insert({
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

export async function listMriExtractions(caseId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('mri_extractions')
    .select('*, document:documents!document_id(file_name, file_path)')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) return { error: error.message, data: [] }
  return { data: data ?? [] }
}

// --- Get single extraction ---

export async function getMriExtraction(extractionId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('mri_extractions')
    .select('*, document:documents!document_id(file_name, file_path)')
    .eq('id', extractionId)
    .is('deleted_at', null)
    .single()

  if (error) return { error: error.message }
  return { data }
}

// --- Approve extraction (no edits) ---

export async function approveMriExtraction(extractionId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: ext } = await supabase.from('mri_extractions').select('case_id').eq('id', extractionId).is('deleted_at', null).single()
  if (!ext) return { error: 'Extraction not found' }
  const closedCheck = await assertCaseNotClosed(supabase, ext.case_id)
  if (closedCheck.error) return { error: closedCheck.error }

  const { data, error } = await supabase
    .from('mri_extractions')
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

export async function saveAndApproveMriExtraction(
  extractionId: string,
  overrides: MriReviewFormValues,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: ext } = await supabase.from('mri_extractions').select('case_id').eq('id', extractionId).is('deleted_at', null).single()
  if (!ext) return { error: 'Extraction not found' }
  const closedCheck = await assertCaseNotClosed(supabase, ext.case_id)
  if (closedCheck.error) return { error: closedCheck.error }

  const { data, error } = await supabase
    .from('mri_extractions')
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

export async function rejectMriExtraction(extractionId: string, reason: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: ext } = await supabase.from('mri_extractions').select('case_id').eq('id', extractionId).is('deleted_at', null).single()
  if (!ext) return { error: 'Extraction not found' }
  const closedCheck = await assertCaseNotClosed(supabase, ext.case_id)
  if (closedCheck.error) return { error: closedCheck.error }

  const { data, error } = await supabase
    .from('mri_extractions')
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
