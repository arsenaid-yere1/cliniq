'use server'

import { createClient } from '@/lib/supabase/server'
import { acquireGenerationLock } from '@/lib/supabase/generation-lock'
import { revalidatePath } from 'next/cache'
import { createHash } from 'node:crypto'
import {
  generateInitialVisitFromData,
  regenerateSection as regenerateSectionAI,
  type InitialVisitInputData,
  type NoteVisitType,
} from '@/lib/claude/generate-initial-visit'
import {
  initialVisitNoteEditSchema,
  initialVisitVitalsSchema,
  initialVisitRomSchema,
  providerIntakeSchema,
  type InitialVisitNoteEditValues,
  type InitialVisitSection,
  type InitialVisitVitalsValues,
  type InitialVisitRomValues,
  type ProviderIntakeValues,
} from '@/lib/validations/initial-visit-note'
import { assertCaseNotClosed, autoAdvanceFromIntake } from '@/actions/case-status'
import { getFeeEstimateTotals } from '@/actions/fee-estimate'
import { computeAgeAtDate, pickVisitAnchor } from '@/lib/age'

// --- Helper: compute source data hash ---

function computeSourceHash(inputData: InitialVisitInputData): string {
  const serialized = JSON.stringify(inputData)
  return createHash('sha256').update(serialized).digest('hex')
}

// --- Helper: map the visit-date-order trigger's check_violation into a
// user-facing message so the UI sees a readable string instead of raw SQL.
// The trigger in 20260414_initial_visit_date_order.sql raises SQLSTATE 23514.

type PgError = { code?: string; message?: string } | null

function mapVisitDateOrderError(err: PgError): string | null {
  if (!err) return null
  if (err.code !== '23514') return null
  const msg = err.message ?? ''
  if (msg.includes('Pain Evaluation Visit date')) {
    return 'The Pain Evaluation Visit date cannot be earlier than the Initial Visit date on this case.'
  }
  if (msg.includes('Initial Visit date')) {
    return 'The Initial Visit date cannot be later than the Pain Evaluation Visit date on this case.'
  }
  return null
}

// --- Helper: gather source data for note generation ---
//
// `visitType` is required: it determines which intake/ROM row is loaded,
// and — only for pain_evaluation_visit — triggers an additional read of the
// finalized Initial Visit row (if one exists) as read-only reference data.

