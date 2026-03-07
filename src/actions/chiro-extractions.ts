'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { extractChiroFromPdf } from '@/lib/claude/extract-chiro'
import type { ChiroReviewFormValues } from '@/lib/validations/chiro-extraction'

// --- Trigger extraction for a document ---

export async function extractChiroReport(documentId: string) {
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
  if (doc.document_type !== 'chiro_report') return { error: 'Not a chiro report' }

  // Soft-delete any existing extraction for this document
  await supabase
    .from('chiro_extractions')
    .update({ deleted_at: new Date().toISOString(), updated_by_user_id: user.id })
    .eq('document_id', documentId)
    .is('deleted_at', null)

  // Create pending extraction record
  const { data: extraction, error: insertError } = await supabase
    .from('chiro_extractions')
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
    await supabase.from('chiro_extractions').update({
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
    await supabase.from('chiro_extractions').update({
      extraction_status: 'failed',
      extraction_error: 'PDF is encrypted/password-protected',
      updated_by_user_id: user.id,
    }).eq('id', extraction.id)
    return { error: 'PDF is encrypted. Please upload an unprotected version.' }
  }

  // Convert to base64 and call Claude
  const arrayBuffer = await fileData.arrayBuffer()
  const pdfBase64 = Buffer.from(arrayBuffer).toString('base64')

  const result = await extractChiroFromPdf(pdfBase64)

  if (result.error || !result.data) {
    // Retry once on failure
    const retry = await extractChiroFromPdf(pdfBase64)

    if (retry.error || !retry.data) {
      await supabase.from('chiro_extractions').update({
        extraction_status: 'failed',
        extraction_error: retry.error ?? result.error ?? 'Extraction failed',
        extraction_attempts: 2,
        raw_ai_response: retry.rawResponse ?? result.rawResponse ?? null,
        updated_by_user_id: user.id,
      }).eq('id', extraction.id)
      revalidatePath(`/patients/${doc.case_id}/clinical`)
      return { error: retry.error ?? result.error }
    }

    // Retry succeeded
    await updateExtractionSuccess(supabase, extraction.id, retry, user.id, 2)
    revalidatePath(`/patients/${doc.case_id}/clinical`)
    return { data: { extractionId: extraction.id } }
  }

  // First attempt succeeded
  await updateExtractionSuccess(supabase, extraction.id, result, user.id, 1)
  revalidatePath(`/patients/${doc.case_id}/clinical`)
  revalidatePath(`/patients/${doc.case_id}/documents`)
  return { data: { extractionId: extraction.id } }
}

async function updateExtractionSuccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
  extractionId: string,
  result: { data?: import('@/lib/validations/chiro-extraction').ChiroExtractionResult; rawResponse?: unknown },
  userId: string,
  attempts: number,
) {
  const data = result.data!
  await supabase.from('chiro_extractions').update({
    extraction_status: 'completed',
    report_type: data.report_type,
    report_date: data.report_date,
    treatment_dates: data.treatment_dates,
    diagnoses: data.diagnoses,
    treatment_modalities: data.treatment_modalities,
    functional_outcomes: data.functional_outcomes,
    plateau_statement: data.plateau_statement,
    ai_model: 'claude-sonnet-4-6',
    ai_confidence: data.confidence,
    extraction_notes: data.extraction_notes,
    raw_ai_response: result.rawResponse ?? null,
    extraction_attempts: attempts,
    extracted_at: new Date().toISOString(),
    updated_by_user_id: userId,
  }).eq('id', extractionId)
}

// --- List extractions for a case ---

export async function listChiroExtractions(caseId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('chiro_extractions')
    .select('*, document:documents!document_id(file_name, file_path)')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) return { error: error.message, data: [] }
  return { data: data ?? [] }
}

// --- Get single extraction ---

export async function getChiroExtraction(extractionId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('chiro_extractions')
    .select('*, document:documents!document_id(file_name, file_path)')
    .eq('id', extractionId)
    .is('deleted_at', null)
    .single()

  if (error) return { error: error.message }
  return { data }
}

// --- Approve extraction (no edits) ---

export async function approveChiroExtraction(extractionId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data, error } = await supabase
    .from('chiro_extractions')
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

export async function saveAndApproveChiroExtraction(
  extractionId: string,
  overrides: ChiroReviewFormValues,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data, error } = await supabase
    .from('chiro_extractions')
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

export async function rejectChiroExtraction(extractionId: string, reason: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data, error } = await supabase
    .from('chiro_extractions')
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
