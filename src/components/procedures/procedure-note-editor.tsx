'use client'

import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { Sparkles, RefreshCw, Loader2, AlertTriangle, Save, Lock, Pencil, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
  generateProcedureNote,
  saveProcedureNote,
  finalizeProcedureNote,
  unfinalizeProcedureNote,
  regenerateProcedureNoteSectionAction,
} from '@/actions/procedure-notes'
import { getDocumentDownloadUrl } from '@/actions/documents'
import {
  procedureNoteEditSchema,
  procedureNoteSections,
  procedureNoteSectionLabels,
  type ProcedureNoteEditValues,
  type ProcedureNoteSection,
} from '@/lib/validations/procedure-note'
import { useCaseStatus } from '@/components/patients/case-status-context'
import { LOCKED_STATUSES, type CaseStatus } from '@/lib/constants/case-status'

interface NoteRow {
  id: string
  case_id: string
  procedure_id: string
  subjective: string | null
  past_medical_history: string | null
  allergies: string | null
  current_medications: string | null
  social_history: string | null
  review_of_systems: string | null
  objective_vitals: string | null
  objective_physical_exam: string | null
  assessment_summary: string | null
  procedure_indication: string | null
  procedure_preparation: string | null
  procedure_prp_prep: string | null
  procedure_anesthesia: string | null
  procedure_injection: string | null
  procedure_post_care: string | null
  procedure_followup: string | null
  assessment_and_plan: string | null
  patient_education: string | null
  prognosis: string | null
  clinician_disclaimer: string | null
  status: string
  generation_error: string | null
  finalized_at: string | null
  finalized_by_user_id: string | null
  document_id: string | null
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

interface ProcedureInfo {
  procedure_date: string
  procedure_name: string
  procedure_number: number
  injection_site: string | null
  laterality: string | null
  indication: string
}

interface ProcedureNoteEditorProps {
  caseId: string
  procedureId: string
  note: NoteRow | null
  canGenerate: boolean
  prerequisiteReason?: string
  clinicSettings: ClinicSettings | null
  providerProfile: ProviderProfile | null
  clinicLogoUrl: string | null
  providerSignatureUrl: string | null
  caseData: CaseData | null
  procedureInfo: ProcedureInfo
  documentFilePath: string | null
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

const sectionRows: Record<ProcedureNoteSection, number> = {
  subjective:              6,
  past_medical_history:    4,
  allergies:               3,
  current_medications:     4,
  social_history:          3,
  review_of_systems:       4,
  objective_vitals:        4,
  objective_physical_exam: 8,
  assessment_summary:      5,
  procedure_indication:    4,
  procedure_preparation:   4,
  procedure_prp_prep:      4,
  procedure_anesthesia:    3,
  procedure_injection:     5,
  procedure_post_care:     5,
  procedure_followup:      4,
  assessment_and_plan:     6,
  patient_education:       5,
  prognosis:               3,
  clinician_disclaimer:    3,
}

export function ProcedureNoteEditor({
  caseId,
  procedureId,
  note,
  canGenerate,
  prerequisiteReason,
  clinicSettings,
  providerProfile,
  clinicLogoUrl,
  providerSignatureUrl,
  caseData,
  procedureInfo,
  documentFilePath,
}: ProcedureNoteEditorProps) {
  const [isPending, startTransition] = useTransition()
  const [regeneratingSection, setRegeneratingSection] = useState<ProcedureNoteSection | null>(null)
  const caseStatus = useCaseStatus()
  const isLocked = LOCKED_STATUSES.includes(caseStatus as CaseStatus)

  // No note — show generate button
  if (!note) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Procedure Note</h1>
        <div className="flex flex-col items-center justify-center py-16 space-y-4 border rounded-lg bg-muted/30">
          <p className="text-sm text-muted-foreground text-center max-w-md">
            {canGenerate
              ? 'Generate an AI-powered PRP Procedure Note from the case data and procedure details.'
              : prerequisiteReason || 'Cannot generate note.'}
          </p>
          <Button
            onClick={() => {
              startTransition(async () => {
                const result = await generateProcedureNote(procedureId, caseId)
                if (result.error) toast.error(result.error)
                else toast.success('Note generated successfully')
              })
            }}
            disabled={isLocked || !canGenerate || isPending}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Generate Procedure Note
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
          <h1 className="text-2xl font-bold">Procedure Note</h1>
          <Badge variant="outline">Generating...</Badge>
        </div>
        <div className="space-y-6">
          {procedureNoteSections.map((section) => (
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
          <h1 className="text-2xl font-bold">Procedure Note</h1>
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
              const result = await generateProcedureNote(procedureId, caseId)
              if (result.error) toast.error(result.error)
              else toast.success('Note generated successfully')
            })
          }}
          disabled={isLocked || isPending}
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Retry
        </Button>
      </div>
    )
  }

  // Finalized state
  if (note.status === 'finalized') {
    return (
      <FinalizedView
        caseId={caseId}
        procedureId={procedureId}
        note={note}
        clinicSettings={clinicSettings}
        providerProfile={providerProfile}
        clinicLogoUrl={clinicLogoUrl}
        providerSignatureUrl={providerSignatureUrl}
        caseData={caseData}
        procedureInfo={procedureInfo}
        documentFilePath={documentFilePath}
        isPending={isPending}
        startTransition={startTransition}
        isLocked={isLocked}
      />
    )
  }

  // Draft state
  return (
    <DraftEditor
      caseId={caseId}
      procedureId={procedureId}
      note={note}
      isPending={isPending}
      startTransition={startTransition}
      regeneratingSection={regeneratingSection}
      setRegeneratingSection={setRegeneratingSection}
      isLocked={isLocked}
    />
  )
}

