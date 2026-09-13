'use client'

import { FollowUpSourceReview } from './follow-up-source-review'
import { useFollowUpWorkspace } from './follow-up-workspace'
import type { FollowUpReviewState } from '@/lib/clinical/pain-follow-up-source'
import { VisitTreatmentDecisionFields } from '@/components/clinical/visit-treatment-decision-fields'
import { visitDecisionDraft, parseVisitDecision, normalizeVisitPlan } from '@/lib/validations/visit-treatment-decision'
import { useCaseStatus } from '@/components/patients/case-status-context'
import { LOCKED_STATUSES, type CaseStatus } from '@/lib/constants/case-status'

import { ClinicalResetDialog } from '@/components/clinical/clinical-reset-dialog'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  applyPainFollowUpProposal,
  discardPainFollowUpProposal,
  reviewPainFollowUpSources,
  finalizePainFollowUpNote,
  generatePainFollowUpNote,
  regeneratePainFollowUpSectionAction,
  savePainFollowUpNote,
} from '@/actions/pain-follow-up-notes'
import { ProcedureOrderDialog } from '@/components/procedures/procedure-order-dialog'
import type { ProcedureOrderSummary } from '@/actions/procedure-orders'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { getPainFollowUpEditorState } from '@/lib/clinical/pain-follow-up-editor-state'
import type { ProcedureSeriesChoice } from '@/lib/clinical/procedure-series-labels'
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
  seriesChoices?: ProcedureSeriesChoice[]
  procedureOrders?: ProcedureOrderSummary[]
  relationshipLoadError?: boolean
  episodeWritable?: boolean
  review?: FollowUpReviewState | null
}

type ActionResult = { error?: string; data?: unknown }

