import { createClient } from '@/lib/supabase/server'
import {
  getInitialVisitNotes,
  checkNotePrerequisites,
  getInitialVisitVitals,
  getProviderIntake,
  detectDefaultVisitTypeForCase,
} from '@/actions/initial-visit-notes'
import { getClinicSettings, getProviderProfileById, getClinicLogoUrl, getProviderSignatureUrl } from '@/actions/settings'
import { InitialVisitEditor } from '@/components/clinical/initial-visit-editor'
import { providerIntakeSchema, type InitialVisitRomValues } from '@/lib/validations/initial-visit-note'
import type { NoteVisitType } from '@/lib/claude/generate-initial-visit'

function parseIntake(raw: unknown) {
  if (!raw) return null
  const parsed = providerIntakeSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export default async function InitialVisitPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params
  const supabase = await createClient()

  const caseRes = await supabase
    .from('cases')
    .select('case_number, accident_type, accident_date, accident_description, assigned_provider_id, patient:patients!inner(first_name, last_name, date_of_birth, gender)')
    .eq('id', caseId)
    .is('deleted_at', null)
    .single()

  const assignedProviderId = caseRes.data?.assigned_provider_id as string | null

  const [
    notesResult,
    prereqResult,
    vitalsResult,
    clinicResult,
    providerResult,
    logoResult,
    signatureResult,
    initialIntakeResult,
    painEvalIntakeResult,
    defaultVisitType,
  ] = await Promise.all([
    getInitialVisitNotes(caseId),
    checkNotePrerequisites(caseId),
    getInitialVisitVitals(caseId),
    getClinicSettings(),
    assignedProviderId ? getProviderProfileById(assignedProviderId) : Promise.resolve({ data: null }),
    getClinicLogoUrl(),
    assignedProviderId ? getProviderSignatureUrl(assignedProviderId) : Promise.resolve({ url: null }),
    getProviderIntake(caseId, 'initial_visit'),
    getProviderIntake(caseId, 'pain_evaluation_visit'),
    detectDefaultVisitTypeForCase(caseId),
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

  // Index notes by visit_type and resolve their document file paths in parallel
  type NoteRow = Record<string, unknown> & { id: string; visit_type: string; document_id: string | null; rom_data: unknown }
  const noteRows = ((notesResult.data as NoteRow[] | undefined) ?? []) as NoteRow[]
  const initialVisitNote = noteRows.find((n) => n.visit_type === 'initial_visit') ?? null
  const painEvaluationNote = noteRows.find((n) => n.visit_type === 'pain_evaluation_visit') ?? null

  const resolveDocPath = async (note: NoteRow | null): Promise<string | null> => {
    if (!note?.document_id) return null
    const { data: docRow } = await supabase
      .from('documents')
      .select('file_path')
      .eq('id', note.document_id)
      .is('deleted_at', null)
      .single()
    return docRow?.file_path ?? null
  }

  const [initialVisitDocPath, painEvalDocPath] = await Promise.all([
    resolveDocPath(initialVisitNote),
    resolveDocPath(painEvaluationNote),
  ])

  const notesByVisitType: Record<NoteVisitType, unknown> = {
    initial_visit: initialVisitNote,
    pain_evaluation_visit: painEvaluationNote,
  }

  const intakesByVisitType = {
    initial_visit: parseIntake(initialIntakeResult.data),
    pain_evaluation_visit: parseIntake(painEvalIntakeResult.data),
  }

  const romByVisitType = {
    initial_visit: (initialVisitNote?.rom_data as InitialVisitRomValues | null) ?? null,
    pain_evaluation_visit: (painEvaluationNote?.rom_data as InitialVisitRomValues | null) ?? null,
  }

  const documentFilePathByVisitType = {
    initial_visit: initialVisitDocPath,
    pain_evaluation_visit: painEvalDocPath,
  }

  return (
    <InitialVisitEditor
      caseId={caseId}
      notesByVisitType={notesByVisitType}
      intakesByVisitType={intakesByVisitType}
      romByVisitType={romByVisitType}
      documentFilePathByVisitType={documentFilePathByVisitType}
      defaultVisitType={defaultVisitType}
      canGenerate={prereqResult.data?.canGenerate ?? false}
      prerequisiteReason={prereqResult.data?.reason}
      initialVitals={vitalsResult.data ?? null}
      clinicSettings={clinicResult.data ?? null}
      providerProfile={providerResult.data ?? null}
      clinicLogoUrl={logoResult.url ?? null}
      providerSignatureUrl={signatureResult.url ?? null}
      caseData={caseData}
    />
  )
}
