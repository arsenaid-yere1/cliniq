'use client'

import { useId, useRef, useState } from 'react'
import { useFieldArray, useForm, useWatch, type UseFormReturn } from 'react-hook-form'
import { ChevronDown, ChevronRight, Loader2, Plus, Save, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form'
import { chiefComplaintsSchema, defaultProviderIntake, type ProviderIntakeValues } from '@/lib/validations/initial-visit-note'
import type { NoteVisitType } from '@/lib/claude/generate-initial-visit'
import { examRegionOptions } from '@/lib/clinical/exam-finding-examples'
import { populateExamFindings } from '@/lib/clinical/populate-exam-findings'
import { useIntakeDrafts, useIntakeSectionSave } from './intake-draft-context'
import { ExamFindingField } from './exam-finding-field'

type Values = Pick<ProviderIntakeValues, 'exam_findings'>
export function ExamFindingsCard({ caseId, visitType, initialIntake, isLocked }: {
  caseId: string; visitType: NoteVisitType; initialIntake: ProviderIntakeValues | null; isLocked: boolean
}) {
  const id = useId()
  const form = useForm<Values>({ defaultValues: { exam_findings: initialIntake?.exam_findings ?? defaultProviderIntake.exam_findings } })
  const regions = useFieldArray({ control: form.control, name: 'exam_findings.regions' })
  const { save, isSaving, isDirty, error, hasSaved } = useIntakeSectionSave(form, caseId, visitType, 'exam_findings', initialIntake)
  const { busy, readSection } = useIntakeDrafts()
  const disabled = isLocked || isSaving || busy
  const [newRowIndex, setNewRowIndex] = useState<number | null>(null)
  const [observedSaving, setObservedSaving] = useState(isSaving)
  if (observedSaving !== isSaving) {
    setObservedSaving(isSaving)
    if (isSaving) setNewRowIndex(null)
  }
  const [adding, setAdding] = useState(false)
  const [regionName, setRegionName] = useState('')
  const [populateMessage, setPopulateMessage] = useState('')
  const addButton = useRef<HTMLButtonElement>(null)
  const container = useRef<HTMLDivElement>(null)
  function populate() {
    if (disabled) return
    const complaints = chiefComplaintsSchema.safeParse(readSection('chief_complaints') ?? initialIntake?.chief_complaints ?? defaultProviderIntake.chief_complaints)
    if (!complaints.success) {
      setPopulateMessage('Check Chief Complaints pain levels: use whole numbers from 0–10.')
      return
    }
    try {
      const current = form.getValues('exam_findings')
      const next = populateExamFindings(current, complaints.data.complaints)
      if (JSON.stringify(current) === JSON.stringify(next)) {
        setPopulateMessage('Matching areas already exist. Existing findings were kept; add pain levels for examples in empty fields.')
        return
      }
      for (const key of ['general_appearance', 'neurological_notes'] as const) {
        if (next[key] !== current[key]) form.setValue(`exam_findings.${key}`, next[key], { shouldDirty: true })
      }
      current.regions.forEach((row, index) => {
        for (const key of ['palpation_findings', 'additional_findings'] as const) {
          if (row[key] !== next.regions[index][key]) form.setValue(`exam_findings.regions.${index}.${key}`, next.regions[index][key], { shouldDirty: true })
        }
      })
      const added = next.regions.slice(current.regions.length)
      if (added.length) {
        setNewRowIndex(current.regions.length)
        regions.append(added, { focusName: `exam_findings.regions.${current.regions.length}.palpation_findings` })
      }
      setPopulateMessage('Example findings applied to the form. Existing text kept. Areas without a positive pain level remain blank.')
    } catch (error) {
      setPopulateMessage(error instanceof Error ? error.message : 'Could not populate example findings.')
    }
  }
  function add() {
    if (disabled || !regionName.trim()) return
    setNewRowIndex(regions.fields.length)
    regions.append({ region: regionName.trim(), palpation_findings: '', muscle_spasm: null, additional_findings: null }, {
      focusName: `exam_findings.regions.${regions.fields.length}.palpation_findings`,
    })
    setRegionName('')
    setAdding(false)
  }
  function remove(index: number) {
    if (disabled) return
    const next = regions.fields[index + 1]?.id ?? regions.fields[index - 1]?.id
    regions.remove(index)
    const toggle = Array.from(container.current?.querySelectorAll<HTMLButtonElement>('[data-exam-toggle]') ?? []).find(button => button.dataset.examToggle === next)
    const focusTarget = toggle ?? addButton.current
    focusTarget?.focus()
  }
  return <Card>
    <CardHeader><CardDescription>Document observed findings. Choose a region for relevant examples, or write in your own words.</CardDescription></CardHeader>
    <CardContent ref={container}><Form {...form}><div className="space-y-5">
      <div className="space-y-2">
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={populate}><Sparkles className="size-4" />Generate Example Findings</Button>
        <p className="text-xs text-muted-foreground">Fill empty fields from Chief Complaints and pain levels. Review examples against your examination before saving.</p>
        {populateMessage && <p role="status" className="text-sm text-muted-foreground">{populateMessage}</p>}
      </div>
      <FormField control={form.control} name="exam_findings.general_appearance" render={({ field }) => <ExamFindingField
        field={{ ...field, value: field.value ?? '', onChange: next => field.onChange(next || null) }} label="General Appearance" kind="general_appearance" disabled={disabled} isSaving={isSaving} />} />
      <div className="space-y-3 border-y py-4">
        <h3 className="text-sm font-semibold">Examination Regions</h3>
        {!regions.fields.length && <p className="text-sm text-muted-foreground">No regions added. Add an examined region to begin.</p>}
        {regions.fields.map((field, index) => <ExamRegionRow key={field.id} rowId={field.id} index={index} form={form}
          initiallyExpanded={index === 0 || index === newRowIndex} disabled={disabled} isSaving={isSaving} onRemove={() => remove(index)} />)}
        {adding && <div className="space-y-2 rounded-lg border p-3" onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); setAdding(false); addButton.current?.focus() }
          if (event.key === 'Enter') { event.preventDefault(); add() }
        }}>
          <label className="text-sm font-medium" htmlFor={`${id}-new-region`}>Region to examine</label>
          <Input id={`${id}-new-region`} autoFocus disabled={disabled} value={regionName} onChange={event => setRegionName(event.target.value)}
            list={`${id}-regions`} placeholder="Search or enter a region" />
          <datalist id={`${id}-regions`}>{examRegionOptions.map(option => <option key={option} value={option} />)}</datalist>
          <div className="flex gap-2"><Button type="button" size="sm" disabled={disabled || !regionName.trim()} onClick={add}>Add region</Button>
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => { setAdding(false); addButton.current?.focus() }}>Cancel</Button></div>
        </div>}
        <Button ref={addButton} type="button" variant="outline" size="sm" disabled={disabled} aria-expanded={adding} onClick={() => setAdding(true)}><Plus className="size-4" />Add Exam Region</Button>
      </div>
      <FormField control={form.control} name="exam_findings.neurological_notes" render={({ field }) => <ExamFindingField
        field={{ ...field, value: field.value ?? '', onChange: next => field.onChange(next || null) }} label="Neurological Notes" kind="neurological_notes" disabled={disabled} isSaving={isSaving} />} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p role="status" className="text-sm text-muted-foreground">{isSaving ? 'Saving…' : error ? 'Save failed' : isDirty ? 'Unsaved changes' : hasSaved || initialIntake ? 'Saved' : 'Not saved yet'}</p>
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => { if (!disabled) void save() }}>
          {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}{error ? 'Retry Save Exam Findings' : 'Save Exam Findings'}
        </Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div></Form></CardContent>
  </Card>
}

