'use client'

import { useState, useTransition } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { format, differenceInYears } from 'date-fns'
import { Sparkles, RefreshCw, Loader2, AlertTriangle, Save, Lock, Pencil, Download, Heart, Plus, Trash2, Activity } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  generateInitialVisitNote,
  saveInitialVisitNote,
  finalizeInitialVisitNote,
  unfinalizeInitialVisitNote,
  regenerateNoteSection,
  saveInitialVisitVitals,
  saveInitialVisitRom,
} from '@/actions/initial-visit-notes'
import { getDocumentDownloadUrl } from '@/actions/documents'
import {
  initialVisitNoteEditSchema,
  initialVisitVitalsSchema,
  initialVisitRomSchema,
  initialVisitSections,
  sectionLabels,
  defaultRomData,
  type InitialVisitNoteEditValues,
  type InitialVisitSection,
  type InitialVisitVitalsValues,
  type InitialVisitRomValues,
} from '@/lib/validations/initial-visit-note'
import { useCaseStatus } from '@/components/patients/case-status-context'

interface NoteRow {
  id: string
  case_id: string
  introduction: string | null
  history_of_accident: string | null
  chief_complaint: string | null
  past_medical_history: string | null
  social_history: string | null
  review_of_systems: string | null
  physical_exam: string | null
  imaging_findings: string | null
  motor_sensory_reflex: string | null
  medical_necessity: string | null
  diagnoses: string | null
  treatment_plan: string | null
  patient_education: string | null
  prognosis: string | null
  clinician_disclaimer: string | null
  status: string
  generation_error: string | null
  finalized_at: string | null
  finalized_by_user_id: string | null
  document_id: string | null
  rom_data: unknown
}

interface ClinicSettings {
  clinic_name: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  zip_code: string | null
  phone: string | null
  fax: string | null
}

interface ProviderProfile {
  display_name: string | null
  credentials: string | null
  npi_number: string | null
}

interface CaseData {
  case_number: string
  accident_type: string | null
  accident_date: string | null
  patient: {
    first_name: string
    last_name: string
    date_of_birth: string | null
    gender: string | null
  }
}

interface VitalsData {
  bp_systolic: number | null
  bp_diastolic: number | null
  heart_rate: number | null
  respiratory_rate: number | null
  temperature_f: number | null
  spo2_percent: number | null
}

interface InitialVisitEditorProps {
  caseId: string
  note: NoteRow | null
  canGenerate: boolean
  prerequisiteReason?: string
  initialVitals: VitalsData | null
  initialRom: InitialVisitRomValues | null
  clinicSettings: ClinicSettings | null
  providerProfile: ProviderProfile | null
  clinicLogoUrl: string | null
  providerSignatureUrl: string | null
  caseData: CaseData | null
  documentFilePath: string | null
}

// Textarea row heights per section
const sectionRows: Record<InitialVisitSection, number> = {
  introduction: 5,
  history_of_accident: 8,
  chief_complaint: 8,
  past_medical_history: 5,
  social_history: 3,
  review_of_systems: 5,
  physical_exam: 8,
  imaging_findings: 8,
  motor_sensory_reflex: 3,
  medical_necessity: 5,
  diagnoses: 5,
  treatment_plan: 8,
  patient_education: 5,
  prognosis: 3,
  clinician_disclaimer: 3,
}

