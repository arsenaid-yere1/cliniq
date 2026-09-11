'use client'

import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { normalizeVisitPlan, parseVisitDecision, visitDecisionClosing, visitDecisionLabels, type VisitTreatmentDecision } from '@/lib/validations/visit-treatment-decision'

export function VisitTreatmentDecisionFields({ value, onChange, saved, plan, visitDate, education = '', disabled = false, historical = false }: {
  value: VisitTreatmentDecision
  onChange: (value: VisitTreatmentDecision) => void
  saved: unknown
  plan: string
  visitDate: string | null
  education?: string
  disabled?: boolean
  historical?: boolean
}) {
  const id = useId()
  const confirmed = parseVisitDecision(saved)
  const changed = confirmed && (confirmed.reviewed_plan !== normalizeVisitPlan(plan) || confirmed.visit_date !== visitDate)
  const manualText = education.replace(visitDecisionClosing(confirmed), '')
  const responseNotice = /\bpatient\b[^.!?\n]{0,100}\b(?:agreed|accepted|declined|deferred|consented|elected)\b/i.test(manualText)
  return <section className="space-y-3 rounded-lg border p-4" aria-label="Visit treatment decision">
    <div className="space-y-1">
      <Label htmlFor={`${id}-decision`}>Patient&apos;s decision regarding the treatment plan</Label>
      <p className="text-xs text-muted-foreground" aria-live="polite">{confirmed
        ? `${visitDecisionLabels[confirmed.decision]} · ${historical ? 'Recorded for this note' : 'Saved'} ${new Date(confirmed.confirmed_at).toLocaleString()}`
        : historical ? 'Not documented' : `${visitDecisionLabels[value.decision]} — pending clinician review`}</p>
    </div>
    {changed && <p role="status" className="text-sm text-amber-700">The plan or visit date changed after this decision was recorded. Review the response and save to confirm it applies to the current plan.</p>}
    {responseNotice && <p role="status" className="text-sm text-amber-700">Review existing patient-decision wording in Patient Education against the selected response. Manually entered statements are not automatically removed.</p>}
    {(!historical || confirmed) && <fieldset disabled={disabled || historical} className="space-y-3">
      <legend className="sr-only">Patient treatment decision</legend>
      <select id={`${id}-decision`} className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={value.decision} onChange={(event) => onChange({ ...value, decision: event.target.value as VisitTreatmentDecision['decision'] })}>
        {Object.entries(visitDecisionLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
      {['partially_accepted', 'deferred', 'declined'].includes(value.decision) && <div className="space-y-2">
        <Label htmlFor={`${id}-details`}>{value.decision === 'partially_accepted' ? 'Accepted treatments and limitations (required)' : 'Decision details (optional)'}</Label>
        <Textarea id={`${id}-details`} value={value.details ?? ''} maxLength={2000} rows={2} onChange={(event) => onChange({ ...value, details: event.target.value || null })} />
      </div>}
    </fieldset>}
    {!historical && <p className="text-xs text-muted-foreground">Saving or signing confirms that the selected decision accurately reflects the patient&apos;s response to the plan discussed at this visit. Select Not documented if the response was not established. Saving or signing also confirms that the Patient Education text is accurate, including any statement that the patient verbalized understanding. Review and correct or remove that statement if it does not reflect the encounter.</p>}
  </section>
}
