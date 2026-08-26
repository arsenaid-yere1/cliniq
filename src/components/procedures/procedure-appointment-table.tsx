'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { completeProcedureAppointment, changeProcedureAppointmentStatus } from '@/actions/procedure-appointments'
import { cancelProcedureOrder } from '@/actions/procedure-orders'
import type { ProcedureDefaults } from '@/actions/procedures'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScheduleProcedureDialog } from './schedule-procedure-dialog'
import { RecordProcedureDialog, type ProcedureInitialData } from './record-procedure-dialog'
import { RecordBotoxDialog } from './record-botox-dialog'
import type { Tables } from '@/types/database'
import type { ProcedureSite } from '@/lib/procedures/sites-helpers'

type DiagnosisSuggestion = {
  icd10_code: string | null
  description: string
  imaging_support?: 'confirmed' | 'referenced' | 'none' | null
  exam_support?: 'objective' | 'subjective_only' | 'none' | null
  source_quote?: string | null
}

type Props = {
  caseId: string
  orders: Tables<'procedure_orders'>[]
  appointments: Tables<'procedure_appointments'>[]
  providers: Array<{ id: string; display_name: string }>
  defaultProviderId?: string | null
  diagnosisSuggestions: DiagnosisSuggestion[]
  procedureDefaults?: ProcedureDefaults | null
  patientLastName: string | null
}

