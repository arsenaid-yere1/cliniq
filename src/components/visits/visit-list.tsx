import Link from 'next/link'
import { format } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Tables } from '@/types/database'

export function VisitList({ caseId, episodes, encounters }: { caseId:string; episodes:Tables<'care_episodes'>[]; encounters:Tables<'clinical_encounters'>[] }) {
  return <div className="space-y-4">{episodes.map((episode) => {
    const visits=encounters.filter((e)=>e.episode_id===episode.id)
    return <Card key={episode.id}><CardHeader className="flex-row items-center justify-between"><CardTitle className="text-base">Episode {episode.episode_number}</CardTitle><Badge variant={episode.status==='active'?'default':'secondary'}>{episode.status}</Badge></CardHeader>
      <CardContent>{visits.length===0?<p className="text-sm text-muted-foreground">No visits in this episode.</p>:<div className="divide-y">{visits.map((visit)=>{const href=visit.encounter_type==='pain_follow_up'?`/patients/${caseId}/visits/${visit.id}`:visit.encounter_type==='discharge'?`/patients/${caseId}/discharge?episode=${episode.id}`:`/patients/${caseId}/initial-visit`;return <Link key={visit.id} href={href} className="flex items-center justify-between py-3 hover:text-primary"><div><p className="font-medium">{visit.encounter_type.replaceAll('_',' ')}</p><p className="text-sm text-muted-foreground">{visit.modality} · {visit.scheduled_start?format(new Date(visit.scheduled_start),'MMM d, yyyy h:mm a'):(visit.encounter_date??'Date pending')}</p></div><Badge variant="outline">{visit.status.replaceAll('_',' ')}</Badge></Link>})}</div>}</CardContent>
    </Card>
  })}</div>
}
