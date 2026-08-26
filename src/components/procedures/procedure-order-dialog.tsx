'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createProcedureOrderFromRecommendation } from '@/actions/procedure-orders'
import { Button } from '@/components/ui/button'
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle,DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select'
import type { ProcedureRecommendation } from '@/lib/validations/pain-follow-up-note'

export function ProcedureOrderDialog({caseId,episodeId,encounterId,recommendation,priorSeries=[]}:{caseId:string;episodeId:string;encounterId:string;recommendation:ProcedureRecommendation;priorSeries:Array<{id:string;label:string}>}) {
  const router=useRouter();const [open,setOpen]=useState(false);const [pending,setPending]=useState(false);const [continuation,setContinuation]=useState('new')
  async function submit(){setPending(true);const result=await createProcedureOrderFromRecommendation({case_id:caseId,episode_id:episodeId,source_encounter_id:encounterId,source_recommendation_id:recommendation.recommendation_id,procedure_type:recommendation.procedure_type,sites:recommendation.sites,diagnoses:recommendation.diagnoses,clinical_rationale:recommendation.rationale,priority:'routine',continued_from_series_id:continuation==='new'?null:continuation});setPending(false);if('error' in result&&result.error)return toast.error(result.error);setOpen(false);toast.success('Procedure ordered');router.push(`/patients/${caseId}/procedures`);router.refresh()}
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm">Recommend Procedure</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Confirm procedure order</DialogTitle><DialogDescription>The order uses the structured recommendation approved in this finalized visit.</DialogDescription></DialogHeader><div className="space-y-4"><div className="rounded-md border p-3 text-sm"><p className="font-medium uppercase">{recommendation.procedure_type}</p><p>{recommendation.sites.join(', ')}</p><p className="mt-2 text-muted-foreground">{recommendation.rationale}</p></div><div className="grid gap-2"><Label>Series</Label><Select value={continuation} onValueChange={setContinuation}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="new">Start new series</SelectItem>{priorSeries.map((s)=><SelectItem key={s.id} value={s.id}>Continue {s.label}</SelectItem>)}</SelectContent></Select></div></div><DialogFooter><Button onClick={submit} disabled={pending}>{pending?'Creating…':'Create Order'}</Button></DialogFooter></DialogContent></Dialog>
}
