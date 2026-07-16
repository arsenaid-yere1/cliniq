'use client'

import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
import { botoxProcedureFormSchema, type BotoxProcedureFormValues } from '@/lib/validations/botox-procedure'
import { createBotoxProcedure, updateBotoxProcedure, type ProcedureDefaults } from '@/actions/procedures'
import { generateProcedureConsent } from '@/actions/procedure-consents'
import { buildDownloadFilename } from '@/lib/filenames/build-download-filename'
import { toast } from 'sonner'
import type { ProcedureSite } from '@/lib/procedures/sites-helpers'
import type { ProcedureInitialData } from './record-procedure-dialog'
import { BotoxMuscleEditor } from './botox-muscle-editor'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { DiagnosisCombobox } from './diagnosis-combobox'

const NULL_VITALS = {
  bp_systolic: null,
  bp_diastolic: null,
  heart_rate: null,
  respiratory_rate: null,
  temperature_f: null,
  spo2_percent: null,
  pain_score_min: null,
  pain_score_max: null,
}

interface BotoxDosingInitial {
  product_name?: string
  ndc?: string
  lot_number?: string
  expiration?: string
  reconstitution_units?: number
  reconstitution_diluent_ml?: number
  units_administered?: number
  units_discarded?: number
}

interface RecordBotoxDialogProps {
  caseId: string
  diagnosisSuggestions: Array<{
    icd10_code: string | null
    description: string
    imaging_support?: 'confirmed' | 'referenced' | 'none' | null
    exam_support?: 'objective' | 'subjective_only' | 'none' | null
    source_quote?: string | null
  }>
  procedureDefaults?: ProcedureDefaults | null
  initialData?: ProcedureInitialData
  patientLastName: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RecordBotoxDialog({
  caseId,
  diagnosisSuggestions,
  procedureDefaults,
  initialData,
  patientLastName,
  open,
  onOpenChange,
}: RecordBotoxDialogProps) {
  const isEditing = !!initialData?.id
  const [generatingConsent, setGeneratingConsent] = useState(false)

  const dosing = (initialData?.botox_dosing ?? null) as BotoxDosingInitial | null

  const form = useForm<BotoxProcedureFormValues>({
    resolver: zodResolver(
      botoxProcedureFormSchema({ earliestDate: procedureDefaults?.earliest_procedure_date ?? null }),
    ),
    defaultValues: {
      procedure_date: initialData?.procedure_date ?? format(new Date(), 'yyyy-MM-dd'),
      sites: initialData?.sites ?? [],
      diagnoses: Array.isArray(initialData?.diagnoses)
        ? (initialData.diagnoses as BotoxProcedureFormValues['diagnoses'])
        : diagnosisSuggestions
            .filter((d): d is typeof d & { icd10_code: string } => !!d.icd10_code)
            .filter((d) => {
              const hasEvidenceTags = d.imaging_support !== undefined || d.exam_support !== undefined
              if (!hasEvidenceTags) return true
              return d.imaging_support === 'confirmed' && d.exam_support === 'objective'
            })
            .map((d) => ({ icd10_code: d.icd10_code, description: d.description })),
      consent_obtained: initialData?.consent_obtained ?? true,
      vital_signs: initialData?._vitals ?? NULL_VITALS,
      botox_dosing: {
        product_name: dosing?.product_name ?? 'BOTOX Cosmetic (onabotulinumtoxinA)',
        ndc: dosing?.ndc ?? '',
        lot_number: dosing?.lot_number ?? '',
        expiration: dosing?.expiration ?? '',
        reconstitution_units: dosing?.reconstitution_units ?? 100,
        reconstitution_diluent_ml: dosing?.reconstitution_diluent_ml ?? 3,
        units_administered: dosing?.units_administered ?? (undefined as unknown as number),
        units_discarded: dosing?.units_discarded ?? (undefined as unknown as number),
      },
      needle_gauge: initialData?.needle_gauge ?? '30-gauge',
      complications: initialData?.complications ?? 'None',
      plan_deviation_reason: initialData?.plan_deviation_reason ?? '',
    },
  })

  // Live vial reconciliation feedback.
  const watchedSites = useWatch({ control: form.control, name: 'sites' }) as ProcedureSite[] | undefined
  const watchedDosing = useWatch({ control: form.control, name: 'botox_dosing' })
  const vialTotal = Number(watchedDosing?.reconstitution_units ?? 0)
  const admin = Number(watchedDosing?.units_administered ?? 0)
  const discarded = Number(watchedDosing?.units_discarded ?? 0)
  const siteUnitsSum = (watchedSites ?? []).reduce((a, s) => a + (Number(s.units) || 0), 0)
  const reconciles = Math.abs(admin + discarded - vialTotal) < 0.001 && vialTotal > 0
  const siteSumMatches = (watchedSites ?? []).every((s) => s.units != null)
    ? Math.abs(siteUnitsSum - admin) < 0.001
    : true

  async function handleGenerateConsent() {
    setGeneratingConsent(true)
    try {
      const values = form.getValues()
      const sites = values.sites ?? []
      const treatmentArea = sites.map((s) => s.label).join(', ') || undefined
      const lateralitySet = new Set(
        sites.map((s) => s.laterality).filter((l): l is 'left' | 'right' | 'bilateral' => l !== null),
      )
      const consentLaterality =
        lateralitySet.size === 1
          ? ([...lateralitySet][0] as 'left' | 'right' | 'bilateral')
          : undefined
      const result = await generateProcedureConsent({
        caseId,
        procedureId: initialData?.id,
        override: { treatmentArea, laterality: consentLaterality },
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
        a.download = buildDownloadFilename({
          lastName: patientLastName,
          docType: 'ProcedureConsent',
          date: values.procedure_date,
        })
        a.click()
        URL.revokeObjectURL(url)
      }
      toast.success('Procedure consent form generated')
    } finally {
      setGeneratingConsent(false)
    }
  }

  async function onSubmit(values: BotoxProcedureFormValues) {
    const result = isEditing
      ? await updateBotoxProcedure(initialData!.id, caseId, values)
      : await createBotoxProcedure(caseId, values)
    if ('error' in result && result.error) {
      toast.error(result.error)
      return
    }
    toast.success(isEditing ? 'Procedure updated' : 'Procedure recorded')
    onOpenChange(false)
    if (!isEditing) form.reset()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] sm:max-w-[min(95vw,56rem)] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit BOTOX Procedure' : 'Record Therapeutic BOTOX Procedure'}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 min-w-0">
            {/* ── Encounter ── */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Encounter Details
              </h3>

              <FormField
                control={form.control}
                name="procedure_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Procedure Date</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        min={procedureDefaults?.earliest_procedure_date ?? undefined}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="sites"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Injection Map (muscles) *</FormLabel>
                    <FormControl>
                      <BotoxMuscleEditor value={field.value ?? []} onChange={field.onChange} />
                    </FormControl>
                    <FormDescription>
                      Add each treated muscle with side, injection points, and units.
                    </FormDescription>
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

              <FormField
                control={form.control}
                name="consent_obtained"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center gap-2">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          id="botox_consent_obtained"
                        />
                      </FormControl>
                      <FormLabel htmlFor="botox_consent_obtained" className="cursor-pointer font-normal">
                        Consent Obtained (off-label therapeutic use discussed)
                      </FormLabel>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

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

            {/* ── Product & Dosing ── */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Product &amp; Dosing
              </h3>

              <FormField
                control={form.control}
                name="botox_dosing.product_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Product *</FormLabel>
                    <FormControl>
                      <Input placeholder="BOTOX Cosmetic (onabotulinumtoxinA)" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="botox_dosing.ndc"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>NDC</FormLabel>
                      <FormControl>
                        <Input placeholder="0023-9232-01" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="botox_dosing.lot_number"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Lot #</FormLabel>
                      <FormControl>
                        <Input placeholder="Lot" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="botox_dosing.expiration"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Expiration</FormLabel>
                      <FormControl>
                        <Input placeholder="YYYY-MM" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="botox_dosing.reconstitution_units"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vial Units (reconstituted) *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="1"
                          placeholder="100"
                          value={field.value ?? ''}
                          onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="botox_dosing.reconstitution_diluent_ml"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Diluent Volume (mL) *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.1"
                          placeholder="3.0"
                          value={field.value ?? ''}
                          onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="botox_dosing.units_administered"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Units Administered *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="1"
                          placeholder="60"
                          value={field.value ?? ''}
                          onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="botox_dosing.units_discarded"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Units Discarded *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="1"
                          placeholder="40"
                          value={field.value ?? ''}
                          onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Live vial reconciliation banner */}
              <div
                className={`rounded-md border p-3 text-sm ${
                  reconciles && siteSumMatches
                    ? 'border-green-600 bg-green-500/10 text-green-700 dark:text-green-400'
                    : 'border-amber-600 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                }`}
              >
                <div>
                  Vial reconciliation: {admin} administered + {discarded} discarded = {admin + discarded} U
                  {' '}vs {vialTotal} U vial {reconciles ? '✓' : '— must equal vial total'}
                </div>
                <div>
                  Per-muscle units sum: {siteUnitsSum} U
                  {' '}vs {admin} administered {siteSumMatches ? '✓' : '— adjust per-muscle units or total'}
                </div>
              </div>

              <FormField
                control={form.control}
                name="needle_gauge"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Needle</FormLabel>
                    <FormControl>
                      <Input placeholder="30-gauge, 1/2-inch" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            {/* ── Post-Procedure ── */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Post-Procedure
              </h3>
              <FormField
                control={form.control}
                name="complications"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Complications</FormLabel>
                    <FormControl>
                      <Input placeholder="None" {...field} />
                    </FormControl>
                    <FormDescription>Immediate complications, or &ldquo;None&rdquo;.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            {/* ── Plan Deviation (optional) ── */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Plan Deviation (optional)
              </h3>
              <FormField
                control={form.control}
                name="plan_deviation_reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reason for deviation from treatment plan</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Fill in only when the performed technique differs from the documented plan of care."
                        rows={3}
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
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
