'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { PrpProcedureFormValues } from '@/lib/validations/prp-procedure'

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
      case_id: caseId,
      procedure_date: values.procedure_date,
      procedure_name: 'PRP Injection',
      injection_site: values.injection_site,
      laterality: values.laterality,
      diagnoses: values.diagnoses,
      consent_obtained: values.consent_obtained,
      pain_rating: values.pain_rating,
      procedure_number: procedureNumber,
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

// Fetch approved PM diagnoses for this case (ICD-10 combobox source)
export async function getCaseDiagnoses(caseId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('pain_management_extractions')
    .select('diagnoses')
    .eq('case_id', caseId)
    .eq('review_status', 'approved')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !data) return { data: [] }

  const diagnoses = Array.isArray(data.diagnoses) ? data.diagnoses : []
  return {
    data: diagnoses as Array<{ icd10_code: string | null; description: string }>,
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
