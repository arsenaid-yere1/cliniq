'use client'

import { useState, useTransition } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { format, differenceInYears } from 'date-fns'
import { Sparkles, RefreshCw, RotateCcw, Loader2, AlertTriangle, Save, Lock, Pencil, Download, Heart, Plus, Trash2, Activity, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
  resetInitialVisitNote,
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
import { LOCKED_STATUSES, type CaseStatus } from '@/lib/constants/case-status'

interface NoteRow {
  id: string
  case_id: string
  introduction: string | null
  history_of_accident: string | null
  post_accident_history: string | null
  chief_complaint: string | null
  past_medical_history: string | null
  social_history: string | null
  review_of_systems: string | null
  physical_exam: string | null
  imaging_findings: string | null
  medical_necessity: string | null
  diagnoses: string | null
  treatment_plan: string | null
  patient_education: string | null
  prognosis: string | null
  time_complexity_attestation: string | null
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
  pain_score_min: number | null
  pain_score_max: number | null
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
  post_accident_history: 8,
  chief_complaint: 8,
  past_medical_history: 5,
  social_history: 3,
  review_of_systems: 5,
  physical_exam: 8,
  imaging_findings: 8,
  medical_necessity: 5,
  diagnoses: 5,
  treatment_plan: 8,
  patient_education: 5,
  prognosis: 3,
  time_complexity_attestation: 3,
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
  const [toneHint, setToneHint] = useState('')
  const caseStatus = useCaseStatus()
  const isLocked = LOCKED_STATUSES.includes(caseStatus as CaseStatus)

  // A note row may exist with only rom_data/vitals but no generated sections yet
  const hasGeneratedContent = note?.introduction || note?.chief_complaint

  // No note or pre-generation note — show tabs + generate button
  if (!note || (note.status === 'draft' && !hasGeneratedContent)) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Initial Visit Note</h1>

        <Tabs defaultValue="vitals">
          <TabsList>
            <TabsTrigger value="vitals">
              <Heart className="h-3.5 w-3.5 mr-1.5" />
              Vital Signs
            </TabsTrigger>
            <TabsTrigger value="rom">
              <Activity className="h-3.5 w-3.5 mr-1.5" />
              Range of Motion
            </TabsTrigger>
          </TabsList>
          <TabsContent value="vitals" className="mt-4">
            <VitalSignsCard caseId={caseId} initialVitals={initialVitals} isLocked={isLocked} />
          </TabsContent>
          <TabsContent value="rom" className="mt-4">
            <RomInputCard caseId={caseId} initialRom={initialRom ?? (note?.rom_data as InitialVisitRomValues | null)} isLocked={isLocked} />
          </TabsContent>
        </Tabs>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tone & Direction (optional)</CardTitle>
            <CardDescription>
              Provide optional guidance to influence the AI&apos;s writing style and emphasis. This is used only for the initial generation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder="e.g., Use assertive language about medical necessity, emphasize conservative treatment failure, keep prognosis cautious..."
              value={toneHint}
              onChange={(e) => setToneHint(e.target.value)}
              rows={3}
              disabled={isLocked || isPending}
            />
          </CardContent>
        </Card>

        <div className="flex flex-col items-center justify-center py-16 space-y-4 border rounded-lg bg-muted/30">
          <p className="text-sm text-muted-foreground text-center max-w-md">
            {canGenerate
              ? 'Generate an AI-powered Initial Visit note from the approved case summary.'
              : prerequisiteReason || 'Cannot generate note.'}
          </p>
          <Button
            onClick={() => {
              startTransition(async () => {
                const result = await generateInitialVisitNote(caseId, toneHint || null)
                if (result.error) toast.error(result.error)
                else toast.success('Note generated successfully')
              })
            }}
            disabled={isLocked || !canGenerate || isPending}
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
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => {
              startTransition(async () => {
                const result = await generateInitialVisitNote(caseId)
                if (result.error) toast.error(result.error)
                else toast.success('Note generated successfully')
              })
            }}
            disabled={isLocked || isPending}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Retry
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={isLocked || isPending}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset Note</AlertDialogTitle>
                <AlertDialogDescription>
                  This will discard all generated content and return to the pre-generation state. Vitals will be preserved, but ROM data will need to be re-entered. Continue?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    startTransition(async () => {
                      const result = await resetInitialVisitNote(caseId)
                      if (result.error) toast.error(result.error)
                      else toast.success('Note reset successfully')
                    })
                  }}
                >
                  Reset
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
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
        isLocked={isLocked}
        initialVitals={initialVitals}
      />
    )
  }

  // Draft state — editable form with tabs
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
      isLocked={isLocked}
    />
  )
}

// --- Vital Signs Content (no Card wrapper — used inside tabs) ---

