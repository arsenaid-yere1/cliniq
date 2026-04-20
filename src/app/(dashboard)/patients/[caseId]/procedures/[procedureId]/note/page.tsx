import { createClient } from '@/lib/supabase/server'
import { getProcedureNote, checkProcedureNotePrerequisites } from '@/actions/procedure-notes'
import { getProcedureById } from '@/actions/procedures'
import { getClinicSettings, getProviderProfileById, getClinicLogoUrl, getProviderSignatureUrl } from '@/actions/settings'
import { ProcedureNoteEditor } from '@/components/procedures/procedure-note-editor'
import { notFound } from 'next/navigation'

export default async function ProcedureNotePage({
  params,
}: {
  params: Promise<{ caseId: string; procedureId: string }>
}) {
  const { caseId, procedureId } = await params
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
    procedureResult,
    noteResult,
    prereqResult,
    clinicResult,
    providerResult,
    logoResult,
    signatureResult,
  ] = await Promise.all([
    getProcedureById(procedureId),
    getProcedureNote(procedureId),
    checkProcedureNotePrerequisites(caseId),
    getClinicSettings(),
    assignedProviderId ? getProviderProfileById(assignedProviderId) : Promise.resolve({ data: null }),
    getClinicLogoUrl(),
    assignedProviderId ? getProviderSignatureUrl(assignedProviderId) : Promise.resolve({ url: null }),
  ])

  // Verify procedure exists and belongs to this case
  if (!procedureResult.data || procedureResult.data.case_id !== caseId) {
    notFound()
  }

  const procedure = procedureResult.data
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

  // Detect missing prior-procedure vitals. Surface to the editor so the
  // provider sees a badge when a prior procedure is on the chart but its
  // pain_score_max row is absent — distinct from "first in series". The AI
  // generator already emits paintoneLabel = 'missing_vitals' in this case;
  // this exposes the same signal to the UI without re-running the gatherer.
  const { data: priorProcIds } = await supabase
    .from('procedures')
    .select('id')
    .eq('case_id', caseId)
    .neq('id', procedureId)
    .is('deleted_at', null)

  let hasMissingPriorVitals = false
  if (priorProcIds && priorProcIds.length > 0) {
    const ids = priorProcIds.map((p) => p.id)
    const { data: priorVitals } = await supabase
      .from('vital_signs')
      .select('procedure_id, pain_score_max')
      .in('procedure_id', ids)
      .is('deleted_at', null)
    const idsWithPain = new Set(
      (priorVitals ?? [])
        .filter((v) => v.pain_score_max != null)
        .map((v) => v.procedure_id),
    )
    hasMissingPriorVitals = ids.some((id) => !idsWithPain.has(id))
  }

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

  // Build procedure display info for the header
  const diagnoses = Array.isArray(procedure.diagnoses)
    ? (procedure.diagnoses as Array<{ description: string }>)
    : []
  const procedureInfo = {
    procedure_date: procedure.procedure_date,
    procedure_name: procedure.procedure_name,
    procedure_number: procedure.procedure_number ?? 1,
    injection_site: procedure.injection_site,
    laterality: procedure.laterality,
    indication: diagnoses.map((d) => d.description).join(', ') || 'PRP Injection',
  }

  return (
    <ProcedureNoteEditor
      caseId={caseId}
      procedureId={procedureId}
      note={note ?? null}
      canGenerate={prereqResult.data?.canGenerate ?? false}
      prerequisiteReason={prereqResult.data?.reason}
      clinicSettings={clinicResult.data ?? null}
      providerProfile={providerResult.data ?? null}
      clinicLogoUrl={logoResult.url ?? null}
      providerSignatureUrl={signatureResult.url ?? null}
      caseData={caseData}
      procedureInfo={procedureInfo}
      documentFilePath={documentFilePath}
      hasMissingPriorVitals={hasMissingPriorVitals}
    />
  )
}