export function ProcedureAppointmentTable({ caseId, orders, appointments, providers, defaultProviderId, diagnosisSuggestions, procedureDefaults, patientLastName }: Props) {
  const router = useRouter()
  const [selected, setSelected] = useState<Tables<'procedure_appointments'> | null>(null)
  const [simpleDate, setSimpleDate] = useState(new Date().toISOString().slice(0, 10))
  const [simplePain, setSimplePain] = useState('')
  const [pending, setPending] = useState(false)
  const operationKeys = useRef(new Map<string, string>())
  const operationKey = (name: string, id: string) => {
    const key = `${name}:${id}`
    const existing = operationKeys.current.get(key)
    if (existing) return existing
    const created = crypto.randomUUID()
    operationKeys.current.set(key, created)
    return created
  }
  const clearOperationKey = (name: string, id: string) => operationKeys.current.delete(`${name}:${id}`)
  const providerName = (id: string) => providers.find((provider) => provider.id === id)?.display_name ?? 'Unknown provider'

  async function closeAppointment(id: string, status: 'cancelled' | 'no_show') {
    const reason = window.prompt(status === 'cancelled' ? 'Cancellation reason' : 'No-show note')
    if (!reason) return
    const result = await changeProcedureAppointmentStatus({ appointment_id: id, status, reason, idempotency_key: operationKey(status, id) })
    if ('error' in result && result.error) toast.error(result.error)
    else { clearOperationKey(status, id); toast.success('Appointment updated'); router.refresh() }
  }

  async function cancelOrder(id: string) {
    const reason = window.prompt('Order cancellation reason')
    if (!reason) return
    const result = await cancelProcedureOrder(caseId, id, reason, operationKey('cancel-order', id))
    if ('error' in result && result.error) toast.error(result.error)
    else { clearOperationKey('cancel-order', id); toast.success('Order cancelled'); router.refresh() }
  }

  const selectedOrder = selected ? orders.find((order) => order.id === selected.procedure_order_id) : null
  const orderSites = (raw: unknown): ProcedureSite[] => Array.isArray(raw) ? raw.flatMap((site) => {
    if (typeof site === 'string') return [{ label: site, laterality: null, volume_ml: null, target_confirmed_imaging: null }]
    if (site && typeof site === 'object' && typeof (site as { label?: unknown }).label === 'string') return [site as ProcedureSite]
    return []
  }) : []
  const selectedInitial: ProcedureInitialData | undefined = selected && selectedOrder ? {
    procedure_date: selected.scheduled_start.slice(0, 10),
    sites: orderSites(selectedOrder.sites),
    diagnoses: selectedOrder.diagnoses,
    consent_obtained: true,
    blood_draw_volume_ml: null, centrifuge_duration_min: null, prep_protocol: null,
    kit_lot_number: null, anesthetic_agent: null, anesthetic_dose_ml: null,
    patient_tolerance: null, injection_volume_ml: null, needle_gauge: null,
    guidance_method: null, target_structure: null, complications: null,
    supplies_used: null, compression_bandage: null, activity_restriction_hrs: null,
    plan_deviation_reason: null, _vitals: null,
  } : undefined

  async function completeOtherType() {
    if (!selected || !selectedOrder) return
    setPending(true)
    const result = await completeProcedureAppointment(selected.id, {
      procedure_date: simpleDate,
      procedure_name: `${selectedOrder.procedure_type.toUpperCase()} Procedure`,
      sites: selectedOrder.sites,
      diagnoses: selectedOrder.diagnoses,
      consent_obtained: true,
      pain_rating: simplePain ? Number(simplePain) : null,
    }, simplePain ? { pain_score_min: Number(simplePain), pain_score_max: Number(simplePain) } : null, operationKey('complete', selected.id))
    setPending(false)
    if ('error' in result && result.error) return toast.error(result.error)
    clearOperationKey('complete', selected.id); setSelected(null); toast.success('Procedure recorded'); router.refresh()
  }

  return <>
    <Card><CardHeader><CardTitle className="text-lg">Scheduled</CardTitle></CardHeader><CardContent>
      {orders.length === 0 ? <p className="text-sm text-muted-foreground">No procedure orders.</p> : <div className="space-y-3">{orders.map((order) => {
        const attempts = appointments.filter((attempt) => attempt.procedure_order_id === order.id)
        const active = attempts.find((attempt) => attempt.status === 'scheduled')
        return <div key={order.id} className="rounded-md border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div>
            <div className="flex items-center gap-2"><p className="font-medium uppercase">{order.procedure_type}</p><Badge variant="outline">{order.status}</Badge></div>
            <p className="text-sm text-muted-foreground">{orderSites(order.sites).map((site) => site.label).join(', ') || 'Sites on order'}</p>
            {active && <p className="mt-2 text-sm">{format(new Date(active.scheduled_start), 'MMM d, yyyy h:mm a')} · {providerName(active.provider_id)}</p>}
          </div><div className="flex flex-wrap gap-2">
            {order.status === 'ordered' && <ScheduleProcedureDialog orderId={order.id} providers={providers} defaultProviderId={defaultProviderId} />}
            {active && <><Button size="sm" onClick={() => setSelected(active)}>Complete</Button><ScheduleProcedureDialog orderId={order.id} appointmentId={active.id} providers={providers} defaultProviderId={active.provider_id} /><Button size="sm" variant="outline" onClick={() => closeAppointment(active.id, 'no_show')}>No-show</Button><Button size="sm" variant="ghost" onClick={() => closeAppointment(active.id, 'cancelled')}>Cancel appointment</Button></>}
            {(order.status === 'ordered' || order.status === 'scheduled') && <Button size="sm" variant="ghost" onClick={() => cancelOrder(order.id)}>Cancel order</Button>}
          </div></div>
          {attempts.length > 0 && <div className="mt-3 space-y-1 border-t pt-3">{attempts.map((attempt) => <p key={attempt.id} className="text-xs text-muted-foreground">{format(new Date(attempt.scheduled_start), 'MMM d, yyyy h:mm a')} · {attempt.status.replaceAll('_', ' ')}{attempt.cancellation_reason ? ` — ${attempt.cancellation_reason}` : ''}</p>)}</div>}
        </div>
      })}</div>}
    </CardContent></Card>

    {selected && selectedOrder?.procedure_type === 'prp' && selectedInitial && <RecordProcedureDialog caseId={caseId} diagnosisSuggestions={diagnosisSuggestions} procedureDefaults={procedureDefaults} initialData={selectedInitial} patientLastName={patientLastName} procedureAppointmentId={selected.id} open onOpenChange={(open) => { if (!open) setSelected(null) }} />}
    {selected && selectedOrder?.procedure_type === 'botox' && selectedInitial && <RecordBotoxDialog caseId={caseId} diagnosisSuggestions={diagnosisSuggestions} procedureDefaults={procedureDefaults} initialData={{ ...selectedInitial, procedure_type: 'botox' }} patientLastName={patientLastName} procedureAppointmentId={selected.id} open onOpenChange={(open) => { if (!open) setSelected(null) }} />}

    <Dialog open={!!selected && !['prp', 'botox'].includes(selectedOrder?.procedure_type ?? '')} onOpenChange={(open) => { if (!open) setSelected(null) }}><DialogContent><DialogHeader><DialogTitle>Confirm performed procedure</DialogTitle></DialogHeader><div className="grid gap-4"><div className="grid gap-2"><Label>Performed date</Label><Input type="date" value={simpleDate} onChange={(event) => setSimpleDate(event.target.value)} /></div><div className="grid gap-2"><Label>Patient-reported pain</Label><Input type="number" min={0} max={10} value={simplePain} onChange={(event) => setSimplePain(event.target.value)} /></div><p className="text-sm text-muted-foreground">Consent is confirmed for this completion. Review the resulting performed procedure before finalizing its note.</p></div><DialogFooter><Button onClick={completeOtherType} disabled={pending}>{pending ? 'Recording…' : 'Record Procedure'}</Button></DialogFooter></DialogContent></Dialog>
  </>
}
