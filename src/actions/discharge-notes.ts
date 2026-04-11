'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { createHash } from 'node:crypto'
import {
  generateDischargeNoteFromData,
  regenerateDischargeNoteSection as regenerateSectionAI,
  type DischargeNoteInputData,
} from '@/lib/claude/generate-discharge-note'
import {
  dischargeNoteEditSchema,
  type DischargeNoteEditValues,
  type DischargeNoteSection,
} from '@/lib/validations/discharge-note'
import { assertCaseNotClosed, autoAdvanceFromIntake } from '@/actions/case-status'

// --- Helper: compute source data hash ---

function computeSourceHash(inputData: DischargeNoteInputData): string {
  const serialized = JSON.stringify(inputData)
  return createHash('sha256').update(serialized).digest('hex')
}

// --- Helper: gather all source data for note generation ---

async function gatherDischargeNoteSourceData(
  supabase: Awaited<ReturnType<typeof createClient>>,
  caseId: string,
  visitDate: string,
): Promise<{ data: DischargeNoteInputData | null; error: string | null }> {
  const [
    caseRes,
    proceduresRes,
    caseSummaryRes,
    ivNoteRes,
    ptRes,
    pmRes,
    mriRes,
    chiroRes,
    clinicRes,
  ] = await Promise.all([
    supabase
      .from('cases')
      .select('case_number, accident_type, accident_date, assigned_provider_id, patient:patients!inner(first_name, last_name, date_of_birth, gender)')
      .eq('id', caseId)
      .is('deleted_at', null)
      .single(),
    supabase
      .from('procedures')
      .select('id, procedure_date, procedure_name, procedure_number, injection_site, laterality, pain_rating, diagnoses')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .order('procedure_date', { ascending: true }),
    supabase
      .from('case_summaries')
      .select('chief_complaint, imaging_findings, prior_treatment, symptoms_timeline, suggested_diagnoses')
      .eq('case_id', caseId)
      .in('review_status', ['approved', 'edited'])
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('initial_visit_notes')
      .select('chief_complaint, physical_exam, diagnoses, treatment_plan')
      .eq('case_id', caseId)
      .eq('status', 'finalized')
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('pt_extractions')
      .select('outcome_measures, short_term_goals, long_term_goals, clinical_impression, prognosis, diagnoses')
      .eq('case_id', caseId)
      .in('review_status', ['approved', 'edited'])
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('pain_management_extractions')
      .select('chief_complaints, physical_exam, diagnoses, treatment_plan')
      .eq('case_id', caseId)
      .in('review_status', ['approved', 'edited'])
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
      .from('chiro_extractions')
      .select('diagnoses, treatment_modalities, functional_outcomes, plateau_statement')
      .eq('case_id', caseId)
      .eq('report_type', 'discharge_summary')
      .in('review_status', ['approved', 'edited'])
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('clinic_settings')
      .select('clinic_name, address_line1, address_line2, city, state, zip_code, phone, fax')
      .is('deleted_at', null)
      .maybeSingle(),
  ])

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

  const patient = caseRes.data.patient as unknown as {
    first_name: string
    last_name: string
    date_of_birth: string | null
    gender: string | null
  }

  const procedures = (proceduresRes.data ?? []).map((p) => ({
    procedure_date: p.procedure_date,
    procedure_name: p.procedure_name,
    procedure_number: p.procedure_number ?? 1,
    injection_site: p.injection_site,
    laterality: p.laterality,
    pain_rating: p.pain_rating,
    diagnoses: Array.isArray(p.diagnoses)
      ? (p.diagnoses as Array<{ icd10_code: string | null; description: string }>)
      : [],
  }))

  // Fetch latest vitals from the most recent procedure
  let latestVitals: DischargeNoteInputData['latestVitals'] = null
  const lastProcedure = proceduresRes.data?.at(-1)
  if (lastProcedure) {
    const { data: vitals } = await supabase
      .from('vital_signs')
      .select('bp_systolic, bp_diastolic, heart_rate, respiratory_rate, temperature_f, spo2_percent')
      .eq('procedure_id', lastProcedure.id)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle()
    latestVitals = vitals ?? null
  }

  const latestPainRating = lastProcedure?.pain_rating ?? null

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
        accident_date: caseRes.data.accident_date,
        accident_type: caseRes.data.accident_type,
      },
      visitDate,
      procedures,
      latestVitals,
      latestPainRating,
      caseSummary: caseSummaryRes.data
        ? {
            chief_complaint: caseSummaryRes.data.chief_complaint,
            imaging_findings: caseSummaryRes.data.imaging_findings as string | null,
            prior_treatment: caseSummaryRes.data.prior_treatment as string | null,
            symptoms_timeline: caseSummaryRes.data.symptoms_timeline as string | null,
            suggested_diagnoses: caseSummaryRes.data.suggested_diagnoses,
          }
        : null,
      initialVisitNote: ivNoteRes.data
        ? {
            chief_complaint: ivNoteRes.data.chief_complaint,
            physical_exam: ivNoteRes.data.physical_exam,
            assessment_and_plan: [ivNoteRes.data.diagnoses, ivNoteRes.data.treatment_plan].filter(Boolean).join('\n\n'),
          }
        : null,
      ptExtraction: ptRes.data
        ? {
            outcome_measures: ptRes.data.outcome_measures,
            short_term_goals: JSON.stringify(ptRes.data.short_term_goals),
            long_term_goals: JSON.stringify(ptRes.data.long_term_goals),
            clinical_impression: ptRes.data.clinical_impression,
            prognosis: ptRes.data.prognosis,
            diagnoses: ptRes.data.diagnoses,
          }
        : null,
      pmExtraction: pmRes.data
        ? {
            chief_complaints: pmRes.data.chief_complaints,
            physical_exam: pmRes.data.physical_exam,
            diagnoses: pmRes.data.diagnoses,
            treatment_plan: pmRes.data.treatment_plan,
          }
        : null,
      mriExtractions: (mriRes.data ?? []).map((m) => ({
        body_region: m.body_region,
        mri_date: m.mri_date,
        findings: m.findings,
        impression_summary: m.impression_summary,
      })),
      chiroExtraction: chiroRes.data
        ? {
            diagnoses: chiroRes.data.diagnoses,
            treatment_modalities: chiroRes.data.treatment_modalities,
            functional_outcomes: chiroRes.data.functional_outcomes,
            plateau_statement: chiroRes.data.plateau_statement as string | null,
          }
        : null,
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

