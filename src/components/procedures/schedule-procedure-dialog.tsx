'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { rescheduleProcedureAppointment, scheduleProcedureAppointment } from '@/actions/procedure-appointments'
import { Button } from '@/components/ui/button'
import { Dialog,DialogContent,DialogFooter,DialogHeader,DialogTitle,DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select'

export function ScheduleProcedureDialog({orderId,providers,defaultProviderId,appointmentId}:{orderId:string;providers:Array<{id:string;display_name:string}>;defaultProviderId?:string|null;appointmentId?:string}){
  const router=useRouter();const[open,setOpen]=useState(false);const[pending,setPending]=useState(false);const[start,setStart]=useState('');const[provider,setProvider]=useState(defaultProviderId??providers[0]?.id??'');const idempotencyKey=useRef(crypto.randomUUID())
  async function submit(){const date=new Date(start);if(!start||Number.isNaN(date.getTime()))return toast.error('Choose a date and time');if(!provider)return toast.error('Choose a provider');setPending(true);const base={procedure_order_id:orderId,scheduled_start:date.toISOString(),scheduled_end:new Date(date.getTime()+60*60_000).toISOString(),provider_id:provider,location:null,notes:null,idempotency_key:idempotencyKey.current};const result=appointmentId?await rescheduleProcedureAppointment({...base,appointment_id:appointmentId}):await scheduleProcedureAppointment(base);setPending(false);if('error' in result&&result.error)return toast.error(result.error);idempotencyKey.current=crypto.randomUUID();setOpen(false);toast.success(appointmentId?'Procedure rescheduled':'Procedure scheduled');router.refresh()}
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" variant={appointmentId?'outline':'default'}>{appointmentId?'Reschedule':'Schedule'}</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>{appointmentId?'Reschedule':'Schedule'} procedure</DialogTitle></DialogHeader><div className="grid gap-4"><div className="grid gap-2"><Label>Date and time</Label><Input type="datetime-local" value={start} onChange={(e)=>setStart(e.target.value)}/></div><div className="grid gap-2"><Label>Provider</Label><Select value={provider} onValueChange={setProvider}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{providers.map((p)=><SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>)}</SelectContent></Select></div></div><DialogFooter><Button onClick={submit} disabled={pending}>{pending?(appointmentId?'Rescheduling…':'Scheduling…'):(appointmentId?'Reschedule':'Schedule')}</Button></DialogFooter></DialogContent></Dialog>
}
