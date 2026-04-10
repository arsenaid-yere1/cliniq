'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { PrpProcedureFormValues } from '@/lib/validations/prp-procedure'
import { assertCaseNotClosed, autoAdvanceFromIntake } from '@/actions/case-status'

export async function getProcedureById(id: string) {
  const supabase = await createClient()

  const { data: procedure, error } = await supabase
    .from('procedures')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single()

  if (error || !procedure) return { error: error?.message ?? 'Not found', data: null }

  const { data: vitals } = await supabase
    .from('vital_signs')
    .select('*')
    .eq('procedure_id', id)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()

  return { data: { ...procedure, _vitals: vitals ?? null } }
}

export async function listProcedures(caseId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('procedures')
    .select('*, provider:users!provider_id(full_name)')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .order('procedure_date', { ascending: false })

  if (error) return { error: error.message, data: [] }
  return { data: data ?? [] }
}

export async function getProcedureCount(caseId: string) {
  const supabase = await createClient()

  const { count, error } = await supabase
    .from('procedures')
    .select('*', { count: 'exact', head: true })
    .eq('case_id', caseId)
    .is('deleted_at', null)

  if (error) return { error: error.message, count: 0 }
  return { count: count ?? 0 }
}

export async function createPrpProcedure(
  caseId: string,
  values: PrpProcedureFormValues
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  await autoAdvanceFromIntake(supabase, caseId, user.id)

  // Derive procedure number in series
  const { count } = await supabase
    .from('procedures')
    .select('*', { count: 'exact', head: true })
    .eq('case_id', caseId)
    .is('deleted_at', null)

  const procedureNumber = (count ?? 0) + 1

  // Insert procedure record
  const { data: procedure, error: procError } = await supabase
    .from('procedures')
    .insert({
      // --- Story 4.1 fields ---
      case_id: caseId,
      procedure_date: values.procedure_date,
      procedure_name: 'PRP Injection',
      injection_site: values.injection_site,
      laterality: values.laterality,
      diagnoses: values.diagnoses,
      consent_obtained: values.consent_obtained,
      pain_rating: values.pain_rating,
      procedure_number: procedureNumber,
      // --- Story 4.2: PRP Preparation ---
      blood_draw_volume_ml: values.prp_preparation.blood_draw_volume_ml,
      centrifuge_duration_min: values.prp_preparation.centrifuge_duration_min,
      prep_protocol: values.prp_preparation.prep_protocol || null,
      kit_lot_number: values.prp_preparation.kit_lot_number || null,
      // --- Story 4.2: Anesthesia ---
      anesthetic_agent: values.anesthesia.anesthetic_agent,
      anesthetic_dose_ml: values.anesthesia.anesthetic_dose_ml,
      patient_tolerance: values.anesthesia.patient_tolerance,
      // --- Story 4.2: Injection ---
      injection_volume_ml: values.injection.injection_volume_ml,
      needle_gauge: values.injection.needle_gauge || null,
      guidance_method: values.injection.guidance_method,
      target_confirmed_imaging: values.injection.target_confirmed_imaging,
      // --- Story 4.2: Post-Procedure ---
      complications: values.post_procedure.complications,
      supplies_used: values.post_procedure.supplies_used || null,
      compression_bandage: values.post_procedure.compression_bandage,
      activity_restriction_hrs: values.post_procedure.activity_restriction_hrs,
      // --- audit ---
      created_by_user_id: user.id,
      updated_by_user_id: user.id,
    })
    .select()
    .single()

  if (procError || !procedure) return { error: procError?.message ?? 'Failed to create procedure' }

  // Insert vital signs record
  const vs = values.vital_signs
  const hasVitals = Object.values(vs).some((v) => v !== null && v !== undefined)
  if (hasVitals) {
    const { error: vsError } = await supabase
      .from('vital_signs')
      .insert({
        case_id: caseId,
        procedure_id: procedure.id,
        bp_systolic: vs.bp_systolic,
        bp_diastolic: vs.bp_diastolic,
        heart_rate: vs.heart_rate,
        respiratory_rate: vs.respiratory_rate,
        temperature_f: vs.temperature_f,
        spo2_percent: vs.spo2_percent,
        created_by_user_id: user.id,
        updated_by_user_id: user.id,
      })

    if (vsError) return { error: vsError.message }
  }

  revalidatePath(`/patients/${caseId}/procedures`)
  return { data: procedure }
}

