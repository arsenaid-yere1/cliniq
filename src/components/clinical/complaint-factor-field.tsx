'use client'

import { useId, useState, type Ref } from 'react'
import { Check, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { FormControl, FormDescription, FormItem, FormLabel } from '@/components/ui/form'
import { factorStatuses, hasFactorExample, isFactorStatus, toggleFactorExample, type FactorStatus } from '@/lib/clinical/complaint-factor-text'

interface Props {
  field: { value: string; onChange: (value: string) => void; onBlur: () => void; name: string; ref: Ref<HTMLTextAreaElement> }
  label: string
  heading: string
  examples: readonly string[]
  regionLabel: string
  disabled: boolean
}

// Mounted within a FormField; region changes remount this presentation only, not form state.
export function ComplaintFactorField({ field, label, heading, examples, regionLabel, disabled }: Props) {
  const examplesId = useId()
  const [expanded, setExpanded] = useState(false)
  const [pending, setPending] = useState<FactorStatus | null>(null)
  const [undo, setUndo] = useState<string | null>(null)
  const [observedValue, setObservedValue] = useState(field.value)
  if (observedValue !== field.value) {
    setObservedValue(field.value)
    setPending(null)
    setUndo(null)
  }

  function change(value: string) {
    if (disabled) return
    setPending(null)
    setUndo(null)
    setObservedValue(value)
    field.onChange(value)
  }

  function selectStatus(status: FactorStatus) {
    if (disabled) return
    if (!field.value.trim() || isFactorStatus(field.value)) {
      change(field.value.trim().toLowerCase() === status.toLowerCase() ? '' : status)
    } else {
      setPending(status)
      setUndo(null)
    }
  }

  return <FormItem className="border-t pt-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <FormLabel><span aria-hidden="true">{heading} · </span>{label}</FormLabel>
      <span className="text-xs text-muted-foreground">{regionLabel} examples</span>
    </div>
    <div id={examplesId} className="flex flex-wrap gap-2" role="group" aria-label={`${label} examples`}>
      {(expanded ? examples : examples.slice(0, 3)).map(example => {
        const selected = hasFactorExample(field.value, example)
        return <Button key={example} type="button" variant="outline" size="sm" disabled={disabled}
          aria-pressed={selected} onClick={() => change(toggleFactorExample(field.value, example))}
          className={`h-auto min-h-9 whitespace-normal rounded-full px-3 py-2 text-xs [@media(pointer:coarse)]:min-h-11 ${selected ? 'border-primary bg-primary/10 text-foreground' : ''}`}>
          {selected ? <Check className="size-3 shrink-0" aria-hidden="true" /> : <Plus className="size-3 shrink-0" aria-hidden="true" />}{example}
        </Button>
      })}
      {factorStatuses.map(status => <Button key={status} type="button" variant="outline" size="sm" disabled={disabled}
        aria-pressed={field.value.trim().toLowerCase() === status.toLowerCase()} onClick={() => selectStatus(status)}
        className={`h-auto min-h-9 rounded-full px-3 py-2 text-xs [@media(pointer:coarse)]:min-h-11 ${field.value.trim().toLowerCase() === status.toLowerCase() ? 'border-primary bg-primary/10' : ''}`}>
        {status}
      </Button>)}
    </div>
    {examples.length > 3 && <Button type="button" variant="link" className="h-auto justify-self-start p-0 text-xs [@media(pointer:coarse)]:min-h-11"
      aria-expanded={expanded} aria-controls={examplesId} onClick={() => setExpanded(!expanded)}>
      {expanded ? 'Fewer examples' : 'More examples'}
    </Button>}
    <FormControl><Textarea {...field} onChange={event => change(event.target.value)} rows={2} disabled={disabled}
      placeholder="Select examples or describe in the patient’s words" /></FormControl>
    <FormDescription>Examples—select only what the patient reports.</FormDescription>
    {pending && <div className="space-y-2 rounded-md border p-3" role="group" aria-label={`Replace ${label.toLowerCase()}`}>
      <p className="text-sm">Replace current text with &ldquo;{pending}&rdquo;?</p>
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={disabled} onClick={() => {
          if (disabled || observedValue !== field.value) return
          const previous = field.value
          change(pending)
          setUndo(previous)
        }}>Replace</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setPending(null)}>Cancel</Button>
      </div>
    </div>}
    {undo !== null && <div className="flex items-center gap-2 text-sm" role="status">
      Text replaced.
      <Button type="button" variant="link" size="sm" disabled={disabled} onClick={() => change(undo)}>Undo</Button>
    </div>}
  </FormItem>
}