async function gatherSourceData(
  supabase: Awaited<ReturnType<typeof createClient>>,
  caseId: string,
  visitType: NoteVisitType,
  romData?: InitialVisitRomValues | null,
): Promise<{ data: InitialVisitInputData | null; error: string | null }> {
  const priorVisitQuery = visitType === 'pain_evaluation_visit'
    ? supabase
        .from('initial_visit_notes')
        .select(
          'chief_complaint, physical_exam, imaging_findings, medical_necessity, diagnoses, treatment_plan, prognosis, provider_intake, rom_data, visit_date, finalized_at',
        )
        .eq('case_id', caseId)
        .eq('visit_type', 'initial_visit')
        .eq('status', 'finalized')
        .is('deleted_at', null)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null })

  const [
    caseRes,
    summaryRes,
    clinicRes,
    vitalsRes,
    feeEstimateTotals,
    intakeRes,
    priorVisitRes,
    mriCountRes,
    ctCountRes,
  ] = await Promise.all([
    supabase
      .from('cases')
      .select(
        'case_number, accident_type, accident_date, accident_description, assigned_provider_id, patient:patients!inner(first_name, last_name, date_of_birth, gender)',
      )
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
      .select('provider_intake, visit_date, finalized_at')
      .eq('case_id', caseId)
      .eq('visit_type', visitType)
      .is('deleted_at', null)
      .maybeSingle(),
    priorVisitQuery,
    supabase
      .from('mri_extractions')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .in('review_status', ['approved', 'edited']),
    supabase
      .from('ct_scan_extractions')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .in('review_status', ['approved', 'edited']),
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

  const hasApprovedDiagnosticExtractions = ((mriCountRes.count ?? 0) + (ctCountRes.count ?? 0)) > 0

  const priorVisitRow = (priorVisitRes as { data: Record<string, unknown> | null }).data

  // When pain-evaluation visit has a prior finalized initial visit, fetch the
  // intake vitals row that predates the prior visit's finalization. Gives the
  // follow-up note a numeric anchor for "pain decreased from X/10 to Y/10"
  // narrative — text-only prior data can't support that sentence.
  const priorVisitFinalizedAt = (priorVisitRow?.finalized_at as string | null) ?? null
  let priorVisitVitalSigns: NonNullable<InitialVisitInputData['priorVisitData']>['vitalSigns'] = null
  if (priorVisitRow && priorVisitFinalizedAt) {
    const { data: vitalsRow } = await supabase
      .from('vital_signs')
      .select('recorded_at, pain_score_min, pain_score_max')
      .eq('case_id', caseId)
      .is('procedure_id', null)
      .is('deleted_at', null)
      .lte('recorded_at', priorVisitFinalizedAt)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (vitalsRow) {
      priorVisitVitalSigns = {
        recorded_at: vitalsRow.recorded_at,
        pain_score_min: vitalsRow.pain_score_min,
        pain_score_max: vitalsRow.pain_score_max,
      }
    }
  }

  const priorVisitData: InitialVisitInputData['priorVisitData'] = priorVisitRow
    ? {
        chief_complaint: (priorVisitRow.chief_complaint as string | null) ?? null,
        physical_exam: (priorVisitRow.physical_exam as string | null) ?? null,
        imaging_findings: (priorVisitRow.imaging_findings as string | null) ?? null,
        medical_necessity: (priorVisitRow.medical_necessity as string | null) ?? null,
        diagnoses: (priorVisitRow.diagnoses as string | null) ?? null,
        treatment_plan: (priorVisitRow.treatment_plan as string | null) ?? null,
        prognosis: (priorVisitRow.prognosis as string | null) ?? null,
        provider_intake: priorVisitRow.provider_intake ?? null,
        rom_data: priorVisitRow.rom_data ?? null,
        visit_date: (priorVisitRow.visit_date as string | null) ?? null,
        finalized_at: priorVisitFinalizedAt,
        vitalSigns: priorVisitVitalSigns,
      }
    : null

  const visitAnchor = pickVisitAnchor(
    (intakeRes.data?.visit_date as string | null | undefined) ?? null,
    (intakeRes.data?.finalized_at as string | null | undefined) ?? null,
  )
  const age = computeAgeAtDate(patient.date_of_birth, visitAnchor)

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
      providerIntake: (intakeRes.data?.provider_intake as InitialVisitInputData['providerIntake']) ?? null,
      priorVisitData,
      hasApprovedDiagnosticExtractions,
    },
    error: null,
  }
}

// --- Generate initial visit note ---