// Fetch approved PM diagnoses + finalized Initial Visit Note diagnoses for this case (ICD-10 combobox source)
export async function getCaseDiagnoses(caseId: string) {
  const supabase = await createClient()

  // Fetch PM extraction diagnoses and Initial Visit Note diagnoses in parallel
  const [pmRes, ivnRes] = await Promise.all([
    supabase
      .from('pain_management_extractions')
      .select('diagnoses')
      .eq('case_id', caseId)
      .eq('review_status', 'approved')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('initial_visit_notes')
      .select('diagnoses')
      .eq('case_id', caseId)
      .eq('status', 'finalized')
      .is('deleted_at', null)
      .maybeSingle(),
  ])

  const pmDiagnoses: Array<{ icd10_code: string | null; description: string }> =
    Array.isArray(pmRes.data?.diagnoses) ? pmRes.data.diagnoses : []

  // Parse ICD-10 codes from initial visit note diagnoses text
  // Format: "• M54.5 — Low back pain" or "M54.5 — Low back pain" per line
  const ivnDiagnoses: Array<{ icd10_code: string; description: string }> = []
  if (ivnRes.data?.diagnoses) {
    const lines = (ivnRes.data.diagnoses as string).split('\n')
    for (const line of lines) {
      // Match patterns like "• M54.5 — Description" or "M54.5 — Description" or "M54.5 - Description"
      const match = line.match(/^[•\-\d.]*\s*([A-Z]\d{1,2}\.?\d{0,4}[A-Z]{0,2})\s*[—–\-]\s*(.+)$/i)
      if (match) {
        ivnDiagnoses.push({ icd10_code: match[1].trim(), description: match[2].trim() })
      }
    }
  }

  // Merge: PM extraction first, then IVN codes not already present (dedup by icd10_code)
  const seen = new Set(pmDiagnoses.map((d) => d.icd10_code?.toUpperCase()))
  const merged = [
    ...pmDiagnoses,
    ...ivnDiagnoses.filter((d) => !seen.has(d.icd10_code.toUpperCase())),
  ]

  return { data: merged }
}

export async function updatePrpProcedure(
  procedureId: string,
  caseId: string,
  values: PrpProcedureFormValues
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  const { data: procedure, error: procError } = await supabase
    .from('procedures')
    .update({
      procedure_date: values.procedure_date,
      injection_site: values.injection_site,
      laterality: values.laterality,
      diagnoses: values.diagnoses,
      consent_obtained: values.consent_obtained,
      pain_rating: values.pain_rating,
      // PRP Preparation
      blood_draw_volume_ml: values.prp_preparation.blood_draw_volume_ml,
      centrifuge_duration_min: values.prp_preparation.centrifuge_duration_min,
      prep_protocol: values.prp_preparation.prep_protocol || null,
      kit_lot_number: values.prp_preparation.kit_lot_number || null,
      // Anesthesia
      anesthetic_agent: values.anesthesia.anesthetic_agent,
      anesthetic_dose_ml: values.anesthesia.anesthetic_dose_ml,
      patient_tolerance: values.anesthesia.patient_tolerance,
      // Injection
      injection_volume_ml: values.injection.injection_volume_ml,
      needle_gauge: values.injection.needle_gauge || null,
      guidance_method: values.injection.guidance_method,
      target_confirmed_imaging: values.injection.target_confirmed_imaging,
      // Post-Procedure
      complications: values.post_procedure.complications,
      supplies_used: values.post_procedure.supplies_used || null,
      compression_bandage: values.post_procedure.compression_bandage,
      activity_restriction_hrs: values.post_procedure.activity_restriction_hrs,
      updated_by_user_id: user.id,
    })
    .eq('id', procedureId)
    .select()
    .single()

  if (procError || !procedure) return { error: procError?.message ?? 'Failed to update procedure' }

  // Upsert vital signs
  const vs = values.vital_signs
  const hasVitals = Object.values(vs).some((v) => v !== null && v !== undefined)

  const { data: existingVitals } = await supabase
    .from('vital_signs')
    .select('id')
    .eq('procedure_id', procedureId)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()

  if (hasVitals) {
    if (existingVitals) {
      await supabase
        .from('vital_signs')
        .update({
          bp_systolic: vs.bp_systolic,
          bp_diastolic: vs.bp_diastolic,
          heart_rate: vs.heart_rate,
          respiratory_rate: vs.respiratory_rate,
          temperature_f: vs.temperature_f,
          spo2_percent: vs.spo2_percent,
          updated_by_user_id: user.id,
        })
        .eq('id', existingVitals.id)
    } else {
      await supabase
        .from('vital_signs')
        .insert({
          case_id: caseId,
          procedure_id: procedureId,
          bp_systolic: vs.bp_systolic,
          bp_diastolic: vs.bp_diastolic,
          heart_rate: vs.heart_rate,
          respiratory_rate: vs.respiratory_rate,
          temperature_f: vs.temperature_f,
          spo2_percent: vs.spo2_percent,
          created_by_user_id: user.id,
          updated_by_user_id: user.id,
        })
    }
  }

  revalidatePath(`/patients/${caseId}/procedures`)
  return { data: procedure }
}

