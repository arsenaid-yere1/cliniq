'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Loader2, Pencil, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import {
  finalizePainFollowUpNote,
  generatePainFollowUpNote,
  regeneratePainFollowUpSectionAction,
  resetPainFollowUpNote,
  savePainFollowUpNote,
  unfinalizePainFollowUpNote,
} from '@/actions/pain-follow-up-notes'
import { ProcedureOrderDialog } from '@/components/procedures/procedure-order-dialog'
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
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { getPainFollowUpEditorState } from '@/lib/clinical/pain-follow-up-editor-state'
import type { ProcedureSeriesOption } from '@/lib/clinical/procedure-series-labels'
import {
  painFollowUpNoteSectionLabels,
  painFollowUpNoteSections,
  type PainFollowUpSection,
  type ProcedureRecommendation,
} from '@/lib/validations/pain-follow-up-note'
import type { Tables } from '@/types/database'

interface PainFollowUpEditorProps {
  caseId: string
  encounter: Tables<'clinical_encounters'>
  initialNote: Tables<'pain_follow_up_notes'> | null
  seriesOptions?: ProcedureSeriesOption[]
}

type ActionResult = { error?: string; data?: unknown }

export function PainFollowUpEditor({
  caseId,
  encounter,
  initialNote,
  seriesOptions = [],
}: PainFollowUpEditorProps) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [note, setNote] = useState<Record<PainFollowUpSection, string>>(() =>
    Object.fromEntries(
      painFollowUpNoteSections.map((section) => [section, initialNote?.[section] ?? '']),
    ) as Record<PainFollowUpSection, string>,
  )
  const recommendations = (
    initialNote?.procedure_recommendations ?? []
  ) as unknown as ProcedureRecommendation[]
  const editorState = getPainFollowUpEditorState(initialNote)
  const visitWritable = encounter.status === 'in_progress'

  async function run(action: () => Promise<ActionResult>, successMessage: string) {
    setPending(true)
    try {
      const result = await action()
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(successMessage)
      router.refresh()
    } catch {
      toast.error('Something went wrong. Please try again.')
    } finally {
      setPending(false)
    }
  }

  const resetDialog = initialNote ? (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" disabled={pending || !visitWritable}>
          <RotateCcw className="mr-2 h-4 w-4" />
          Reset
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reset Follow-Up Note</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently discards the generated narrative and structured procedure
            recommendations. Visit intake, consent, pain information, and encounter details
            will be preserved. Continue?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending || !visitWritable}
            onClick={() => void run(
              () => resetPainFollowUpNote(caseId, encounter.id),
              'Follow-up note reset successfully',
            )}
          >
            Reset Note
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : null

  if (editorState === 'empty') {
    return (
      <Card>
        <CardHeader><CardTitle>Telehealth follow-up note</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Generate a draft from this visit and the current episode&apos;s clinical history.
          </p>
          <Button
            disabled={pending || !visitWritable}
            onClick={() => void run(
              () => generatePainFollowUpNote(caseId, encounter.id),
              'Follow-up note generated successfully',
            )}
          >
            {pending ? 'Generating…' : 'Generate Follow-Up Note'}
          </Button>
          {encounter.status === 'scheduled' && (
            <p className="text-xs text-muted-foreground">
              Start the visit after documenting intake to enable note generation.
            </p>
          )}
        </CardContent>
      </Card>
    )
  }

  if (editorState === 'generating') {
    return (
      <Card>
        <CardHeader><CardTitle>Telehealth follow-up note</CardTitle></CardHeader>
        <CardContent className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Generating the follow-up note…
        </CardContent>
      </Card>
    )
  }

  if (editorState === 'failed' && initialNote) {
    return (
      <Card>
        <CardHeader><CardTitle>Telehealth follow-up note</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div>
              <p className="text-sm font-medium">Generation failed</p>
              <p className="text-sm text-muted-foreground">
                {initialNote.generation_error ?? 'The follow-up note could not be generated.'}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              disabled={pending || !visitWritable}
              onClick={() => void run(
                () => generatePainFollowUpNote(caseId, encounter.id),
                'Follow-up note generated successfully',
              )}
            >
              {pending ? 'Retrying…' : 'Retry'}
            </Button>
            {resetDialog}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!initialNote) return null

  const finalized = editorState === 'finalized'
  const actionDisabled = pending || !visitWritable
  const editValues = {
    encounter_id: encounter.id,
    subjective: note.subjective,
    interval_history: note.interval_history,
    review_of_systems: note.review_of_systems,
    telehealth_observations: note.telehealth_observations,
    imaging_review: note.imaging_review,
    assessment: note.assessment,
    diagnoses: note.diagnoses,
    treatment_plan: note.treatment_plan,
    patient_education: note.patient_education,
    follow_up: note.follow_up,
    clinician_disclaimer: note.clinician_disclaimer,
    procedure_recommendations: recommendations,
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Telehealth follow-up note</h2>
          <p className="text-sm capitalize text-muted-foreground">{initialNote.status}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {finalized && initialNote.document_id && (
            <Button variant="outline" asChild>
              <Link href={`/patients/${caseId}/documents`}>View finalized PDF</Link>
            </Button>
          )}
          {finalized ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={pending || encounter.status !== 'completed'}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Unfinalize
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Unfinalize Follow-Up Note</AlertDialogTitle>
                  <AlertDialogDescription>
                    This reopens the note for editing, returns the visit to in progress, and
                    removes the current finalized PDF. The generated note content is preserved;
                    Reset remains a separate action after reopening. Re-finalizing creates a
                    fresh PDF. Continue?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={pending || encounter.status !== 'completed'}
                    onClick={() => void run(
                      () => unfinalizePainFollowUpNote(caseId, initialNote.id),
                      'Follow-up note reopened successfully',
                    )}
                  >
                    Unfinalize Note
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <>
              {resetDialog}
              <Button
                variant="outline"
                disabled={actionDisabled}
                onClick={() => void run(
                  () => savePainFollowUpNote(caseId, editValues),
                  'Follow-up note saved',
                )}
              >
                Save Draft
              </Button>
              <Button
                disabled={actionDisabled}
                onClick={() => void run(
                  () => finalizePainFollowUpNote(caseId, encounter.id),
                  'Follow-up note finalized successfully',
                )}
              >
                Finalize &amp; Complete Visit
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-4">
        {painFollowUpNoteSections.map((section) => {
          const label = painFollowUpNoteSectionLabels[section]
          return (
            <Card key={section}>
              <CardHeader className="flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm">{label}</CardTitle>
                {!finalized && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={actionDisabled}
                    onClick={() => void run(
                      () => regeneratePainFollowUpSectionAction(caseId, encounter.id, section),
                      `${label} regenerated`,
                    )}
                  >
                    Regenerate
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                <Label className="sr-only" htmlFor={section}>{label}</Label>
                <Textarea
                  id={section}
                  value={note[section]}
                  disabled={finalized || !visitWritable}
                  rows={4}
                  onChange={(event) => setNote((current) => ({
                    ...current,
                    [section]: event.target.value,
                  }))}
                />
              </CardContent>
            </Card>
          )
        })}
      </div>

      {recommendations.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Structured procedure recommendations</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {recommendations.map((recommendation) => (
              <div
                key={recommendation.recommendation_id}
                className="flex items-start justify-between gap-4 rounded-md border p-3"
              >
                <div>
                  <p className="font-medium uppercase">{recommendation.procedure_type}</p>
                  <p className="text-sm text-muted-foreground">{recommendation.sites.join(', ')}</p>
                  <p className="mt-1 text-sm">{recommendation.rationale}</p>
                </div>
                {finalized && (
                  <ProcedureOrderDialog
                    caseId={caseId}
                    episodeId={encounter.episode_id}
                    encounterId={encounter.id}
                    recommendation={recommendation}
                    seriesOptions={seriesOptions}
                  />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
