'use client'

import { useState, useTransition, useEffect } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { computeAgeAtDate, pickVisitAnchor } from '@/lib/age'
import { Sparkles, RefreshCw, RotateCcw, Loader2, AlertTriangle, Save, Lock, Pencil, Download, Heart, Plus, Trash2, Activity, FileText, ClipboardList, Car, History, UserRound, Stethoscope, FileImage, Bone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { GeneratingProgress } from '@/components/clinical/generating-progress'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { VITALS_NORMAL_RANGES } from '@/lib/clinical/vitals-ranges'
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
  saveProviderIntake,
} from '@/actions/initial-visit-notes'
import type { NoteVisitType } from '@/lib/claude/generate-initial-visit'
import { getDocumentDownloadUrl } from '@/actions/documents'
import { buildDownloadFilename } from '@/lib/filenames/build-download-filename'
import {
  initialVisitNoteEditSchema,
  initialVisitVitalsSchema,
  initialVisitRomSchema,
  initialVisitSections,
  sectionLabels,
  defaultRomData,
  providerIntakeSchema,
  defaultProviderIntake,
  type InitialVisitNoteEditValues,
  type InitialVisitSection,
  type InitialVisitVitalsValues,
  type InitialVisitRomValues,
  type ProviderIntakeValues,
} from '@/lib/validations/initial-visit-note'
import { useCaseStatus } from '@/components/patients/case-status-context'
import { LOCKED_STATUSES, type CaseStatus } from '@/lib/constants/case-status'
import { formatReasonForVisit, formatVisitTypeLabel } from '@/lib/constants/clinical-note-header'

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
  visit_date: string | null
  updated_at: string | null
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

interface InitialVisitEditorOuterProps {
  caseId: string
  notesByVisitType: Record<NoteVisitType, unknown>
  intakesByVisitType: Record<NoteVisitType, ProviderIntakeValues | null>
  romByVisitType: Record<NoteVisitType, InitialVisitRomValues | null>
  documentFilePathByVisitType: Record<NoteVisitType, string | null>
  defaultVisitType: NoteVisitType
  canGenerate: boolean
  prerequisiteReason?: string
  initialVitals: VitalsData | null
  clinicSettings: ClinicSettings | null
  providerProfile: ProviderProfile | null
  clinicLogoUrl: string | null
  providerSignatureUrl: string | null
  caseData: CaseData | null
  // Signals that the pain-eval follow-up visit has a prior finalized initial
  // visit on the chart but no intake vitals row predating it. AI cannot cite
  // a numeric pain delta for the NUMERIC-ANCHOR clause; badge surfaces the
  // data gap. Applies to the pain_evaluation_visit tab only.
  painEvalMissingPriorVitals: boolean
}

interface InitialVisitEditorInnerProps {
  caseId: string
  visitType: NoteVisitType
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
  initialIntake: ProviderIntakeValues | null
}