export async function generateInitialVisitNote(
  caseId: string,
  visitType: NoteVisitType,
  toneHint?: string | null,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  await autoAdvanceFromIntake(supabase, caseId, user.id)

  // Find or create the note row for this (case, visit_type).
  // The unique partial index on (case_id, visit_type) guarantees at most one
  // live row per pair, so the other visit type's row is never touched.
  const { data: existingNote } = await supabase
    .from('initial_visit_notes')
    .select('id, rom_data, provider_intake, visit_date')
    .eq('case_id', caseId)
    .eq('visit_type', visitType)
    .is('deleted_at', null)
    .maybeSingle()

  const preservedRom = existingNote?.rom_data as InitialVisitRomValues | null
  const today = new Date().toISOString().slice(0, 10)

  // Gather source data (include ROM)
  const { data: inputData, error: gatherError } = await gatherSourceData(supabase, caseId, visitType, preservedRom)
  if (gatherError || !inputData) return { error: gatherError || 'Failed to gather source data' }

  const sourceHash = computeSourceHash(inputData)

  let recordId: string

  if (existingNote) {
    // Acquire the generation lock first. Prevents concurrent invocations from
    // re-entering an in-flight generation; recovers stale locks after 5 min.
    const lock = await acquireGenerationLock(supabase, 'initial_visit_notes', existingNote.id, user.id)
    if (!lock.acquired) {
      return { error: lock.reason }
    }

    // Clear stale narrative. Status already in 'generating' from the lock —
    // do not include it in this update.
    const { error: updateError } = await supabase
      .from('initial_visit_notes')
      .update({
        generation_attempts: 1,
        source_data_hash: sourceHash,
        visit_date: existingNote.visit_date ?? today,
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
        updated_by_user_id: user.id,
      })
      .eq('id', existingNote.id)

    if (updateError) {
      revalidatePath(`/patients/${caseId}`)
      return { error: mapVisitDateOrderError(updateError) ?? 'Failed to start note generation' }
    }

    recordId = existingNote.id
  } else {
    // No existing row for this visit type — create one. The unique partial
    // index on (case_id, visit_type) protects against concurrent inserts:
    // a second racer gets a unique-violation error (code 23505).
    const { data: record, error: insertError } = await supabase
      .from('initial_visit_notes')
      .insert({
        case_id: caseId,
        visit_type: visitType,
        status: 'generating',
        generation_attempts: 1,
        source_data_hash: sourceHash,
        visit_date: today,
        created_by_user_id: user.id,
        updated_by_user_id: user.id,
      })
      .select('id')
      .single()

    if (insertError || !record) {
      revalidatePath(`/patients/${caseId}`)
      if (insertError?.code === '23505') {
        return { error: 'Generation already in progress — please wait a moment and try again.' }
      }
      return { error: mapVisitDateOrderError(insertError) ?? 'Failed to create note record' }
    }

    recordId = record.id
  }

  // Call Claude
  const result = await generateInitialVisitFromData(inputData, visitType, toneHint)

  if (result.error || !result.data) {
    await supabase
      .from('initial_visit_notes')
      .update({
        status: 'failed',
        generation_error: result.error || 'Unknown error',
        generation_attempts: 1,
        raw_ai_response: result.rawResponse || null,
        updated_by_user_id: user.id,
      })
      .eq('id', recordId)

    revalidatePath(`/patients/${caseId}`)
    return { error: result.error || 'Note generation failed' }
  }

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
      ai_model: 'claude-opus-4-7',
      raw_ai_response: result.rawResponse || null,
      status: 'draft',
      source_data_hash: sourceHash,
      updated_by_user_id: user.id,
    })
    .eq('id', recordId)

  revalidatePath(`/patients/${caseId}`)
  return { data: { id: recordId } }
}

// --- Get a single note by (case, visit_type) ---

export async function getInitialVisitNote(caseId: string, visitType: NoteVisitType) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data, error } = await supabase
    .from('initial_visit_notes')
    .select('*')
    .eq('case_id', caseId)
    .eq('visit_type', visitType)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) return { error: 'Failed to fetch note' }

  return { data: data || null }
}

// --- Get ALL live notes for a case (both visit types) ---

export async function getInitialVisitNotes(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data, error } = await supabase
    .from('initial_visit_notes')
    .select('*')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .order('visit_type', { ascending: true })

  if (error) return { error: 'Failed to fetch notes' }

  return { data: data ?? [] }
}

// --- Save draft edits ---

export async function saveInitialVisitNote(
  caseId: string,
  visitType: NoteVisitType,
  values: InitialVisitNoteEditValues,
) {
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
    .eq('visit_type', visitType)
    .is('deleted_at', null)
    .eq('status', 'draft')

  if (error) return { error: mapVisitDateOrderError(error) ?? 'Failed to save note' }

  revalidatePath(`/patients/${caseId}`)
  return { data: { success: true } }
}

// --- Finalize note ---

