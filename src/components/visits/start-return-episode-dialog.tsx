'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { startReturnVisit } from '@/actions/care-episodes'

export function StartReturnEpisodeDialog({ caseId, providers }: { caseId: string; providers: Array<{ id: string; display_name: string }> }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [reason, setReason] = useState('')
  const [scheduledStart, setScheduledStart] = useState('')
  const [providerId, setProviderId] = useState(providers[0]?.id ?? '')
  const [modality, setModality] = useState<'telehealth' | 'phone' | 'in_person'>('telehealth')
  const idempotencyKey = useRef(crypto.randomUUID())

  async function submit() {
    if (!reason.trim()) return toast.error('Return reason is required')
    setPending(true)
    const start = scheduledStart ? new Date(scheduledStart) : null
    const result = await startReturnVisit(caseId, reason, {
      case_id: caseId, modality,
      scheduled_start: start?.toISOString() ?? null,
      scheduled_end: start ? new Date(start.getTime() + 30 * 60_000).toISOString() : null,
      encounter_date: start ? start.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      provider_id: providerId || null, provider_intake: {}, patient_reported_measurements: {},
    }, idempotencyKey.current)
    setPending(false)
    if ('error' in result && result.error) return toast.error(result.error)
    setOpen(false)
    idempotencyKey.current = crypto.randomUUID()
    toast.success('Return visit started')
    const encounterId = 'data' in result ? result.data?.encounterId : null
    router.push(encounterId ? `/patients/${caseId}/visits/${encounterId}` : `/patients/${caseId}/visits`)
    router.refresh()
  }

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button>Start Return Visit</Button></DialogTrigger>
    <DialogContent>
      <DialogHeader><DialogTitle>Start return visit</DialogTitle><DialogDescription>Creates a new care episode and its first pain-management visit together.</DialogDescription></DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="grid gap-2"><Label htmlFor="return-reason">Reason for return</Label><Textarea id="return-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <div className="grid gap-2"><Label>Modality</Label><Select value={modality} onValueChange={(v) => setModality(v as typeof modality)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="telehealth">Telehealth</SelectItem><SelectItem value="phone">Phone</SelectItem><SelectItem value="in_person">In person</SelectItem></SelectContent></Select></div>
        <div className="grid gap-2"><Label htmlFor="return-time">Date and time</Label><Input id="return-time" type="datetime-local" value={scheduledStart} onChange={(e) => setScheduledStart(e.target.value)} /></div>
        <div className="grid gap-2"><Label>Provider</Label><Select value={providerId} onValueChange={setProviderId}><SelectTrigger><SelectValue placeholder="Select provider" /></SelectTrigger><SelectContent>{providers.map((p) => <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>)}</SelectContent></Select></div>
      </div>
      <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={submit} disabled={pending}>{pending ? 'Starting…' : 'Start Return Visit'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