// Defaults for pre-populating new procedure dialog from Initial Visit data
export interface ProcedureDefaults {
  injection_site: string | null
  laterality: 'left' | 'right' | 'bilateral' | null
  pain_rating: number | null
  vital_signs: {
    bp_systolic: number | null
    bp_diastolic: number | null
    heart_rate: number | null
    respiratory_rate: number | null
    temperature_f: number | null
    spo2_percent: number | null
  }
}

export async function getProcedureDefaults(caseId: string): Promise<{ data: ProcedureDefaults }> {
  const supabase = await createClient()

  const [vitalsRes, ivnRes] = await Promise.all([
    supabase
      .from('vital_signs')
      .select('bp_systolic, bp_diastolic, heart_rate, respiratory_rate, temperature_f, spo2_percent, pain_score_max')
      .eq('case_id', caseId)
      .is('procedure_id', null)
      .is('deleted_at', null)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('initial_visit_notes')
      .select('provider_intake')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const vitals = vitalsRes.data
  const providerIntake = ivnRes.data?.provider_intake as {
    chief_complaints?: {
      complaints?: Array<{ body_region: string }>
    }
  } | null

  // Derive injection_site and laterality from chief complaints
  let injection_site: string | null = null
  let laterality: 'left' | 'right' | 'bilateral' | null = null

  const complaints = providerIntake?.chief_complaints?.complaints ?? []
  if (complaints.length === 1) {
    const region = complaints[0].body_region
    const lowerRegion = region.toLowerCase()
    if (lowerRegion.startsWith('left ')) {
      laterality = 'left'
      injection_site = region.slice(5)
    } else if (lowerRegion.startsWith('right ')) {
      laterality = 'right'
      injection_site = region.slice(6)
    } else {
      injection_site = region
    }
  }

  return {
    data: {
      injection_site,
      laterality,
      pain_rating: vitals?.pain_score_max ?? null,
      vital_signs: {
        bp_systolic: vitals?.bp_systolic ?? null,
        bp_diastolic: vitals?.bp_diastolic ?? null,
        heart_rate: vitals?.heart_rate ?? null,
        respiratory_rate: vitals?.respiratory_rate ?? null,
        temperature_f: vitals?.temperature_f ?? null,
        spo2_percent: vitals?.spo2_percent ?? null,
      },
    },
  }
}

// Get the most recent prior PRP procedure for comparison
export async function getPriorPrpProcedure(caseId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('procedures')
    .select('id, procedure_date, pain_rating, procedure_number')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .order('procedure_date', { ascending: false })
    .limit(1)
    .single()

  if (error || !data) return { data: null }
  return { data }
}
