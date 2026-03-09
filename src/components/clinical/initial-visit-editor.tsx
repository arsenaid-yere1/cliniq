'use client'

import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { Sparkles, RefreshCw, Loader2, AlertTriangle, Save, Lock, Pencil } from 'lucide-react'
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
  generateInitialVisitNote,
  saveInitialVisitNote,
  finalizeInitialVisitNote,
  unfinalizeInitialVisitNote,
  regenerateNoteSection,
} from '@/actions/initial-visit-notes'
import {
  initialVisitNoteEditSchema,
  initialVisitSections,
  sectionLabels,
  type InitialVisitNoteEditValues,
  type InitialVisitSection,
} from '@/lib/validations/initial-visit-note'

interface NoteRow {
  id: string
  case_id: string
  patient_info: string | null
  chief_complaint: string | null
  history_of_present_illness: string | null
  imaging_review: string | null
  prior_treatment_summary: string | null
  physical_exam: string | null
  assessment: string | null
  treatment_plan: string | null
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

interface InitialVisitEditorProps {
  caseId: string
  note: NoteRow | null
  canGenerate: boolean
  prerequisiteReason?: string
  clinicSettings: ClinicSettings | null
  providerProfile: ProviderProfile | null
  clinicLogoUrl: string | null
  providerSignatureUrl: string | null
}

export function InitialVisitEditor({
  caseId,
  note,
  canGenerate,
  prerequisiteReason,
  clinicSettings,
  providerProfile,
  clinicLogoUrl,
  providerSignatureUrl,
}: InitialVisitEditorProps) {
  const [isPending, startTransition] = useTransition()
  const [regeneratingSection, setRegeneratingSection] = useState<InitialVisitSection | null>(null)

  // No note — show generate button
  if (!note) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Initial Visit Note</h1>
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
            disabled={!canGenerate || isPending}
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
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
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
          disabled={isPending}
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
        isPending={isPending}
        startTransition={startTransition}
      />
    )
  }

  // Draft state — editable form
  return (
    <DraftEditor
      caseId={caseId}
      note={note}
      isPending={isPending}
      startTransition={startTransition}
      regeneratingSection={regeneratingSection}
      setRegeneratingSection={setRegeneratingSection}
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
}: {
  caseId: string
  note: NoteRow
  isPending: boolean
  startTransition: (callback: () => Promise<void>) => void
  regeneratingSection: InitialVisitSection | null
  setRegeneratingSection: (s: InitialVisitSection | null) => void
}) {
  const form = useForm<InitialVisitNoteEditValues>({
    resolver: zodResolver(initialVisitNoteEditSchema),
    defaultValues: {
      patient_info: note.patient_info || '',
      chief_complaint: note.chief_complaint || '',
      history_of_present_illness: note.history_of_present_illness || '',
      imaging_review: note.imaging_review || '',
      prior_treatment_summary: note.prior_treatment_summary || '',
      physical_exam: note.physical_exam || '',
      assessment: note.assessment || '',
      treatment_plan: note.treatment_plan || '',
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
          <Button variant="outline" onClick={handleSave} disabled={isPending}>
            {isPending && !regeneratingSection ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Save Draft
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={isPending}>
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
                          disabled={isPending}
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
                      rows={6}
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
  isPending,
  startTransition,
}: {
  caseId: string
  note: NoteRow
  clinicSettings: ClinicSettings | null
  providerProfile: ProviderProfile | null
  clinicLogoUrl: string | null
  providerSignatureUrl: string | null
  isPending: boolean
  startTransition: (callback: () => Promise<void>) => void
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Initial Visit Note</h1>
          <Badge variant="outline" className="border-green-500 bg-green-50 text-green-700">Finalized</Badge>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={isPending}>
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

      {/* Clinic Header */}
      <div className="border rounded-lg p-6 bg-white">
        <div className="flex items-start justify-between mb-6">
          <div className="space-y-1">
            {clinicLogoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={clinicLogoUrl} alt="Clinic logo" className="h-12 mb-2" />
            )}
            {clinicSettings?.clinic_name && (
              <h2 className="text-lg font-bold">{clinicSettings.clinic_name}</h2>
            )}
            {clinicSettings?.address_line1 && (
              <p className="text-sm text-muted-foreground">{clinicSettings.address_line1}</p>
            )}
            {clinicSettings?.address_line2 && (
              <p className="text-sm text-muted-foreground">{clinicSettings.address_line2}</p>
            )}
            {(clinicSettings?.city || clinicSettings?.state || clinicSettings?.zip_code) && (
              <p className="text-sm text-muted-foreground">
                {[clinicSettings.city, clinicSettings.state].filter(Boolean).join(', ')} {clinicSettings.zip_code}
              </p>
            )}
            {(clinicSettings?.phone || clinicSettings?.fax) && (
              <p className="text-sm text-muted-foreground">
                {clinicSettings.phone && `Phone: ${clinicSettings.phone}`}
                {clinicSettings.phone && clinicSettings.fax && ' | '}
                {clinicSettings.fax && `Fax: ${clinicSettings.fax}`}
              </p>
            )}
          </div>
          <div className="text-right">
            <h3 className="text-lg font-semibold">Initial Visit Note</h3>
            {note.finalized_at && (
              <p className="text-sm text-muted-foreground">
                {format(new Date(note.finalized_at), 'MMMM d, yyyy')}
              </p>
            )}
          </div>
        </div>

        <Separator className="mb-6" />

        {/* Note Sections */}
        <div className="space-y-6">
          {initialVisitSections.map((section) => {
            const content = note[section]
            if (!content) return null
            return (
              <section key={section}>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  {sectionLabels[section]}
                </h3>
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{content}</p>
              </section>
            )
          })}
        </div>

        {/* Provider Signature Block */}
        <Separator className="my-6" />
        <div className="flex flex-col items-end space-y-2">
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
  )
}