export function PainFollowUpEditor({
  caseId,
  encounter,
  initialNote: incomingNote,
  review = null,
  seriesChoices = [],
  procedureOrders = [],
  relationshipLoadError = false,
  episodeWritable = true,
}: PainFollowUpEditorProps) {
  const router = useRouter()
  const { intakeDirty } = useFollowUpWorkspace()
  const [initialNote, setBaseNote] = useState(incomingNote)
  const [observed, setObserved] = useState(incomingNote)
  const [pending, setPending] = useState(false)
  const [note, setNote] = useState<Record<PainFollowUpSection, string>>(() =>
    Object.fromEntries(
      painFollowUpNoteSections.map((section) => [section, initialNote?.[section] ?? '']),
    ) as Record<PainFollowUpSection, string>,
  )
  const [decision, setDecision] = useState(() => visitDecisionDraft(initialNote?.visit_treatment_decision))
  const dirty = painFollowUpNoteSections.some((key) => note[key] !== (initialNote?.[key] ?? ''))
    || JSON.stringify(decision) !== JSON.stringify(visitDecisionDraft(initialNote?.visit_treatment_decision))
  function adopt(saved: Tables<'pain_follow_up_notes'> | null) {
    setBaseNote(saved)
    setNote(Object.fromEntries(painFollowUpNoteSections.map((key) => [key, saved?.[key] ?? ''])) as Record<PainFollowUpSection, string>)
    setDecision(visitDecisionDraft(saved?.visit_treatment_decision))
  }
  // Only clean editors adopt external versions. Dirty text stays visible for reconciliation.
  if (observed !== incomingNote) {
    setObserved(incomingNote)
    if (!dirty) adopt(incomingNote)
  }
  const conflict = initialNote?.updated_at !== incomingNote?.updated_at
  const caseLocked = LOCKED_STATUSES.includes(useCaseStatus() as CaseStatus)
  const recommendations = (
    initialNote?.procedure_recommendations ?? []
  ) as unknown as ProcedureRecommendation[]
  const editorState = review?.proposal && initialNote ? 'draft' : getPainFollowUpEditorState(initialNote)
  const visitWritable = encounter.status === 'in_progress' && !caseLocked && episodeWritable

  async function run(action: () => Promise<ActionResult>, successMessage: string) {
    setPending(true)
    try {
      const result = await action()
      if (result.error) {
        router.refresh()
        toast.error(result.error)
        return
      }
      const data = result.data as { note?: Tables<'pain_follow_up_notes'>; savedNote?: Tables<'pain_follow_up_notes'> } | undefined
      const saved = data?.note ?? data?.savedNote
      if (saved) adopt({ ...initialNote, ...saved } as Tables<'pain_follow_up_notes'>)
      toast.success(successMessage)
      router.refresh()
    } catch {
      toast.error('Something went wrong. Please try again.')
    } finally {
      setPending(false)
    }
  }

  const resetDialog = initialNote ? (
    <ClinicalResetDialog caseId={caseId} target={{ kind: "pain_follow_up_notes", id: initialNote.id }} disabled={pending} />
  ) : null

  if (editorState === 'empty') {
    return (
      <Card>
        <CardHeader><CardTitle>Telehealth follow-up note</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Generate a draft from this visit and the current episode&apos;s clinical history.
          </p>
        {intakeDirty && <p role="alert">Save encounter intake before generating the note.</p>}
          {!review && <p role="alert">Visit information could not be checked. Save the visit date and refresh before generating.</p>}
          <Button
            disabled={pending || !visitWritable || intakeDirty || !review}
            onClick={() => void run(
              () => generatePainFollowUpNote(caseId, encounter.id, initialNote?.updated_at),
              'Proposed draft ready for review',
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
            <p className="text-sm">Use Reset to clear the failed generation, then prepare a new proposed draft.</p>
            {resetDialog}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!initialNote) return null

  const finalized = editorState === 'finalized'
  const actionDisabled = pending || !visitWritable || conflict
  const reviewDisabled = actionDisabled || dirty || intakeDirty
  const savedDecision = parseVisitDecision(initialNote.visit_treatment_decision)
  const decisionNeedsReview = !savedDecision || savedDecision.reviewed_plan !== normalizeVisitPlan(note.treatment_plan) || savedDecision.visit_date !== encounter.encounter_date
  const signingDisabled = decisionNeedsReview || reviewDisabled || !review?.reviewed || review.note_version !== initialNote.updated_at
  const editValues = {
    encounter_id: encounter.id,
    reviewed_visit_date: encounter.encounter_date,
    treatment_decision: decision,
    expected_updated_at: initialNote.updated_at,
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
            <><ClinicalResetDialog caseId={caseId} target={{ kind: "pain_follow_up_notes", id: initialNote.id }} disabled={pending} /><ClinicalResetDialog caseId={caseId} target={{ kind: "pain_follow_up_notes", id: initialNote.id }} keepContent disabled={pending} /></>
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
                disabled={signingDisabled}
                onClick={() => void run(
                  () => finalizePainFollowUpNote(caseId, encounter.id, initialNote.updated_at),
                  'Follow-up note finalized successfully',
                )}
              >
                Finalize &amp; Complete Visit
              </Button>
            </>
          )}
        </div>
      </div>

      {!finalized && <>
        {decisionNeedsReview && <p role="status">Review the patient’s treatment decision and Save Draft before signing.</p>}
        {intakeDirty && <p role="alert">Save encounter intake before generating, reviewing, or signing the note.</p>}
        {dirty && <p role="status">You have unsaved note edits. Save Draft before generating or confirming source review.</p>}
        {conflict && <div role="alert" className="space-y-2 rounded border p-3"><p>A different saved version is available. Your local text has been kept. Copy any edits you want to retain before loading it.</p><Button variant="outline" onClick={() => adopt(incomingNote)}>Discard local edits and load saved version</Button></div>}
        <FollowUpSourceReview key={`${review?.snapshot.fingerprint}:${initialNote.updated_at}:${review?.proposal?.id}:${dirty}:${intakeDirty}`} review={review} current={{ ...note, procedure_recommendations: recommendations }} disabled={reviewDisabled}
          onApply={() => void run(() => applyPainFollowUpProposal(caseId, encounter.id, initialNote.updated_at, review!.proposal!.id), 'Reviewed replacement applied')}
          onDiscard={() => void run(() => discardPainFollowUpProposal(caseId, encounter.id, initialNote.updated_at, review!.proposal!.id), 'Proposal discarded; saved text kept')}
          onReview={() => void run(() => reviewPainFollowUpSources(caseId, encounter.id, initialNote.updated_at, review!.snapshot.fingerprint), 'Source review recorded')} />
        <Button variant="outline" disabled={reviewDisabled || !review || !!review.proposal} onClick={() => void run(() => generatePainFollowUpNote(caseId, encounter.id, initialNote.updated_at), 'Proposed draft ready for review')}>Generate updated draft</Button>
      </>}
      {finalized && <p className="text-sm text-muted-foreground">{initialNote.source_review ? 'Source review was recorded with this signed note.' : 'This signed note predates source review tracking.'} Its saved PDF and historical record are preserved.</p>}
      <VisitTreatmentDecisionFields value={decision} onChange={setDecision}
        saved={initialNote.visit_treatment_decision} plan={note.treatment_plan}
        visitDate={encounter.encounter_date} education={note.patient_education}
        disabled={actionDisabled} historical={finalized} />
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
                    disabled={reviewDisabled || !review || !!review.proposal}
                    onClick={() => void run(
                      () => regeneratePainFollowUpSectionAction(caseId, encounter.id, section, undefined, initialNote.updated_at),
                      `${label} replacement ready for review`,
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
                  disabled={pending || finalized || !visitWritable}
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
                {finalized && (() => {
                  const order = procedureOrders.find((item) => item.source_recommendation_id === recommendation.recommendation_id)
                  return order ? <div className="min-w-48 rounded-md bg-muted p-3 text-sm">
                    <div className="flex items-center gap-2"><span className="font-medium">Ordered</span><span className="capitalize text-muted-foreground">{order.status}</span></div>
                    <p className="mt-1 text-xs text-muted-foreground">{order.seriesRelationshipLabel}</p>
                    <Link className="mt-2 inline-block text-xs font-medium text-primary underline-offset-4 hover:underline" href={`/patients/${caseId}/procedures`}>View Procedures</Link>
                  </div> : <ProcedureOrderDialog
                    caseId={caseId}
                    episodeId={encounter.episode_id}
                    encounterId={encounter.id}
                    recommendation={recommendation}
                    seriesChoices={seriesChoices}
                    seriesLoadError={relationshipLoadError}
                  />
                })()}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