// Outer wrapper: visit type tab selector. Each tab has its own completely
// independent InitialVisitEditorInner instance — separate notes, separate
// intake, separate ROM, separate orders. Switching tabs does not lose or
// merge data on either side.
export function InitialVisitEditor({
  caseId,
  notesByVisitType,
  intakesByVisitType,
  romByVisitType,
  documentFilePathByVisitType,
  defaultVisitType,
  canGenerate,
  prerequisiteReason,
  initialVitals,
  clinicSettings,
  providerProfile,
  clinicLogoUrl,
  providerSignatureUrl,
  caseData,
  painEvalMissingPriorVitals,
}: InitialVisitEditorOuterProps) {
  const [activeVisitType, setActiveVisitType] = useState<NoteVisitType>(defaultVisitType)

  const visitTypes: Array<{ value: NoteVisitType; label: string }> = [
    { value: 'initial_visit', label: 'Initial Visit' },
    { value: 'pain_evaluation_visit', label: 'Pain Evaluation Visit' },
  ]

  return (
    <div className="space-y-6">
      <Tabs value={activeVisitType} onValueChange={(v) => setActiveVisitType(v as NoteVisitType)}>
        <TabsList>
          {visitTypes.map((vt) => (
            <TabsTrigger key={vt.value} value={vt.value}>
              <FileText className="h-3.5 w-3.5 mr-1.5" />
              {vt.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {visitTypes.map((vt) => {
          const note = (notesByVisitType[vt.value] ?? null) as NoteRow | null
          const showPainEvalBadge = vt.value === 'pain_evaluation_visit' && painEvalMissingPriorVitals
          return (
            <TabsContent key={vt.value} value={vt.value} className="mt-4">
              {showPainEvalBadge && (
                <div className="mb-4 flex items-start gap-2 p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 text-sm text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Prior initial-visit pain measurement is missing</p>
                    <p className="text-muted-foreground mt-1">
                      A prior Initial Visit note is finalized for this case but its intake vital signs (pain rating) were not recorded. The generated Pain Evaluation Visit note cannot cite a numeric pain delta against the initial evaluation — the narrative will describe the change qualitatively instead. To restore the numeric anchor, add the intake vital signs to the prior encounter.
                    </p>
                  </div>
                </div>
              )}
              <InitialVisitEditorInner
                caseId={caseId}
                visitType={vt.value}
                note={note}
                canGenerate={canGenerate}
                prerequisiteReason={prerequisiteReason}
                initialVitals={initialVitals}
                initialRom={romByVisitType[vt.value]}
                clinicSettings={clinicSettings}
                providerProfile={providerProfile}
                clinicLogoUrl={clinicLogoUrl}
                providerSignatureUrl={providerSignatureUrl}
                caseData={caseData}
                documentFilePath={documentFilePathByVisitType[vt.value]}
                initialIntake={intakesByVisitType[vt.value]}
              />
            </TabsContent>
          )
        })}
      </Tabs>
    </div>
  )
}

// Format visit date for display: prefers visit_date (parsed as local), falls back to finalized_at
function formatVisitDate(visitDate: string | null, finalizedAt: string | null): string {
  if (visitDate) {
    return format(new Date(`${visitDate}T00:00:00`), 'MM/dd/yyyy')
  }
  if (finalizedAt) {
    return format(new Date(finalizedAt), 'MM/dd/yyyy')
  }
  return '\u2014'
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

function InitialVisitEditorInner({
  caseId,
  visitType,
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
  initialIntake,
}: InitialVisitEditorInnerProps) {
  const [isPending, startTransition] = useTransition()
  const [regeneratingSection, setRegeneratingSection] = useState<InitialVisitSection | null>(null)
  const [toneHint, setToneHint] = useState('')
  const [optimisticGenerating, setOptimisticGenerating] = useState(false)
  const [optimisticStartedAt, setOptimisticStartedAt] = useState<string | null>(null)
  const caseStatus = useCaseStatus()
  const isLocked = LOCKED_STATUSES.includes(caseStatus as CaseStatus)
  const visitTypeLabel = visitType === 'initial_visit' ? 'Initial Visit Note' : 'Pain Evaluation Visit Note'

  const runGenerate = (toneHintArg: string | null) => {
    setOptimisticStartedAt(new Date().toISOString())
    setOptimisticGenerating(true)
    startTransition(async () => {
      try {
        const result = await generateInitialVisitNote(caseId, visitType, toneHintArg)
        if (result.error) toast.error(result.error)
        else toast.success('Note generated successfully')
      } finally {
        setOptimisticGenerating(false)
      }
    })
  }

  // A note row may exist with only rom_data/vitals but no generated sections yet
  const hasGeneratedContent = note?.introduction || note?.chief_complaint

  // Parse initial intake data safely
  const parsedIntake = (() => {
    if (initialIntake) return initialIntake
    // Try to get from note row if it exists
    const noteIntake = (note as Record<string, unknown> | null)?.provider_intake
    if (noteIntake) {
      const result = providerIntakeSchema.safeParse(noteIntake)
      if (result.success) return result.data
    }
    return null
  })()

  // Optimistic generating state — entered on Generate click before the server
  // action has persisted status = 'generating'. Masks the 30–90s blocking gap
  // where note.status is still the pre-click value.
  if (optimisticGenerating && note?.status !== 'generating') {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{visitTypeLabel}</h1>
          <Badge variant="outline">Generating...</Badge>
        </div>
        <GeneratingProgress startedAt={optimisticStartedAt} />
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

  // No note or pre-generation note — show tabs + generate button
  if (!note || (note.status === 'draft' && !hasGeneratedContent)) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{visitTypeLabel}</h1>

        <Tabs defaultValue="chief-complaints">
          <TabsList className="flex-wrap h-auto gap-1 p-1">
            <TabsTrigger value="chief-complaints">
              <ClipboardList className="h-3.5 w-3.5 mr-1.5" />
              Chief Complaints
            </TabsTrigger>
            <TabsTrigger value="accident-details">
              <Car className="h-3.5 w-3.5 mr-1.5" />
              Accident Details
            </TabsTrigger>
            <TabsTrigger value="pmh">
              <History className="h-3.5 w-3.5 mr-1.5" />
              Past Medical Hx
            </TabsTrigger>
            <TabsTrigger value="social-history">
              <UserRound className="h-3.5 w-3.5 mr-1.5" />
              Social History
            </TabsTrigger>
            <TabsTrigger value="exam-findings">
              <Stethoscope className="h-3.5 w-3.5 mr-1.5" />
              Exam Findings
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
          <TabsContent value="chief-complaints" className="mt-4">
            <ChiefComplaintsCard caseId={caseId} visitType={visitType} initialIntake={parsedIntake} isLocked={isLocked} />
          </TabsContent>
          <TabsContent value="accident-details" className="mt-4">
            <AccidentDetailsCard caseId={caseId} visitType={visitType} initialIntake={parsedIntake} isLocked={isLocked} />
          </TabsContent>
          <TabsContent value="pmh" className="mt-4">
            <PastMedicalHistoryCard caseId={caseId} visitType={visitType} initialIntake={parsedIntake} isLocked={isLocked} />
          </TabsContent>
          <TabsContent value="social-history" className="mt-4">
            <SocialHistoryCard caseId={caseId} visitType={visitType} initialIntake={parsedIntake} isLocked={isLocked} />
          </TabsContent>
          <TabsContent value="exam-findings" className="mt-4">
            <ExamFindingsCard caseId={caseId} visitType={visitType} initialIntake={parsedIntake} isLocked={isLocked} />
          </TabsContent>
          <TabsContent value="vitals" className="mt-4">
            <VitalSignsCard caseId={caseId} initialVitals={initialVitals} isLocked={isLocked} />
          </TabsContent>
          <TabsContent value="rom" className="mt-4">
            <RomInputCard caseId={caseId} visitType={visitType} initialRom={initialRom ?? (note?.rom_data as InitialVisitRomValues | null)} isLocked={isLocked} />
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
              ? 'Generate an AI-powered Initial Visit note from available case data and provider intake.'
              : prerequisiteReason || 'Cannot generate note.'}
          </p>
          <Button
            onClick={() => runGenerate(toneHint || null)}
            disabled={isLocked || !canGenerate || isPending}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Generate {visitTypeLabel}
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
          <h1 className="text-2xl font-bold">{visitTypeLabel}</h1>
          <Badge variant="outline">Generating...</Badge>
        </div>
        <GeneratingProgress startedAt={note.updated_at ?? null} />
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
          <h1 className="text-2xl font-bold">{visitTypeLabel}</h1>
          <Badge variant="destructive">Failed</Badge>
        </div>
        <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {note.generation_error || 'Note generation failed.'}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => runGenerate(null)}
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
                  This will discard all generated note content and return to the pre-generation state. Your intake data (chief complaints, accident details, medical history, exam findings), vitals, and ROM data will be preserved. Continue?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    startTransition(async () => {
                      const result = await resetInitialVisitNote(caseId, visitType)
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
        visitType={visitType}
        visitTypeLabel={visitTypeLabel}
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
      visitType={visitType}
      visitTypeLabel={visitTypeLabel}
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

// --- Intake Card shared props ---

interface IntakeCardProps {
  caseId: string
  visitType: NoteVisitType
  initialIntake: ProviderIntakeValues | null
  isLocked: boolean
}

// --- Helper: build full intake for saving (merges one section into defaults) ---

function buildFullIntake(
  initialIntake: ProviderIntakeValues | null,
  section: keyof ProviderIntakeValues,
  sectionData: ProviderIntakeValues[keyof ProviderIntakeValues],
): ProviderIntakeValues {
  const base = initialIntake ?? defaultProviderIntake
  return { ...base, [section]: sectionData }
}

// --- Chief Complaints Card ---

function ChiefComplaintsCard({ caseId, visitType, initialIntake, isLocked }: IntakeCardProps) {
  const [isSaving, startSaving] = useTransition()
  const defaults = initialIntake?.chief_complaints ?? defaultProviderIntake.chief_complaints
  const form = useForm({
    defaultValues: { chief_complaints: defaults },
  })

  const complaintsArray = useFieldArray({
    control: form.control,
    name: 'chief_complaints.complaints',
  })

  function handleSave() {
    startSaving(async () => {
      const values = form.getValues()
      const full = buildFullIntake(initialIntake, 'chief_complaints', values.chief_complaints)
      const result = await saveProviderIntake(caseId, visitType, full)
      if (result.error) toast.error(result.error)
      else toast.success('Chief complaints saved')
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription>
          Document the patient&apos;s chief complaints — body regions, pain character, severity, and functional impact.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <div className="space-y-4">
            {complaintsArray.fields.map((field, index) => (
              <div key={field.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Complaint {index + 1}</span>
                  {complaintsArray.fields.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => complaintsArray.remove(index)} disabled={isLocked}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name={`chief_complaints.complaints.${index}.body_region`} render={({ field: f }) => (
                    <FormItem>
                      <FormLabel>Body Region</FormLabel>
                      <FormControl><Input placeholder="e.g., Neck, Lower Back" {...f} /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name={`chief_complaints.complaints.${index}.pain_character`} render={({ field: f }) => (
                    <FormItem>
                      <FormLabel>Pain Character</FormLabel>
                      <Select onValueChange={f.onChange} value={f.value || ''}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {['sharp', 'dull', 'burning', 'aching', 'throbbing', 'stabbing'].map(v => (
                            <SelectItem key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name={`chief_complaints.complaints.${index}.severity_min`} render={({ field: f }) => (
                    <FormItem>
                      <FormLabel>Severity Min (0-10)</FormLabel>
                      <FormControl>
                        <Input type="number" min={0} max={10} placeholder="0-10" value={f.value ?? ''} onChange={e => f.onChange(e.target.value === '' ? null : Number(e.target.value))} />
                      </FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name={`chief_complaints.complaints.${index}.severity_max`} render={({ field: f }) => (
                    <FormItem>
                      <FormLabel>Severity Max (0-10)</FormLabel>
                      <FormControl>
                        <Input type="number" min={0} max={10} placeholder="0-10" value={f.value ?? ''} onChange={e => f.onChange(e.target.value === '' ? null : Number(e.target.value))} />
                      </FormControl>
                    </FormItem>
                  )} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name={`chief_complaints.complaints.${index}.is_persistent`} render={({ field: f }) => (
                    <FormItem>
                      <FormLabel>Pattern</FormLabel>
                      <FormControl>
                        <select className="h-9 w-full border rounded-md px-3 text-sm" value={f.value ? 'persistent' : 'intermittent'} onChange={e => f.onChange(e.target.value === 'persistent')}>
                          <option value="persistent">Persistent</option>
                          <option value="intermittent">Intermittent</option>
                        </select>
                      </FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name={`chief_complaints.complaints.${index}.radiates_to`} render={({ field: f }) => (
                    <FormItem>
                      <FormLabel>Radiates To</FormLabel>
                      <FormControl><Input placeholder="e.g., left arm" value={f.value ?? ''} onChange={e => f.onChange(e.target.value || null)} /></FormControl>
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name={`chief_complaints.complaints.${index}.aggravating_factors`} render={({ field: f }) => (
                  <FormItem>
                    <FormLabel>Aggravating Factors</FormLabel>
                    <FormControl><Textarea rows={2} placeholder="e.g., prolonged sitting, bending, lifting" {...f} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name={`chief_complaints.complaints.${index}.alleviating_factors`} render={({ field: f }) => (
                  <FormItem>
                    <FormLabel>Alleviating Factors</FormLabel>
                    <FormControl><Textarea rows={2} placeholder="e.g., rest, OTC medications, ice" {...f} /></FormControl>
                  </FormItem>
                )} />
              </div>
            ))}

            <Button type="button" variant="outline" size="sm" onClick={() => complaintsArray.append({
              body_region: '', pain_character: '', severity_min: null, severity_max: null,
              is_persistent: true, radiates_to: null, aggravating_factors: '', alleviating_factors: '',
            })} disabled={isLocked}>
              <Plus className="h-4 w-4 mr-1" /> Add Complaint
            </Button>

            <Separator />

            <FormField control={form.control} name="chief_complaints.sleep_disturbance" render={({ field: f }) => (
              <FormItem>
                <FormLabel>Sleep Disturbance</FormLabel>
                <FormControl>
                  <select className="h-9 w-full border rounded-md px-3 text-sm" value={f.value ? 'yes' : 'no'} onChange={e => f.onChange(e.target.value === 'yes')}>
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </FormControl>
              </FormItem>
            )} />

            <FormField control={form.control} name="chief_complaints.additional_notes" render={({ field: f }) => (
              <FormItem>
                <FormLabel>Additional Notes</FormLabel>
                <FormControl><Textarea rows={2} placeholder="Any additional details about symptoms..." value={f.value ?? ''} onChange={e => f.onChange(e.target.value || null)} /></FormControl>
              </FormItem>
            )} />

            <div className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={handleSave} disabled={isLocked || isSaving}>
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Save Chief Complaints
              </Button>
            </div>
          </div>
        </Form>
      </CardContent>
    </Card>
  )
}

// --- Accident Details Card ---

function AccidentDetailsCard({ caseId, visitType, initialIntake, isLocked }: IntakeCardProps) {
  const [isSaving, startSaving] = useTransition()
  const defaults = initialIntake?.accident_details ?? defaultProviderIntake.accident_details
  const form = useForm({ defaultValues: { accident_details: defaults } })

  const erVisit = form.watch('accident_details.er_visit')

  function handleSave() {
    startSaving(async () => {
      const values = form.getValues()
      const full = buildFullIntake(initialIntake, 'accident_details', values.accident_details)
      const result = await saveProviderIntake(caseId, visitType, full)
      if (result.error) toast.error(result.error)
      else toast.success('Accident details saved')
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription>
          Structured accident details supplement the narrative in the case record.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="accident_details.vehicle_position" render={({ field: f }) => (
                <FormItem>
                  <FormLabel>Vehicle Position</FormLabel>
                  <Select onValueChange={v => f.onChange(v || null)} value={f.value ?? ''}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger></FormControl>
                    <SelectContent>
                      {['driver', 'front passenger', 'rear passenger', 'pedestrian', 'cyclist'].map(v => (
                        <SelectItem key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="accident_details.impact_type" render={({ field: f }) => (
                <FormItem>
                  <FormLabel>Impact Type</FormLabel>
                  <Select onValueChange={v => f.onChange(v || null)} value={f.value ?? ''}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger></FormControl>
                    <SelectContent>
                      {['rear-end', 'front', 'side', 't-bone', 'rollover', 'other'].map(v => (
                        <SelectItem key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              {([
                ['accident_details.seatbelt_worn', 'Seatbelt Worn'],
                ['accident_details.airbag_deployed', 'Airbag Deployed'],
                ['accident_details.lost_consciousness', 'Lost Consciousness'],
                ['accident_details.er_visit', 'ER Visit'],
              ] as const).map(([name, label]) => (
                <FormField key={name} control={form.control} name={name} render={({ field: f }) => (
                  <FormItem>
                    <FormLabel>{label}</FormLabel>
                    <FormControl>
                      <select className="h-9 w-full border rounded-md px-3 text-sm" value={f.value === null ? '' : f.value ? 'yes' : 'no'} onChange={e => f.onChange(e.target.value === '' ? null : e.target.value === 'yes')}>
                        <option value="">Not specified</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </FormControl>
                  </FormItem>
                )} />
              ))}
            </div>

            {erVisit && (
              <FormField control={form.control} name="accident_details.er_details" render={({ field: f }) => (
                <FormItem>
                  <FormLabel>ER Details</FormLabel>
                  <FormControl><Textarea rows={2} placeholder="Hospital, treatments received, imaging done..." value={f.value ?? ''} onChange={e => f.onChange(e.target.value || null)} /></FormControl>
                </FormItem>
              )} />
            )}

            <FormField control={form.control} name="accident_details.immediate_symptoms" render={({ field: f }) => (
              <FormItem>
                <FormLabel>Immediate Symptoms</FormLabel>
                <FormControl><Textarea rows={2} placeholder="Symptoms experienced immediately after the accident..." value={f.value ?? ''} onChange={e => f.onChange(e.target.value || null)} /></FormControl>
              </FormItem>
            )} />

            <FormField control={form.control} name="accident_details.narrative" render={({ field: f }) => (
              <FormItem>
                <FormLabel>Additional Narrative</FormLabel>
                <FormControl><Textarea rows={3} placeholder="Any additional details about the accident not captured above..." value={f.value ?? ''} onChange={e => f.onChange(e.target.value || null)} /></FormControl>
              </FormItem>
            )} />

            <div className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={handleSave} disabled={isLocked || isSaving}>
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Save Accident Details
              </Button>
            </div>
          </div>
        </Form>
      </CardContent>
    </Card>
  )
}

// --- Past Medical History Card ---

function PastMedicalHistoryCard({ caseId, visitType, initialIntake, isLocked }: IntakeCardProps) {
  const [isSaving, startSaving] = useTransition()
  const defaults = initialIntake?.past_medical_history ?? defaultProviderIntake.past_medical_history
  const form = useForm({ defaultValues: { past_medical_history: defaults } })

  function handleSave() {
    startSaving(async () => {
      const values = form.getValues()
      const full = buildFullIntake(initialIntake, 'past_medical_history', values.past_medical_history)
      const result = await saveProviderIntake(caseId, visitType, full)
      if (result.error) toast.error(result.error)
      else toast.success('Past medical history saved')
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription>
          Document the patient&apos;s medical history, surgeries, medications, and allergies.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <div className="space-y-4">
            <FormField control={form.control} name="past_medical_history.medical_conditions" render={({ field }) => (
              <FormItem>
                <FormLabel>Medical Conditions</FormLabel>
                <FormControl><Textarea rows={2} placeholder="e.g., Hypertension, Type 2 Diabetes, or 'None reported'" {...field} /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="past_medical_history.prior_surgeries" render={({ field }) => (
              <FormItem>
                <FormLabel>Prior Surgeries</FormLabel>
                <FormControl><Textarea rows={2} placeholder="e.g., Appendectomy (2018), or 'None'" {...field} /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="past_medical_history.current_medications" render={({ field }) => (
              <FormItem>
                <FormLabel>Current Medications (pre-accident)</FormLabel>
                <FormControl><Textarea rows={2} placeholder="e.g., Advil/Ibuprofen as needed, Lisinopril 10mg daily" {...field} /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="past_medical_history.allergies" render={({ field }) => (
              <FormItem>
                <FormLabel>Allergies</FormLabel>
                <FormControl><Textarea rows={2} placeholder="e.g., No known drug allergies (NKDA)" {...field} /></FormControl>
              </FormItem>
            )} />

            <div className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={handleSave} disabled={isLocked || isSaving}>
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Save Medical History
              </Button>
            </div>
          </div>
        </Form>
      </CardContent>
    </Card>
  )
}

// --- Social History Card ---

function SocialHistoryCard({ caseId, visitType, initialIntake, isLocked }: IntakeCardProps) {
  const [isSaving, startSaving] = useTransition()
  const defaults = initialIntake?.social_history ?? defaultProviderIntake.social_history
  const form = useForm({ defaultValues: { social_history: defaults } })

  function handleSave() {
    startSaving(async () => {
      const values = form.getValues()
      const full = buildFullIntake(initialIntake, 'social_history', values.social_history)
      const result = await saveProviderIntake(caseId, visitType, full)
      if (result.error) toast.error(result.error)
      else toast.success('Social history saved')
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription>
          Document the patient&apos;s social history — smoking, alcohol, drug use, and occupation.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <FormField control={form.control} name="social_history.smoking_status" render={({ field }) => (
                <FormItem>
                  <FormLabel>Smoking Status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="never">Never</SelectItem>
                      <SelectItem value="former">Former</SelectItem>
                      <SelectItem value="current">Current</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="social_history.alcohol_use" render={({ field }) => (
                <FormItem>
                  <FormLabel>Alcohol Use</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="denies">Denies</SelectItem>
                      <SelectItem value="social">Social</SelectItem>
                      <SelectItem value="regular">Regular</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="social_history.drug_use" render={({ field }) => (
                <FormItem>
                  <FormLabel>Drug Use</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="denies">Denies</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="social_history.occupation" render={({ field }) => (
              <FormItem>
                <FormLabel>Occupation</FormLabel>
                <FormControl><Input placeholder="e.g., Office worker, Construction" value={field.value ?? ''} onChange={e => field.onChange(e.target.value || null)} /></FormControl>
              </FormItem>
            )} />

            <div className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={handleSave} disabled={isLocked || isSaving}>
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Save Social History
              </Button>
            </div>
          </div>
        </Form>
      </CardContent>
    </Card>
  )
}

// --- Exam Findings Card ---

function ExamFindingsCard({ caseId, visitType, initialIntake, isLocked }: IntakeCardProps) {
  const [isSaving, startSaving] = useTransition()
  const defaults = initialIntake?.exam_findings ?? defaultProviderIntake.exam_findings
  const form = useForm({ defaultValues: { exam_findings: defaults } })

  const regionsArray = useFieldArray({
    control: form.control,
    name: 'exam_findings.regions',
  })

  function handleSave() {
    startSaving(async () => {
      const values = form.getValues()
      const full = buildFullIntake(initialIntake, 'exam_findings', values.exam_findings)
      const result = await saveProviderIntake(caseId, visitType, full)
      if (result.error) toast.error(result.error)
      else toast.success('Exam findings saved')
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription>
          Document physical examination findings by body region — palpation, muscle spasm, and neurological assessment.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <div className="space-y-4">
            <FormField control={form.control} name="exam_findings.general_appearance" render={({ field }) => (
              <FormItem>
                <FormLabel>General Appearance</FormLabel>
                <FormControl><Textarea rows={2} placeholder="e.g., Alert and oriented, in no acute distress" value={field.value ?? ''} onChange={e => field.onChange(e.target.value || null)} /></FormControl>
              </FormItem>
            )} />

            <Separator />

            <div className="space-y-3">
              <FormLabel>Examination Regions</FormLabel>
              {regionsArray.fields.map((field, index) => (
                <div key={field.id} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <FormField control={form.control} name={`exam_findings.regions.${index}.region`} render={({ field: f }) => (
                      <FormItem className="flex-1">
                        <FormControl><Input placeholder="Region (e.g., Cervical Spine)" className="font-semibold" {...f} /></FormControl>
                      </FormItem>
                    )} />
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => regionsArray.remove(index)} disabled={isLocked}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <FormField control={form.control} name={`exam_findings.regions.${index}.palpation_findings`} render={({ field: f }) => (
                    <FormItem>
                      <FormLabel>Palpation Findings</FormLabel>
                      <FormControl><Textarea rows={2} placeholder="e.g., Tenderness and muscle spasm at C3-C7 paraspinal musculature" {...f} /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name={`exam_findings.regions.${index}.muscle_spasm`} render={({ field: f }) => (
                    <FormItem>
                      <FormLabel>Muscle Spasm</FormLabel>
                      <FormControl>
                        <select className="h-9 w-full border rounded-md px-3 text-sm" value={f.value ? 'yes' : 'no'} onChange={e => f.onChange(e.target.value === 'yes')}>
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </select>
                      </FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name={`exam_findings.regions.${index}.additional_findings`} render={({ field: f }) => (
                    <FormItem>
                      <FormLabel>Additional Findings</FormLabel>
                      <FormControl><Textarea rows={2} placeholder="Any other findings for this region..." value={f.value ?? ''} onChange={e => f.onChange(e.target.value || null)} /></FormControl>
                    </FormItem>
                  )} />
                </div>
              ))}

              <Button type="button" variant="outline" size="sm" onClick={() => regionsArray.append({
                region: '', palpation_findings: '', muscle_spasm: false, additional_findings: null,
              })} disabled={isLocked}>
                <Plus className="h-4 w-4 mr-1" /> Add Region
              </Button>
            </div>

            <Separator />

            <FormField control={form.control} name="exam_findings.neurological_notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Neurological Notes</FormLabel>
                <FormControl><Textarea rows={2} placeholder="e.g., Motor strength 5/5 bilaterally, sensation intact, reflexes symmetric" value={field.value ?? ''} onChange={e => field.onChange(e.target.value || null)} /></FormControl>
              </FormItem>
            )} />

            <div className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={handleSave} disabled={isLocked || isSaving}>
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Save Exam Findings
              </Button>
            </div>
          </div>
        </Form>
      </CardContent>
    </Card>
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
                  <FormDescription>{VITALS_NORMAL_RANGES.bp_systolic}</FormDescription>
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
                  <FormDescription>{VITALS_NORMAL_RANGES.bp_diastolic}</FormDescription>
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
                  <FormDescription>{VITALS_NORMAL_RANGES.heart_rate}</FormDescription>
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
                  <FormDescription>{VITALS_NORMAL_RANGES.respiratory_rate}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={vitalsForm.control}
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
                      onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))}
                    />
                  </FormControl>
                  <FormDescription>{VITALS_NORMAL_RANGES.temperature_f}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={vitalsForm.control}
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
                      onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))}
                    />
                  </FormControl>
                  <FormDescription>{VITALS_NORMAL_RANGES.spo2_percent}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={vitalsForm.control}
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
                      onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))}
                    />
                  </FormControl>
                  <FormDescription>{VITALS_NORMAL_RANGES.pain_score_min}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={vitalsForm.control}
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
                      onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))}
                    />
                  </FormControl>
                  <FormDescription>{VITALS_NORMAL_RANGES.pain_score_max}</FormDescription>
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
  visitType,
  initialRom,
  isLocked,
}: {
  caseId: string
  visitType: NoteVisitType
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
      const result = await saveInitialVisitRom(caseId, visitType, validated.data)
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
  visitType,
  visitTypeLabel,
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
  visitType: NoteVisitType
  visitTypeLabel: string
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
      visit_date: note.visit_date ?? new Date().toISOString().slice(0, 10),
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
      const result = await saveInitialVisitNote(caseId, visitType, values)
      if (result.error) toast.error(result.error)
      else toast.success('Draft saved')
    })
  }

  function handleRegenerate(section: InitialVisitSection) {
    setRegeneratingSection(section)
    startTransition(async () => {
      const result = await regenerateNoteSection(caseId, visitType, section)
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
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{visitTypeLabel}</h1>
          <Badge variant="outline">Draft</Badge>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <label htmlFor="visit-date-input" className="text-sm font-medium whitespace-nowrap">
              Date of Visit
            </label>
            <Input
              id="visit-date-input"
              type="date"
              className="w-[160px]"
              disabled={isLocked || isPending}
              {...form.register('visit_date', {
                setValueAs: (v) => (v === '' ? null : v),
              })}
            />
          </div>
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
                  This will discard all generated note content and return to the pre-generation state. Your intake data (chief complaints, accident details, medical history, exam findings), vitals, and ROM data will be preserved. Continue?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    startTransition(async () => {
                      const result = await resetInitialVisitNote(caseId, visitType)
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
                      const saveResult = await saveInitialVisitNote(caseId, visitType, values)
                      if (saveResult.error) {
                        toast.error(saveResult.error)
                        return
                      }
                      const result = await finalizeInitialVisitNote(caseId, visitType)
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
          <RomInputCard caseId={caseId} visitType={visitType} initialRom={initialRom} isLocked={isLocked} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// --- Finalized View ---

function FinalizedView({
  caseId,
  visitType,
  visitTypeLabel,
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
  visitType: NoteVisitType
  visitTypeLabel: string
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
  void initialVitals
  const patientName = caseData
    ? `${caseData.patient.first_name} ${caseData.patient.last_name}`
    : null
  const dob = caseData?.patient.date_of_birth
    ? format(new Date(caseData.patient.date_of_birth), 'MM/dd/yyyy')
    : null
  const age = computeAgeAtDate(
    caseData?.patient.date_of_birth,
    pickVisitAnchor(note.visit_date, note.finalized_at),
  )
  const accidentDate = caseData?.accident_date
    ? format(new Date(caseData.accident_date), 'MM/dd/yyyy')
    : null

  return (
    <div className="space-y-6">
      {/* Action bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{visitTypeLabel}</h1>
          <Badge variant="outline" className="border-green-600 bg-green-500/10 text-green-700 dark:text-green-400">Finalized</Badge>
        </div>
        <div className="flex items-center gap-2">
          {documentFilePath && (
            <Button
              variant="outline"
              disabled={isPending}
              onClick={async () => {
                const filename = buildDownloadFilename({
                  lastName: caseData?.patient.last_name,
                  docType: visitType === 'initial_visit' ? 'InitialVisitNote' : 'PainEvaluationVisitNote',
                  date: note.visit_date ?? note.finalized_at,
                })
                const result = await getDocumentDownloadUrl(documentFilePath, filename)
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
                This will re-open the note for editing and remove the current finalized PDF from the document repository. Re-finalizing will generate a fresh PDF. Continue?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  startTransition(async () => {
                    const result = await unfinalizeInitialVisitNote(caseId, visitType)
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

      <Tabs defaultValue="note">
        <TabsList>
          <TabsTrigger value="note">
            <FileText className="h-3.5 w-3.5 mr-1.5" />
            Note
          </TabsTrigger>
          <TabsTrigger value="orders">
            <ClipboardList className="h-3.5 w-3.5 mr-1.5" />
            Orders
          </TabsTrigger>
        </TabsList>

        <TabsContent value="note" className="mt-4">
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

            {/* Patient Info Block — medical-legal header convention:
                  Indication = injury cause, Visit Type = encounter purpose */}
            {caseData && (
              <>
                <div className="space-y-1 text-sm">
                  {patientName && <p><strong>Patient:</strong> {patientName}</p>}
                  {dob && <p><strong>DOB:</strong> {dob}</p>}
                  {age !== null && <p><strong>Age:</strong> {age}</p>}
                  <p><strong>Date of Service:</strong> {formatVisitDate(note.visit_date, note.finalized_at)}</p>
                  {accidentDate && <p><strong>Date of Injury:</strong> {accidentDate}</p>}
                  <p><strong>Reason for Visit:</strong> {formatReasonForVisit(caseData.accident_type, visitType)}</p>
                  <p><strong>Visit Type:</strong> {formatVisitTypeLabel(visitType)}</p>
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
                    Finalized: {format(new Date(note.finalized_at), 'MM/dd/yyyy \'at\' h:mm a')}
                  </p>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="orders" className="mt-4">
          <CompanionDocumentsSection caseId={caseId} visitType={visitType} isPending={isPending} startTransition={startTransition} isLocked={isLocked} noteFinalized={true} patientLastName={caseData?.patient.last_name ?? null} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// --- Companion Documents Section ---

function CompanionDocumentsSection({
  caseId,
  visitType,
  isPending,
  startTransition,
  isLocked,
  noteFinalized,
  patientLastName,
}: {
  caseId: string
  visitType: NoteVisitType
  isPending: boolean
  startTransition: (callback: () => Promise<void>) => void
  isLocked: boolean
  noteFinalized: boolean
  patientLastName: string | null
}) {
  void startTransition
  const [orders, setOrders] = useState<Array<{
    id: string
    order_type: string
    order_data: Record<string, unknown>
    status: string
    generation_error: string | null
    finalized_at: string | null
    document_id: string | null
    document: { file_path: string | null } | null
    created_at: string
  }>>([])
  const [loadingType, setLoadingType] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  // Load orders on mount and whenever visitType changes
  useEffect(() => {
    loadOrders()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitType])

  async function loadOrders() {
    const { getClinicalOrders } = await import('@/actions/clinical-orders')
    const result = await getClinicalOrders(caseId, visitType)
    if (result.data) {
      setOrders(result.data.map((o: Record<string, unknown>) => ({
        ...o,
        document: Array.isArray(o.document) ? (o.document[0] ?? null) : o.document ?? null,
      })) as typeof orders)
      setLoaded(true)
    }
  }

  async function handleGenerate(orderType: 'imaging' | 'chiropractic_therapy') {
    setLoadingType(orderType)
    try {
      const { generateClinicalOrder } = await import('@/actions/clinical-orders')
      const result = await generateClinicalOrder(caseId, visitType, orderType)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(orderType === 'imaging' ? 'Imaging orders generated' : 'Chiropractic order generated')
        await loadOrders()
      }
    } finally {
      setLoadingType(null)
    }
  }

  async function handleDownload(filePath: string, orderType: string, orderCreatedAt: string) {
    const { getDocumentDownloadUrl } = await import('@/actions/documents')
    const filename = buildDownloadFilename({
      lastName: patientLastName,
      docType: orderType === 'imaging' ? 'ImagingOrders' : 'ChiropracticOrder',
      date: orderCreatedAt,
    })
    const result = await getDocumentDownloadUrl(filePath, filename)
    if (result.url) window.open(result.url, '_blank')
    else toast.error('Failed to get download URL')
  }

  async function handleDelete(orderId: string) {
    const { deleteClinicalOrder } = await import('@/actions/clinical-orders')
    const result = await deleteClinicalOrder(orderId, caseId)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Order deleted')
      await loadOrders()
    }
  }

  const hasImaging = orders.some(o => o.order_type === 'imaging' && o.status !== 'failed')
  const hasChiro = orders.some(o => o.order_type === 'chiropractic_therapy' && o.status !== 'failed')

  const orderTypeLabel = (type: string) =>
    type === 'imaging' ? 'Imaging Orders' : 'Chiropractic Therapy Order'

  const orderTypeIcon = (type: string) =>
    type === 'imaging' ? <FileImage className="h-4 w-4" /> : <Bone className="h-4 w-4" />

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5" />
          Companion Documents
        </CardTitle>
        <CardDescription>
          Generate referral orders and imaging requests based on the finalized Initial Visit note.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Finalization notice */}
        {!noteFinalized && (
          <div className="flex items-center gap-2 rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Finalize the Initial Visit note before generating orders.
          </div>
        )}

        {/* Generation buttons */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={hasImaging || loadingType !== null || isPending || isLocked || !noteFinalized}
            onClick={() => handleGenerate('imaging')}
          >
            {loadingType === 'imaging' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileImage className="mr-2 h-4 w-4" />}
            {hasImaging ? 'Imaging Orders Generated' : 'Generate Imaging Orders'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={hasChiro || loadingType !== null || isPending || isLocked || !noteFinalized}
            onClick={() => handleGenerate('chiropractic_therapy')}
          >
            {loadingType === 'chiropractic_therapy' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bone className="mr-2 h-4 w-4" />}
            {hasChiro ? 'Chiropractic Order Generated' : 'Generate Chiropractic Order'}
          </Button>
        </div>

        {/* Generated orders list */}
        {loaded && orders.length > 0 && (
          <div className="space-y-3">
            {orders.map((order) => (
              <div
                key={order.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="flex items-center gap-3">
                  {orderTypeIcon(order.order_type)}
                  <div>
                    <p className="text-sm font-medium">{orderTypeLabel(order.order_type)}</p>
                    <p className="text-xs text-muted-foreground">
                      {order.status === 'completed' && `Generated ${format(new Date(order.created_at), 'MM/dd/yyyy')}`}
                      {order.status === 'generating' && 'Generating...'}
                      {order.status === 'failed' && `Failed: ${order.generation_error}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {order.status === 'completed' && order.document?.file_path && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownload(order.document!.file_path!, order.order_type, order.created_at)}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Download PDF
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isLocked}
                    onClick={() => handleDelete(order.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {loaded && orders.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No companion documents generated yet. Use the buttons above to create imaging or chiropractic referral orders.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
