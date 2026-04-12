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
import { Input } from '@/components/ui/input'
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
  generateDischargeNote,
  saveDischargeNote,
  finalizeDischargeNote,
  unfinalizeDischargeNote,
  regenerateDischargeNoteSectionAction,
} from '@/actions/discharge-notes'
import { getDocumentDownloadUrl } from '@/actions/documents'
import {
  dischargeNoteEditSchema,
  dischargeNoteSections,
  dischargeNoteSectionLabels,
  type DischargeNoteEditValues,
  type DischargeNoteSection,
} from '@/lib/validations/discharge-note'
import { useCaseStatus } from '@/components/patients/case-status-context'
import { LOCKED_STATUSES, type CaseStatus } from '@/lib/constants/case-status'
import { formatIndication } from '@/lib/constants/clinical-note-header'

interface NoteRow {
  id: string
  case_id: string
  patient_header: string | null
  subjective: string | null
  objective_vitals: string | null
  objective_general: string | null
  objective_cervical: string | null
  objective_lumbar: string | null
  objective_neurological: string | null
  diagnoses: string | null
  assessment: string | null
  plan_and_recommendations: string | null
  patient_education: string | null
  prognosis: string | null
  clinician_disclaimer: string | null
  status: string
  generation_error: string | null
  visit_date: string | null
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

interface DischargeNoteEditorProps {
  caseId: string
  note: NoteRow | null
  canGenerate: boolean
  prerequisiteReason?: string
  clinicSettings: ClinicSettings | null
  providerProfile: ProviderProfile | null
  clinicLogoUrl: string | null
  providerSignatureUrl: string | null
  caseData: CaseData | null
  documentFilePath: string | null
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

const sectionRows: Record<DischargeNoteSection, number> = {
  patient_header:          4,
  subjective:              8,
  objective_vitals:        4,
  objective_general:       4,
  objective_cervical:      5,
  objective_lumbar:        5,
  objective_neurological:  5,
  diagnoses:               6,
  assessment:              5,
  plan_and_recommendations: 8,
  patient_education:       5,
  prognosis:               4,
  clinician_disclaimer:    4,
}

export function DischargeNoteEditor({
  caseId,
  note,
  canGenerate,
  prerequisiteReason,
  clinicSettings,
  providerProfile,
  clinicLogoUrl,
  providerSignatureUrl,
  caseData,
  documentFilePath,
}: DischargeNoteEditorProps) {
  const [isPending, startTransition] = useTransition()
  const [regeneratingSection, setRegeneratingSection] = useState<DischargeNoteSection | null>(null)
  const caseStatus = useCaseStatus()
  const isLocked = LOCKED_STATUSES.includes(caseStatus as CaseStatus)

  // No note — show generate button
  if (!note) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Discharge Summary</h1>
        <div className="flex flex-col items-center justify-center py-16 space-y-4 border rounded-lg bg-muted/30">
          <p className="text-sm text-muted-foreground text-center max-w-md">
            {canGenerate
              ? 'Generate an AI-powered discharge summary from the aggregated case data.'
              : prerequisiteReason || 'Cannot generate note.'}
          </p>
          <Button
            onClick={() => {
              startTransition(async () => {
                const result = await generateDischargeNote(caseId)
                if (result.error) toast.error(result.error)
                else toast.success('Discharge summary generated successfully')
              })
            }}
            disabled={isLocked || !canGenerate || isPending}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Generate Discharge Summary
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
          <h1 className="text-2xl font-bold">Discharge Summary</h1>
          <Badge variant="outline">Generating...</Badge>
        </div>
        <div className="space-y-6">
          {dischargeNoteSections.map((section) => (
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
          <h1 className="text-2xl font-bold">Discharge Summary</h1>
          <Badge variant="destructive">Failed</Badge>
        </div>
        <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {note.generation_error || 'Discharge summary generation failed.'}
        </div>
        <Button
          variant="outline"
          onClick={() => {
            startTransition(async () => {
              const result = await generateDischargeNote(caseId)
              if (result.error) toast.error(result.error)
              else toast.success('Discharge summary generated successfully')
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
      />
    )
  }

  // Draft state
  return (
    <DraftEditor
      caseId={caseId}
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
  note,
  isPending,
  startTransition,
  regeneratingSection,
  setRegeneratingSection,
  isLocked,
}: {
  caseId: string
  note: NoteRow
  isPending: boolean
  startTransition: (callback: () => Promise<void>) => void
  regeneratingSection: DischargeNoteSection | null
  setRegeneratingSection: (s: DischargeNoteSection | null) => void
  isLocked: boolean
}) {
  const form = useForm<DischargeNoteEditValues>({
    resolver: zodResolver(dischargeNoteEditSchema),
    defaultValues: {
      visit_date: note.visit_date ?? new Date().toISOString().slice(0, 10),
      ...(Object.fromEntries(
        dischargeNoteSections.map((s) => [s, note[s] || ''])
      ) as Omit<DischargeNoteEditValues, 'visit_date'>),
    },
  })

  function handleSave() {
    startTransition(async () => {
      const values = form.getValues()
      const result = await saveDischargeNote(caseId, values)
      if (result.error) toast.error(result.error)
      else toast.success('Draft saved')
    })
  }

  function handleRegenerate(section: DischargeNoteSection) {
    setRegeneratingSection(section)
    startTransition(async () => {
      const result = await regenerateDischargeNoteSectionAction(caseId, section)
      if (result.error) {
        toast.error(result.error)
      } else if (result.data?.content) {
        form.setValue(section, result.data.content)
        toast.success(`${dischargeNoteSectionLabels[section]} regenerated`)
      }
      setRegeneratingSection(null)
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Discharge Summary</h1>
          <Badge variant="outline">Draft</Badge>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <label htmlFor="discharge-visit-date-input" className="text-sm font-medium whitespace-nowrap">
              Date of Visit
            </label>
            <Input
              id="discharge-visit-date-input"
              type="date"
              className="w-[160px]"
              disabled={isLocked || isPending}
              {...form.register('visit_date', {
                setValueAs: (v) => (v === '' ? null : v),
              })}
            />
          </div>
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
                <AlertDialogTitle>Finalize Discharge Summary</AlertDialogTitle>
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
                      const saveResult = await saveDischargeNote(caseId, values)
                      if (saveResult.error) {
                        toast.error(saveResult.error)
                        return
                      }
                      const result = await finalizeDischargeNote(caseId)
                      if (result.error) toast.error(result.error)
                      else toast.success('Discharge summary finalized')
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
          {dischargeNoteSections.map((section) => (
            <FormField
              key={section}
              control={form.control}
              name={section}
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel className="text-base font-semibold">
                      {dischargeNoteSectionLabels[section]}
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
                            This will replace the current content of &ldquo;{dischargeNoteSectionLabels[section]}&rdquo; with newly generated content. Other sections will not be affected. Continue?
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
  isLocked,
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

  return (
    <div className="space-y-6">
      {/* Action bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Discharge Summary</h1>
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
                <AlertDialogTitle>Unfinalize Discharge Summary</AlertDialogTitle>
                <AlertDialogDescription>
                  This will re-open the note for editing. The existing document record will be preserved. Continue?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    startTransition(async () => {
                      const result = await unfinalizeDischargeNote(caseId)
                      if (result.error) toast.error(result.error)
                      else toast.success('Discharge summary reopened for editing')
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

        {/* Document Title */}
        <h2 className="text-center font-bold text-base">FINAL PRP FOLLOW-UP AND DISCHARGE VISIT</h2>

        {/* Patient Info Block — medical-legal header convention:
              Indication = injury cause, Visit Type = encounter purpose */}
        <div className="space-y-1 text-sm">
          {patientName && <p><strong>Patient:</strong> {patientName}</p>}
          {dob && <p><strong>DOB:</strong> {dob}</p>}
          <p><strong>Date of Service:</strong> {formatVisitDate(note.visit_date, note.finalized_at)}</p>
          {accidentDate && <p><strong>Date of Injury:</strong> {accidentDate}</p>}
          <p><strong>Indication:</strong> {formatIndication(caseData?.accident_type)}</p>
          <p><strong>Visit Type:</strong> Post-PRP Series Follow-Up and Discharge Evaluation</p>
        </div>

        <Separator />

        {/* patient_header — opening narrative, no heading */}
        {note.patient_header && (
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{note.patient_header}</p>
        )}

        {/* Remaining sections */}
        {dischargeNoteSections.slice(1).map((section) => {
          const content = note[section]
          if (!content) return null
          return (
            <div key={section}>
              <h3 className="text-sm font-bold mb-2">{dischargeNoteSectionLabels[section]}</h3>
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
