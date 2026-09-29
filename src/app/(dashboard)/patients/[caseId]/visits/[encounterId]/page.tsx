import { VisitEditorHeader } from '@/components/visits/visit-editor-header'
import { visitHref } from '@/lib/clinical/visit-routes'
import { loadFollowUpIntakeHistory } from '@/lib/clinical/load-follow-up-intake-history'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPainFollowUpNote } from '@/actions/pain-follow-up-notes'
import { requireReturnTeleVisitsPage } from '@/lib/features/return-tele-visits'
import { PainFollowUpEditor } from '@/components/visits/pain-follow-up-editor'
import { Badge } from '@/components/ui/badge'
import { TelehealthIntakeCard } from '@/components/visits/telehealth-intake-card'
import { buildPainFollowUpEditorKey } from '@/lib/clinical/pain-follow-up-editor-key'
import { listProcedureOrders, previewProcedureSeriesChoices } from '@/actions/procedure-orders'

export default async function VisitPage({params}:{params:Promise<{caseId:string;encounterId:string}>}) {
  const {caseId,encounterId}=await params; const supabase=await createClient()
  const { data: encounter, error: encounterError } = await supabase.from('clinical_encounters').select('*').eq('id',encounterId).eq('case_id',caseId).is('deleted_at',null).maybeSingle()
  if (encounterError) return <p role="alert">Unable to load this visit. Reload to try again.</p>
  if (!encounter) notFound()
  if (encounter.encounter_type === 'pain_evaluation' || encounter.encounter_type === 'initial_evaluation' || encounter.encounter_type === 'discharge') {
    redirect(visitHref(caseId, encounter.episode_id, encounter.encounter_type, encounter.id)!)
  }
  if (encounter.encounter_type !== 'pain_follow_up') notFound()
  requireReturnTeleVisitsPage()
  const [noteResult, orderResult] = await Promise.all([getPainFollowUpNote(caseId,encounterId), listProcedureOrders(caseId)])
  if (noteResult.error) return <p role="alert">Unable to load the follow-up note. Reload to try again.</p>
  const [episodeResult, correctionResult, intakeHistory] = await Promise.all([
    supabase.from('care_episodes').select('status,episode_number').eq('id', encounter.episode_id).eq('case_id', caseId).is('deleted_at', null).maybeSingle(),
    supabase.from('discharge_note_corrections').select('id').eq('episode_id', encounter.episode_id).eq('status', 'open').limit(1),
    loadFollowUpIntakeHistory(supabase, encounter),
  ])
  const episodeWritable = !episodeResult.error && episodeResult.data?.status === 'active' && !correctionResult.error && correctionResult.data?.length === 0
  const {data:seriesChoices,error:seriesError}=await previewProcedureSeriesChoices(caseId,encounter.episode_id)
  const followUpNote=noteResult.data??null
  return <div className="space-y-6"><VisitEditorHeader caseId={caseId} episodeId={encounter.episode_id} episodeNumber={episodeResult.data?.episode_number} /><div><div className="flex items-center gap-3"><h1 className="text-2xl font-bold">Pain Follow-Up</h1><Badge variant="outline">{encounter.status.replaceAll('_',' ')}</Badge></div><p className="text-sm text-muted-foreground capitalize">{encounter.modality} visit · {encounter.encounter_date??'Date pending'}</p></div><TelehealthIntakeCard key={encounter.id} caseId={caseId} encounter={encounter} history={intakeHistory} episodeWritable={episodeWritable}/><PainFollowUpEditor key={buildPainFollowUpEditorKey(caseId,encounterId,followUpNote)} caseId={caseId} encounter={encounter} initialNote={followUpNote} episodeWritable={episodeWritable} seriesChoices={seriesChoices} procedureOrders={(orderResult.data??[]).filter((order)=>order.source_encounter_id===encounterId)} relationshipLoadError={!!seriesError||!!orderResult.error}/></div>
}