// --- Draft Editor ---

function DraftEditor({
  caseId,
  procedureId,
  note,
  isPending,
  startTransition,
  regeneratingSection,
  setRegeneratingSection,
  isLocked,
}: {
  caseId: string
  procedureId: string
  note: NoteRow
  isPending: boolean
  startTransition: (callback: () => Promise<void>) => void
  regeneratingSection: ProcedureNoteSection | null
  setRegeneratingSection: (s: ProcedureNoteSection | null) => void
  isLocked: boolean
}) {
  const form = useForm<ProcedureNoteEditValues>({
    resolver: zodResolver(procedureNoteEditSchema),
    defaultValues: Object.fromEntries(
      procedureNoteSections.map((s) => [s, note[s] || ''])
    ) as ProcedureNoteEditValues,
  })

  function handleSave() {
    startTransition(async () => {
      const values = form.getValues()
      const result = await saveProcedureNote(procedureId, caseId, values)
      if (result.error) toast.error(result.error)
      else toast.success('Draft saved')
    })
  }

  function handleRegenerate(section: ProcedureNoteSection) {
    setRegeneratingSection(section)
    startTransition(async () => {
      const result = await regenerateProcedureNoteSectionAction(procedureId, caseId, section)
      if (result.error) {
        toast.error(result.error)
      } else if (result.data?.content) {
        form.setValue(section, result.data.content)
        toast.success(`${procedureNoteSectionLabels[section]} regenerated`)
      }
      setRegeneratingSection(null)
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Procedure Note</h1>
          <Badge variant="outline">Draft</Badge>
        </div>
        <div className="flex items-center gap-2">
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
                      const values = form.getValues()
                      const saveResult = await saveProcedureNote(procedureId, caseId, values)
                      if (saveResult.error) {
                        toast.error(saveResult.error)
                        return
                      }
                      const result = await finalizeProcedureNote(procedureId, caseId)
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

      <Form {...form}>
        <form className="space-y-6">
          {procedureNoteSections.map((section) => (
            <FormField
              key={section}
              control={form.control}
              name={section}
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel className="text-base font-semibold">
                      {procedureNoteSectionLabels[section]}
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
                            This will replace the current content of &ldquo;{procedureNoteSectionLabels[section]}&rdquo; with newly generated content. Other sections will not be affected. Continue?
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
  procedureId,
  note,
  clinicSettings,
  providerProfile,
  clinicLogoUrl,
  providerSignatureUrl,
  caseData,
  procedureInfo,
  documentFilePath,
  isPending,
  startTransition,
  isLocked,
}: {
  caseId: string
  procedureId: string
  note: NoteRow
  clinicSettings: ClinicSettings | null
  providerProfile: ProviderProfile | null
  clinicLogoUrl: string | null
  providerSignatureUrl: string | null
  caseData: CaseData | null
  procedureInfo: ProcedureInfo
  documentFilePath: string | null
  isPending: boolean
  startTransition: (callback: () => Promise<void>) => void
  isLocked: boolean
}) {
  const patientName = caseData
    ? `${caseData.patient.first_name} ${caseData.patient.last_name}`
    : null
  const dob = caseData?.patient.date_of_birth
    ? format(new Date(caseData.patient.date_of_birth + 'T00:00:00'), 'MM/dd/yyyy')
    : null
  const accidentDate = caseData?.accident_date
    ? format(new Date(caseData.accident_date + 'T00:00:00'), 'MM/dd/yyyy')
    : null
  const procedureDate = procedureInfo.procedure_date
    ? format(new Date(procedureInfo.procedure_date + 'T00:00:00'), 'MM/dd/yyyy')
    : null
  const procedureDisplayName = procedureInfo.injection_site
    ? `${procedureInfo.procedure_name} \u2013 ${procedureInfo.injection_site}`
    : procedureInfo.procedure_name

  return (
    <div className="space-y-6">
      {/* Action bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Procedure Note</h1>
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
                      const result = await unfinalizeProcedureNote(procedureId, caseId)
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

        {/* Clinic Header */}
        <div className="text-center space-y-1">
          {clinicLogoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={clinicLogoUrl} alt="Clinic logo" className="h-16 mx-auto mb-2" />
          )}
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

        {/* Procedure Header Block */}
        <div className="space-y-1 text-sm">
          {patientName && <p><strong>Patient:</strong> {patientName}</p>}
          {dob && <p><strong>DOB:</strong> {dob}</p>}
          {procedureDate && <p><strong>Date of Visit:</strong> {procedureDate}</p>}
          {accidentDate && <p><strong>Date of Injury:</strong> {accidentDate}</p>}
          <p><strong>Procedure:</strong> {procedureDisplayName}</p>
          <p><strong>Injection #:</strong> {ordinal(procedureInfo.procedure_number)} Injection</p>
        </div>

        <Separator />

        {/* Sections */}
        {procedureNoteSections.map((section) => {
          const content = note[section]
          if (!content) return null
          return (
            <div key={section}>
              <h3 className="text-sm font-bold mb-2">{procedureNoteSectionLabels[section]}</h3>
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{content}</p>
            </div>
          )
        })}

        <Separator />

        {/* Signature */}
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
