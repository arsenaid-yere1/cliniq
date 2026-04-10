'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
import { prpProcedureFormSchema, type PrpProcedureFormValues } from '@/lib/validations/prp-procedure'
import { createPrpProcedure, updatePrpProcedure } from '@/actions/procedures'
import { generateProcedureConsent } from '@/actions/procedure-consents'
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
import { Textarea } from '@/components/ui/textarea'
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

const SECTIONS = [
  { id: 'section-encounter', label: 'Encounter' },
  { id: 'section-prp-prep', label: 'PRP Prep' },
  { id: 'section-anesthesia', label: 'Anesthesia' },
  { id: 'section-injection', label: 'Injection' },
  { id: 'section-post-proc', label: 'Post-Procedure' },
  { id: 'section-vitals', label: 'Vitals' },
]

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export interface ProcedureInitialData {
  id: string
  procedure_date: string
  injection_site: string | null
  laterality: string | null
  diagnoses: unknown
  consent_obtained: boolean | null
  pain_rating: number | null
  blood_draw_volume_ml: number | null
  centrifuge_duration_min: number | null
  prep_protocol: string | null
  kit_lot_number: string | null
  anesthetic_agent: string | null
  anesthetic_dose_ml: number | null
  patient_tolerance: string | null
  injection_volume_ml: number | null
  needle_gauge: string | null
  guidance_method: string | null
  target_confirmed_imaging: boolean | null
  complications: string | null
  supplies_used: string | null
  compression_bandage: boolean | null
  activity_restriction_hrs: number | null
  _vitals?: {
    bp_systolic: number | null
    bp_diastolic: number | null
    heart_rate: number | null
    respiratory_rate: number | null
    temperature_f: number | null
    spo2_percent: number | null
  } | null
}

