'use client'

import { useId } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { psychologicalAssessmentSchema, defaultPsychologicalAssessment, psychologicalSymptoms, type PsychologicalAssessment } from '@/lib/validations/psychological-assessment'
import type { ProviderIntakeValues } from '@/lib/validations/initial-visit-note'
import { useIntakeSectionSave } from './intake-draft-context'

const formSchema = z.object({ psychological_assessment: psychologicalAssessmentSchema })
type Values = { psychological_assessment: PsychologicalAssessment }
type TextKey = { [K in keyof PsychologicalAssessment]: PsychologicalAssessment[K] extends string ? K : never }[keyof PsychologicalAssessment]
export const psychologicalStatusLabels = {
  not_assessed: 'Not assessed', none_reported: 'No symptoms reported',
  reported: 'Symptoms reported', declined: 'Patient declined to discuss',
}

export function PsychologicalAssessmentCard({ caseId, initialIntake, isLocked, onEditSleep }: {
  caseId: string; initialIntake: ProviderIntakeValues | null; isLocked: boolean; onEditSleep?: () => void
}) {
  const id = useId()
  const form = useForm<Values>({
    resolver: zodResolver(formSchema),
    defaultValues: { psychological_assessment: initialIntake?.psychological_assessment ?? defaultPsychologicalAssessment },
  })
  const { save, isSaving, isDirty, error, hasSaved } = useIntakeSectionSave(form, caseId, 'initial_visit', 'psychological_assessment', initialIntake)
  const value = form.watch('psychological_assessment')
  const text = (key: TextKey, label: string, placeholder?: string) => <FormField key={key} control={form.control} name={`psychological_assessment.${key}`} render={({ field }) => (
    <FormItem><FormLabel>{label}</FormLabel><FormControl><Textarea {...field} rows={2} placeholder={placeholder} /></FormControl><FormMessage /></FormItem>
  )} />
  const select = (key: 'symptom_status' | 'assessment_status' | 'safety_status' | 'follow_up', label: string, options: Record<string, string>) => <FormField control={form.control} name={`psychological_assessment.${key}`} render={({ field }) => (
    <FormItem><FormLabel>{label}</FormLabel><FormControl>
      <select {...field} className="h-10 w-full rounded-md border bg-background px-3 text-sm" onChange={event => {
        const next = event.target.value
        if (key === 'symptom_status' && value.symptom_status === 'reported' && next !== 'reported') {
          const hasDetails = value.symptoms.length || [value.patient_description, value.onset, value.triggers, value.functional_impact, value.sleep_details].some(v => v.trim())
          if (hasDetails && !window.confirm('Clear the reported symptom details and change status?')) return
          form.setValue('psychological_assessment.symptoms', [], { shouldDirty: true })
          for (const name of ['patient_description', 'onset', 'triggers', 'functional_impact', 'sleep_details'] as const) {
            form.setValue(`psychological_assessment.${name}`, '', { shouldDirty: true })
          }
        }
        if (key === 'safety_status' && value.safety_status === 'concerns' && next !== 'concerns') {
          const hasDetails = [value.safety_details, value.safety_actions, value.safety_disposition].some(v => v.trim())
          if (hasDetails && !window.confirm('Clear the safety concern details and change status?')) return
          for (const name of ['safety_details', 'safety_actions', 'safety_disposition'] as const) {
            form.setValue(`psychological_assessment.${name}`, '', { shouldDirty: true })
          }
        }
        if (key === 'follow_up' && next === 'not_documented' && (value.referral_reason || value.follow_up_timeframe)) {
          if (!window.confirm('Clear the follow-up details and mark the plan not documented?')) return
          form.setValue('psychological_assessment.referral_reason', '', { shouldDirty: true })
          form.setValue('psychological_assessment.follow_up_timeframe', '', { shouldDirty: true })
        }
        field.onChange(next)
      }}>{Object.entries(options).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
    </FormControl><FormMessage /></FormItem>
  )} />

  return <Form {...form}>
    <form onSubmit={event => { event.preventDefault(); void save() }} className="space-y-4">
      <fieldset disabled={isLocked || isSaving} className="min-w-0 space-y-4">
        <Card>
          <CardHeader><CardTitle>Patient-reported concerns</CardTitle><CardDescription>Record what the patient reports today. Symptom selections do not establish a diagnosis.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {select('symptom_status', 'Symptoms discussed today', psychologicalStatusLabels)}
            {value.symptom_status === 'reported' && <div className="space-y-4">
              <fieldset><legend className="mb-2 text-sm font-medium">Reported symptoms</legend><div className="grid gap-2 sm:grid-cols-2">
                {psychologicalSymptoms.map((symptom, index) => <label key={symptom} htmlFor={`${id}-${index}`} className="flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <input id={`${id}-${index}`} type="checkbox" checked={value.symptoms.includes(symptom)} onChange={event => form.setValue('psychological_assessment.symptoms', event.target.checked ? [...value.symptoms, symptom] : value.symptoms.filter(s => s !== symptom), { shouldDirty: true, shouldValidate: true })} />{symptom}
                </label>)}
              </div></fieldset>
              {text('patient_description', 'Patient description', 'Describe the concerns in the patient\'s own words.')}
              <div className="grid gap-4 sm:grid-cols-2">{text('onset', 'Onset and course', 'New, pre-existing, worsened, or unclear; include timing.')}{text('triggers', 'Frequency and triggers')}</div>
              {text('functional_impact', 'Impact on daily life', 'Work, travel, relationships, daily activities or self-care.')}
              {text('sleep_details', 'Sleep details and reported contributors', 'Difficulty falling/staying asleep, nightmares; pain, anxiety, both, or unclear.')}
            </div>}
            <div className="rounded-md bg-muted/40 p-3 text-sm">
              <p>Saved Sleep Disturbance in Chief Complaints: {initialIntake ? initialIntake.chief_complaints.sleep_disturbance ? 'Yes' : 'No (may be the default)' : 'Not saved'}</p>
              {onEditSleep && <Button type="button" variant="link" className="h-auto p-0 mt-1" onClick={onEditSleep}>Edit in Chief Complaints</Button>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Clinician assessment</CardTitle><CardDescription>Keep observed findings separate from reported symptoms and clinical interpretation.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {select('assessment_status', 'Assessment status', { not_assessed: 'Not assessed', partial: 'Partial assessment', assessed: 'Assessed today' })}
            {text('observations', 'Observed mood, affect and behavior', 'Only findings actually observed during this visit.')}
            {text('clinical_impression', 'Clinical impression', 'Interpretation, uncertainty and rationale.')}
            <details className="rounded-md border p-3"><summary className="cursor-pointer text-sm font-medium">Relevant history and confirmed diagnoses (optional)</summary><div className="mt-4 space-y-4">
              {initialIntake?.past_medical_history.medical_conditions && <p className="text-sm text-muted-foreground">Medical history on file: {initialIntake.past_medical_history.medical_conditions}</p>}
              {text('relevant_history', 'Relevant prior history and care', 'Distinguish pre-existing concerns from the current presentation.')}
              {text('confirmed_diagnoses', 'Clinician-confirmed psychological diagnoses', 'Enter only diagnoses you have established; include codes if known.')}
            </div></details>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Safety and follow-up</CardTitle><CardDescription>Document your assessment and actions. This is not a screening questionnaire or risk score.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {select('safety_status', 'Safety assessment', { not_assessed: 'Not assessed', no_concerns: 'Assessed - no concerns identified', concerns: 'Concerns identified', unable: 'Unable to assess' })}
            {value.safety_status === 'concerns' && <div className="space-y-4 rounded-md border border-amber-500/50 p-4">
              <p className="text-sm font-medium">Safety concern documented: review actions and disposition before finalizing.</p>
              {text('safety_details', 'Safety concern')}{text('safety_actions', 'Actions taken', 'Record actions or explain why not available.')}{text('safety_disposition', 'Disposition and follow-up', 'Record disposition or explain why not available.')}
            </div>}
            {select('follow_up', 'Follow-up plan', { not_documented: 'Not documented', monitor: 'Monitor / reassess', discuss_referral: 'Discuss referral', referral_recommended: 'Referral recommended', existing_care: 'Already receiving care', other: 'Other' })}
            {value.follow_up !== 'not_documented' && <>
              {text('referral_reason', 'Follow-up details and referral rationale', 'A recommendation here does not create a referral order.')}
              {text('follow_up_timeframe', 'Reassessment timeframe')}
            </>}
            <details className="rounded-md border p-3"><summary className="cursor-pointer text-sm font-medium">Education and patient response (optional)</summary><div className="mt-4 space-y-4">{text('education', 'Education actually provided')}{text('patient_response', 'Documented patient response')}</div></details>
          </CardContent>
        </Card>
        {!isLocked && <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-4">
          <p role="status" aria-live="polite" className="text-sm">{isSaving ? 'Saving...' : error ? `Save failed: ${error}` : isDirty ? 'Unsaved changes' : hasSaved || initialIntake?.psychological_assessment ? 'Saved (does not indicate clinical completion)' : 'Not yet saved'}</p>
          <Button type="submit" disabled={isSaving}>{error ? 'Retry save' : 'Save Psychological Assessment'}</Button>
        </div>}
      </fieldset>
    </form>
  </Form>
}
