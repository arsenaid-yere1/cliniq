'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { changePainFollowUpStatus, saveEncounterDiagnoses, updatePainFollowUpEncounter } from '@/actions/clinical-encounters'
import { getEncounterDiagnosisSuggestions, type EncounterDiagnosisSuggestion } from '@/actions/visit-diagnoses'
import { DiagnosisCombobox, type ClinicalDiagnosis } from '@/components/clinical/diagnosis-combobox'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { encounterDateFromLocalDateTime } from '@/lib/clinical/encounter-dates'
import { normalizeVisitDiagnoses } from '@/lib/clinical/visit-diagnoses'
import type { Tables } from '@/types/database'

type Intake = { chief_complaint?: string; interval_history?: string; review_of_systems?: string; video_observations?: string }

export function TelehealthIntakeCard({ caseId, encounter }: { caseId: string; encounter: Tables<'clinical_encounters'> }) {
  const router = useRouter()
  const initial = (encounter.provider_intake ?? {}) as Intake
  const [intake, setIntake] = useState<Intake>(initial)
  const [painMin, setPainMin] = useState(encounter.patient_reported_pain_min?.toString() ?? '')
  const [painMax, setPainMax] = useState(encounter.patient_reported_pain_max?.toString() ?? '')
  const [consent, setConsent] = useState(encounter.telehealth_consent_obtained ?? false)
  const [patientState, setPatientState] = useState(encounter.patient_location_state ?? '')
  const [providerLocation, setProviderLocation] = useState(encounter.provider_location ?? '')
  const [connection, setConnection] = useState(encounter.connection_method ?? '')
  const [scheduledStart, setScheduledStart] = useState(encounter.scheduled_start ? new Date(encounter.scheduled_start).toISOString().slice(0, 16) : '')
  const [pending, setPending] = useState(false)
  const locked = encounter.status === 'completed' || encounter.status === 'cancelled' || encounter.status === 'no_show'
  const [diagnoses, setDiagnoses] = useState<ClinicalDiagnosis[]>(() => {
    try { return normalizeVisitDiagnoses(encounter.diagnoses) }
    catch { return [] }
  })
  const [diagnosisSuggestions, setDiagnosisSuggestions] = useState<EncounterDiagnosisSuggestion[]>([])
  const [diagnosesDirty, setDiagnosesDirty] = useState(false)

  useEffect(() => {
    let active = true
    void getEncounterDiagnosisSuggestions(caseId, encounter.id).then((result) => {
      if (active && !result.error) setDiagnosisSuggestions(result.data)
    })
    return () => { active = false }
  }, [caseId, encounter.id])

  async function run(action: () => Promise<unknown>, message: string) {
    setPending(true)
    const result = await action() as { error?: string }
    setPending(false)
    if (result.error) return toast.error(result.error)
    toast.success(message); router.refresh()
  }

  async function save() {
    const start = scheduledStart ? new Date(scheduledStart) : null
    await run(() => updatePainFollowUpEncounter(caseId, {
      encounter_id: encounter.id,
      scheduled_start: start?.toISOString() ?? null,
      scheduled_end: start ? new Date(start.getTime() + 30 * 60_000).toISOString() : null,
      encounter_date: start
        ? encounterDateFromLocalDateTime(scheduledStart)
        : encounter.encounter_date,
      provider_intake: intake,
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

  async function confirmDiagnoses() {
    setPending(true)
    const result = await saveEncounterDiagnoses(caseId, encounter.id, diagnoses)
    setPending(false)
    if (result.error) return toast.error(result.error)
    setDiagnosesDirty(false)
    toast.success('Visit diagnoses confirmed')
    router.refresh()
  }

  return <div className="grid gap-4"><Card><CardHeader><CardTitle className="text-base">Diagnoses for this visit</CardTitle></CardHeader><CardContent className="grid gap-3">
    <p className="text-sm text-muted-foreground">Historical diagnoses are suggestions only. Select each diagnosis that applies to this encounter, then confirm the list.</p>
    <DiagnosisCombobox
      value={diagnoses}
      suggestions={diagnosisSuggestions}
      disabled={locked || pending}
      onChange={(value) => { setDiagnoses(value); setDiagnosesDirty(true) }}
    />
    <div className="flex flex-wrap items-center gap-3">
      {!locked && <Button variant="outline" onClick={confirmDiagnoses} disabled={pending || (!diagnosesDirty && encounter.diagnoses_confirmed_at !== null)}>
        {encounter.diagnoses_confirmed_at ? 'Reconfirm diagnoses' : 'Confirm diagnoses'}
      </Button>}
      <span className="text-xs text-muted-foreground">
        {encounter.diagnoses_confirmed_at
          ? `Confirmed ${new Date(encounter.diagnoses_confirmed_at).toLocaleString()}`
          : 'Not yet confirmed'}
      </span>
    </div>
  </CardContent></Card><Card><CardHeader><CardTitle className="text-base">Encounter intake</CardTitle></CardHeader><CardContent className="grid gap-4">
    {encounter.status === 'scheduled' && <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => changeStatus('in_progress')} disabled={pending}>Start visit</Button><Button size="sm" variant="outline" onClick={() => changeStatus('no_show')} disabled={pending}>Mark no-show</Button><Button size="sm" variant="ghost" onClick={() => changeStatus('cancelled')} disabled={pending}>Cancel visit</Button></div>}
    <div className="grid gap-2"><Label>Scheduled date and time</Label><Input type="datetime-local" value={scheduledStart} disabled={locked} onChange={(event) => setScheduledStart(event.target.value)} /></div>
    <div className="grid gap-2 md:grid-cols-2"><div className="grid gap-2"><Label>Patient-reported pain minimum</Label><Input type="number" min={0} max={10} value={painMin} disabled={locked} onChange={(event) => setPainMin(event.target.value)} /></div><div className="grid gap-2"><Label>Patient-reported pain maximum</Label><Input type="number" min={0} max={10} value={painMax} disabled={locked} onChange={(event) => setPainMax(event.target.value)} /></div></div>
    <div className="grid gap-2"><Label>Chief complaint</Label><Textarea value={intake.chief_complaint ?? ''} disabled={locked} onChange={(event) => setIntake((value) => ({ ...value, chief_complaint: event.target.value }))} /></div>
    <div className="grid gap-2"><Label>Interval history</Label><Textarea value={intake.interval_history ?? ''} disabled={locked} onChange={(event) => setIntake((value) => ({ ...value, interval_history: event.target.value }))} /></div>
    <div className="grid gap-2"><Label>Review of systems</Label><Textarea value={intake.review_of_systems ?? ''} disabled={locked} onChange={(event) => setIntake((value) => ({ ...value, review_of_systems: event.target.value }))} /></div>
    <div className="grid gap-2"><Label>Video-observable findings</Label><Textarea value={intake.video_observations ?? ''} disabled={locked} onChange={(event) => setIntake((value) => ({ ...value, video_observations: event.target.value }))} /></div>
    {encounter.modality === 'telehealth' && <><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={consent} disabled={locked} onChange={(event) => setConsent(event.target.checked)} /> Telehealth consent obtained</label><div className="grid gap-4 md:grid-cols-3"><div className="grid gap-2"><Label>Patient location (state)</Label><Input value={patientState} disabled={locked} onChange={(event) => setPatientState(event.target.value)} /></div><div className="grid gap-2"><Label>Provider location</Label><Input value={providerLocation} disabled={locked} onChange={(event) => setProviderLocation(event.target.value)} /></div><div className="grid gap-2"><Label>Connection method</Label><Input value={connection} disabled={locked} onChange={(event) => setConnection(event.target.value)} placeholder="Secure video" /></div></div></>}
    {!locked && <div><Button variant="outline" onClick={save} disabled={pending}>Save encounter intake</Button></div>}
  </CardContent></Card></div>
}
