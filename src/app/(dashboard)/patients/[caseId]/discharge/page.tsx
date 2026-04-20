import { createClient } from '@/lib/supabase/server'
import { getDischargeNote, checkDischargeNotePrerequisites } from '@/actions/discharge-notes'
import { getClinicSettings, getProviderProfileById, getClinicLogoUrl, getProviderSignatureUrl } from '@/actions/settings'
import { DischargeNoteEditor } from '@/components/discharge/discharge-note-editor'

export default async function DischargePage({
  params,
}: {
  params: Promise<{ caseId: string }>
}) {
  const { caseId } = await params
  const supabase = await createClient()

  // Fetch case first to get assigned_provider_id for signature lookup
  const caseRes = await supabase
    .from('cases')
    .select('case_number, accident_type, accident_date, assigned_provider_id, patient:patients!inner(first_name, last_name, date_of_birth, gender)')
    .eq('id', caseId)
    .is('deleted_at', null)
    .single()

  const assignedProviderId = caseRes.data?.assigned_provider_id as string | null

  const [
    noteResult,
    prereqResult,
    clinicResult,
    providerResult,
    logoResult,
    signatureResult,
  ] = await Promise.all([
    getDischargeNote(caseId),
    checkDischargeNotePrerequisites(caseId),
    getClinicSettings(),
    assignedProviderId ? getProviderProfileById(assignedProviderId) : Promise.resolve({ data: null }),
    getClinicLogoUrl(),
    assignedProviderId ? getProviderSignatureUrl(assignedProviderId) : Promise.resolve({ url: null }),
  ])

  const caseData = caseRes.data
    ? {
        case_number: caseRes.data.case_number,
        accident_type: caseRes.data.accident_type,
        accident_date: caseRes.data.accident_date,
        patient: caseRes.data.patient as unknown as {
          first_name: string
          last_name: string
          date_of_birth: string | null
          gender: string | null
        },
      }
    : null

  // Fetch document file_path if note is finalized
  let documentFilePath: string | null = null
  const note = noteResult.data
  if (note?.document_id) {
    const { data: docRow } = await supabase
      .from('documents')
      .select('file_path')
      .eq('id', note.document_id)
      .is('deleted_at', null)
      .single()
    documentFilePath = docRow?.file_path ?? null
  }

  // Default discharge vitals = latest procedure's vital_signs row.
  // Used to pre-fill the pre-generation vitals card the first time the
  // provider visits, so the discharge reading carries forward from the
  // final injection instead of starting blank.
  const { data: latestProcedure } = await supabase
    .from('procedures')
    .select('id')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .order('procedure_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  let defaultVitals: {
    bp_systolic: number | null
    bp_diastolic: number | null
    heart_rate: number | null
    respiratory_rate: number | null
    temperature_f: number | null
    spo2_percent: number | null
    pain_score_min: number | null
    pain_score_max: number | null
  } | null = null

  if (latestProcedure) {
    const { data: latestVitalsRow } = await supabase
      .from('vital_signs')
      .select('bp_systolic, bp_diastolic, heart_rate, respiratory_rate, temperature_f, spo2_percent, pain_score_min, pain_score_max')
      .eq('procedure_id', latestProcedure.id)
      .is('deleted_at', null)
      .maybeSingle()
    defaultVitals = latestVitalsRow ?? null
  }

  // Fallback: if the latest procedure had no vitals recorded, try the
  // case-level initial-visit vitals (stored with procedure_id = null).
  if (!defaultVitals) {
    const { data: ivVitalsRow } = await supabase
      .from('vital_signs')
      .select('bp_systolic, bp_diastolic, heart_rate, respiratory_rate, temperature_f, spo2_percent, pain_score_min, pain_score_max')
      .eq('case_id', caseId)
      .is('procedure_id', null)
      .is('deleted_at', null)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    defaultVitals = ivVitalsRow ?? null
  }

  // Cross-note staleness: when a draft exists, compare note.updated_at to
  // max(updated_at) of the approved/edited upstream inputs the generator
  // reads (case_summaries, pt/pm/mri/chiro extractions, initial_visit_notes,
  // procedures, vital_signs). If any input changed after the note's last
  // generation, the draft reflects stale context.
  let isStale = false
  if (note && note.status === 'draft' && note.updated_at) {
    const noteUpdatedAt = new Date(note.updated_at as string)
    const [csRes, ptRes, pmRes, mriRes, chiroRes, ivRes, procRes, vsRes] = await Promise.all([
      supabase.from('case_summaries').select('updated_at').eq('case_id', caseId).in('review_status', ['approved', 'edited']).is('deleted_at', null).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('pt_extractions').select('updated_at').eq('case_id', caseId).in('review_status', ['approved', 'edited']).is('deleted_at', null).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('pain_management_extractions').select('updated_at').eq('case_id', caseId).in('review_status', ['approved', 'edited']).is('deleted_at', null).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('mri_extractions').select('updated_at').eq('case_id', caseId).in('review_status', ['approved', 'edited']).is('deleted_at', null).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('chiro_extractions').select('updated_at').eq('case_id', caseId).eq('report_type', 'discharge_summary').in('review_status', ['approved', 'edited']).is('deleted_at', null).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('initial_visit_notes').select('updated_at').eq('case_id', caseId).eq('status', 'finalized').is('deleted_at', null).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('procedures').select('updated_at').eq('case_id', caseId).is('deleted_at', null).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('vital_signs').select('updated_at').eq('case_id', caseId).is('deleted_at', null).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    const latestInputUpdates = [csRes, ptRes, pmRes, mriRes, chiroRes, ivRes, procRes, vsRes]
      .map((r) => (r.data as { updated_at: string | null } | null)?.updated_at)
      .filter((s): s is string => typeof s === 'string')
      .map((s) => new Date(s))
    isStale = latestInputUpdates.some((d) => d > noteUpdatedAt)
  }

  return (
    <DischargeNoteEditor
      caseId={caseId}
      note={note ?? null}
      canGenerate={prereqResult.data?.canGenerate ?? false}
      prerequisiteReason={prereqResult.data?.reason}
      clinicSettings={clinicResult.data ?? null}
      providerProfile={providerResult.data ?? null}
      clinicLogoUrl={logoResult.url ?? null}
      providerSignatureUrl={signatureResult.url ?? null}
      caseData={caseData}
      documentFilePath={documentFilePath}
      defaultVitals={defaultVitals}
      isStale={isStale}
    />
  )
}
