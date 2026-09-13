'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { changePainFollowUpStatus, updatePainFollowUpEncounter } from '@/actions/clinical-encounters'
import { requestFollowUpIntakeHistory } from '@/actions/follow-up-intake-history'
import { useCaseStatus } from '@/components/patients/case-status-context'
import { LOCKED_STATUSES, type CaseStatus } from '@/lib/constants/case-status'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { encounterDateFromLocalDateTime } from '@/lib/clinical/encounter-dates'
import { initializeFollowUpIntake, intakeRecord, type FollowUpIntake, type HistorySource, type IntakeHistoryResult } from '@/lib/clinical/follow-up-intake-prefill'
import type { Tables } from '@/types/database'

function savedSources(value: unknown): HistorySource[] {
  const sources = intakeRecord(value).sources
  if (!Array.isArray(sources)) return []
  return sources.filter((source): source is HistorySource => {
    const row = intakeRecord(source)
    return typeof row.id === 'string' && typeof row.date === 'string' && typeof row.label === 'string'
      && ['visit', 'procedure', 'discharge'].includes(String(row.kind))
  })
}

export function TelehealthIntakeCard({ caseId, encounter, history, episodeWritable = true }: {
  caseId: string
  encounter: Tables<'clinical_encounters'>
  history?: IntakeHistoryResult
  episodeWritable?: boolean
}) {
  const router = useRouter()
  const caseLocked = LOCKED_STATUSES.includes(useCaseStatus() as CaseStatus)
  const locked = !episodeWritable || caseLocked || !['scheduled', 'in_progress'].includes(encounter.status)
  // Snapshot per encounter: a router refresh must not overwrite local edits or clears.
  const [initial] = useState(() => initializeFollowUpIntake(encounter, locked ? null : history?.data ?? null))
  const [intake, setIntake] = useState(initial.intake)
  const [sources, setSources] = useState(() => initial.applied ? history!.data!.sources : savedSources(initial.intake.history_prefill))
  const [reviewed, setReviewed] = useState(!initial.applied)
  const [historyError, setHistoryError] = useState(history?.error)
  const [previousPain, setPreviousPain] = useState(history?.data?.previousPain ?? null)
  const [painMin, setPainMin] = useState(encounter.patient_reported_pain_min?.toString() ?? '')
  const [painMax, setPainMax] = useState(encounter.patient_reported_pain_max?.toString() ?? '')
  const [consent, setConsent] = useState(encounter.telehealth_consent_obtained ?? false)
  const [patientState, setPatientState] = useState(encounter.patient_location_state ?? '')
  const [providerLocation, setProviderLocation] = useState(encounter.provider_location ?? '')
  const [connection, setConnection] = useState(encounter.connection_method ?? '')
  const [scheduledStart, setScheduledStart] = useState(() => {
    if (!encounter.scheduled_start) return ''
    const start = new Date(encounter.scheduled_start)
    // datetime-local expects local wall time, not UTC.
    return new Date(start.getTime() - start.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
  })
  const [pending, setPending] = useState(false)
  const disabled = locked || pending
  const visitDate = encounterDateFromLocalDateTime(scheduledStart) ?? encounter.encounter_date
  const invalidHistoryDate = sources.length > 0 && (!visitDate || sources.some((source) => source.date >= visitDate))

  async function run(action: () => Promise<unknown>, message: string) {
    if (disabled) return
    setPending(true)
    try {
      const result = await action() as { error?: string }
      if (result.error) { toast.error(result.error); return }
      toast.success(message)
      router.refresh()
    } catch {
      toast.error('Something went wrong. Your intake has been kept; please try again.')
    } finally {
      setPending(false)
    }
  }

  async function fillFromHistory() {
    if (disabled || !visitDate) return
    setPending(true)
    try {
      const result = await requestFollowUpIntakeHistory(caseId, encounter.id, visitDate)
      if (result.error) { setHistoryError(result.error); return }
      const suggestion = result.data
      if (!suggestion || (!suggestion.chiefComplaint && !suggestion.intervalHistory)) {
        setHistoryError('No earlier information is available to fill these fields.')
        return
      }
      setHistoryError(undefined)
      setPreviousPain(suggestion.previousPain)
      const fillsComplaint = !intake.chief_complaint.trim() && !!suggestion.chiefComplaint
      const fillsHistory = !intake.interval_history.trim() && !!suggestion.intervalHistory
      if (fillsComplaint || fillsHistory) {
        setIntake((value) => ({ ...value,
          chief_complaint: value.chief_complaint.trim() ? value.chief_complaint : suggestion.chiefComplaint,
          interval_history: value.interval_history.trim() ? value.interval_history : suggestion.intervalHistory,
        }))
        setSources((existing) => [...new Map([...existing, ...suggestion.sources].map((source) => [`${source.kind}:${source.id}`, source])).values()])
        setReviewed(false)
      }
    } catch {
      setHistoryError('Previous visit information could not be loaded. Please try again.')
    } finally {
      setPending(false)
    }
  }

  async function save() {
    if (sources.length > 0 && !reviewed) return toast.error('Review the historical suggestions before saving.')
    if (invalidHistoryDate) return toast.error('Clear the historical suggestions before saving an earlier visit date.')
    const start = scheduledStart ? new Date(scheduledStart) : null
    await run(() => updatePainFollowUpEncounter(caseId, {
      encounter_id: encounter.id,
      scheduled_start: start?.toISOString() ?? null,
      scheduled_end: start ? new Date(start.getTime() + 30 * 60_000).toISOString() : null,
      encounter_date: visitDate,
      provider_intake: {
        ...intake,
        ...(sources.length > 0 ? { history_prefill: { sources, reviewed_at: new Date().toISOString(), visit_date: visitDate } } : {}),
      },
      patient_reported_pain_min: painMin === '' ? null : Number(painMin),
      patient_reported_pain_max: painMax === '' ? null : Number(painMax),
      telehealth_consent_obtained: encounter.modality === 'telehealth' ? consent : null,
      telehealth_consent_at: encounter.modality === 'telehealth' && consent ? encounter.telehealth_consent_at ?? new Date().toISOString() : null,
      patient_location_state: patientState || null,
      provider_location: providerLocation || null,
      connection_method: connection || null,
    }), 'Visit intake saved')
  }

  async function changeStatus(status: 'in_progress' | 'cancelled' | 'no_show') {
    const reason = status === 'in_progress' ? undefined : window.prompt(status === 'cancelled' ? 'Cancellation reason' : 'No-show note') ?? undefined
    if (status !== 'in_progress' && !reason) return
    await run(() => changePainFollowUpStatus(caseId, encounter.id, status, reason), status === 'in_progress' ? 'Visit started' : 'Visit status updated')
  }

  function clearSuggestions() {
    setIntake((value) => {
      const next: FollowUpIntake = { ...value, chief_complaint: '', interval_history: '' }
      delete next.history_prefill
      return next
    })
    setSources([])
    setReviewed(true)
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Encounter intake</CardTitle></CardHeader>
      <CardContent className="grid gap-4">
        {encounter.status === 'scheduled' && !locked && <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => changeStatus('in_progress')} disabled={pending}>Start visit</Button>
          <Button size="sm" variant="outline" onClick={() => changeStatus('no_show')} disabled={pending}>Mark no-show</Button>
          <Button size="sm" variant="ghost" onClick={() => changeStatus('cancelled')} disabled={pending}>Cancel visit</Button>
        </div>}
        {historyError && <p role="status" className="text-sm text-muted-foreground">{historyError}</p>}
        {!locked && (!intake.chief_complaint.trim() || !intake.interval_history.trim()) && <div>
          <Button type="button" size="sm" variant="outline" disabled={disabled || !visitDate} onClick={fillFromHistory}>Fill empty fields from history</Button>
        </div>}
        {sources.length > 0 && <div className="space-y-3 rounded-md border bg-muted/30 p-4">
          <div>
            <p className="text-sm font-medium">Historical sources</p>
            <p className="text-sm text-muted-foreground">The complaint and interval history include previous documentation. Review and edit them, then save before generating the note. Enter today&apos;s findings separately.</p>
          </div>
          <ul className="list-inside list-disc text-sm text-muted-foreground">
            {sources.map((source) => <li key={`${source.kind}:${source.id}`}>{source.label}</li>)}
          </ul>
          {!locked && <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={reviewed} disabled={disabled || invalidHistoryDate} onChange={(event) => setReviewed(event.target.checked)} />
              I reviewed the historical suggestions for this visit
            </label>
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={clearSuggestions}>Clear suggested complaint and history</Button>
          </>}
          {invalidHistoryDate && <p role="alert" className="text-sm text-destructive">These sources are not all before the selected visit date. Clear the suggested complaint and history before saving.</p>}
        </div>}
        <div className="grid gap-2">
          <Label htmlFor="intake-scheduled-start">Scheduled date and time</Label>
          <Input id="intake-scheduled-start" type="datetime-local" value={scheduledStart} disabled={disabled} onChange={(event) => { setScheduledStart(event.target.value); setReviewed(false) }} />
        </div>
        {previousPain && visitDate && previousPain.date < visitDate && <p className="rounded-md bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          Previous patient-reported pain ({previousPain.date}): minimum {previousPain.min ?? 'not recorded'}, maximum {previousPain.max ?? 'not recorded'} / 10. Record today&apos;s pain below.
        </p>}
        <div className="grid gap-2 md:grid-cols-2">
          <div className="grid gap-2"><Label htmlFor="intake-pain-min">Patient-reported pain minimum</Label><Input id="intake-pain-min" type="number" min={0} max={10} value={painMin} disabled={disabled} onChange={(event) => setPainMin(event.target.value)} /></div>
          <div className="grid gap-2"><Label htmlFor="intake-pain-max">Patient-reported pain maximum</Label><Input id="intake-pain-max" type="number" min={0} max={10} value={painMax} disabled={disabled} onChange={(event) => setPainMax(event.target.value)} /></div>
        </div>
        {([
          ['chief_complaint', 'Chief complaint'], ['interval_history', 'Interval history'],
          ['review_of_systems', 'Review of systems'], ['video_observations', 'Video-observable findings'],
        ] as const).map(([key, label]) => <div key={key} className="grid gap-2">
          <Label htmlFor={`intake-${key}`}>{label}</Label>
          <Textarea id={`intake-${key}`} value={intake[key]} rows={key === 'interval_history' ? 6 : 3} disabled={disabled} onChange={(event) => { setIntake((value) => ({ ...value, [key]: event.target.value })); setReviewed(false) }} />
        </div>)}
        {encounter.modality === 'telehealth' && <>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={consent} disabled={disabled} onChange={(event) => setConsent(event.target.checked)} /> Telehealth consent obtained</label>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-2"><Label htmlFor="intake-patient-state">Patient location (state)</Label><Input id="intake-patient-state" value={patientState} disabled={disabled} onChange={(event) => setPatientState(event.target.value)} /></div>
            <div className="grid gap-2"><Label htmlFor="intake-provider-location">Provider location</Label><Input id="intake-provider-location" value={providerLocation} disabled={disabled} onChange={(event) => setProviderLocation(event.target.value)} /></div>
            <div className="grid gap-2"><Label htmlFor="intake-connection">Connection method</Label><Input id="intake-connection" value={connection} disabled={disabled} onChange={(event) => setConnection(event.target.value)} placeholder="Secure video" /></div>
          </div>
        </>}
        {!locked && <div><Button variant="outline" onClick={save} disabled={pending || invalidHistoryDate || (sources.length > 0 && !reviewed)}>Save encounter intake</Button></div>}
      </CardContent>
    </Card>
  )
}
