'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { schedulePainFollowUp } from '@/actions/clinical-encounters'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { encounterDateFromLocalDateTime } from '@/lib/clinical/encounter-dates'

export function ScheduleVisitDialog({ caseId, episodeId, providers }: { caseId: string; episodeId: string; providers: Array<{ id: string; display_name: string }> }) {
  const router = useRouter(); const [open,setOpen]=useState(false); const [pending,setPending]=useState(false)
  const [time,setTime]=useState(''); const [provider,setProvider]=useState(providers[0]?.id ?? ''); const [modality,setModality]=useState<'telehealth'|'phone'|'in_person'>('telehealth')
  async function submit() {
    const start = new Date(time)
    if (!time || Number.isNaN(start.getTime())) return toast.error('Choose a valid date and time')
    setPending(true)
    const result = await schedulePainFollowUp({ case_id:caseId,episode_id:episodeId,modality,
      scheduled_start:start.toISOString(),scheduled_end:new Date(start.getTime()+30*60_000).toISOString(),
      encounter_date:encounterDateFromLocalDateTime(time),provider_id:provider||null,provider_intake:{},patient_reported_measurements:{} })
    setPending(false)
    if ('error' in result && result.error) return toast.error(result.error)
    setOpen(false); toast.success('Visit scheduled'); router.refresh()
  }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button variant="outline">Schedule Follow-Up</Button></DialogTrigger><DialogContent>
    <DialogHeader><DialogTitle>Schedule pain follow-up</DialogTitle></DialogHeader>
    <div className="grid gap-4 py-2"><div className="grid gap-2"><Label>Date and time</Label><Input type="datetime-local" value={time} onChange={(e)=>setTime(e.target.value)} /></div>
      <div className="grid gap-2"><Label>Modality</Label><Select value={modality} onValueChange={(v)=>setModality(v as typeof modality)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="telehealth">Telehealth</SelectItem><SelectItem value="phone">Phone</SelectItem><SelectItem value="in_person">In person</SelectItem></SelectContent></Select></div>
      <div className="grid gap-2"><Label>Provider</Label><Select value={provider} onValueChange={setProvider}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{providers.map((p)=><SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>)}</SelectContent></Select></div></div>
    <DialogFooter><Button onClick={submit} disabled={pending}>{pending?'Scheduling…':'Schedule'}</Button></DialogFooter>
  </DialogContent></Dialog>
}
