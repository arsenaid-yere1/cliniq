'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { createHash } from 'node:crypto'
import {
  generateProcedureNoteFromData,
  regenerateProcedureNoteSection as regenerateSectionAI,
  type ProcedureNoteInputData,
} from '@/lib/claude/generate-procedure-note'
import {
  procedureNoteEditSchema,
  type ProcedureNoteEditValues,
  type ProcedureNoteSection,
} from '@/lib/validations/procedure-note'
import { assertCaseNotClosed, autoAdvanceFromIntake } from '@/actions/case-status'
import { computeAgeAtDate } from '@/lib/age'

// --- Helper: compute source data hash ---

function computeSourceHash(inputData: ProcedureNoteInputData): string {
  const serialized = JSON.stringify(inputData)
  return createHash('sha256').update(serialized).digest('hex')
}

// --- Helper: gather all source data for note generation ---

async function gatherProcedureNoteSourceData(
  supabase: Awaited<ReturnType<typeof createClient>>,
  procedureId: string,
  caseId: string,
): Promise<{ data: ProcedureNoteInputData | null; error: string | null }> {
  const [
    procedureRes,
    vitalsRes,
    caseRes,
    pmRes,
    mriRes,
    ivNoteRes,
    priorProcedureRes,
    clinicRes,
  ] = await Promise.all([
    supabase
      .from('procedures')
      .select('*')
      .eq('id', procedureId)
      .is('deleted_at', null)
      .single(),
    supabase
      .from('vital_signs')
      .select('bp_systolic, bp_diastolic, heart_rate, respiratory_rate, temperature_f, spo2_percent')
      .eq('procedure_id', procedureId)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle(),
    supabase
      .from('cases')
      .select('case_number, accident_type, accident_date, assigned_provider_id, patient:patients!inner(first_name, last_name, date_of_birth, gender)')
      .eq('id', caseId)
      .is('deleted_at', null)
      .single(),
    supabase
      .from('pain_management_extractions')
      .select('chief_complaints, physical_exam, diagnoses, treatment_plan, diagnostic_studies_summary')
      .eq('case_id', caseId)
      .eq('review_status', 'approved')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('mri_extractions')
      .select('body_region, mri_date, findings, impression_summary')
      .eq('case_id', caseId)
      .in('review_status', ['approved', 'edited'])
      .is('deleted_at', null),
    supabase
      .from('initial_visit_notes')
      .select('past_medical_history, social_history')
      .eq('case_id', caseId)
      .eq('status', 'finalized')
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle(),
    // Prior procedure: most recent for this case excluding current
    supabase
      .from('procedures')
      .select('procedure_date, pain_rating, procedure_number')
      .eq('case_id', caseId)
      .neq('id', procedureId)
      .is('deleted_at', null)
      .order('procedure_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('clinic_settings')
      .select('clinic_name, address_line1, address_line2, city, state, zip_code, phone, fax')
      .is('deleted_at', null)
      .maybeSingle(),
  ])

  if (procedureRes.error || !procedureRes.data) {
    return { data: null, error: 'Failed to fetch procedure' }
  }
  if (caseRes.error || !caseRes.data) {
    return { data: null, error: 'Failed to fetch case details' }
  }

  // Fetch provider profile from case's assigned provider
  const assignedProviderId = caseRes.data.assigned_provider_id as string | null
  let providerRes: { data: { display_name: string; credentials: string | null; npi_number: string | null } | null } = { data: null }
  if (assignedProviderId) {
    providerRes = await supabase
      .from('provider_profiles')
      .select('display_name, credentials, npi_number')
      .eq('id', assignedProviderId)
      .is('deleted_at', null)
      .maybeSingle()
  }

  const proc = procedureRes.data
  const patient = caseRes.data.patient as unknown as {
    first_name: string
    last_name: string
    date_of_birth: string | null
    gender: string | null
  }

  const diagnoses = Array.isArray(proc.diagnoses)
    ? (proc.diagnoses as Array<{ icd10_code: string | null; description: string }>)
    : []

  const age = computeAgeAtDate(patient.date_of_birth, proc.procedure_date)

  return {
    data: {
      patientInfo: {
        first_name: patient.first_name,
        last_name: patient.last_name,
        date_of_birth: patient.date_of_birth,
        gender: patient.gender,
      },
      age,
      caseDetails: {
        case_number: caseRes.data.case_number,
        accident_date: caseRes.data.accident_date,
        accident_type: caseRes.data.accident_type,
      },
      procedureRecord: {
        procedure_date: proc.procedure_date,
        procedure_name: proc.procedure_name,
        procedure_number: proc.procedure_number ?? 1,
        injection_site: proc.injection_site,
        laterality: proc.laterality,
        diagnoses,
        consent_obtained: proc.consent_obtained,
        pain_rating: proc.pain_rating,
        blood_draw_volume_ml: proc.blood_draw_volume_ml,
        centrifuge_duration_min: proc.centrifuge_duration_min,
        prep_protocol: proc.prep_protocol,
        kit_lot_number: proc.kit_lot_number,
        anesthetic_agent: proc.anesthetic_agent,
        anesthetic_dose_ml: proc.anesthetic_dose_ml,
        patient_tolerance: proc.patient_tolerance,
        injection_volume_ml: proc.injection_volume_ml,
        needle_gauge: proc.needle_gauge,
        guidance_method: proc.guidance_method,
        target_confirmed_imaging: proc.target_confirmed_imaging,
        complications: proc.complications,
        supplies_used: proc.supplies_used,
        compression_bandage: proc.compression_bandage,
        activity_restriction_hrs: proc.activity_restriction_hrs,
      },
      vitalSigns: vitalsRes.data ?? null,
      priorProcedure: priorProcedureRes.data
        ? {
            procedure_date: priorProcedureRes.data.procedure_date,
            pain_rating: priorProcedureRes.data.pain_rating,
            procedure_number: priorProcedureRes.data.procedure_number ?? 1,
          }
        : null,
      pmExtraction: pmRes.data
        ? {
            chief_complaints: pmRes.data.chief_complaints,
            physical_exam: pmRes.data.physical_exam,
            diagnoses: pmRes.data.diagnoses,
            treatment_plan: pmRes.data.treatment_plan,
            diagnostic_studies_summary: pmRes.data.diagnostic_studies_summary,
          }
        : null,
      initialVisitNote: ivNoteRes.data
        ? {
            past_medical_history: ivNoteRes.data.past_medical_history,
            social_history: ivNoteRes.data.social_history,
          }
        : null,
      mriExtractions: (mriRes.data ?? []).map((m) => ({
        body_region: m.body_region,
        mri_date: m.mri_date,
        findings: m.findings,
        impression_summary: m.impression_summary,
      })),
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

// --- Check prerequisites ---

export async function checkProcedureNotePrerequisites(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: ivNote } = await supabase
    .from('initial_visit_notes')
    .select('id')
    .eq('case_id', caseId)
    .eq('status', 'finalized')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()

  if (!ivNote) {
    return { data: { canGenerate: false, reason: 'A finalized Initial Visit Note is required before generating a procedure note.' } }
  }

  return { data: { canGenerate: true } }
}

// --- Generate procedure note ---

export async function generateProcedureNote(procedureId: string, caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  await autoAdvanceFromIntake(supabase, caseId, user.id)

  // Check prerequisite
  const prereq = await checkProcedureNotePrerequisites(caseId)
  if (prereq.data && !prereq.data.canGenerate) {
    return { error: prereq.data.reason }
  }

  // Gather source data (always fresh — picks up edits to the procedure record since last generation)
  const { data: inputData, error: gatherError } = await gatherProcedureNoteSourceData(supabase, procedureId, caseId)
  if (gatherError || !inputData) return { error: gatherError || 'Failed to gather source data' }

  const sourceHash = computeSourceHash(inputData)

  // Look up existing active note for this procedure
  const { data: existingNote } = await supabase
    .from('procedure_notes')
    .select('id, status')
    .eq('procedure_id', procedureId)
    .is('deleted_at', null)
    .maybeSingle()

  if (existingNote && existingNote.status === 'finalized') {
    return { error: 'Note is finalized — unfinalize before regenerating' }
  }

  let recordId: string

  if (existingNote) {
    // Update existing row in-place to generating state, clearing any stale content
    const { error: updateError } = await supabase
      .from('procedure_notes')
      .update({
        status: 'generating',
        generation_attempts: 1,
        generation_error: null,
        source_data_hash: sourceHash,
        subjective: null,
        past_medical_history: null,
        allergies: null,
        current_medications: null,
        social_history: null,
        review_of_systems: null,
        objective_vitals: null,
        objective_physical_exam: null,
        assessment_summary: null,
        procedure_indication: null,
        procedure_preparation: null,
        procedure_prp_prep: null,
        procedure_anesthesia: null,
        procedure_injection: null,
        procedure_post_care: null,
        procedure_followup: null,
        assessment_and_plan: null,
        patient_education: null,
        prognosis: null,
        clinician_disclaimer: null,
        ai_model: null,
        raw_ai_response: null,
        updated_by_user_id: user.id,
      })
      .eq('id', existingNote.id)

    if (updateError) {
      revalidatePath(`/patients/${caseId}/procedures/${procedureId}/note`)
      return { error: 'Failed to start note generation' }
    }

    recordId = existingNote.id
  } else {
    // No existing row — create one
    const { data: record, error: insertError } = await supabase
      .from('procedure_notes')
      .insert({
        case_id: caseId,
        procedure_id: procedureId,
        status: 'generating',
        generation_attempts: 1,
        source_data_hash: sourceHash,
        created_by_user_id: user.id,
        updated_by_user_id: user.id,
      })
      .select('id')
      .single()

    if (insertError || !record) {
      revalidatePath(`/patients/${caseId}/procedures/${procedureId}/note`)
      return { error: 'Failed to create note record' }
    }

    recordId = record.id
  }

  // Call Claude
  const result = await generateProcedureNoteFromData(inputData)

  if (result.error || !result.data) {
    await supabase
      .from('procedure_notes')
      .update({
        status: 'failed',
        generation_error: result.error || 'Unknown error',
        generation_attempts: 1,
        raw_ai_response: result.rawResponse || null,
        updated_by_user_id: user.id,
      })
      .eq('id', recordId)

    revalidatePath(`/patients/${caseId}/procedures/${procedureId}/note`)
    return { error: result.error || 'Note generation failed' }
  }

  // Write success
  const data = result.data!
  await supabase
    .from('procedure_notes')
    .update({
      subjective: data.subjective,
      past_medical_history: data.past_medical_history,
      allergies: data.allergies,
      current_medications: data.current_medications,
      social_history: data.social_history,
      review_of_systems: data.review_of_systems,
      objective_vitals: data.objective_vitals,
      objective_physical_exam: data.objective_physical_exam,
      assessment_summary: data.assessment_summary,
      procedure_indication: data.procedure_indication,
      procedure_preparation: data.procedure_preparation,
      procedure_prp_prep: data.procedure_prp_prep,
      procedure_anesthesia: data.procedure_anesthesia,
      procedure_injection: data.procedure_injection,
      procedure_post_care: data.procedure_post_care,
      procedure_followup: data.procedure_followup,
      assessment_and_plan: data.assessment_and_plan,
      patient_education: data.patient_education,
      prognosis: data.prognosis,
      clinician_disclaimer: data.clinician_disclaimer,
      ai_model: 'claude-sonnet-4-6',
      raw_ai_response: result.rawResponse || null,
      status: 'draft',
      source_data_hash: sourceHash,
      updated_by_user_id: user.id,
    })
    .eq('id', recordId)

  revalidatePath(`/patients/${caseId}/procedures/${procedureId}/note`)
  return { data: { id: recordId } }
}

// --- Get procedure note ---

export async function getProcedureNote(procedureId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data, error } = await supabase
    .from('procedure_notes')
    .select('*')
    .eq('procedure_id', procedureId)
    .is('deleted_at', null)
    .single()

  if (error && error.code !== 'PGRST116') {
    return { error: 'Failed to fetch note' }
  }

  return { data: data || null }
}

// --- Save draft edits ---

export async function saveProcedureNote(procedureId: string, caseId: string, values: ProcedureNoteEditValues) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const validated = procedureNoteEditSchema.safeParse(values)
  if (!validated.success) return { error: 'Invalid form data' }

  const { error } = await supabase
    .from('procedure_notes')
    .update({
      ...validated.data,
      updated_by_user_id: user.id,
    })
    .eq('procedure_id', procedureId)
    .is('deleted_at', null)
    .eq('status', 'draft')

  if (error) return { error: 'Failed to save note' }

  revalidatePath(`/patients/${caseId}/procedures/${procedureId}/note`)
  return { data: { success: true } }
}

// --- Finalize note ---

export async function finalizeProcedureNote(procedureId: string, caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  // Fetch the draft note
  const { data: note, error: fetchError } = await supabase
    .from('procedure_notes')
    .select('*')
    .eq('procedure_id', procedureId)
    .is('deleted_at', null)
    .eq('status', 'draft')
    .single()

  if (fetchError || !note) return { error: 'No draft note found to finalize' }

  // Clean up previous document if re-finalizing
  if (note.document_id) {
    const { data: oldDoc } = await supabase
      .from('documents')
      .select('id, file_path')
      .eq('id', note.document_id)
      .is('deleted_at', null)
      .single()

    if (oldDoc) {
      await supabase
        .from('documents')
        .update({ deleted_at: new Date().toISOString(), updated_by_user_id: user.id })
        .eq('id', oldDoc.id)

      if (oldDoc.file_path) {
        await supabase.storage.from('case-documents').remove([oldDoc.file_path])
      }
    }
  }

  // Render PDF
  const { renderProcedureNotePdf } = await import('@/lib/pdf/render-procedure-note-pdf')
  const pdfBuffer = await renderProcedureNotePdf({
    note: note as Record<string, unknown>,
    procedureId,
    caseId,
    userId: user.id,
  })

  // Upload PDF to Supabase Storage
  const storagePath = `cases/${caseId}/procedure-note-${procedureId}-${Date.now()}.pdf`
  const fileBlob = new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' })

  const { error: uploadError } = await supabase.storage
    .from('case-documents')
    .upload(storagePath, fileBlob, {
      contentType: 'application/pdf',
      upsert: false,
    })

  if (uploadError) return { error: `Failed to upload note: ${uploadError.message}` }

  // Create documents row
  const { data: doc, error: docError } = await supabase
    .from('documents')
    .insert({
      case_id: caseId,
      document_type: 'generated',
      file_name: 'PRP Procedure Note',
      file_path: storagePath,
      file_size_bytes: pdfBuffer.length,
      mime_type: 'application/pdf',
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
    .from('procedure_notes')
    .update({
      status: 'finalized',
      finalized_by_user_id: user.id,
      finalized_at: new Date().toISOString(),
      document_id: doc.id,
      updated_by_user_id: user.id,
    })
    .eq('id', note.id)

  if (updateError) return { error: 'Failed to finalize note' }

  revalidatePath(`/patients/${caseId}/procedures/${procedureId}/note`)
  return { data: { success: true } }
}

// --- Unfinalize note ---

export async function unfinalizeProcedureNote(procedureId: string, caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const { error } = await supabase
    .from('procedure_notes')
    .update({
      status: 'draft',
      finalized_by_user_id: null,
      finalized_at: null,
      updated_by_user_id: user.id,
    })
    .eq('procedure_id', procedureId)
    .is('deleted_at', null)
    .eq('status', 'finalized')

  if (error) return { error: 'Failed to unfinalize note' }

  revalidatePath(`/patients/${caseId}/procedures/${procedureId}/note`)
  return { data: { success: true } }
}

// --- Reset note (clear AI content, keep row) ---

export async function resetProcedureNote(procedureId: string, caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  // Only allow reset on draft or failed notes
  const { data: note } = await supabase
    .from('procedure_notes')
    .select('id, status')
    .eq('procedure_id', procedureId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!note) return { error: 'No note found to reset' }
  if (note.status !== 'draft' && note.status !== 'failed') {
    return { error: 'Only draft or failed notes can be reset' }
  }

  const { error } = await supabase
    .from('procedure_notes')
    .update({
      status: 'draft',
      subjective: null,
      past_medical_history: null,
      allergies: null,
      current_medications: null,
      social_history: null,
      review_of_systems: null,
      objective_vitals: null,
      objective_physical_exam: null,
      assessment_summary: null,
      procedure_indication: null,
      procedure_preparation: null,
      procedure_prp_prep: null,
      procedure_anesthesia: null,
      procedure_injection: null,
      procedure_post_care: null,
      procedure_followup: null,
      assessment_and_plan: null,
      patient_education: null,
      prognosis: null,
      clinician_disclaimer: null,
      ai_model: null,
      raw_ai_response: null,
      generation_error: null,
      generation_attempts: 0,
      source_data_hash: null,
      updated_by_user_id: user.id,
    })
    .eq('id', note.id)

  if (error) return { error: 'Failed to reset note' }

  revalidatePath(`/patients/${caseId}/procedures/${procedureId}/note`)
  return { data: { success: true } }
}

// --- Regenerate single section ---

export async function regenerateProcedureNoteSectionAction(
  procedureId: string,
  caseId: string,
  section: ProcedureNoteSection,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  // Fetch current note
  const { data: note, error: fetchError } = await supabase
    .from('procedure_notes')
    .select('*')
    .eq('procedure_id', procedureId)
    .is('deleted_at', null)
    .eq('status', 'draft')
    .single()

  if (fetchError || !note) return { error: 'No draft note found' }

  // Gather fresh source data
  const { data: inputData, error: gatherError } = await gatherProcedureNoteSourceData(supabase, procedureId, caseId)
  if (gatherError || !inputData) return { error: gatherError || 'Failed to gather source data' }

  const currentContent = (note[section] as string) || ''

  const result = await regenerateSectionAI(inputData, section, currentContent)
  if (result.error || !result.data) {
    return { error: result.error || 'Section regeneration failed' }
  }

  // Update only the target section
  const { error: updateError } = await supabase
    .from('procedure_notes')
    .update({
      [section]: result.data,
      updated_by_user_id: user.id,
    })
    .eq('id', note.id)

  if (updateError) return { error: 'Failed to update section' }

  revalidatePath(`/patients/${caseId}/procedures/${procedureId}/note`)
  return { data: { content: result.data } }
}
