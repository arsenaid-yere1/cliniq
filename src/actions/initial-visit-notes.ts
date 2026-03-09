'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { createHash } from 'node:crypto'
import { generateInitialVisitFromData, regenerateSection as regenerateSectionAI, type InitialVisitInputData } from '@/lib/claude/generate-initial-visit'
import { initialVisitNoteEditSchema, type InitialVisitNoteEditValues, type InitialVisitSection } from '@/lib/validations/initial-visit-note'

// --- Helper: compute source data hash ---

function computeSourceHash(inputData: InitialVisitInputData): string {
  const serialized = JSON.stringify(inputData)
  return createHash('sha256').update(serialized).digest('hex')
}

// --- Helper: gather source data for note generation ---

async function gatherSourceData(
  supabase: Awaited<ReturnType<typeof createClient>>,
  caseId: string,
  userId: string,
): Promise<{ data: InitialVisitInputData | null; error: string | null }> {
  const [caseRes, summaryRes, clinicRes, providerRes] = await Promise.all([
    supabase
      .from('cases')
      .select('case_number, accident_type, accident_date, accident_description, patient:patients!inner(first_name, last_name, date_of_birth, gender)')
      .eq('id', caseId)
      .is('deleted_at', null)
      .single(),
    supabase
      .from('case_summaries')
      .select('chief_complaint, imaging_findings, prior_treatment, symptoms_timeline, suggested_diagnoses')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .in('review_status', ['approved', 'edited'])
      .eq('generation_status', 'completed')
      .single(),
    supabase
      .from('clinic_settings')
      .select('clinic_name, address_line1, address_line2, city, state, zip_code, phone, fax')
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('provider_profiles')
      .select('display_name, credentials, npi_number')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .maybeSingle(),
  ])

  if (caseRes.error || !caseRes.data) {
    return { data: null, error: 'Failed to fetch case details' }
  }

  if (summaryRes.error || !summaryRes.data) {
    return { data: null, error: 'An approved case summary is required before generating an Initial Visit note.' }
  }

  const patient = caseRes.data.patient as unknown as {
    first_name: string
    last_name: string
    date_of_birth: string | null
    gender: string | null
  }

  return {
    data: {
      patientInfo: {
        first_name: patient.first_name,
        last_name: patient.last_name,
        date_of_birth: patient.date_of_birth,
        gender: patient.gender,
      },
      caseDetails: {
        case_number: caseRes.data.case_number,
        accident_type: caseRes.data.accident_type,
        accident_date: caseRes.data.accident_date,
        accident_description: caseRes.data.accident_description,
      },
      caseSummary: {
        chief_complaint: summaryRes.data.chief_complaint,
        imaging_findings: summaryRes.data.imaging_findings,
        prior_treatment: summaryRes.data.prior_treatment,
        symptoms_timeline: summaryRes.data.symptoms_timeline,
        suggested_diagnoses: summaryRes.data.suggested_diagnoses,
      },
      clinicInfo: {
        clinic_name: clinicRes.data?.clinic_name ?? null,
        address_line1: clinicRes.data?.address_line1 ?? null,
        address_line2: clinicRes.data?.address_line2 ?? null,
        city: clinicRes.data?.city ?? null,
        state: clinicRes.data?.state ?? null,
        zip_code: clinicRes.data?.zip_code ?? null,
        phone: clinicRes.data?.phone ?? null,
        fax: clinicRes.data?.fax ?? null,
      },
      providerInfo: {
        display_name: providerRes.data?.display_name ?? null,
        credentials: providerRes.data?.credentials ?? null,
        npi_number: providerRes.data?.npi_number ?? null,
      },
    },
    error: null,
  }
}

// --- Generate initial visit note ---

export async function generateInitialVisitNote(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Gather source data
  const { data: inputData, error: gatherError } = await gatherSourceData(supabase, caseId, user.id)
  if (gatherError || !inputData) return { error: gatherError || 'Failed to gather source data' }

  // Soft-delete existing note
  await supabase
    .from('initial_visit_notes')
    .update({ deleted_at: new Date().toISOString(), updated_by_user_id: user.id })
    .eq('case_id', caseId)
    .is('deleted_at', null)

  // Insert generating record
  const sourceHash = computeSourceHash(inputData)
  const { data: record, error: insertError } = await supabase
    .from('initial_visit_notes')
    .insert({
      case_id: caseId,
      status: 'generating',
      generation_attempts: 1,
      source_data_hash: sourceHash,
      created_by_user_id: user.id,
      updated_by_user_id: user.id,
    })
    .select('id')
    .single()

  if (insertError || !record) {
    revalidatePath(`/patients/${caseId}`)
    return { error: 'Failed to create note record' }
  }

  // Call Claude
  let result = await generateInitialVisitFromData(inputData)

  // One retry on failure
  if (result.error || !result.data) {
    const retry = await generateInitialVisitFromData(inputData)

    if (retry.error || !retry.data) {
      await supabase
        .from('initial_visit_notes')
        .update({
          status: 'failed',
          generation_error: retry.error || result.error || 'Unknown error',
          generation_attempts: 2,
          raw_ai_response: retry.rawResponse || result.rawResponse || null,
          updated_by_user_id: user.id,
        })
        .eq('id', record.id)

      revalidatePath(`/patients/${caseId}`)
      return { error: retry.error || result.error || 'Note generation failed after 2 attempts' }
    }

    result = retry
  }

  // Write success
  const data = result.data!
  await supabase
    .from('initial_visit_notes')
    .update({
      patient_info: data.patient_info,
      chief_complaint: data.chief_complaint,
      history_of_present_illness: data.history_of_present_illness,
      imaging_review: data.imaging_review,
      prior_treatment_summary: data.prior_treatment_summary,
      physical_exam: data.physical_exam,
      assessment: data.assessment,
      treatment_plan: data.treatment_plan,
      ai_model: 'claude-sonnet-4-6',
      raw_ai_response: result.rawResponse || null,
      status: 'draft',
      source_data_hash: sourceHash,
      updated_by_user_id: user.id,
    })
    .eq('id', record.id)

  revalidatePath(`/patients/${caseId}`)
  return { data: { id: record.id } }
}

