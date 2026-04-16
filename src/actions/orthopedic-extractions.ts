'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { extractOrthopedicFromPdf } from '@/lib/claude/extract-orthopedic'
import type { OrthopedicReviewFormValues } from '@/lib/validations/orthopedic-extraction'
import { assertCaseNotClosed } from '@/actions/case-status'

// --- Trigger extraction for a document ---

export async function extractOrthopedicReport(documentId: string) {
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
  if (doc.document_type !== 'orthopedic_report') return { error: 'Not an orthopedic report' }

  const closedCheck = await assertCaseNotClosed(supabase, doc.case_id)
  if (closedCheck.error) return { error: closedCheck.error }

  // Soft-delete any existing extraction for this document
  await supabase
    .from('orthopedic_extractions')
    .update({ deleted_at: new Date().toISOString(), updated_by_user_id: user.id })
    .eq('document_id', documentId)
    .is('deleted_at', null)

  // Create pending extraction record
  const { data: extraction, error: insertError } = await supabase
    .from('orthopedic_extractions')
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
    await supabase.from('orthopedic_extractions').update({
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
    await supabase.from('orthopedic_extractions').update({
      extraction_status: 'failed',
      extraction_error: 'PDF is encrypted/password-protected',
      updated_by_user_id: user.id,
    }).eq('id', extraction.id)
    return { error: 'PDF is encrypted. Please upload an unprotected version.' }
  }

  // Convert to base64 and call Claude
  const arrayBuffer = await fileData.arrayBuffer()
  const pdfBase64 = Buffer.from(arrayBuffer).toString('base64')

  const result = await extractOrthopedicFromPdf(pdfBase64)

  if (result.error || !result.data) {
    await supabase.from('orthopedic_extractions').update({
      extraction_status: 'failed',
      extraction_error: result.error ?? 'Extraction failed',
      extraction_attempts: 1,
      raw_ai_response: result.rawResponse ?? null,
      updated_by_user_id: user.id,
    }).eq('id', extraction.id)
    revalidatePath(`/patients/${doc.case_id}/clinical`)
    return { error: result.error }
  }

  await updateExtractionSuccess(supabase, extraction.id, result, user.id, 1)
  revalidatePath(`/patients/${doc.case_id}/clinical`)
  revalidatePath(`/patients/${doc.case_id}/documents`)
  return { data: { extractionId: extraction.id } }
}

async function updateExtractionSuccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
  extractionId: string,
  result: { data?: import('@/lib/validations/orthopedic-extraction').OrthopedicExtractionResult; rawResponse?: unknown },
  userId: string,
  attempts: number,
) {
  const data = result.data!
  await supabase.from('orthopedic_extractions').update({
    extraction_status: 'completed',
    report_date: data.report_date,
    date_of_injury: data.date_of_injury,
    examining_provider: data.examining_provider,
    provider_specialty: data.provider_specialty,
    patient_age: data.patient_age,
    patient_sex: data.patient_sex,
    hand_dominance: data.hand_dominance,
    height: data.height,
    weight: data.weight,
    current_employment: data.current_employment,
    history_of_injury: data.history_of_injury,
    past_medical_history: data.past_medical_history,
    surgical_history: data.surgical_history,
    previous_complaints: data.previous_complaints,
    subsequent_complaints: data.subsequent_complaints,
    allergies: data.allergies,
    social_history: data.social_history,
    family_history: data.family_history,
    present_complaints: data.present_complaints,
    current_medications: data.current_medications,
    physical_exam: data.physical_exam,
    diagnostics: data.diagnostics,
    diagnoses: data.diagnoses,
    recommendations: data.recommendations,
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

export async function listOrthopedicExtractions(caseId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('orthopedic_extractions')
    .select('*, document:documents!document_id(file_name, file_path)')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) return { error: error.message, data: [] }
  return { data: data ?? [] }
}

// --- Get single extraction ---

export async function getOrthopedicExtraction(extractionId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('orthopedic_extractions')
    .select('*, document:documents!document_id(file_name, file_path)')
    .eq('id', extractionId)
    .is('deleted_at', null)
    .single()

  if (error) return { error: error.message }
  return { data }
}

// --- Approve extraction (no edits) ---

export async function approveOrthopedicExtraction(extractionId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: ext } = await supabase.from('orthopedic_extractions').select('case_id').eq('id', extractionId).is('deleted_at', null).single()
  if (!ext) return { error: 'Extraction not found' }
  const closedCheck = await assertCaseNotClosed(supabase, ext.case_id)
  if (closedCheck.error) return { error: closedCheck.error }

  const { data, error } = await supabase
    .from('orthopedic_extractions')
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

export async function saveAndApproveOrthopedicExtraction(
  extractionId: string,
  overrides: OrthopedicReviewFormValues,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: ext } = await supabase.from('orthopedic_extractions').select('case_id').eq('id', extractionId).is('deleted_at', null).single()
  if (!ext) return { error: 'Extraction not found' }
  const closedCheck = await assertCaseNotClosed(supabase, ext.case_id)
  if (closedCheck.error) return { error: closedCheck.error }

  const { data, error } = await supabase
    .from('orthopedic_extractions')
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

export async function rejectOrthopedicExtraction(extractionId: string, reason: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: ext } = await supabase.from('orthopedic_extractions').select('case_id').eq('id', extractionId).is('deleted_at', null).single()
  if (!ext) return { error: 'Extraction not found' }
  const closedCheck = await assertCaseNotClosed(supabase, ext.case_id)
  if (closedCheck.error) return { error: closedCheck.error }

  const { data, error } = await supabase
    .from('orthopedic_extractions')
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
