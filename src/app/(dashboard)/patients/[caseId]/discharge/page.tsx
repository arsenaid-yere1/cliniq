import { createClient } from '@/lib/supabase/server'
import { getDischargeNote, checkDischargeNotePrerequisites } from '@/actions/discharge-notes'
import { getClinicSettings, getProviderProfile, getClinicLogoUrl, getProviderSignatureUrl } from '@/actions/settings'
import { DischargeNoteEditor } from '@/components/discharge/discharge-note-editor'

export default async function DischargePage({
  params,
}: {
  params: Promise<{ caseId: string }>
}) {
  const { caseId } = await params
  const supabase = await createClient()

  const [
    noteResult,
    prereqResult,
    clinicResult,
    providerResult,
    logoResult,
    signatureResult,
    caseRes,
  ] = await Promise.all([
    getDischargeNote(caseId),
    checkDischargeNotePrerequisites(caseId),
    getClinicSettings(),
    getProviderProfile(),
    getClinicLogoUrl(),
    getProviderSignatureUrl(),
    supabase
      .from('cases')
      .select('case_number, accident_type, accident_date, patient:patients!inner(first_name, last_name, date_of_birth, gender)')
      .eq('id', caseId)
      .is('deleted_at', null)
      .single(),
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
    />
  )
}
