'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { createHash } from 'node:crypto'
import { generateInitialVisitFromData, regenerateSection as regenerateSectionAI, type InitialVisitInputData } from '@/lib/claude/generate-initial-visit'
import { initialVisitNoteEditSchema, initialVisitVitalsSchema, initialVisitRomSchema, providerIntakeSchema, type InitialVisitNoteEditValues, type InitialVisitSection, type InitialVisitVitalsValues, type InitialVisitRomValues, type ProviderIntakeValues } from '@/lib/validations/initial-visit-note'
import { assertCaseNotClosed, autoAdvanceFromIntake } from '@/actions/case-status'
import { getFeeEstimateTotals } from '@/actions/fee-estimate'

// --- Helper: compute source data hash ---

function computeSourceHash(inputData: InitialVisitInputData): string {
  const serialized = JSON.stringify(inputData)
  return createHash('sha256').update(serialized).digest('hex')
}

// --- Helper: gather source data for note generation ---

async function gatherSourceData(
  supabase: Awaited<ReturnType<typeof createClient>>,
  caseId: string,
  romData?: InitialVisitRomValues | null,
): Promise<{ data: InitialVisitInputData | null; error: string | null }> {
  const [caseRes, summaryRes, clinicRes, vitalsRes, feeEstimateTotals, intakeRes] = await Promise.all([
    supabase
      .from('cases')
      .select('case_number, accident_type, accident_date, accident_description, assigned_provider_id, patient:patients!inner(first_name, last_name, date_of_birth, gender)')
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
      .maybeSingle(),
    supabase
      .from('clinic_settings')
      .select('clinic_name, address_line1, address_line2, city, state, zip_code, phone, fax')
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('vital_signs')
      .select('bp_systolic, bp_diastolic, heart_rate, respiratory_rate, temperature_f, spo2_percent, pain_score_min, pain_score_max')
      .eq('case_id', caseId)
      .is('procedure_id', null)
      .is('deleted_at', null)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    getFeeEstimateTotals(),
    supabase
      .from('initial_visit_notes')
      .select('provider_intake')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (caseRes.error || !caseRes.data) {
    return { data: null, error: 'Failed to fetch case details' }
  }

  const summaryData = summaryRes.data

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
        chief_complaint: summaryData?.chief_complaint ?? null,
        imaging_findings: summaryData?.imaging_findings ?? null,
        prior_treatment: summaryData?.prior_treatment ?? null,
        symptoms_timeline: summaryData?.symptoms_timeline ?? null,
        suggested_diagnoses: summaryData?.suggested_diagnoses ?? null,
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
      vitalSigns: vitalsRes.data ?? null,
      romData: romData ?? null,
      feeEstimate: feeEstimateTotals.professional_max > 0 || feeEstimateTotals.practice_center_max > 0
        ? feeEstimateTotals
        : null,
      providerIntake: intakeRes.data?.provider_intake as InitialVisitInputData['providerIntake'] ?? null,
    },
    error: null,
  }
}

// --- Generate initial visit note ---