export async function finalizeInitialVisitNote(caseId: string, visitType: NoteVisitType) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  // Fetch the draft note for this visit type
  const { data: note, error: fetchError } = await supabase
    .from('initial_visit_notes')
    .select('*')
    .eq('case_id', caseId)
    .eq('visit_type', visitType)
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
  const { renderInitialVisitPdf } = await import('@/lib/pdf/render-initial-visit-pdf')
  const pdfBuffer = await renderInitialVisitPdf({
    note: note as Record<string, unknown>,
    caseId,
    userId: user.id,
  })

  const storagePath = `cases/${caseId}/${visitType}-note-${Date.now()}.pdf`
  const fileBlob = new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' })

  const { error: uploadError } = await supabase.storage
    .from('case-documents')
    .upload(storagePath, fileBlob, {
      contentType: 'application/pdf',
      upsert: false,
    })

  if (uploadError) return { error: `Failed to upload note: ${uploadError.message}` }

  const fileName = visitType === 'initial_visit' ? 'Initial Visit Note' : 'Pain Evaluation Visit Note'

  const { data: doc, error: docError } = await supabase
    .from('documents')
    .insert({
      case_id: caseId,
      document_type: 'generated',
      file_name: fileName,
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

export async function unfinalizeInitialVisitNote(caseId: string, visitType: NoteVisitType) {
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
    .eq('visit_type', visitType)
    .is('deleted_at', null)
    .eq('status', 'finalized')

  if (error) return { error: 'Failed to unfinalize note' }

  revalidatePath(`/patients/${caseId}`)
  return { data: { success: true } }
}

// --- Reset note (discard all generated content) — scoped to one visit type ---

export async function resetInitialVisitNote(caseId: string, visitType: NoteVisitType) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  // Look up ONLY the target visit type's row. The other visit type is untouched.
  const { data: note } = await supabase
    .from('initial_visit_notes')
    .select('id, status')
    .eq('case_id', caseId)
    .eq('visit_type', visitType)
    .is('deleted_at', null)
    .maybeSingle()

  if (!note) return { error: 'No note to reset for this visit type' }
  if (note.status !== 'draft' && note.status !== 'failed') {
    return { error: 'Only draft or failed notes can be reset' }
  }

  // In-place update: null all AI-generated fields. Preserve provider_intake,
  // rom_data, visit_type, and visit_date.
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

export async function regenerateNoteSection(
  caseId: string,
  visitType: NoteVisitType,
  section: InitialVisitSection,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const { data: note, error: fetchError } = await supabase
    .from('initial_visit_notes')
    .select('*')
    .eq('case_id', caseId)
    .eq('visit_type', visitType)
    .is('deleted_at', null)
    .eq('status', 'draft')
    .single()

  if (fetchError || !note) return { error: 'No draft note found' }

  const noteRom = note.rom_data as InitialVisitRomValues | null
  const { data: inputData, error: gatherError } = await gatherSourceData(supabase, caseId, visitType, noteRom)
  if (gatherError || !inputData) return { error: gatherError || 'Failed to gather source data' }

  const currentContent = (note[section] as string) || ''

  const result = await regenerateSectionAI(inputData, visitType, section, currentContent)
  if (result.error || !result.data) {
    return { error: result.error || 'Section regeneration failed' }
  }

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

export async function checkNotePrerequisites(
  caseId: string,
  _visitType?: NoteVisitType,
) {
  void _visitType
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

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
//
// Vitals live in a separate vital_signs table keyed by case_id. They are
// shared across both visit types for a given case — the plan notes this
// is acceptable because vitals are a snapshot in time, not a per-visit
// editable artifact. A dedicated per-visit vitals column can be added
// later if needed.

export async function saveInitialVisitVitals(caseId: string, vitals: InitialVisitVitalsValues) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const validated = initialVisitVitalsSchema.safeParse(vitals)
  if (!validated.success) return { error: 'Invalid vitals data' }

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

// --- Get ROM data, scoped per visit type ---

export async function getInitialVisitRom(caseId: string, visitType: NoteVisitType) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data, error } = await supabase
    .from('initial_visit_notes')
    .select('rom_data')
    .eq('case_id', caseId)
    .eq('visit_type', visitType)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) return { error: 'Failed to fetch ROM data' }

  return { data: (data?.rom_data as InitialVisitRomValues | null) ?? null }
}

// --- Save ROM data, scoped per visit type ---

export async function saveInitialVisitRom(
  caseId: string,
  visitType: NoteVisitType,
  romData: InitialVisitRomValues | null,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  let validatedData: InitialVisitRomValues | null = null
  if (romData !== null) {
    const validated = initialVisitRomSchema.safeParse(romData)
    if (!validated.success) return { error: 'Invalid ROM data' }
    validatedData = validated.data
  }

  const { data: existing } = await supabase
    .from('initial_visit_notes')
    .select('id')
    .eq('case_id', caseId)
    .eq('visit_type', visitType)
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

    if (error) return { error: mapVisitDateOrderError(error) ?? 'Failed to update ROM data' }
  } else if (validatedData !== null) {
    const { error } = await supabase
      .from('initial_visit_notes')
      .insert({
        case_id: caseId,
        visit_type: visitType,
        status: 'draft',
        rom_data: validatedData as unknown as Record<string, unknown>,
        visit_date: new Date().toISOString().slice(0, 10),
        created_by_user_id: user.id,
        updated_by_user_id: user.id,
      })

    if (error) return { error: mapVisitDateOrderError(error) ?? 'Failed to save ROM data' }
  }

  revalidatePath(`/patients/${caseId}`)
  return { data: { success: true } }
}