function VitalSignsCard({
  caseId,
  initialVitals,
  isLocked,
}: {
  caseId: string
  initialVitals: VitalsData | null
  isLocked: boolean
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
      pain_score_min: initialVitals?.pain_score_min ?? null,
      pain_score_max: initialVitals?.pain_score_max ?? null,
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
            <FormField
              control={vitalsForm.control}
              name="pain_score_min"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Pain Score Min</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      max={10}
                      placeholder="0-10"
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
              name="pain_score_max"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Pain Score Max</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      max={10}
                      placeholder="0-10"
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
              disabled={isLocked || isSaving}
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
  isLocked,
}: {
  caseId: string
  initialRom: InitialVisitRomValues | null
  isLocked: boolean
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
        <CardDescription>
          Record ROM measurements for each affected region. Save to include in the generated note.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <div className="space-y-6">
            {regionsArray.fields.map((regionField, regionIndex) => (
              <RomRegionSection
                key={regionField.id}
                form={form}
                regionIndex={regionIndex}
                onRemoveRegion={() => regionsArray.remove(regionIndex)}
                isLocked={isLocked}
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
                disabled={isLocked}
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
                disabled={isLocked || isSaving}
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Save ROM
              </Button>
            </div>
          </div>
        </Form>
      </CardContent>
    </Card>
  )
}

// --- ROM Region Section (nested field array) ---

function RomRegionSection({
  form,
  regionIndex,
  onRemoveRegion,
  isLocked,
}: {
  form: ReturnType<typeof useForm<{ rom: InitialVisitRomValues }>>
  regionIndex: number
  onRemoveRegion: () => void
  isLocked: boolean
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
          disabled={isLocked}
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
                disabled={isLocked}
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
        disabled={isLocked}
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
  isLocked,
}: {
  caseId: string
  note: NoteRow
  initialVitals: VitalsData | null
  initialRom: InitialVisitRomValues | null
  isPending: boolean
  startTransition: (callback: () => Promise<void>) => void
  regeneratingSection: InitialVisitSection | null
  setRegeneratingSection: (s: InitialVisitSection | null) => void
  isLocked: boolean
}) {
  const form = useForm<InitialVisitNoteEditValues>({
    resolver: zodResolver(initialVisitNoteEditSchema),
    defaultValues: {
      introduction: note.introduction || '',
      history_of_accident: note.history_of_accident || '',
      post_accident_history: note.post_accident_history || '',
      chief_complaint: note.chief_complaint || '',
      past_medical_history: note.past_medical_history || '',
      social_history: note.social_history || '',
      review_of_systems: note.review_of_systems || '',
      physical_exam: note.physical_exam || '',
      imaging_findings: note.imaging_findings || '',
      medical_necessity: note.medical_necessity || '',
      diagnoses: note.diagnoses || '',
      treatment_plan: note.treatment_plan || '',
      patient_education: note.patient_education || '',
      prognosis: note.prognosis || '',
      time_complexity_attestation: note.time_complexity_attestation || '',
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
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={isLocked || isPending}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset Note</AlertDialogTitle>
                <AlertDialogDescription>
                  This will discard all generated content and return to the pre-generation state. Vitals will be preserved, but ROM data will need to be re-entered. Continue?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    startTransition(async () => {
                      const result = await resetInitialVisitNote(caseId)
                      if (result.error) toast.error(result.error)
                      else toast.success('Note reset successfully')
                    })
                  }}
                >
                  Reset
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button variant="outline" onClick={handleSave} disabled={isLocked || isPending}>
            {isPending && !regeneratingSection ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Save Draft
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={isLocked || isPending}>
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

      <Tabs defaultValue="note">
        <TabsList>
          <TabsTrigger value="note">
            <FileText className="h-3.5 w-3.5 mr-1.5" />
            Note Sections
          </TabsTrigger>
          <TabsTrigger value="vitals">
            <Heart className="h-3.5 w-3.5 mr-1.5" />
            Vital Signs
          </TabsTrigger>
          <TabsTrigger value="rom">
            <Activity className="h-3.5 w-3.5 mr-1.5" />
            Range of Motion
          </TabsTrigger>
        </TabsList>

        <TabsContent value="note" className="mt-4">
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
                              disabled={isLocked || isPending}
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
        </TabsContent>

        <TabsContent value="vitals" className="mt-4">
          <VitalSignsCard caseId={caseId} initialVitals={initialVitals} isLocked={isLocked} />
        </TabsContent>

        <TabsContent value="rom" className="mt-4">
          <RomInputCard caseId={caseId} initialRom={initialRom} isLocked={isLocked} />
        </TabsContent>
      </Tabs>
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
  isLocked,
  initialVitals,
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
  isLocked: boolean
  initialVitals: VitalsData | null
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
              <Button variant="outline" disabled={isLocked || isPending}>
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

        {/* Vital Signs Summary */}
        {initialVitals && (
          <>
            <div className="space-y-1 text-sm">
              <h3 className="text-sm font-bold mb-2">Vital Signs</h3>
              <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                {initialVitals.bp_systolic != null && initialVitals.bp_diastolic != null && (
                  <p><strong>Blood Pressure:</strong> {initialVitals.bp_systolic}/{initialVitals.bp_diastolic} mmHg</p>
                )}
                {initialVitals.heart_rate != null && (
                  <p><strong>Heart Rate:</strong> {initialVitals.heart_rate} bpm</p>
                )}
                {initialVitals.respiratory_rate != null && (
                  <p><strong>Respiratory Rate:</strong> {initialVitals.respiratory_rate} breaths/min</p>
                )}
                {initialVitals.temperature_f != null && (
                  <p><strong>Temperature:</strong> {initialVitals.temperature_f}°F</p>
                )}
                {initialVitals.spo2_percent != null && (
                  <p><strong>SpO2:</strong> {initialVitals.spo2_percent}%</p>
                )}
                {(initialVitals.pain_score_min != null || initialVitals.pain_score_max != null) && (
                  <p><strong>Pain Score:</strong> {
                    initialVitals.pain_score_min != null && initialVitals.pain_score_max != null
                      ? initialVitals.pain_score_min === initialVitals.pain_score_max
                        ? `${initialVitals.pain_score_min}/10`
                        : `${initialVitals.pain_score_min}-${initialVitals.pain_score_max}/10`
                      : `${initialVitals.pain_score_min ?? initialVitals.pain_score_max}/10`
                  }</p>
                )}
              </div>
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