// --- Get note ---

export async function getInitialVisitNote(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data, error } = await supabase
    .from('initial_visit_notes')
    .select('*')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .single()

  if (error && error.code !== 'PGRST116') {
    return { error: 'Failed to fetch note' }
  }

  return { data: data || null }
}

// --- Save draft edits ---

export async function saveInitialVisitNote(caseId: string, values: InitialVisitNoteEditValues) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const validated = initialVisitNoteEditSchema.safeParse(values)
  if (!validated.success) return { error: 'Invalid form data' }

  const { error } = await supabase
    .from('initial_visit_notes')
    .update({
      ...validated.data,
      updated_by_user_id: user.id,
    })
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .eq('status', 'draft')

  if (error) return { error: 'Failed to save note' }

  revalidatePath(`/patients/${caseId}`)
  return { data: { success: true } }
}

// --- Finalize note ---

export async function finalizeInitialVisitNote(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Fetch the note
  const { data: note, error: fetchError } = await supabase
    .from('initial_visit_notes')
    .select('*')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .eq('status', 'draft')
    .single()

  if (fetchError || !note) return { error: 'No draft note found to finalize' }

  // Assemble note content as JSON
  const noteContent = {
    patient_info: note.patient_info,
    chief_complaint: note.chief_complaint,
    history_of_present_illness: note.history_of_present_illness,
    imaging_review: note.imaging_review,
    prior_treatment_summary: note.prior_treatment_summary,
    physical_exam: note.physical_exam,
    assessment: note.assessment,
    treatment_plan: note.treatment_plan,
    finalized_at: new Date().toISOString(),
    finalized_by: user.id,
  }

  // Upload to Supabase Storage
  const storagePath = `cases/${caseId}/initial-visit-note-${Date.now()}.json`
  const fileContent = JSON.stringify(noteContent, null, 2)
  const fileBlob = new Blob([fileContent], { type: 'application/json' })

  const { error: uploadError } = await supabase.storage
    .from('case-documents')
    .upload(storagePath, fileBlob, {
      contentType: 'application/json',
      upsert: false,
    })

  if (uploadError) return { error: `Failed to upload note: ${uploadError.message}` }

  // Create documents row
  const { data: doc, error: docError } = await supabase
    .from('documents')
    .insert({
      case_id: caseId,
      document_type: 'generated',
      file_name: 'Initial Visit Note',
      file_path: storagePath,
      file_size_bytes: new TextEncoder().encode(fileContent).length,
      mime_type: 'application/json',
      status: 'reviewed',
      uploaded_by_user_id: user.id,
      created_by_user_id: user.id,
      updated_by_user_id: user.id,
    })
    .select('id')
    .single()

  if (docError || !doc) return { error: 'Failed to create document record' }

  // Update note as finalized
  const { error: updateError } = await supabase
    .from('initial_visit_notes')
    .update({
      status: 'finalized',
      finalized_by_user_id: user.id,
      finalized_at: new Date().toISOString(),
      document_id: doc.id,
      updated_by_user_id: user.id,
    })
    .eq('id', note.id)

  if (updateError) return { error: 'Failed to finalize note' }

  revalidatePath(`/patients/${caseId}`)
  return { data: { success: true } }
}

// --- Unfinalize note ---

export async function unfinalizeInitialVisitNote(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('initial_visit_notes')
    .update({
      status: 'draft',
      finalized_by_user_id: null,
      finalized_at: null,
      updated_by_user_id: user.id,
    })
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .eq('status', 'finalized')

  if (error) return { error: 'Failed to unfinalize note' }

  revalidatePath(`/patients/${caseId}`)
  return { data: { success: true } }
}

// --- Regenerate single section ---

export async function regenerateNoteSection(caseId: string, section: InitialVisitSection) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Fetch current note
  const { data: note, error: fetchError } = await supabase
    .from('initial_visit_notes')
    .select('*')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .eq('status', 'draft')
    .single()

  if (fetchError || !note) return { error: 'No draft note found' }

  // Gather fresh source data
  const { data: inputData, error: gatherError } = await gatherSourceData(supabase, caseId, user.id)
  if (gatherError || !inputData) return { error: gatherError || 'Failed to gather source data' }

  const currentContent = (note[section] as string) || ''

  const result = await regenerateSectionAI(inputData, section, currentContent)
  if (result.error || !result.data) {
    return { error: result.error || 'Section regeneration failed' }
  }

  // Update only the target section
  const { error: updateError } = await supabase
    .from('initial_visit_notes')
    .update({
      [section]: result.data,
      updated_by_user_id: user.id,
    })
    .eq('id', note.id)

  if (updateError) return { error: 'Failed to update section' }

  revalidatePath(`/patients/${caseId}`)
  return { data: { content: result.data } }
}

// --- Check prerequisites ---

export async function checkNotePrerequisites(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: summary } = await supabase
    .from('case_summaries')
    .select('id')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .in('review_status', ['approved', 'edited'])
    .eq('generation_status', 'completed')
    .single()

  if (!summary) {
    return { data: { canGenerate: false, reason: 'An approved case summary is required before generating an Initial Visit note.' } }
  }

  return { data: { canGenerate: true } }
}
