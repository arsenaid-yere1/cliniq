import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPainFollowUpNote } from '@/actions/pain-follow-up-notes'
import { requireReturnTeleVisitsPage } from '@/lib/features/return-tele-visits'
import { PainFollowUpEditor } from '@/components/visits/pain-follow-up-editor'
import { Badge } from '@/components/ui/badge'
import { TelehealthIntakeCard } from '@/components/visits/telehealth-intake-card'
import { buildPainFollowUpEditorKey } from '@/lib/clinical/pain-follow-up-editor-key'
import { buildProcedureSeriesOptions } from '@/lib/clinical/procedure-series-labels'

export default async function VisitPage({params}:{params:Promise<{caseId:string;encounterId:string}>}) {
  requireReturnTeleVisitsPage()
  const {caseId,encounterId}=await params; const supabase=await createClient()
  const [{data:encounter},noteResult]=await Promise.all([
    supabase.from('clinical_encounters').select('*').eq('id',encounterId).eq('case_id',caseId).eq('encounter_type','pain_follow_up').is('deleted_at',null).maybeSingle(),
    getPainFollowUpNote(caseId,encounterId),
  ])
  if(!encounter) notFound()
  const {data:seriesRows}=await supabase.from('procedure_series')
    .select('id,episode_id,series_number,procedure_type,status,deleted_at,episode:care_episodes!inner(episode_number),procedures(procedure_number,deleted_at),procedure_orders(status,deleted_at)')
    .eq('case_id',caseId).in('status',['active','completed']).is('deleted_at',null).order('created_at',{ascending:false})
  const candidates=(seriesRows??[]).flatMap((series)=>{
    const episode=series.episode[0]
    return episode?[{
      id:series.id,
      episodeId:series.episode_id,episodeNumber:episode.episode_number,seriesNumber:series.series_number,
      procedureType:series.procedure_type,status:series.status,deletedAt:series.deleted_at,
      procedureNumbers:series.procedures.filter((procedure)=>procedure.deleted_at===null).map((procedure)=>procedure.procedure_number),
      orderStatuses:series.procedure_orders.map((order)=>({status:order.status,deletedAt:order.deleted_at})),
    }]:[]
  })
  const seriesOptions=buildProcedureSeriesOptions(candidates,encounter.episode_id)
  const followUpNote=noteResult.data??null
  return <div className="space-y-6"><div><div className="flex items-center gap-3"><h1 className="text-2xl font-bold">Pain Follow-Up</h1><Badge variant="outline">{encounter.status.replaceAll('_',' ')}</Badge></div><p className="text-sm text-muted-foreground capitalize">{encounter.modality} visit · {encounter.encounter_date??'Date pending'}</p></div><TelehealthIntakeCard caseId={caseId} encounter={encounter}/><PainFollowUpEditor key={buildPainFollowUpEditorKey(followUpNote)} caseId={caseId} encounter={encounter} initialNote={followUpNote} seriesOptions={seriesOptions}/></div>
}
