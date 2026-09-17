'use client'

import { useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { FormControl, FormDescription, FormItem, FormLabel } from '@/components/ui/form'
import { completeExamExample, completionFields, getExamExamples, getExamRegion, type ExamExample, type ExamField } from '@/lib/clinical/exam-finding-examples'
import { appendExamPhrase, conflictingExamSegments, hasExamPhrase, removeExamPhrase, replaceConflictingExamPhrases } from '@/lib/clinical/exam-finding-text'

interface Props {
  field: { value: string; onChange: (value: string) => void; onBlur: () => void; name: string; ref: (element: HTMLTextAreaElement | null) => void }
  label: string
  kind: ExamField
  region?: string
  disabled: boolean
  isSaving: boolean
}

export function ExamFindingField({ field, label, kind, region = '', disabled, isSaving }: Props) {
  const id = useId()
  const textarea = useRef<HTMLTextAreaElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const [more, setMore] = useState(false)
  const [generic, setGeneric] = useState(false)
  const [query, setQuery] = useState('')
  const [example, setExample] = useState<ExamExample | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [showErrors, setShowErrors] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [undo, setUndo] = useState<string | null>(null)
  const [observed, setObserved] = useState({ value: field.value, region, disabled, isSaving })
  // Clear ephemeral work on external changes and save/lock boundaries, including
  // a same-value save. Internal edits advance observed.value themselves.
  if (observed.value !== field.value || observed.region !== region || observed.disabled !== disabled || observed.isSaving !== isSaving) {
    setObserved({ value: field.value, region, disabled, isSaving })
    setExample(null)
    setPending(null)
    setUndo(null)
  }
  const examples = getExamExamples(kind, region, generic)
  const unknown = !getExamRegion(region) && (kind === 'palpation_findings' || kind === 'additional_findings')
  const completion = example ? completeExamExample(example, values, region) : null
  const fields = example ? completionFields(example, region) : []

  function change(next: string, remember = true) {
    if (disabled) return
    if (next === field.value) { setPending(null); setExample(null); return }
    setUndo(remember ? field.value : null)
    setObserved({ value: next, region, disabled, isSaving })
    setPending(null)
    setExample(null)
    field.onChange(next)
  }
  function cancel() {
    setExample(null)
    setPending(null)
    trigger.current?.focus()
  }
  function insert(text: string) {
    if (disabled) return
    if (conflictingExamSegments(field.value, text, kind).length) { setPending(text); return }
    change(appendExamPhrase(field.value, text))
    textarea.current?.focus()
  }
  function chip(item: ExamExample) {
    const direct = completionFields(item, region).length === 0
    const selected = direct && hasExamPhrase(field.value, item.template)
    return <Button key={item.id} type="button" variant="outline" size="sm" disabled={disabled}
      aria-pressed={direct ? selected : undefined}
      className={`h-auto min-h-9 whitespace-normal rounded-full px-3 py-2 text-xs [@media(pointer:coarse)]:min-h-11 ${selected ? 'border-primary bg-primary/10' : ''}`}
      onClick={event => {
        if (disabled) return
        trigger.current = event.currentTarget
        setPending(null)
        if (direct) {
          if (selected) change(removeExamPhrase(field.value, item.template))
          else insert(item.template)
        } else { setExample(item); setValues({}); setShowErrors(false) }
      }}>{selected ? '✓ ' : '+ '}{item.label}</Button>
  }
  const filtered = examples.filter(item => `${item.label} ${item.group} ${item.template} ${completionFields(item, region).flatMap(input => input.suggestions ?? []).join(' ')}`.toLowerCase().includes(query.toLowerCase().trim()))
  return <FormItem>
    <FormLabel>{label}</FormLabel>
    <div className="flex flex-wrap gap-2" role="group" aria-label={`${label} examples`}>{examples.slice(0, 3).map(chip)}</div>
    {unknown && <div className="text-xs text-muted-foreground">
      <p>No specific examples for this region. You can enter your findings below.</p>
      <Button type="button" variant="link" className="h-auto px-0 text-xs" disabled={disabled} aria-expanded={generic}
        onClick={() => { setGeneric(!generic); setMore(false) }}>{generic ? 'Hide general examples' : 'Show general examples'}</Button>
    </div>}
    {examples.length > 3 && <Button type="button" variant="link" className="h-auto justify-self-start px-0 text-xs" disabled={disabled}
      aria-expanded={more} aria-controls={`${id}-library`} onClick={() => setMore(!more)}>{more ? 'Fewer examples' : `More examples (${examples.length})`}</Button>}
    {more && <div id={`${id}-library`} className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <label htmlFor={`${id}-search`} className="text-xs font-medium">Search {label.toLowerCase()} examples</label>
      <Input id={`${id}-search`} disabled={disabled} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search observations or tests…" />
      {Array.from(new Set(filtered.map(item => item.group))).map(group => <div key={group} className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">{group}</p>
        <div className="flex flex-wrap gap-2">{filtered.filter(item => item.group === group).map(chip)}</div>
      </div>)}
      {!filtered.length && <p className="text-sm text-muted-foreground">No matching examples. Enter your own finding below.</p>}
    </div>}
    {example && <div role="group" aria-label={`Complete ${example.label}`} className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4"
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel() } }}>
      <p className="text-sm font-semibold">{example.label}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((input, index) => <div key={input.key} className="min-w-0 space-y-1">
          <label htmlFor={`${id}-${input.key}`} className="text-xs font-medium">{input.label}{input.optional ? ' (optional)' : ''}</label>
          {input.options ? <select id={`${id}-${input.key}`} autoFocus={index === 0} disabled={disabled} value={values[input.key] ?? ''}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm" aria-invalid={showErrors && !!completion?.errors[input.key]}
            aria-describedby={showErrors && completion?.errors[input.key] ? `${id}-${input.key}-error` : undefined}
            onChange={event => { setValues({ ...values, [input.key]: event.target.value }); setPending(null) }}>
            <option value="">Choose…</option>{input.options.map(option => <option key={option} value={option}>{option}</option>)}
          </select> : <Input id={`${id}-${input.key}`} autoFocus={index === 0} disabled={disabled} value={values[input.key] ?? ''}
            type={input.numeric ? 'number' : 'text'} min={input.numeric ? 0 : undefined} step={input.numeric ? 'any' : undefined}
            list={input.suggestions ? `${id}-${input.key}-options` : undefined} aria-invalid={showErrors && !!completion?.errors[input.key]}
            aria-describedby={showErrors && completion?.errors[input.key] ? `${id}-${input.key}-error` : undefined}
            onChange={event => { setValues({ ...values, [input.key]: event.target.value }); setPending(null) }} />}
          {input.suggestions && <datalist id={`${id}-${input.key}-options`}>{input.suggestions.map(option => <option key={option} value={option} />)}</datalist>}
          {showErrors && completion?.errors[input.key] && <p id={`${id}-${input.key}-error`} className="text-xs text-destructive">{completion.errors[input.key]}</p>}
        </div>)}
      </div>
      <p className="break-words text-sm" aria-live="polite"><span className="font-medium">Preview: </span>{completion?.text ?? 'Complete the details to preview this finding.'}</p>
      {!pending && <div className="flex gap-2"><Button type="button" size="sm" disabled={disabled} onClick={() => {
        setShowErrors(true)
        if (completion?.text) insert(completion.text)
      }}>Insert finding</Button><Button type="button" size="sm" variant="outline" disabled={disabled} onClick={cancel}>Cancel</Button></div>}
    </div>}
    {pending && <div role="group" aria-label={`Conflicting ${label.toLowerCase()}`} className="space-y-2 rounded-lg border p-3"
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); cancel() } }}>
      <p className="text-sm">This conflicts with an existing example for the same examination scope:</p>
      <ul className="list-inside list-disc break-words text-sm">{conflictingExamSegments(field.value, pending, kind).map(item => <li key={item.start}>{item.text.trim()}</li>)}</ul>
      <p className="break-words text-sm">Replace with: {pending}</p>
      <div className="flex gap-2"><Button type="button" size="sm" disabled={disabled} onClick={() => {
        change(replaceConflictingExamPhrases(field.value, pending, kind)); textarea.current?.focus()
      }}>Replace</Button><Button type="button" size="sm" variant="outline" disabled={disabled} onClick={cancel}>Cancel</Button></div>
    </div>}
    <FormControl><Textarea {...field} ref={element => {
      textarea.current = element
      field.ref(element)
    }} disabled={disabled} rows={2} onChange={event => change(event.target.value, false)} placeholder="Select an example or enter your findings…" /></FormControl>
    <FormDescription>Use only findings you observed. All text remains editable.</FormDescription>
    {undo !== null && <div role="status" className="flex items-center gap-2 text-xs text-muted-foreground">Finding updated.
      <Button type="button" variant="link" size="sm" disabled={disabled} onClick={() => { change(undo, false); textarea.current?.focus() }}>Undo</Button>
    </div>}
  </FormItem>
}
