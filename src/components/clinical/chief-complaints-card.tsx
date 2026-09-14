'use client'

import { useId, useRef, useState } from 'react'
import { useFieldArray, useForm, useWatch, type UseFormReturn } from 'react-hook-form'
import { ChevronDown, ChevronRight, Loader2, Plus, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { defaultProviderIntake, type ProviderIntakeValues } from '@/lib/validations/initial-visit-note'
import type { NoteVisitType } from '@/lib/claude/generate-initial-visit'
import { complaintRegionOptions, getComplaintRegion, setComplaintSide, type ComplaintSide } from '@/lib/clinical/complaint-factor-hints'
import { complaintRadiationRegionOptions, getComplaintRadiationRegion } from '@/lib/clinical/complaint-radiation-hints'
import { useIntakeDrafts, useIntakeSectionSave } from './intake-draft-context'
import { ComplaintFactorField } from './complaint-factor-field'
import { ComplaintRadiationField } from './complaint-radiation-field'

type Values = Pick<ProviderIntakeValues, 'chief_complaints'>

export function ChiefComplaintsCard({ caseId, visitType, initialIntake, isLocked }: {
  caseId: string
  visitType: NoteVisitType
  initialIntake: ProviderIntakeValues | null
  isLocked: boolean
}) {
  const form = useForm<Values>({ defaultValues: { chief_complaints: initialIntake?.chief_complaints ?? defaultProviderIntake.chief_complaints } })
  const complaints = useFieldArray({ control: form.control, name: 'chief_complaints.complaints' })
  const { save, isSaving, isDirty, error, hasSaved } = useIntakeSectionSave(form, caseId, visitType, 'chief_complaints', initialIntake)
  const { busy } = useIntakeDrafts()
  const disabled = isLocked || isSaving || busy
  const container = useRef<HTMLDivElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  function remove(index: number) {
    if (disabled) return
    const next = complaints.fields[index + 1]?.id ?? complaints.fields[index - 1]?.id
    complaints.remove(index)
    // Surviving row buttons remain mounted and retain identity across index changes.
    const toggle = Array.from(container.current?.querySelectorAll<HTMLButtonElement>('[data-complaint-toggle]') ?? [])
      .find(button => button.dataset.complaintToggle === next)
    const focusTarget = toggle ?? addButton.current
    focusTarget?.focus()
  }

  return <Card>
    <CardHeader>
      <CardDescription>Document body regions, pain character, severity, and what changes the patient&apos;s symptoms.</CardDescription>
    </CardHeader>
    <CardContent ref={container}>
      <Form {...form}>
        <div className="space-y-4">
          {complaints.fields.map((field, index) => <ComplaintRow key={field.id} rowId={field.id} form={form} index={index}
            disabled={disabled} canRemove={complaints.fields.length > 1} onRemove={() => remove(index)} />)}
          <Button ref={addButton} type="button" variant="outline" size="sm" disabled={disabled} onClick={() => {
            if (disabled) return
            complaints.append({ ...defaultProviderIntake.chief_complaints.complaints[0] }, {
              focusName: `chief_complaints.complaints.${complaints.fields.length}.body_region`,
            })
          }}><Plus className="size-4" />Add Complaint</Button>
          <fieldset disabled={disabled} className="space-y-4 border-t pt-4">
            <FormField control={form.control} name="chief_complaints.sleep_disturbance" render={({ field }) => <FormItem>
              <FormLabel>Sleep Disturbance</FormLabel><FormControl>
                <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={field.value ? 'yes' : 'no'}
                  onChange={event => field.onChange(event.target.value === 'yes')}>
                  <option value="no">No</option><option value="yes">Yes</option>
                </select>
              </FormControl>
            </FormItem>} />
            <FormField control={form.control} name="chief_complaints.additional_notes" render={({ field }) => <FormItem>
              <FormLabel>Additional Notes</FormLabel><FormControl><Textarea {...field} value={field.value ?? ''} rows={2}
                placeholder="Any additional details about symptoms…" onChange={event => field.onChange(event.target.value || null)} /></FormControl>
            </FormItem>} />
          </fieldset>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p role="status" className="text-sm text-muted-foreground">{isSaving ? 'Saving…' : error ? 'Save failed' : isDirty ? 'Unsaved changes' : hasSaved || initialIntake ? 'Saved' : 'Not saved yet'}</p>
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => { if (!disabled) void save() }}>
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {error ? 'Retry Save Chief Complaints' : 'Save Chief Complaints'}
            </Button>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
      </Form>
    </CardContent>
  </Card>
}

