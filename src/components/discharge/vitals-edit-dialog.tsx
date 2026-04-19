'use client'

import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

interface VitalsFormValues {
  bp_systolic: number | null
  bp_diastolic: number | null
  heart_rate: number | null
  respiratory_rate: number | null
  temperature_f: number | null
  spo2_percent: number | null
  pain_score_min: number | null
  pain_score_max: number | null
}

const EMPTY: VitalsFormValues = {
  bp_systolic: null,
  bp_diastolic: null,
  heart_rate: null,
  respiratory_rate: null,
  temperature_f: null,
  spo2_percent: null,
  pain_score_min: null,
  pain_score_max: null,
}

function parseNum(s: string | undefined): number | null {
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

// Best-effort parse of the existing objective_vitals textarea content.
function parseVitalsText(text: string): VitalsFormValues {
  const out: VitalsFormValues = { ...EMPTY }
  if (!text) return out

  const bp = text.match(/BP:\s*(\d+)\s*\/\s*(\d+)/i)
  if (bp) {
    out.bp_systolic = parseNum(bp[1])
    out.bp_diastolic = parseNum(bp[2])
  }
  const hr = text.match(/HR:\s*(\d+)/i)
  if (hr) out.heart_rate = parseNum(hr[1])

  const rr = text.match(/RR:\s*(\d+)/i)
  if (rr) out.respiratory_rate = parseNum(rr[1])

  const temp = text.match(/Temp:\s*([\d.]+)/i)
  if (temp) out.temperature_f = parseNum(temp[1])

  const spo2 = text.match(/SpO[₂2]?:\s*(\d+)/i)
  if (spo2) out.spo2_percent = parseNum(spo2[1])

  const painRange = text.match(/Pain:\s*(\d+)\s*-\s*(\d+)\s*\/\s*10/i)
  const painSingle = text.match(/Pain:\s*(\d+)\s*\/\s*10/i)
  if (painRange) {
    out.pain_score_min = parseNum(painRange[1])
    out.pain_score_max = parseNum(painRange[2])
  } else if (painSingle) {
    out.pain_score_max = parseNum(painSingle[1])
  }

  return out
}

function formatVitalsText(v: VitalsFormValues): string {
  const lines: string[] = []
  if (v.bp_systolic != null && v.bp_diastolic != null) {
    lines.push(`• BP: ${v.bp_systolic}/${v.bp_diastolic} mmHg`)
  }
  if (v.heart_rate != null) lines.push(`• HR: ${v.heart_rate} bpm`)
  if (v.respiratory_rate != null) lines.push(`• RR: ${v.respiratory_rate} breaths/min`)
  if (v.temperature_f != null) lines.push(`• Temp: ${v.temperature_f}°F`)
  if (v.spo2_percent != null) lines.push(`• SpO₂: ${v.spo2_percent}% on room air`)

  const { pain_score_min: pmin, pain_score_max: pmax } = v
  if (pmin != null && pmax != null && pmin !== pmax) {
    lines.push(`• Pain: ${pmin}-${pmax}/10`)
  } else if (pmax != null) {
    lines.push(`• Pain: ${pmax}/10`)
  } else if (pmin != null) {
    lines.push(`• Pain: ${pmin}/10`)
  }

  return lines.join('\n')
}

interface VitalsEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentValue: string
  onSave: (formatted: string) => void
}

export function VitalsEditDialog({
  open,
  onOpenChange,
  currentValue,
  onSave,
}: VitalsEditDialogProps) {
  const form = useForm<VitalsFormValues>({
    defaultValues: EMPTY,
  })

  // Re-seed the form every time the dialog opens so edits made directly to
  // the textarea are reflected in the structured fields.
  useEffect(() => {
    if (open) form.reset(parseVitalsText(currentValue))
  }, [open, currentValue, form])

  function handleSave() {
    const formatted = formatVitalsText(form.getValues())
    onSave(formatted)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Vital Signs</DialogTitle>
          <DialogDescription>
            Leave a field blank to omit that bullet. Saving replaces the current Vital Signs text.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="pain_score_min"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pain Min (0–10)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={10}
                        placeholder="—"
                        value={field.value ?? ''}
                        onChange={(e) =>
                          field.onChange(e.target.value === '' ? null : Number(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="pain_score_max"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pain Max (0–10)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={10}
                        placeholder="—"
                        value={field.value ?? ''}
                        onChange={(e) =>
                          field.onChange(e.target.value === '' ? null : Number(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="bp_systolic"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>BP Systolic</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="mmHg"
                        value={field.value ?? ''}
                        onChange={(e) =>
                          field.onChange(e.target.value === '' ? null : Number(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="bp_diastolic"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>BP Diastolic</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="mmHg"
                        value={field.value ?? ''}
                        onChange={(e) =>
                          field.onChange(e.target.value === '' ? null : Number(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="heart_rate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Heart Rate</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="bpm"
                        value={field.value ?? ''}
                        onChange={(e) =>
                          field.onChange(e.target.value === '' ? null : Number(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="respiratory_rate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Respiratory Rate</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="breaths/min"
                        value={field.value ?? ''}
                        onChange={(e) =>
                          field.onChange(e.target.value === '' ? null : Number(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="temperature_f"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Temperature (°F)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.1"
                        placeholder="°F"
                        value={field.value ?? ''}
                        onChange={(e) =>
                          field.onChange(e.target.value === '' ? null : Number(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="spo2_percent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>SpO₂ (%)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        placeholder="%"
                        value={field.value ?? ''}
                        onChange={(e) =>
                          field.onChange(e.target.value === '' ? null : Number(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        </Form>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { parseVitalsText, formatVitalsText }
