import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  getInitialVisitNotes,
  checkNotePrerequisites,
  getInitialVisitVitals,
  getProviderIntake,
} from '@/actions/initial-visit-notes'
import { getClinicSettings, getProviderProfileById, getClinicLogoUrl, getProviderSignatureUrl } from '@/actions/settings'
import { InitialVisitEditor } from '@/components/clinical/initial-visit-editor'
import { providerIntakeSchema } from '@/lib/validations/initial-visit-note'
import type { NoteVisitType } from '@/lib/claude/generate-initial-visit'

function parseIntake(raw: unknown) {
  if (!raw) return null
  const parsed = providerIntakeSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export default async function InitialVisitPage({ params, searchParams }: { params: Promise<{ caseId: string }>; searchParams: Promise<{ episode?: string; visitType?: string }> }) {
  const { caseId } = await params
  const query = await searchParams
  const supabase = await createClient()
  let episodeQuery = supabase.from('care_episodes').select('*').eq('case_id', caseId).is('deleted_at', null)
  episodeQuery = query.episode ? episodeQuery.eq('id', query.episode) : episodeQuery.eq('episode_number', 1)
  const { data: episode } = await episodeQuery.maybeSingle()
  if (!episode) notFound()
  const episodeId = episode.id
  const painEvaluationOnly = episode.episode_number > 1
  const { data: corrections, error: correctionError } = await supabase.from('discharge_note_corrections')
    .select('id').eq('episode_id', episodeId).eq('status', 'open').limit(1)
  const episodeWritable = episode.status === 'active' && !correctionError && corrections?.length === 0

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
  ] = await Promise.all([
    getInitialVisitNotes(caseId, episodeId),
    checkNotePrerequisites(caseId),
    getInitialVisitVitals(caseId, episodeId),
    getClinicSettings(),
    assignedProviderId ? getProviderProfileById(assignedProviderId) : Promise.resolve({ data: null }),
    getClinicLogoUrl(),
    assignedProviderId ? getProviderSignatureUrl(assignedProviderId) : Promise.resolve({ url: null }),
    painEvaluationOnly ? Promise.resolve({ data: null }) : getProviderIntake(caseId, 'initial_visit', episodeId),
    getProviderIntake(caseId, 'pain_evaluation_visit', episodeId),
  ])

  // A failed query is not an empty visit. Do not allow blank defaults to
  // overwrite saved measurements or feed generation after a read failure.
  if (vitalsResult.error) {
    return (
      <div role="alert" className="rounded-lg border border-destructive/40 p-4 text-sm">
        Vital signs could not be loaded. Reload this page to try again. Saved measurements have not been changed.
      </div>
    )
  }

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
  type NoteRow = Record<string, unknown> & { id: string; visit_type: string; document_id: string | null }
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

  // Pain-eval follow-up relies on priorVisitData.vitalSigns (the intake vitals
  // row that predates the prior initial-visit's finalization) for the
  // NUMERIC-ANCHOR prompt clause. When a prior finalized initial visit exists
  // but no intake vitals row predates it, the AI cannot cite a numeric pain
  // delta. Surface this to the editor as a data-gap badge.
  let painEvalMissingPriorVitals = false
  const priorIvFinalizedAt = (initialVisitNote?.finalized_at as string | null) ?? null
  const priorIvStatus = (initialVisitNote?.status as string | null) ?? null
  if (priorIvStatus === 'finalized' && priorIvFinalizedAt) {
    const { data: priorVitalsRow } = await supabase
      .from('vital_signs')
      .select('pain_score_max, clinical_encounters!vital_signs_encounter_id_fkey!inner(episode_id)')
      .eq('case_id', caseId)
      .eq('clinical_encounters.episode_id', episodeId)
      .is('procedure_id', null)
      .is('deleted_at', null)
      .lte('recorded_at', priorIvFinalizedAt)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    painEvalMissingPriorVitals = priorVitalsRow?.pain_score_max == null
  }

  const notesByVisitType: Record<NoteVisitType, unknown> = {
    initial_visit: initialVisitNote,
    pain_evaluation_visit: painEvaluationNote,
  }

  const intakesByVisitType = {
    initial_visit: parseIntake(initialIntakeResult.data),
    pain_evaluation_visit: parseIntake(painEvalIntakeResult.data),
  }

  const documentFilePathByVisitType = {
    initial_visit: initialVisitDocPath,
    pain_evaluation_visit: painEvalDocPath,
  }

  // Sibling dates power the pre-generation date input's min/max bounds,
  // mirroring the DB trigger (20260414_initial_visit_date_order) which requires
  // initial_visit.visit_date <= pain_evaluation_visit.visit_date. When a sibling
  // row has no date, no client-side bound is applied (trigger still enforces).
  const siblingDatesByVisitType: Record<NoteVisitType, string | null> = {
    initial_visit: (painEvaluationNote?.visit_date as string | null) ?? null,
    pain_evaluation_visit: (initialVisitNote?.visit_date as string | null) ?? null,
  }

  return (
    <InitialVisitEditor
      key={episodeId}
      caseId={caseId}
      episodeId={episodeId}
      episodeNumber={episode.episode_number}
      episodeWritable={episodeWritable}
      painEvaluationOnly={painEvaluationOnly}
      notesByVisitType={notesByVisitType}
      intakesByVisitType={intakesByVisitType}
      documentFilePathByVisitType={documentFilePathByVisitType}
      defaultVisitType={painEvaluationOnly || query.visitType === 'pain_evaluation_visit' ? 'pain_evaluation_visit' : 'initial_visit'}
      canGenerate={prereqResult.data?.canGenerate ?? false}
      prerequisiteReason={prereqResult.data?.reason}
      initialVitals={vitalsResult.data ?? null}
      clinicSettings={clinicResult.data ?? null}
      providerProfile={providerResult.data ?? null}
      clinicLogoUrl={logoResult.url ?? null}
      providerSignatureUrl={signatureResult.url ?? null}
      caseData={caseData}
      painEvalMissingPriorVitals={painEvalMissingPriorVitals}
      siblingDatesByVisitType={siblingDatesByVisitType}
    />
  )
}