function ExamRegionRow({ form, index, rowId, initiallyExpanded, disabled, isSaving, onRemove }: {
  form: UseFormReturn<Values>; index: number; rowId: string; initiallyExpanded: boolean; disabled: boolean; isSaving: boolean; onRemove: () => void
}) {
  const id = useId()
  const [expanded, setExpanded] = useState(initiallyExpanded)
  const base = `exam_findings.regions.${index}` as const
  const value = useWatch({ control: form.control, name: base })
  const [initialRegion] = useState(value.region)
  return <section aria-label={`Exam region ${index + 1}`} className="min-w-0 rounded-lg border p-4">
    <div className="flex items-start justify-between gap-2">
      <Button type="button" variant="ghost" className="h-auto min-w-0 justify-start whitespace-normal px-0 text-left hover:bg-transparent"
        data-exam-toggle={rowId} aria-label={`Exam region ${index + 1} details`} aria-expanded={expanded} aria-controls={`${id}-content`} onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}<span className="min-w-0 break-words">{value.region || `Exam region ${index + 1}`}</span>
      </Button>
      <Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label={`Remove exam region ${index + 1}`} onClick={onRemove}><Trash2 className="size-4" /></Button>
    </div>
    {!expanded && !value.palpation_findings && !value.additional_findings && value.muscle_spasm === null && <p className="mt-2 text-sm text-muted-foreground">No findings entered.</p>}
    {!expanded && <div className="mt-2 space-y-1 break-words text-sm text-muted-foreground"><p>{value.palpation_findings || 'Palpation: Not entered'}</p>
      <p>Muscle spasm: {value.muscle_spasm === null ? 'Not assessed' : value.muscle_spasm ? 'Present' : 'Absent'}</p><p>{value.additional_findings || 'Additional findings: Not entered'}</p></div>}
    <div hidden={!expanded} id={`${id}-content`} className="mt-3 space-y-4">
      <FormField control={form.control} name={`${base}.region`} render={({ field }) => <FormItem><FormLabel>Region</FormLabel>
        <FormControl><Input {...field} disabled={disabled} list={`${id}-regions`} /></FormControl><datalist id={`${id}-regions`}>{examRegionOptions.map(option => <option key={option} value={option} />)}</datalist>
      </FormItem>} />
      {initialRegion !== value.region && (value.palpation_findings || value.additional_findings || value.muscle_spasm !== null) && <p className="text-xs text-muted-foreground">Region changed. Review retained findings.</p>}
      <FormField control={form.control} name={`${base}.palpation_findings`} render={({ field }) => <ExamFindingField key={`palpation-${value.region}`}
        field={field} label="Palpation Findings" kind="palpation_findings" region={value.region} disabled={disabled} isSaving={isSaving} />} />
      <FormField control={form.control} name={`${base}.muscle_spasm`} render={({ field }) => <fieldset disabled={disabled} className="space-y-2">
        <legend className="text-sm font-medium">Muscle Spasm</legend><div className="flex flex-wrap gap-2">
          {[{ label: 'Not assessed', value: null }, { label: 'Absent', value: false }, { label: 'Present', value: true }].map(option => <label key={option.label}
            className={`flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-sm ${field.value === option.value ? 'border-primary bg-primary/5' : ''}`}>
            <input type="radio" name={`${id}-spasm`} value={String(option.value)} checked={field.value === option.value} onBlur={field.onBlur}
              ref={option.value === null ? field.ref : undefined} onChange={() => field.onChange(option.value)} />{option.label}
          </label>)}
        </div></fieldset>} />
      <FormField control={form.control} name={`${base}.additional_findings`} render={({ field }) => <ExamFindingField key={`additional-${value.region}`}
        field={{ ...field, value: field.value ?? '', onChange: next => field.onChange(next || null) }} label="Additional Findings" kind="additional_findings" region={value.region} disabled={disabled} isSaving={isSaving} />} />
    </div>
  </section>
}