export async function generateInitialVisitNote(caseId: string, toneHint?: string | null) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  await autoAdvanceFromIntake(supabase, caseId, user.id)

  // Read ROM data and provider_intake from existing note before soft-deleting
  const { data: existingNote } = await supabase
    .from('initial_visit_notes')
    .select('rom_data, provider_intake')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .maybeSingle()

  const preservedRom = existingNote?.rom_data as InitialVisitRomValues | null
  const preservedIntake = existingNote?.provider_intake as Record<string, unknown> | null

  // Gather source data (include ROM)
  const { data: inputData, error: gatherError } = await gatherSourceData(supabase, caseId, preservedRom)
  if (gatherError || !inputData) return { error: gatherError || 'Failed to gather source data' }

  // Soft-delete existing note
  await supabase
    .from('initial_visit_notes')
    .update({ deleted_at: new Date().toISOString(), updated_by_user_id: user.id })
    .eq('case_id', caseId)
    .is('deleted_at', null)

  // Insert generating record (carry ROM data forward)
  const sourceHash = computeSourceHash(inputData)
  const { data: record, error: insertError } = await supabase
    .from('initial_visit_notes')
    .insert({
      case_id: caseId,
      status: 'generating',
      generation_attempts: 1,
      source_data_hash: sourceHash,
      rom_data: preservedRom,
      provider_intake: preservedIntake,
      created_by_user_id: user.id,
      updated_by_user_id: user.id,
    })
    .select('id')
    .single()

  if (insertError || !record) {
    revalidatePath(`/patients/${caseId}`)
    return { error: 'Failed to create note record' }
  }

  // Call Claude (pass toneHint only on first generation, not retry)
  let result = await generateInitialVisitFromData(inputData, toneHint)

  // One retry on failure (without toneHint — retry uses default tone)
  if (result.error || !result.data) {
    const retry = await generateInitialVisitFromData(inputData, toneHint)

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
      introduction: data.introduction,
      history_of_accident: data.history_of_accident,
      post_accident_history: data.post_accident_history,
      chief_complaint: data.chief_complaint,
      past_medical_history: data.past_medical_history,
      social_history: data.social_history,
      review_of_systems: data.review_of_systems,
      physical_exam: data.physical_exam,
      imaging_findings: data.imaging_findings,
      medical_necessity: data.medical_necessity,
      diagnoses: data.diagnoses,
      treatment_plan: data.treatment_plan,
      patient_education: data.patient_education,
      prognosis: data.prognosis,
      time_complexity_attestation: data.time_complexity_attestation,
      clinician_disclaimer: data.clinician_disclaimer,
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

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

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

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  // Fetch the note
  const { data: note, error: fetchError } = await supabase
    .from('initial_visit_notes')
    .select('*')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .eq('status', 'draft')
    .single()

  if (fetchError || !note) return { error: 'No draft note found to finalize' }

  // Clean up previous document if re-finalizing (prevents duplicate documents)
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
  const { renderInitialVisitPdf } = await import('@/lib/pdf/render-initial-visit-pdf')
  const pdfBuffer = await renderInitialVisitPdf({
    note: note as Record<string, unknown>,
    caseId,
    userId: user.id,
  })

  // Upload PDF to Supabase Storage
  const storagePath = `cases/${caseId}/initial-visit-note-${Date.now()}.pdf`
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
      file_name: 'Initial Visit Note',
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

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

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

// --- Reset note (discard all generated content) ---

export async function resetInitialVisitNote(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  // Only allow reset on draft or failed notes
  const { data: note } = await supabase
    .from('initial_visit_notes')
    .select('id, status')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!note) return { error: 'No note found to reset' }
  if (note.status !== 'draft' && note.status !== 'failed') {
    return { error: 'Only draft or failed notes can be reset' }
  }

  // Update in-place: null out all AI-generated content but keep provider_intake and rom_data
  const { error } = await supabase
    .from('initial_visit_notes')
    .update({
      status: 'draft',
      introduction: null,
      history_of_accident: null,
      post_accident_history: null,
      chief_complaint: null,
      past_medical_history: null,
      social_history: null,
      review_of_systems: null,
      physical_exam: null,
      imaging_findings: null,
      medical_necessity: null,
      diagnoses: null,
      treatment_plan: null,
      patient_education: null,
      prognosis: null,
      time_complexity_attestation: null,
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

  revalidatePath(`/patients/${caseId}`)
  return { data: { success: true } }
}

// --- Regenerate single section ---

export async function regenerateNoteSection(caseId: string, section: InitialVisitSection) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  // Fetch current note
  const { data: note, error: fetchError } = await supabase
    .from('initial_visit_notes')
    .select('*')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .eq('status', 'draft')
    .single()

  if (fetchError || !note) return { error: 'No draft note found' }

  // Gather fresh source data (include ROM from note row)
  const noteRom = note.rom_data as InitialVisitRomValues | null
  const { data: inputData, error: gatherError } = await gatherSourceData(supabase, caseId, noteRom)
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

  // Verify case exists and has a patient
  const { data: caseData } = await supabase
    .from('cases')
    .select('id, accident_date, patient:patients!inner(id)')
    .eq('id', caseId)
    .is('deleted_at', null)
    .single()

  if (!caseData) {
    return { data: { canGenerate: false, reason: 'Case not found or has no patient linked.' } }
  }

  return { data: { canGenerate: true } }
}

// --- Get initial visit vitals ---

export async function getInitialVisitVitals(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data, error } = await supabase
    .from('vital_signs')
    .select('bp_systolic, bp_diastolic, heart_rate, respiratory_rate, temperature_f, spo2_percent, pain_score_min, pain_score_max')
    .eq('case_id', caseId)
    .is('procedure_id', null)
    .is('deleted_at', null)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return { error: 'Failed to fetch vitals' }

  return { data: data ?? null }
}