interface RecordProcedureDialogProps {
  caseId: string
  diagnosisSuggestions: Array<{ icd10_code: string | null; description: string }>
  initialData?: ProcedureInitialData
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function RecordProcedureDialog({
  caseId,
  diagnosisSuggestions,
  initialData,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: RecordProcedureDialogProps) {
  const isEditing = !!initialData?.id
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen
  const setOpen = controlledOnOpenChange ?? setInternalOpen

  // Derive complications mode from initialData
  const initialComplicationsMode = initialData?.complications
    ? initialData.complications === 'none'
      ? 'none'
      : 'other'
    : ''
  const [complicationsMode, setComplicationsMode] = useState<'none' | 'other' | ''>(
    isEditing ? (initialComplicationsMode as 'none' | 'other' | '') : ''
  )
  const [generatingConsent, setGeneratingConsent] = useState(false)

  async function handleGenerateConsent() {
    setGeneratingConsent(true)
    try {
      const values = form.getValues()
      const result = await generateProcedureConsent({
        caseId,
        procedureId: initialData?.id,
        override: {
          treatmentArea: values.injection_site || undefined,
          laterality: (values.laterality as 'left' | 'right' | 'bilateral' | undefined) || undefined,
        },
      })
      if ('error' in result && result.error) {
        toast.error(result.error)
        return
      }
      if ('data' in result && result.data?.base64) {
        const bytes = atob(result.data.base64)
        const arr = new Uint8Array(bytes.length)
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
        const blob = new Blob([arr], { type: 'application/pdf' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'Procedure-Consent-Form.pdf'
        a.click()
        URL.revokeObjectURL(url)
      }
      toast.success('Procedure consent form generated')
    } finally {
      setGeneratingConsent(false)
    }
  }

  const form = useForm<PrpProcedureFormValues>({
    resolver: zodResolver(prpProcedureFormSchema),
    defaultValues: {
      procedure_date: initialData?.procedure_date ?? format(new Date(), 'yyyy-MM-dd'),
      injection_site: initialData?.injection_site ?? '',
      laterality: (initialData?.laterality as 'left' | 'right' | 'bilateral' | undefined) ?? undefined,
      diagnoses: Array.isArray(initialData?.diagnoses)
        ? (initialData.diagnoses as PrpProcedureFormValues['diagnoses'])
        : diagnosisSuggestions.filter((d): d is { icd10_code: string; description: string } => !!d.icd10_code),
      consent_obtained: initialData?.consent_obtained ?? false,
      pain_rating: initialData?.pain_rating ?? null,
      vital_signs: {
        bp_systolic: initialData?._vitals?.bp_systolic ?? null,
        bp_diastolic: initialData?._vitals?.bp_diastolic ?? null,
        heart_rate: initialData?._vitals?.heart_rate ?? null,
        respiratory_rate: initialData?._vitals?.respiratory_rate ?? null,
        temperature_f: initialData?._vitals?.temperature_f ?? null,
        spo2_percent: initialData?._vitals?.spo2_percent ?? null,
      },
      prp_preparation: {
        blood_draw_volume_ml: initialData?.blood_draw_volume_ml ?? undefined,
        centrifuge_duration_min: initialData?.centrifuge_duration_min ?? null,
        prep_protocol: initialData?.prep_protocol ?? '',
        kit_lot_number: initialData?.kit_lot_number ?? '',
      },
      anesthesia: {
        anesthetic_agent: initialData?.anesthetic_agent ?? '',
        anesthetic_dose_ml: initialData?.anesthetic_dose_ml ?? null,
        patient_tolerance: (initialData?.patient_tolerance as 'tolerated_well' | 'adverse_reaction' | null) ?? null,
      },
      injection: {
        injection_volume_ml: initialData?.injection_volume_ml ?? undefined,
        needle_gauge: initialData?.needle_gauge ?? '',
        guidance_method: (initialData?.guidance_method as 'ultrasound' | 'fluoroscopy' | 'landmark' | undefined) ?? undefined,
        target_confirmed_imaging: initialData?.target_confirmed_imaging ?? null,
      },
      post_procedure: {
        complications: initialData?.complications ?? '',
        supplies_used: initialData?.supplies_used ?? '',
        compression_bandage: initialData?.compression_bandage ?? null,
        activity_restriction_hrs: initialData?.activity_restriction_hrs ?? null,
      },
    },
  })

  async function onSubmit(values: PrpProcedureFormValues) {
    const result = isEditing
      ? await updatePrpProcedure(initialData!.id, caseId, values)
      : await createPrpProcedure(caseId, values)
    if ('error' in result && result.error) {
      toast.error(result.error)
      return
    }
    toast.success(isEditing ? 'Procedure updated' : 'Procedure recorded')
    setOpen(false)
    if (!isEditing) {
      setComplicationsMode('')
      form.reset()
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isEditing && (
        <DialogTrigger asChild>
          <Button>Record Procedure</Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit PRP Procedure' : 'Record PRP Procedure'}</DialogTitle>
        </DialogHeader>

        {/* Section nav */}
        <div className="flex gap-1.5 flex-wrap pb-2 sticky top-0 bg-background z-10 py-2 border-b mb-2">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => scrollToSection(s.id)}
              className="rounded-full px-3 py-1 text-xs font-medium bg-muted hover:bg-muted/80 transition-colors"
            >
              {s.label}
            </button>
          ))}
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* ── Encounter Details ── */}
            <div id="section-encounter" className="space-y-4">
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

              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleGenerateConsent}
                  disabled={generatingConsent}
                >
                  {generatingConsent ? 'Generating...' : 'Generate Consent Form'}
                </Button>
              </div>
            </div>

            <Separator />

            {/* ── PRP Preparation ── */}
            <div id="section-prp-prep" className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                PRP Preparation
              </h3>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="prp_preparation.blood_draw_volume_ml"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Blood Draw Volume (mL) *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.1"
                          placeholder="mL"
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
                  name="prp_preparation.centrifuge_duration_min"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Centrifuge Duration (min)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="minutes"
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

              <FormField
                control={form.control}
                name="prp_preparation.prep_protocol"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Prep Protocol / Kit Description</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. ACP Double Syringe System" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="prp_preparation.kit_lot_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Kit Lot Number</FormLabel>
                    <FormControl>
                      <Input placeholder="Lot #" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            {/* ── Anesthesia ── */}
            <div id="section-anesthesia" className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Anesthesia
              </h3>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="anesthesia.anesthetic_agent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Anesthetic Agent *</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Lidocaine 1%" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="anesthesia.anesthetic_dose_ml"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Anesthetic Dose (mL)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.1"
                          placeholder="mL"
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

              <FormField
                control={form.control}
                name="anesthesia.patient_tolerance"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Patient Tolerance</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ''}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="tolerated_well">Tolerated Well</SelectItem>
                        <SelectItem value="adverse_reaction">Adverse Reaction</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            {/* ── Injection ── */}
            <div id="section-injection" className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Injection
              </h3>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="injection.injection_volume_ml"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Injection Volume (mL) *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.1"
                          placeholder="mL"
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
                  name="injection.needle_gauge"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Needle Gauge</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. 25-gauge spinal" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="injection.guidance_method"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Guidance Method *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? ''}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="ultrasound">Ultrasound</SelectItem>
                          <SelectItem value="fluoroscopy">Fluoroscopy</SelectItem>
                          <SelectItem value="landmark">Landmark</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="injection.target_confirmed_imaging"
                  render={({ field }) => (
                    <FormItem className="flex flex-col justify-end pb-1">
                      <div className="flex items-center gap-2">
                        <FormControl>
                          <Checkbox
                            checked={field.value ?? false}
                            onCheckedChange={(checked) => field.onChange(checked === true ? true : null)}
                            id="target_confirmed_imaging"
                          />
                        </FormControl>
                        <FormLabel htmlFor="target_confirmed_imaging" className="cursor-pointer font-normal">
                          Target Confirmed on Imaging
                        </FormLabel>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <Separator />

            {/* ── Post-Procedure ── */}
            <div id="section-post-proc" className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Post-Procedure
              </h3>

              <FormField
                control={form.control}
                name="post_procedure.complications"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Complications *</FormLabel>
                    <Select
                      onValueChange={(val) => {
                        setComplicationsMode(val as 'none' | 'other')
                        if (val === 'none') {
                          form.setValue('post_procedure.complications', 'none', { shouldValidate: true })
                        } else {
                          form.setValue('post_procedure.complications', '', { shouldValidate: false })
                        }
                      }}
                      value={complicationsMode}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="other">Other – specify</SelectItem>
                      </SelectContent>
                    </Select>
                    {complicationsMode === 'other' && (
                      <Textarea
                        placeholder="Describe complications..."
                        value={field.value === 'none' ? '' : field.value}
                        onChange={(e) =>
                          form.setValue('post_procedure.complications', e.target.value, { shouldValidate: true })
                        }
                        className="mt-2"
                      />
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="post_procedure.supplies_used"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Supplies Used</FormLabel>
                    <FormControl>
                      <Textarea placeholder="List supplies used..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="post_procedure.activity_restriction_hrs"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Activity Restriction (hours)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="hours"
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
                  name="post_procedure.compression_bandage"
                  render={({ field }) => (
                    <FormItem className="flex flex-col justify-end pb-1">
                      <div className="flex items-center gap-2">
                        <FormControl>
                          <Checkbox
                            checked={field.value ?? false}
                            onCheckedChange={(checked) => field.onChange(checked === true ? true : null)}
                            id="compression_bandage"
                          />
                        </FormControl>
                        <FormLabel htmlFor="compression_bandage" className="cursor-pointer font-normal">
                          Compression Bandage Applied
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
            <div id="section-vitals" className="space-y-4">
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
                {form.formState.isSubmitting ? 'Saving...' : isEditing ? 'Update Procedure' : 'Record Procedure'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