export async function checkDischargeNotePrerequisites(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: ivNote } = await supabase
    .from('initial_visit_notes')
    .select('id')
    .eq('case_id', caseId)
    .eq('status', 'finalized')
    .is('deleted_at', null)
    .maybeSingle()

  if (!ivNote) {
    return { data: { canGenerate: false, reason: 'A finalized Initial Visit Note is required before generating a discharge summary.' } }
  }

  return { data: { canGenerate: true } }
}

// --- Generate discharge note ---

export async function generateDischargeNote(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  await autoAdvanceFromIntake(supabase, caseId, user.id)

  // Check prerequisite
  const prereq = await checkDischargeNotePrerequisites(caseId)
  if (prereq.data && !prereq.data.canGenerate) {
    return { error: prereq.data.reason }
  }

  // Look up existing active discharge note to preserve visit_date on regeneration
  const { data: existingNote } = await supabase
    .from('discharge_notes')
    .select('id, visit_date')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .maybeSingle()

  const today = new Date().toISOString().slice(0, 10)
  const visitDate = existingNote?.visit_date ?? today

  // Gather source data
  const { data: inputData, error: gatherError } = await gatherDischargeNoteSourceData(supabase, caseId, visitDate)
  if (gatherError || !inputData) return { error: gatherError || 'Failed to gather source data' }

  // Soft-delete existing discharge note for this case
  await supabase
    .from('discharge_notes')
    .update({ deleted_at: new Date().toISOString(), updated_by_user_id: user.id })
    .eq('case_id', caseId)
    .is('deleted_at', null)

  // Insert generating record
  const sourceHash = computeSourceHash(inputData)
  const { data: record, error: insertError } = await supabase
    .from('discharge_notes')
    .insert({
      case_id: caseId,
      status: 'generating',
      generation_attempts: 1,
      source_data_hash: sourceHash,
      visit_date: visitDate,
      created_by_user_id: user.id,
      updated_by_user_id: user.id,
    })
    .select('id')
    .single()

  if (insertError || !record) {
    revalidatePath(`/patients/${caseId}/discharge`)
    return { error: 'Failed to create note record' }
  }

  // Call Claude
  let result = await generateDischargeNoteFromData(inputData)

  // One retry on failure
  if (result.error || !result.data) {
    const retry = await generateDischargeNoteFromData(inputData)

    if (retry.error || !retry.data) {
      await supabase
        .from('discharge_notes')
        .update({
          status: 'failed',
          generation_error: retry.error || result.error || 'Unknown error',
          generation_attempts: 2,
          raw_ai_response: retry.rawResponse || result.rawResponse || null,
          updated_by_user_id: user.id,
        })
        .eq('id', record.id)

      revalidatePath(`/patients/${caseId}/discharge`)
      return { error: retry.error || result.error || 'Note generation failed after 2 attempts' }
    }

    result = retry
  }

  // Write success
  const data = result.data!
  await supabase
    .from('discharge_notes')
    .update({
      patient_header: data.patient_header,
      subjective: data.subjective,
      objective_vitals: data.objective_vitals,
      objective_general: data.objective_general,
      objective_cervical: data.objective_cervical,
      objective_lumbar: data.objective_lumbar,
      objective_neurological: data.objective_neurological,
      diagnoses: data.diagnoses,
      assessment: data.assessment,
      plan_and_recommendations: data.plan_and_recommendations,
      patient_education: data.patient_education,
      prognosis: data.prognosis,
      clinician_disclaimer: data.clinician_disclaimer,
      ai_model: 'claude-sonnet-4-6',
      raw_ai_response: result.rawResponse || null,
      status: 'draft',
      source_data_hash: sourceHash,
      updated_by_user_id: user.id,
    })
    .eq('id', record.id)

  revalidatePath(`/patients/${caseId}/discharge`)
  return { data: { id: record.id } }
}

