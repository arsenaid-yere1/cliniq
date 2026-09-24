import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { listCareEpisodes } from '@/actions/care-episodes'
import { listClinicalEncounters } from '@/actions/clinical-encounters'
import { listProviderProfiles } from '@/actions/settings'
import { requireReturnTeleVisitsPage } from '@/lib/features/return-tele-visits'
import { VisitList } from '@/components/visits/visit-list'
import { StartReturnEpisodeDialog } from '@/components/visits/start-return-episode-dialog'
import { ScheduleVisitDialog } from '@/components/visits/schedule-visit-dialog'

export default async function VisitsPage({ params }: { params:Promise<{caseId:string}> }) {
  requireReturnTeleVisitsPage()
  const { caseId }=await params
  const [episodeResult,encounterResult,providerResult]=await Promise.all([listCareEpisodes(caseId),listClinicalEncounters(caseId),listProviderProfiles()])
  const episodes=episodeResult.data??[]; const encounters=encounterResult.data??[]
  const providers=(providerResult.data??[]).map((p)=>({id:p.id,display_name:p.display_name}))
  const active=episodes.find((e)=>e.status==='active')
  const evaluationPending = active?.requires_pain_evaluation && !encounters.some((visit) => visit.episode_id === active.id && visit.encounter_type === 'pain_evaluation' && visit.status === 'completed')
  return <div className="space-y-6"><div className="flex items-start justify-between gap-4"><div><h1 className="text-2xl font-bold">Visits</h1><p className="text-sm text-muted-foreground">Care episodes and pain-management encounters.</p></div><div className="flex gap-2">{active ? evaluationPending ? <Button asChild><Link href={`/patients/${caseId}/initial-visit?episode=${active.id}&visitType=pain_evaluation_visit`}>Complete Pain Evaluation</Link></Button> : <><ScheduleVisitDialog caseId={caseId} episodeId={active.id} providers={providers}/><Button asChild variant="outline"><Link href={`/patients/${caseId}/discharge?episode=${active.id}`}>Discharge Episode</Link></Button></> : <StartReturnEpisodeDialog caseId={caseId} providers={providers}/>}</div></div><VisitList caseId={caseId} episodes={episodes} encounters={encounters}/></div>
}