function ComplaintRow({ form, index, rowId, disabled, canRemove, onRemove }: {
  form: UseFormReturn<Values>; index: number; rowId: string; disabled: boolean; canRemove: boolean; onRemove: () => void
}) {
  const id = useId()
  const [expanded, setExpanded] = useState(true)
  const value = useWatch({ control: form.control, name: `chief_complaints.complaints.${index}` })
  const [initialRegion] = useState(value.body_region)
  const region = getComplaintRegion(value.body_region)
  const radiationRegion = getComplaintRadiationRegion(value.body_region)
  const base = `chief_complaints.complaints.${index}` as const
  const severity = value.severity_min === null && value.severity_max === null ? 'Not entered'
    : `${value.severity_min ?? '—'}–${value.severity_max ?? '—'}/10`

  return <section aria-label={`Complaint ${index + 1}`} className="min-w-0 rounded-lg border p-4">
    <div className="flex items-start justify-between gap-2">
      <Button type="button" variant="ghost" className="h-auto min-w-0 justify-start whitespace-normal px-0 text-left hover:bg-transparent"
        data-complaint-toggle={rowId} aria-label={`Complaint ${index + 1} details`} aria-expanded={expanded} aria-controls={`${id}-content`}
        onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
        <span className="min-w-0 break-words">Complaint {index + 1}{value.body_region ? ` · ${value.body_region}` : ''}</span>
      </Button>
      {canRemove && <Button type="button" variant="ghost" size="icon" className="shrink-0" disabled={disabled}
        aria-label={`Remove complaint ${index + 1}`} onClick={onRemove}><Trash2 className="size-4" /></Button>}
    </div>
    {!expanded && <div className="mt-2 space-y-1 break-words text-sm text-muted-foreground">
      <p>{value.body_region || 'Region: Not entered'} · {value.pain_character || 'Character: Not entered'} · {severity}</p>
      <p>Worse with: {value.aggravating_factors || 'Not entered'}</p><p>Better with: {value.alleviating_factors || 'Not entered'}</p>
      <p>Radiates to: {value.radiates_to || 'Not entered'}</p>
    </div>}
    <div id={`${id}-content`} hidden={!expanded} className="mt-3 space-y-4">
      <fieldset disabled={disabled} className="grid min-w-0 gap-3 sm:grid-cols-2">
        <FormField control={form.control} name={`${base}.body_region`} render={({ field }) => <FormItem>
          <FormLabel>Body Region</FormLabel><FormControl><Input {...field} list={`${id}-regions`} placeholder="Search or enter a region" /></FormControl>
          <datalist id={`${id}-regions`}>
            {[...new Set([...complaintRegionOptions(field.value), ...complaintRadiationRegionOptions(field.value)])].map(option => <option key={option} value={option} />)}
          </datalist>
        </FormItem>} />
        <div className="grid gap-2">
          <label htmlFor={`${id}-side`} className="text-sm font-medium">Side</label>
          <select id={`${id}-side`} className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={region.side}
            disabled={disabled || region.key === 'general'} aria-describedby={region.key === 'general' ? `${id}-side-help` : undefined}
            onChange={event => { if (!disabled) form.setValue(`${base}.body_region`, setComplaintSide(value.body_region, event.target.value as ComplaintSide), { shouldDirty: true }) }}>
            <option value="">Not specified</option><option value="left">Left</option><option value="right">Right</option><option value="bilateral">Both sides</option>
          </select>
          {region.key === 'general' && <p id={`${id}-side-help`} className="text-xs text-muted-foreground">Include side in the region text.</p>}
        </div>
        <FormField control={form.control} name={`${base}.pain_character`} render={({ field }) => <FormItem>
          <FormLabel>Pain Character</FormLabel><Select disabled={disabled} value={field.value || ''} onValueChange={next => { if (!disabled) field.onChange(next) }}>
            <FormControl><SelectTrigger className="w-full"><SelectValue placeholder="Select…" /></SelectTrigger></FormControl>
            <SelectContent>{['sharp', 'dull', 'burning', 'aching', 'throbbing', 'stabbing'].map(character => <SelectItem key={character} value={character}>{character.charAt(0).toUpperCase() + character.slice(1)}</SelectItem>)}</SelectContent>
          </Select>
        </FormItem>} />
        <FormField control={form.control} name={`${base}.is_persistent`} render={({ field }) => <FormItem>
          <FormLabel>Pattern</FormLabel><FormControl><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={field.value ? 'persistent' : 'intermittent'}
            onChange={event => field.onChange(event.target.value === 'persistent')}><option value="persistent">Persistent</option><option value="intermittent">Intermittent</option></select></FormControl>
        </FormItem>} />
        {(['severity_min', 'severity_max'] as const).map(key => <FormField key={key} control={form.control} name={`${base}.${key}`} render={({ field }) => <FormItem>
          <FormLabel>{key === 'severity_min' ? 'Severity Min (0-10)' : 'Severity Max (0-10)'}</FormLabel><FormControl><Input {...field} type="number" min={0} max={10}
            value={field.value ?? ''} placeholder="0–10" onChange={event => field.onChange(event.target.value === '' ? null : Number(event.target.value))} /></FormControl>
        </FormItem>} />)}
        <FormField key={`radiates-${value.body_region}`} control={form.control} name={`${base}.radiates_to`} render={({ field }) => <ComplaintRadiationField
          field={{ ...field, value: field.value ?? '', onChange: next => field.onChange(next || null), onBlur: field.onBlur }}
          label="Pain Radiates To"
          examples={radiationRegion.destinations}
          regionLabel={radiationRegion.label}
          className="sm:col-span-2"
          disabled={disabled} />} />
      </fieldset>
      {value.body_region !== initialRegion && (value.aggravating_factors || value.alleviating_factors) && <p className="text-xs text-muted-foreground">Existing factors kept—review for this region.</p>}
      <FormField control={form.control} name={`${base}.aggravating_factors`} render={({ field }) => <ComplaintFactorField key={`worse-${value.body_region}`} field={field}
        label="Aggravating Factors" heading="Worse with" examples={region.hints.worse} regionLabel={region.hints.label} disabled={disabled} />} />
      <FormField control={form.control} name={`${base}.alleviating_factors`} render={({ field }) => <ComplaintFactorField key={`better-${value.body_region}`} field={field}
        label="Alleviating Factors" heading="Better with" examples={region.hints.better} regionLabel={region.hints.label} disabled={disabled} />} />
    </div>
  </section>
}