// --- Save initial visit vitals ---

export async function saveInitialVisitVitals(caseId: string, vitals: InitialVisitVitalsValues) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const validated = initialVisitVitalsSchema.safeParse(vitals)
  if (!validated.success) return { error: 'Invalid vitals data' }

  // Check for existing initial visit vitals row
  const { data: existing } = await supabase
    .from('vital_signs')
    .select('id')
    .eq('case_id', caseId)
    .is('procedure_id', null)
    .is('deleted_at', null)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('vital_signs')
      .update({
        ...validated.data,
        updated_by_user_id: user.id,
      })
      .eq('id', existing.id)

    if (error) return { error: 'Failed to update vitals' }
  } else {
    const { error } = await supabase
      .from('vital_signs')
      .insert({
        case_id: caseId,
        procedure_id: null,
        ...validated.data,
        created_by_user_id: user.id,
        updated_by_user_id: user.id,
      })

    if (error) return { error: 'Failed to save vitals' }
  }

  revalidatePath(`/patients/${caseId}`)
  return { data: { success: true } }
}

// --- Get ROM data ---

export async function getInitialVisitRom(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data, error } = await supabase
    .from('initial_visit_notes')
    .select('rom_data')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) return { error: 'Failed to fetch ROM data' }

  return { data: (data?.rom_data as InitialVisitRomValues | null) ?? null }
}

// --- Save ROM data ---

export async function saveInitialVisitRom(caseId: string, romData: InitialVisitRomValues | null) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  // Validate if non-null
  let validatedData: InitialVisitRomValues | null = null
  if (romData !== null) {
    const validated = initialVisitRomSchema.safeParse(romData)
    if (!validated.success) return { error: 'Invalid ROM data' }
    validatedData = validated.data
  }

  // Check for existing active note
  const { data: existing } = await supabase
    .from('initial_visit_notes')
    .select('id')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('initial_visit_notes')
      .update({
        rom_data: validatedData as unknown as Record<string, unknown> | null,
        updated_by_user_id: user.id,
      })
      .eq('id', existing.id)

    if (error) return { error: 'Failed to update ROM data' }
  } else if (validatedData !== null) {
    // Create a new draft note with only ROM data (don't create for null)
    const { error } = await supabase
      .from('initial_visit_notes')
      .insert({
        case_id: caseId,
        status: 'draft',
        rom_data: validatedData as unknown as Record<string, unknown>,
        created_by_user_id: user.id,
        updated_by_user_id: user.id,
      })

    if (error) return { error: 'Failed to save ROM data' }
  }

  revalidatePath(`/patients/${caseId}`)
  return { data: { success: true } }
}

// --- Get provider intake ---

export async function getProviderIntake(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data, error } = await supabase
    .from('initial_visit_notes')
    .select('provider_intake')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return { error: 'Failed to fetch provider intake' }

  return { data: data?.provider_intake ?? null }
}

// --- Save provider intake ---

export async function saveProviderIntake(caseId: string, intake: ProviderIntakeValues) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const validated = providerIntakeSchema.safeParse(intake)
  if (!validated.success) return { error: 'Invalid provider intake data' }

  // Check for existing active note
  const { data: existing } = await supabase
    .from('initial_visit_notes')
    .select('id')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('initial_visit_notes')
      .update({
        provider_intake: validated.data as unknown as Record<string, unknown>,
        updated_by_user_id: user.id,
      })
      .eq('id', existing.id)

    if (error) return { error: 'Failed to update provider intake' }
  } else {
    const { error } = await supabase
      .from('initial_visit_notes')
      .insert({
        case_id: caseId,
        status: 'draft',
        provider_intake: validated.data as unknown as Record<string, unknown>,
        created_by_user_id: user.id,
        updated_by_user_id: user.id,
      })

    if (error) return { error: 'Failed to save provider intake' }
  }

  revalidatePath(`/patients/${caseId}`)
  return { data: { success: true } }
}
