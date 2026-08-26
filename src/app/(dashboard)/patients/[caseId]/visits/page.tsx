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
  return <div className="space-y-6"><div className="flex items-start justify-between gap-4"><div><h1 className="text-2xl font-bold">Visits</h1><p className="text-sm text-muted-foreground">Care episodes and pain-management encounters.</p></div><div className="flex gap-2">{active?<ScheduleVisitDialog caseId={caseId} episodeId={active.id} providers={providers}/>:<StartReturnEpisodeDialog caseId={caseId} providers={providers}/>}</div></div><VisitList caseId={caseId} episodes={episodes} encounters={encounters}/></div>
}
