'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { extractPtFromPdf } from '@/lib/claude/extract-pt'
import type { PtReviewFormValues } from '@/lib/validations/pt-extraction'
import { assertCaseNotClosed } from '@/actions/case-status'

// --- Trigger extraction for a document ---

export async function extractPtReport(documentId: string) {
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
  if (doc.document_type !== 'pt_report') return { error: 'Not a PT report' }

  const closedCheck = await assertCaseNotClosed(supabase, doc.case_id)
  if (closedCheck.error) return { error: closedCheck.error }

  // Soft-delete any existing extraction for this document
  await supabase
    .from('pt_extractions')
    .update({ deleted_at: new Date().toISOString(), updated_by_user_id: user.id })
    .eq('document_id', documentId)
    .is('deleted_at', null)

  // Create pending extraction record
  const { data: extraction, error: insertError } = await supabase
    .from('pt_extractions')
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
    await supabase.from('pt_extractions').update({
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
    await supabase.from('pt_extractions').update({
      extraction_status: 'failed',
      extraction_error: 'PDF is encrypted/password-protected',
      updated_by_user_id: user.id,
    }).eq('id', extraction.id)
    return { error: 'PDF is encrypted. Please upload an unprotected version.' }
  }

  // Convert to base64 and call Claude
  const arrayBuffer = await fileData.arrayBuffer()
  const pdfBase64 = Buffer.from(arrayBuffer).toString('base64')

  const result = await extractPtFromPdf(pdfBase64)

  if (result.error || !result.data) {
    await supabase.from('pt_extractions').update({
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
  result: { data?: import('@/lib/validations/pt-extraction').PtExtractionResult; rawResponse?: unknown },
  userId: string,
  attempts: number,
) {
  const data = result.data!
  await supabase.from('pt_extractions').update({
    extraction_status: 'completed',
    evaluation_date: data.evaluation_date,
    date_of_injury: data.date_of_injury,
    evaluating_therapist: data.evaluating_therapist,
    referring_provider: data.referring_provider,
    chief_complaint: data.chief_complaint,
    mechanism_of_injury: data.mechanism_of_injury,
    pain_ratings: data.pain_ratings,
    functional_limitations: data.functional_limitations,
    prior_treatment: data.prior_treatment,
    work_status: data.work_status,
    postural_assessment: data.postural_assessment,
    gait_analysis: data.gait_analysis,
    range_of_motion: data.range_of_motion,
    muscle_strength: data.muscle_strength,
    palpation_findings: data.palpation_findings,
    special_tests: data.special_tests,
    neurological_screening: data.neurological_screening,
    functional_tests: data.functional_tests,
    outcome_measures: data.outcome_measures,
    clinical_impression: data.clinical_impression,
    causation_statement: data.causation_statement,
    prognosis: data.prognosis,
    short_term_goals: data.short_term_goals,
    long_term_goals: data.long_term_goals,
    plan_of_care: data.plan_of_care,
    diagnoses: data.diagnoses,
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

export async function listPtExtractions(caseId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('pt_extractions')
    .select('*, document:documents!document_id(file_name, file_path)')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) return { error: error.message, data: [] }
  return { data: data ?? [] }
}

// --- Get single extraction ---

export async function getPtExtraction(extractionId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('pt_extractions')
    .select('*, document:documents!document_id(file_name, file_path)')
    .eq('id', extractionId)
    .is('deleted_at', null)
    .single()

  if (error) return { error: error.message }
  return { data }
}

// --- Approve extraction (no edits) ---

export async function approvePtExtraction(extractionId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: ext } = await supabase.from('pt_extractions').select('case_id').eq('id', extractionId).is('deleted_at', null).single()
  if (!ext) return { error: 'Extraction not found' }
  const closedCheck = await assertCaseNotClosed(supabase, ext.case_id)
  if (closedCheck.error) return { error: closedCheck.error }

  const { data, error } = await supabase
    .from('pt_extractions')
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

export async function saveAndApprovePtExtraction(
  extractionId: string,
  overrides: PtReviewFormValues,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: ext } = await supabase.from('pt_extractions').select('case_id').eq('id', extractionId).is('deleted_at', null).single()
  if (!ext) return { error: 'Extraction not found' }
  const closedCheck = await assertCaseNotClosed(supabase, ext.case_id)
  if (closedCheck.error) return { error: closedCheck.error }

  const { data, error } = await supabase
    .from('pt_extractions')
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

export async function rejectPtExtraction(extractionId: string, reason: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: ext } = await supabase.from('pt_extractions').select('case_id').eq('id', extractionId).is('deleted_at', null).single()
  if (!ext) return { error: 'Extraction not found' }
  const closedCheck = await assertCaseNotClosed(supabase, ext.case_id)
  if (closedCheck.error) return { error: closedCheck.error }

  const { data, error } = await supabase
    .from('pt_extractions')
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