// --- Get discharge note ---

export async function getDischargeNote(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data, error } = await supabase
    .from('discharge_notes')
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

export async function saveDischargeNote(caseId: string, values: DischargeNoteEditValues) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const validated = dischargeNoteEditSchema.safeParse(values)
  if (!validated.success) return { error: 'Invalid form data' }

  const { error } = await supabase
    .from('discharge_notes')
    .update({
      ...validated.data,
      updated_by_user_id: user.id,
    })
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .eq('status', 'draft')

  if (error) return { error: 'Failed to save note' }

  revalidatePath(`/patients/${caseId}/discharge`)
  return { data: { success: true } }
}

// --- Finalize note ---

export async function finalizeDischargeNote(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  // Fetch the draft note
  const { data: note, error: fetchError } = await supabase
    .from('discharge_notes')
    .select('*')
    .eq('case_id', caseId)
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
  const { renderDischargeNotePdf } = await import('@/lib/pdf/render-discharge-note-pdf')
  const pdfBuffer = await renderDischargeNotePdf({
    note: note as Record<string, unknown>,
    caseId,
    userId: user.id,
  })

  // Upload PDF to Supabase Storage
  const storagePath = `cases/${caseId}/discharge-note-${Date.now()}.pdf`
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
      file_name: 'Discharge Summary',
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
    .from('discharge_notes')
    .update({
      status: 'finalized',
      finalized_by_user_id: user.id,
      finalized_at: new Date().toISOString(),
      document_id: doc.id,
      updated_by_user_id: user.id,
    })
    .eq('id', note.id)

  if (updateError) return { error: 'Failed to finalize note' }

  revalidatePath(`/patients/${caseId}/discharge`)
  return { data: { success: true } }
}

// --- Unfinalize note ---

export async function unfinalizeDischargeNote(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const { error } = await supabase
    .from('discharge_notes')
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

  revalidatePath(`/patients/${caseId}/discharge`)
  return { data: { success: true } }
}

// --- Regenerate single section ---

export async function regenerateDischargeNoteSectionAction(
  caseId: string,
  section: DischargeNoteSection,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  // Fetch current note
  const { data: note, error: fetchError } = await supabase
    .from('discharge_notes')
    .select('*')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .eq('status', 'draft')
    .single()

  if (fetchError || !note) return { error: 'No draft note found' }

  // Gather fresh source data (preserve the note's existing visit_date)
  const visitDate = (note.visit_date as string | null) ?? new Date().toISOString().slice(0, 10)
  const { data: inputData, error: gatherError } = await gatherDischargeNoteSourceData(supabase, caseId, visitDate)
  if (gatherError || !inputData) return { error: gatherError || 'Failed to gather source data' }

  const currentContent = (note[section] as string) || ''

  const result = await regenerateSectionAI(inputData, section, currentContent)
  if (result.error || !result.data) {
    return { error: result.error || 'Section regeneration failed' }
  }

  // Update only the target section
  const { error: updateError } = await supabase
    .from('discharge_notes')
    .update({
      [section]: result.data,
      updated_by_user_id: user.id,
    })
    .eq('id', note.id)

  if (updateError) return { error: 'Failed to update section' }

  revalidatePath(`/patients/${caseId}/discharge`)
  return { data: { content: result.data } }
}