export function InitialVisitEditor({
  caseId,
  note,
  canGenerate,
  prerequisiteReason,
  initialVitals,
  initialRom,
  clinicSettings,
  providerProfile,
  clinicLogoUrl,
  providerSignatureUrl,
  caseData,
  documentFilePath,
}: InitialVisitEditorProps) {
  const [isPending, startTransition] = useTransition()
  const [regeneratingSection, setRegeneratingSection] = useState<InitialVisitSection | null>(null)
  const caseStatus = useCaseStatus()
  const isClosed = caseStatus === 'closed'

  // No note — show vitals card + generate button
  if (!note) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Initial Visit Note</h1>
        <VitalSignsCard caseId={caseId} initialVitals={initialVitals} isClosed={isClosed} />
        <RomInputCard caseId={caseId} initialRom={initialRom} isClosed={isClosed} />
        <div className="flex flex-col items-center justify-center py-16 space-y-4 border rounded-lg bg-muted/30">
          <p className="text-sm text-muted-foreground text-center max-w-md">
            {canGenerate
              ? 'Generate an AI-powered Initial Visit note from the approved case summary.'
              : prerequisiteReason || 'Cannot generate note.'}
          </p>
          <Button
            onClick={() => {
              startTransition(async () => {
                const result = await generateInitialVisitNote(caseId)
                if (result.error) toast.error(result.error)
                else toast.success('Note generated successfully')
              })
            }}
            disabled={isClosed || !canGenerate || isPending}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Generate Initial Visit Note
          </Button>
        </div>
      </div>
    )
  }

  // Generating state
  if (note.status === 'generating') {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Initial Visit Note</h1>
          <Badge variant="outline">Generating...</Badge>
        </div>
        <div className="space-y-6">
          {initialVisitSections.map((section) => (
            <div key={section} className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-24 w-full" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Failed state
  if (note.status === 'failed') {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Initial Visit Note</h1>
          <Badge variant="destructive">Failed</Badge>
        </div>
        <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {note.generation_error || 'Note generation failed.'}
        </div>
        <Button
          variant="outline"
          onClick={() => {
            startTransition(async () => {
              const result = await generateInitialVisitNote(caseId)
              if (result.error) toast.error(result.error)
              else toast.success('Note generated successfully')
            })
          }}
          disabled={isClosed || isPending}
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Retry
        </Button>
      </div>
    )
  }

  // Finalized state — read-only view
  if (note.status === 'finalized') {
    return (
      <FinalizedView
        caseId={caseId}
        note={note}
        clinicSettings={clinicSettings}
        providerProfile={providerProfile}
        clinicLogoUrl={clinicLogoUrl}
        providerSignatureUrl={providerSignatureUrl}
        caseData={caseData}
        documentFilePath={documentFilePath}
        isPending={isPending}
        startTransition={startTransition}
        isClosed={isClosed}
      />
    )
  }

  // Draft state — editable form
  return (
    <DraftEditor
      caseId={caseId}
      note={note}
      initialVitals={initialVitals}
      initialRom={initialRom}
      isPending={isPending}
      startTransition={startTransition}
      regeneratingSection={regeneratingSection}
      setRegeneratingSection={setRegeneratingSection}
      isClosed={isClosed}
    />
  )
}

// --- Vital Signs Card ---

function VitalSignsCard({
  caseId,
  initialVitals,
  isClosed,
}: {
  caseId: string
  initialVitals: VitalsData | null
  isClosed: boolean
}) {
  const [isSaving, startSaving] = useTransition()
  const vitalsForm = useForm<InitialVisitVitalsValues>({
    resolver: zodResolver(initialVisitVitalsSchema),
    defaultValues: {
      bp_systolic: initialVitals?.bp_systolic ?? null,
      bp_diastolic: initialVitals?.bp_diastolic ?? null,
      heart_rate: initialVitals?.heart_rate ?? null,
      respiratory_rate: initialVitals?.respiratory_rate ?? null,
      temperature_f: initialVitals?.temperature_f ?? null,
      spo2_percent: initialVitals?.spo2_percent ?? null,
    },
  })

  function handleSaveVitals() {
    startSaving(async () => {
      const values = vitalsForm.getValues()
      const result = await saveInitialVisitVitals(caseId, values)
      if (result.error) toast.error(result.error)
      else toast.success('Vitals saved')
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Heart className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Vital Signs</CardTitle>
        </div>
        <CardDescription>
          Record vital signs for this visit. These will be included in the generated note.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...vitalsForm}>
          <div className="grid grid-cols-3 gap-4">
            <FormField
              control={vitalsForm.control}
              name="bp_systolic"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>BP Systolic</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder="mmHg"
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={vitalsForm.control}
              name="bp_diastolic"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>BP Diastolic</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder="mmHg"
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={vitalsForm.control}
              name="heart_rate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Heart Rate</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder="bpm"
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={vitalsForm.control}
              name="respiratory_rate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Respiratory Rate</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder="breaths/min"
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={vitalsForm.control}
              name="temperature_f"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Temperature</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.1"
                      placeholder="°F"
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={vitalsForm.control}
              name="spo2_percent"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>SpO2</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      placeholder="%"
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="mt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSaveVitals}
              disabled={isClosed || isSaving}
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Save Vitals
            </Button>
          </div>
        </Form>
      </CardContent>
    </Card>
  )
}

// --- ROM Input Card ---

function RomInputCard({
  caseId,
  initialRom,
  isClosed,
}: {
  caseId: string
  initialRom: InitialVisitRomValues | null
  isClosed: boolean
}) {
  const [isSaving, startSaving] = useTransition()
  const form = useForm<{ rom: InitialVisitRomValues }>({
    defaultValues: {
      rom: initialRom ?? defaultRomData,
    },
  })

  const regionsArray = useFieldArray({
    control: form.control,
    name: 'rom',
  })

  function handleSaveRom() {
    startSaving(async () => {
      const values = form.getValues()
      const validated = initialVisitRomSchema.safeParse(values.rom)
      if (!validated.success) {
        toast.error('Invalid ROM data')
        return
      }
      const result = await saveInitialVisitRom(caseId, validated.data)
      if (result.error) toast.error(result.error)
      else toast.success('ROM data saved')
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Range of Motion</CardTitle>
        </div>
        <CardDescription>
          Record ROM measurements for each affected region. These will be included in the generated note.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {regionsArray.fields.map((regionField, regionIndex) => (
          <RomRegionSection
            key={regionField.id}
            form={form}
            regionIndex={regionIndex}
            onRemoveRegion={() => regionsArray.remove(regionIndex)}
            isClosed={isClosed}
          />
        ))}

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => regionsArray.append({
              region: '',
              movements: [{ movement: '', normal: null, actual: null, pain: false }],
            })}
            disabled={isClosed}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Region
          </Button>
          <div className="flex-1" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleSaveRom}
            disabled={isClosed || isSaving}
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Save ROM
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// --- ROM Region Section (nested field array) ---

function RomRegionSection({
  form,
  regionIndex,
  onRemoveRegion,
  isClosed,
}: {
  form: ReturnType<typeof useForm<{ rom: InitialVisitRomValues }>>
  regionIndex: number
  onRemoveRegion: () => void
  isClosed: boolean
}) {
  const movementsArray = useFieldArray({
    control: form.control,
    name: `rom.${regionIndex}.movements`,
  })

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <FormField
          control={form.control}
          name={`rom.${regionIndex}.region`}
          render={({ field }) => (
            <FormItem className="flex-1">
              <FormControl>
                <Input
                  placeholder="Region (e.g., Cervical Spine)"
                  className="font-semibold"
                  {...field}
                />
              </FormControl>
            </FormItem>
          )}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={onRemoveRegion}
          disabled={isClosed}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {movementsArray.fields.length > 0 && (
        <div className="space-y-1">
          <div className="grid grid-cols-[1fr_70px_70px_50px_28px] gap-2 text-xs text-muted-foreground px-1">
            <span>Movement</span>
            <span>Normal (°)</span>
            <span>Actual (°)</span>
            <span>Pain</span>
            <span />
          </div>
          {movementsArray.fields.map((movField, movIndex) => (
            <div key={movField.id} className="grid grid-cols-[1fr_70px_70px_50px_28px] gap-2 items-center">
              <FormField
                control={form.control}
                name={`rom.${regionIndex}.movements.${movIndex}.movement`}
                render={({ field }) => (
                  <FormControl>
                    <Input className="h-8 text-sm" placeholder="e.g. Flexion" {...field} />
                  </FormControl>
                )}
              />
              <FormField
                control={form.control}
                name={`rom.${regionIndex}.movements.${movIndex}.normal`}
                render={({ field }) => (
                  <FormControl>
                    <Input
                      className="h-8 text-sm"
                      type="number"
                      placeholder="°"
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))}
                    />
                  </FormControl>
                )}
              />
              <FormField
                control={form.control}
                name={`rom.${regionIndex}.movements.${movIndex}.actual`}
                render={({ field }) => (
                  <FormControl>
                    <Input
                      className="h-8 text-sm"
                      type="number"
                      placeholder="°"
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))}
                    />
                  </FormControl>
                )}
              />
              <FormField
                control={form.control}
                name={`rom.${regionIndex}.movements.${movIndex}.pain`}
                render={({ field }) => (
                  <FormControl>
                    <select
                      className="h-8 text-sm border rounded px-1 w-full"
                      value={field.value ? 'Y' : 'N'}
                      onChange={(e) => field.onChange(e.target.value === 'Y')}
                    >
                      <option value="N">No</option>
                      <option value="Y">Yes</option>
                    </select>
                  </FormControl>
                )}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => movementsArray.remove(movIndex)}
                disabled={isClosed}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={() => movementsArray.append({ movement: '', normal: null, actual: null, pain: false })}
        disabled={isClosed}
      >
        <Plus className="h-3 w-3 mr-1" />
        Add Movement
      </Button>
    </div>
  )
}

// --- Draft Editor ---

function DraftEditor({
  caseId,
  note,
  initialVitals,
  initialRom,
  isPending,
  startTransition,
  regeneratingSection,
  setRegeneratingSection,
  isClosed,
}: {
  caseId: string
  note: NoteRow
  initialVitals: VitalsData | null
  initialRom: InitialVisitRomValues | null
  isPending: boolean
  startTransition: (callback: () => Promise<void>) => void
  regeneratingSection: InitialVisitSection | null
  setRegeneratingSection: (s: InitialVisitSection | null) => void
  isClosed: boolean
}) {
  const form = useForm<InitialVisitNoteEditValues>({
    resolver: zodResolver(initialVisitNoteEditSchema),
    defaultValues: {
      introduction: note.introduction || '',
      history_of_accident: note.history_of_accident || '',
      chief_complaint: note.chief_complaint || '',
      past_medical_history: note.past_medical_history || '',
      social_history: note.social_history || '',
      review_of_systems: note.review_of_systems || '',
      physical_exam: note.physical_exam || '',
      imaging_findings: note.imaging_findings || '',
      motor_sensory_reflex: note.motor_sensory_reflex || '',
      medical_necessity: note.medical_necessity || '',
      diagnoses: note.diagnoses || '',
      treatment_plan: note.treatment_plan || '',
      patient_education: note.patient_education || '',
      prognosis: note.prognosis || '',
      clinician_disclaimer: note.clinician_disclaimer || '',
    },
  })

  function handleSave() {
    startTransition(async () => {
      const values = form.getValues()
      const result = await saveInitialVisitNote(caseId, values)
      if (result.error) toast.error(result.error)
      else toast.success('Draft saved')
    })
  }

  function handleRegenerate(section: InitialVisitSection) {
    setRegeneratingSection(section)
    startTransition(async () => {
      const result = await regenerateNoteSection(caseId, section)
      if (result.error) {
        toast.error(result.error)
      } else if (result.data?.content) {
        form.setValue(section, result.data.content)
        toast.success(`${sectionLabels[section]} regenerated`)
      }
      setRegeneratingSection(null)
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Initial Visit Note</h1>
          <Badge variant="outline">Draft</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleSave} disabled={isClosed || isPending}>
            {isPending && !regeneratingSection ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Save Draft
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={isClosed || isPending}>
                <Lock className="h-4 w-4 mr-2" />
                Finalize
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Finalize Note</AlertDialogTitle>
                <AlertDialogDescription>
                  Finalizing will lock this note and create a document record. You can unfinalize later to make edits. Continue?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    startTransition(async () => {
                      // Save current form values first
                      const values = form.getValues()
                      const saveResult = await saveInitialVisitNote(caseId, values)
                      if (saveResult.error) {
                        toast.error(saveResult.error)
                        return
                      }
                      const result = await finalizeInitialVisitNote(caseId)
                      if (result.error) toast.error(result.error)
                      else toast.success('Note finalized')
                    })
                  }}
                >
                  Finalize
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <VitalSignsCard caseId={caseId} initialVitals={initialVitals} isClosed={isClosed} />
      <RomInputCard caseId={caseId} initialRom={initialRom} isClosed={isClosed} />

      <Form {...form}>
        <form className="space-y-6">
          {initialVisitSections.map((section) => (
            <FormField
              key={section}
              control={form.control}
              name={section}
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel className="text-base font-semibold">
                      {sectionLabels[section]}
                    </FormLabel>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={isClosed || isPending}
                        >
                          {regeneratingSection === section ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <RefreshCw className="h-3 w-3 mr-1" />
                          )}
                          Regenerate
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Regenerate Section</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will replace the current content of &ldquo;{sectionLabels[section]}&rdquo; with newly generated content. Other sections will not be affected. Continue?
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleRegenerate(section)}>
                            Regenerate
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={sectionRows[section]}
                      className="resize-y"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
        </form>
      </Form>
    </div>
  )
}

// --- Finalized View ---

function FinalizedView({
  caseId,
  note,
  clinicSettings,
  providerProfile,
  clinicLogoUrl,
  providerSignatureUrl,
  caseData,
  documentFilePath,
  isPending,
  startTransition,
  isClosed,
}: {
  caseId: string
  note: NoteRow
  clinicSettings: ClinicSettings | null
  providerProfile: ProviderProfile | null
  clinicLogoUrl: string | null
  providerSignatureUrl: string | null
  caseData: CaseData | null
  documentFilePath: string | null
  isPending: boolean
  startTransition: (callback: () => Promise<void>) => void
  isClosed: boolean
}) {
  const patientName = caseData
    ? `${caseData.patient.first_name} ${caseData.patient.last_name}`
    : null
  const dob = caseData?.patient.date_of_birth
    ? format(new Date(caseData.patient.date_of_birth), 'MM/dd/yyyy')
    : null
  const age = caseData?.patient.date_of_birth
    ? differenceInYears(new Date(), new Date(caseData.patient.date_of_birth))
    : null
  const accidentDate = caseData?.accident_date
    ? format(new Date(caseData.accident_date), 'MM/dd/yyyy')
    : null

  return (
    <div className="space-y-6">
      {/* Action bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Initial Visit Note</h1>
          <Badge variant="outline" className="border-green-600 bg-green-500/10 text-green-700 dark:text-green-400">Finalized</Badge>
        </div>
        <div className="flex items-center gap-2">
          {documentFilePath && (
            <Button
              variant="outline"
              disabled={isPending}
              onClick={async () => {
                const result = await getDocumentDownloadUrl(documentFilePath)
                if (result.url) window.open(result.url, '_blank')
                else toast.error('Failed to get download URL')
              }}
            >
              <Download className="h-4 w-4 mr-2" />
              Download PDF
            </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={isClosed || isPending}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Pencil className="h-4 w-4 mr-2" />}
                Edit
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Unfinalize Note</AlertDialogTitle>
              <AlertDialogDescription>
                This will re-open the note for editing. The existing document record will be preserved. Continue?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  startTransition(async () => {
                    const result = await unfinalizeInitialVisitNote(caseId)
                    if (result.error) toast.error(result.error)
                    else toast.success('Note reopened for editing')
                  })
                }}
              >
                Unfinalize
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Document */}
      <div className="border rounded-lg p-8 bg-card text-card-foreground max-w-4xl mx-auto space-y-6">

        {/* Clinic Header — centered */}
        <div className="text-center space-y-1">
          {clinicLogoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={clinicLogoUrl} alt="Clinic logo" className="h-16 mx-auto mb-2" />
          )}
          {/* Clinic name omitted — logo contains it */}
          {clinicSettings?.address_line1 && (
            <p className="text-sm">{clinicSettings.address_line1}</p>
          )}
          {clinicSettings?.address_line2 && (
            <p className="text-sm">{clinicSettings.address_line2}</p>
          )}
          {(clinicSettings?.city || clinicSettings?.state || clinicSettings?.zip_code) && (
            <p className="text-sm">
              {[clinicSettings.city, clinicSettings.state].filter(Boolean).join(', ')} {clinicSettings.zip_code}
            </p>
          )}
          {(clinicSettings?.phone || clinicSettings?.fax) && (
            <p className="text-sm">
              {clinicSettings.phone && `Tel: ${clinicSettings.phone}`}
              {clinicSettings.phone && clinicSettings.fax && ' | '}
              {clinicSettings.fax && `Fax: ${clinicSettings.fax}`}
            </p>
          )}
        </div>

        <Separator />

        {/* Patient Info Block */}
        {caseData && (
          <>
            <div className="space-y-1 text-sm">
              {patientName && <p><strong>Patient:</strong> {patientName}</p>}
              {dob && <p><strong>DOB:</strong> {dob}</p>}
              {age !== null && <p><strong>Age:</strong> {age}</p>}
              <p><strong>Date of Visit:</strong> {note.finalized_at ? format(new Date(note.finalized_at), 'MM/dd/yyyy') : '\u2014'}</p>
              {note.chief_complaint && <p><strong>Indication:</strong> Pain Management Evaluation</p>}
              {accidentDate && <p><strong>Date of Injury:</strong> {accidentDate}</p>}
            </div>
            <Separator />
          </>
        )}

        {/* Introduction — special heading */}
        {note.introduction && (
          <div>
            <h3 className="text-sm font-bold mb-2">To Whom it May Concern</h3>
            <p className="text-sm whitespace-pre-wrap leading-relaxed">{note.introduction}</p>
          </div>
        )}

        {/* Remaining sections with their headings */}
        {initialVisitSections.slice(1).map((section) => {
          const content = note[section]
          if (!content) return null
          return (
            <div key={section}>
              <h3 className="text-sm font-bold mb-2">{sectionLabels[section]}</h3>
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{content}</p>
            </div>
          )
        })}

        <Separator />

        {/* Closing + Signature */}
        <div className="space-y-4">
          <p className="text-sm">Respectfully,</p>
          <div className="space-y-2">
            {providerSignatureUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={providerSignatureUrl} alt="Provider signature" className="h-16" />
            )}
            {providerProfile?.display_name && (
              <p className="text-sm font-semibold">
                {providerProfile.display_name}
                {providerProfile.credentials && `, ${providerProfile.credentials}`}
              </p>
            )}
            {providerProfile?.npi_number && (
              <p className="text-xs text-muted-foreground">NPI: {providerProfile.npi_number}</p>
            )}
            {note.finalized_at && (
              <p className="text-xs text-muted-foreground">
                Finalized: {format(new Date(note.finalized_at), 'MMMM d, yyyy \'at\' h:mm a')}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
