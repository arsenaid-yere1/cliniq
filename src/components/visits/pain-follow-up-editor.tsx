'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { generatePainFollowUpNote, savePainFollowUpNote, finalizePainFollowUpNote, regeneratePainFollowUpSectionAction } from '@/actions/pain-follow-up-notes'
import Link from 'next/link'
import type { Tables } from '@/types/database'
import type { ProcedureRecommendation } from '@/lib/validations/pain-follow-up-note'
import { ProcedureOrderDialog } from '@/components/procedures/procedure-order-dialog'

const sections = [
  ['subjective','Subjective'],['interval_history','Interval History'],['review_of_systems','Review of Systems'],
  ['telehealth_observations','Telehealth Observations'],['imaging_review','Imaging Review'],['assessment','Assessment'],
  ['diagnoses','Diagnoses'],['treatment_plan','Treatment Plan'],['patient_education','Patient Education'],
  ['follow_up','Follow-Up'],['clinician_disclaimer','Clinician Disclaimer'],
] as const

export function PainFollowUpEditor({ caseId, encounter, initialNote, priorSeries=[] }: { caseId:string; encounter:Tables<'clinical_encounters'>; initialNote:Tables<'pain_follow_up_notes'>|null; priorSeries?:Array<{id:string;label:string}> }) {
  const router=useRouter(); const [pending,setPending]=useState(false)
  const [note,setNote]=useState<Record<string,string>>(()=>Object.fromEntries(sections.map(([key])=>[key,(initialNote?.[key] as string|null)??''])))
  const recommendations=(initialNote?.procedure_recommendations??[]) as unknown as ProcedureRecommendation[]
  async function run(action:()=>Promise<unknown>) { setPending(true); const result=await action() as {error?:string}; setPending(false); if(result.error) toast.error(result.error); else { toast.success('Saved'); router.refresh() } }
  if (!initialNote || initialNote.status==='failed') return <Card><CardHeader><CardTitle>Telehealth follow-up note</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm text-muted-foreground">Generate a draft from this visit and the current episode’s clinical history.</p><Button disabled={pending||encounter.status!=='in_progress'} onClick={()=>run(()=>generatePainFollowUpNote(caseId,encounter.id))}>{pending?'Generating…':'Generate Follow-Up Note'}</Button>{encounter.status==='scheduled'&&<p className="text-xs text-muted-foreground">Start the visit after documenting intake to enable note generation.</p>}</CardContent></Card>
  const finalized=initialNote.status==='finalized'
  const editValues={encounter_id:encounter.id,subjective:note.subjective,interval_history:note.interval_history,review_of_systems:note.review_of_systems,telehealth_observations:note.telehealth_observations,imaging_review:note.imaging_review,assessment:note.assessment,diagnoses:note.diagnoses,treatment_plan:note.treatment_plan,patient_education:note.patient_education,follow_up:note.follow_up,clinician_disclaimer:note.clinician_disclaimer,procedure_recommendations:recommendations}
  return <div className="space-y-4"><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">Telehealth follow-up note</h2><p className="text-sm text-muted-foreground capitalize">{initialNote.status}</p></div><div className="flex gap-2">{finalized&&initialNote.document_id&&<Button variant="outline" asChild><Link href={`/patients/${caseId}/documents`}>View finalized PDF</Link></Button>}{!finalized&&<><Button variant="outline" disabled={pending} onClick={()=>run(()=>savePainFollowUpNote(caseId,editValues))}>Save Draft</Button><Button disabled={pending} onClick={()=>run(()=>finalizePainFollowUpNote(caseId,encounter.id))}>Finalize & Complete Visit</Button></>}</div></div>
    <div className="grid gap-4">{sections.map(([key,label])=><Card key={key}><CardHeader className="flex-row items-center justify-between pb-2"><CardTitle className="text-sm">{label}</CardTitle>{!finalized&&<Button size="sm" variant="ghost" disabled={pending} onClick={()=>run(()=>regeneratePainFollowUpSectionAction(caseId,encounter.id,key))}>Regenerate</Button>}</CardHeader><CardContent><Label className="sr-only" htmlFor={key}>{label}</Label><Textarea id={key} value={note[key]} disabled={finalized} rows={4} onChange={(e)=>setNote((n)=>({...n,[key]:e.target.value}))} /></CardContent></Card>)}</div>
    {recommendations.length>0&&<Card><CardHeader><CardTitle className="text-base">Structured procedure recommendations</CardTitle></CardHeader><CardContent className="space-y-3">{recommendations.map((r)=><div key={r.recommendation_id} className="flex items-start justify-between gap-4 rounded-md border p-3"><div><p className="font-medium uppercase">{r.procedure_type}</p><p className="text-sm text-muted-foreground">{r.sites.join(', ')}</p><p className="mt-1 text-sm">{r.rationale}</p></div>{finalized&&<ProcedureOrderDialog caseId={caseId} episodeId={encounter.episode_id} encounterId={encounter.id} recommendation={r} priorSeries={priorSeries}/>}</div>)}</CardContent></Card>}
  </div>
}
