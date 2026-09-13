import { loadFollowUpIntakeHistory } from '@/lib/clinical/load-follow-up-intake-history'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPainFollowUpNote } from '@/actions/pain-follow-up-notes'
import { requireReturnTeleVisitsPage } from '@/lib/features/return-tele-visits'
import { PainFollowUpEditor } from '@/components/visits/pain-follow-up-editor'
import { Badge } from '@/components/ui/badge'
import { TelehealthIntakeCard } from '@/components/visits/telehealth-intake-card'
import { buildPainFollowUpEditorKey } from '@/lib/clinical/pain-follow-up-editor-key'
import { listProcedureOrders, previewProcedureSeriesChoices } from '@/actions/procedure-orders'

export default async function VisitPage({params}:{params:Promise<{caseId:string;encounterId:string}>}) {
  requireReturnTeleVisitsPage()
  const {caseId,encounterId}=await params; const supabase=await createClient()
  const [{data:encounter},noteResult,orderResult]=await Promise.all([
    supabase.from('clinical_encounters').select('*').eq('id',encounterId).eq('case_id',caseId).eq('encounter_type','pain_follow_up').is('deleted_at',null).maybeSingle(),
    getPainFollowUpNote(caseId,encounterId),
    listProcedureOrders(caseId),
  ])
  if(!encounter) notFound()
  const [episodeResult, correctionResult, intakeHistory] = await Promise.all([
    supabase.from('care_episodes').select('status').eq('id', encounter.episode_id).eq('case_id', caseId).is('deleted_at', null).maybeSingle(),
    supabase.from('discharge_note_corrections').select('id').eq('episode_id', encounter.episode_id).eq('status', 'open').limit(1),
    loadFollowUpIntakeHistory(supabase, encounter),
  ])
  const episodeWritable = !episodeResult.error && episodeResult.data?.status === 'active' && !correctionResult.error && correctionResult.data?.length === 0
  const {data:seriesChoices,error:seriesError}=await previewProcedureSeriesChoices(caseId,encounter.episode_id)
  const followUpNote=noteResult.data??null
  return <div className="space-y-6"><div><div className="flex items-center gap-3"><h1 className="text-2xl font-bold">Pain Follow-Up</h1><Badge variant="outline">{encounter.status.replaceAll('_',' ')}</Badge></div><p className="text-sm text-muted-foreground capitalize">{encounter.modality} visit · {encounter.encounter_date??'Date pending'}</p></div><TelehealthIntakeCard key={encounter.id} caseId={caseId} encounter={encounter} history={intakeHistory} episodeWritable={episodeWritable}/><PainFollowUpEditor key={buildPainFollowUpEditorKey(followUpNote)} caseId={caseId} encounter={encounter} initialNote={followUpNote} episodeWritable={episodeWritable} seriesChoices={seriesChoices} procedureOrders={(orderResult.data??[]).filter((order)=>order.source_encounter_id===encounterId)} relationshipLoadError={!!seriesError||!!orderResult.error}/></div>
}
