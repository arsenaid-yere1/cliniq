'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
import { prpProcedureFormSchema, type PrpProcedureFormValues } from '@/lib/validations/prp-procedure'
import { createPrpProcedure } from '@/actions/procedures'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { DiagnosisCombobox } from './diagnosis-combobox'

interface RecordProcedureDialogProps {
  caseId: string
  diagnosisSuggestions: Array<{ icd10_code: string | null; description: string }>
}

export function RecordProcedureDialog({ caseId, diagnosisSuggestions }: RecordProcedureDialogProps) {
  const [open, setOpen] = useState(false)

  const form = useForm<PrpProcedureFormValues>({
    resolver: zodResolver(prpProcedureFormSchema),
    defaultValues: {
      procedure_date: format(new Date(), 'yyyy-MM-dd'),
      injection_site: '',
      laterality: undefined,
      diagnoses: [],
      consent_obtained: false,
      pain_rating: null,
      vital_signs: {
        bp_systolic: null,
        bp_diastolic: null,
        heart_rate: null,
        respiratory_rate: null,
        temperature_f: null,
        spo2_percent: null,
      },
    },
  })

  async function onSubmit(values: PrpProcedureFormValues) {
    const result = await createPrpProcedure(caseId, values)
    if ('error' in result && result.error) {
      toast.error(result.error)
      return
    }
    toast.success('Procedure recorded')
    setOpen(false)
    form.reset()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Record Procedure</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record PRP Procedure</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* ── Encounter Details ── */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Encounter Details
              </h3>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="procedure_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Procedure Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="laterality"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Laterality</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="left">Left</SelectItem>
                          <SelectItem value="right">Right</SelectItem>
                          <SelectItem value="bilateral">Bilateral</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="injection_site"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Injection Site</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Knee, Shoulder" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="diagnoses"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>ICD-10 Diagnoses</FormLabel>
                    <FormControl>
                      <DiagnosisCombobox
                        value={field.value}
                        onChange={field.onChange}
                        suggestions={diagnosisSuggestions}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="pain_rating"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Pain Rating (0–10, optional)</FormLabel>
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
                  name="consent_obtained"
                  render={({ field }) => (
                    <FormItem className="flex flex-col justify-end pb-1">
                      <div className="flex items-center gap-2">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            id="consent_obtained"
                          />
                        </FormControl>
                        <FormLabel htmlFor="consent_obtained" className="cursor-pointer font-normal">
                          Consent Obtained
                        </FormLabel>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <Separator />

            {/* ── Vital Signs ── */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Vital Signs (optional)
              </h3>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="vital_signs.bp_systolic"
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
                  name="vital_signs.bp_diastolic"
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
                  name="vital_signs.heart_rate"
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
                  name="vital_signs.respiratory_rate"
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
                  name="vital_signs.temperature_f"
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
                  name="vital_signs.spo2_percent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>SpO2 (%)</FormLabel>
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

            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Saving...' : 'Record Procedure'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