// --- Get provider intake, scoped per visit type ---

export async function getProviderIntake(caseId: string, visitType: NoteVisitType) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data, error } = await supabase
    .from('initial_visit_notes')
    .select('provider_intake')
    .eq('case_id', caseId)
    .eq('visit_type', visitType)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) return { error: 'Failed to fetch provider intake' }

  return { data: data?.provider_intake ?? null }
}

// --- Save provider intake, scoped per visit type ---

export async function saveProviderIntake(
  caseId: string,
  visitType: NoteVisitType,
  intake: ProviderIntakeValues,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const validated = providerIntakeSchema.safeParse(intake)
  if (!validated.success) return { error: 'Invalid provider intake data' }

  const { data: existing } = await supabase
    .from('initial_visit_notes')
    .select('id')
    .eq('case_id', caseId)
    .eq('visit_type', visitType)
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

    if (error) return { error: mapVisitDateOrderError(error) ?? 'Failed to update provider intake' }
  } else {
    const { error } = await supabase
      .from('initial_visit_notes')
      .insert({
        case_id: caseId,
        visit_type: visitType,
        status: 'draft',
        provider_intake: validated.data as unknown as Record<string, unknown>,
        visit_date: new Date().toISOString().slice(0, 10),
        created_by_user_id: user.id,
        updated_by_user_id: user.id,
      })

    if (error) return { error: mapVisitDateOrderError(error) ?? 'Failed to save provider intake' }
  }

  revalidatePath(`/patients/${caseId}`)
  return { data: { success: true } }
}

// --- Default visit type detection for a case (used by the page component) ---
//
// Cheap read-side helper: true if the case has any signal that imaging has
// been reviewed (case_summary with imaging_findings, OR approved MRI/CT
// extractions). Used only to pick the default tab when the editor opens —
// never at generation time.

export async function detectDefaultVisitTypeForCase(caseId: string): Promise<NoteVisitType> {
  const supabase = await createClient()

  const [summaryRes, mriCountRes, ctCountRes] = await Promise.all([
    supabase
      .from('case_summaries')
      .select('imaging_findings')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .in('review_status', ['approved', 'edited'])
      .eq('generation_status', 'completed')
      .maybeSingle(),
    supabase
      .from('mri_extractions')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .in('review_status', ['approved', 'edited']),
    supabase
      .from('ct_scan_extractions')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .in('review_status', ['approved', 'edited']),
  ])

  const findings = summaryRes.data?.imaging_findings
  const hasImagingFindings = findings != null
    && Array.isArray(findings)
    && (findings as unknown[]).length > 0

  if (hasImagingFindings) return 'pain_evaluation_visit'
  if (((mriCountRes.count ?? 0) + (ctCountRes.count ?? 0)) > 0) return 'pain_evaluation_visit'
  return 'initial_visit'
}
