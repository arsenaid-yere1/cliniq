'use client'

import { VisitTreatmentDecisionFields } from '@/components/clinical/visit-treatment-decision-fields'
import { visitDecisionDraft } from '@/lib/validations/visit-treatment-decision'
import { useCaseStatus } from '@/components/patients/case-status-context'
import { LOCKED_STATUSES, type CaseStatus } from '@/lib/constants/case-status'

import { ClinicalResetDialog } from '@/components/clinical/clinical-reset-dialog'

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Loader2, Sparkles, RefreshCw, Save, Lock } from 'lucide-react'
import { toast } from 'sonner'
import {
  finalizePainFollowUpNote,
  generatePainFollowUpNote,
  regeneratePainFollowUpSectionAction,
  savePainFollowUpNote,
  savePainFollowUpNoteToneHint,
} from '@/actions/pain-follow-up-notes'
import { ProcedureOrderDialog } from '@/components/procedures/procedure-order-dialog'
import type { ProcedureOrderSummary } from '@/actions/procedure-orders'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ToneDirectionCard } from '@/components/clinical/tone-direction-card'
import { GeneratingProgress } from '@/components/clinical/generating-progress'
import { useDraftNoteMutations } from '@/hooks/use-note-mutation-queue'
import { useVisitNoteVersion } from '@/hooks/use-visit-note-version'
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
  AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog'
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
}

type ActionResult = { error?: string; data?: unknown }

const sectionRows: Record<PainFollowUpSection, number> = {
  subjective: 6, interval_history: 6, review_of_systems: 4,
  telehealth_observations: 4, imaging_review: 4, assessment: 6,
  diagnoses: 4, treatment_plan: 6, patient_education: 5, follow_up: 3,
  clinician_disclaimer: 3,
}
const versionFields = [...painFollowUpNoteSections, 'tone_hint']

export function PainFollowUpEditor(props: PainFollowUpEditorProps) {
  const { caseId, encounter, initialNote, episodeWritable = true } = props
  const router = useRouter()
  const [toneHint, setToneHint] = useState(initialNote?.tone_hint ?? '')
  const [generating, setGenerating] = useState(false)
  const [startedAt, setStartedAt] = useState<string | null>(null)
  const running = useRef(false)
  const mounted = useRef(true)
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const caseLocked = LOCKED_STATUSES.includes(useCaseStatus() as CaseStatus)
  const writable = encounter.status === 'in_progress' && !caseLocked && episodeWritable
  const state = getPainFollowUpEditorState(initialNote)

  async function generate() {
    if (running.current || !writable) return
    running.current = true
    setStartedAt(new Date().toISOString())
    setGenerating(true)
    try {
      const result = await generatePainFollowUpNote(caseId, encounter.id, toneHint.trim() || null)
      if (!mounted.current) return
      if (result.error) toast.error(result.error)
      else toast.success('Follow-up note generated successfully')
      router.refresh()
    } catch {
      if (mounted.current) toast.error('Something went wrong. Please try again.')
    } finally {
      running.current = false
      if (mounted.current) setGenerating(false)
    }
  }

  if (generating || state === 'generating') {
    return <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">Telehealth follow-up note</h2>
        <Badge variant="outline">Generating...</Badge>
      </div>
      <GeneratingProgress
        startedAt={state === 'generating' ? initialNote?.updated_at : startedAt}
        noteId={initialNote?.id}
        realtimeTable="pain_follow_up_notes"
        initialProgress={state === 'generating' && initialNote
          ? { done: initialNote.sections_done, total: initialNote.sections_total } : null}
      />
      <div className="space-y-6" aria-hidden="true">
        {painFollowUpNoteSections.map((section) => <div key={section} className="space-y-2">
          <Skeleton className="h-4 w-40" /><Skeleton className="h-24 w-full" />
        </div>)}
      </div>
    </div>
  }

  if (state === 'empty' || state === 'failed') {
    const failed = state === 'failed'
    return <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">Telehealth follow-up note</h2>
        {failed && <Badge variant="destructive">Failed</Badge>}
      </div>
      {failed && <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {initialNote?.generation_error || 'The follow-up note could not be generated.'}
      </div>}
      <ToneDirectionCard value={toneHint} onChange={setToneHint} disabled={!writable} />
      <div className="flex flex-col items-center justify-center space-y-4 rounded-lg border bg-muted/30 px-4 py-16">
        <p className="max-w-md text-center text-sm text-muted-foreground">
          Generate a draft from this visit and the current episode&apos;s clinical history.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button disabled={!writable} onClick={() => void generate()}>
            {failed ? <RefreshCw className="mr-2 h-4 w-4" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {failed ? 'Retry' : 'Generate Follow-Up Note'}
          </Button>
          {failed && initialNote && <ClinicalResetDialog caseId={caseId} target={{ kind: 'pain_follow_up_notes', id: initialNote.id }} />}
        </div>
        {encounter.status === 'scheduled' && <p className="text-center text-xs text-muted-foreground">
          Start the visit after documenting intake to enable note generation.
        </p>}
      </div>
    </div>
  }
  return initialNote ? <NoteEditor {...props} initialNote={initialNote} /> : null
}

function NoteEditor({
  caseId, encounter, initialNote, seriesChoices = [], procedureOrders = [],
  relationshipLoadError = false, episodeWritable = true,
}: PainFollowUpEditorProps & { initialNote: Tables<'pain_follow_up_notes'> }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [tonePending, setTonePending] = useState(false)
  const [regeneratingSection, setRegeneratingSection] = useState<PainFollowUpSection | null>(null)
  const [toneHint, setToneHint] = useState(initialNote.tone_hint ?? '')
  const [note, setNote] = useState<Record<PainFollowUpSection, string>>(() =>
    Object.fromEntries(
      painFollowUpNoteSections.map((section) => [section, initialNote?.[section] ?? '']),
    ) as Record<PainFollowUpSection, string>,
  )
  const [decision, setDecision] = useState(() => visitDecisionDraft(initialNote?.visit_treatment_decision))
  const [savedNote, setSavedNote] = useState(initialNote)
  const expectedVersion = useRef(initialNote?.updated_at)
  const running = useRef(false)
  const caseLocked = LOCKED_STATUSES.includes(useCaseStatus() as CaseStatus)
  const recommendations = (
    savedNote?.procedure_recommendations ?? []
  ) as unknown as ProcedureRecommendation[]
  const editorState = getPainFollowUpEditorState(initialNote)
  const visitWritable = encounter.status === 'in_progress' && !caseLocked && episodeWritable

  const finalized = editorState === 'finalized'
  const actionDisabled = pending || !visitWritable || finalized
  const active = useRef(false)
  useLayoutEffect(() => {
    active.current = visitWritable && !finalized
    return () => { active.current = false }
  }, [visitWritable, finalized])
  const setVersion = useCallback((version: string) => { expectedVersion.current = version }, [])
  const versions = useVisitNoteVersion(initialNote, versionFields, setVersion)

  function confirmedRow(value: unknown): Tables<'pain_follow_up_notes'> | null {
    if (!value || typeof value !== 'object') return null
    const row = value as Tables<'pain_follow_up_notes'>
    return row.id === initialNote.id && row.case_id === caseId && row.encounter_id === encounter.id
      && typeof row.updated_at === 'string' && !!row.updated_at
      && painFollowUpNoteSections.every((section) => typeof row[section] === 'string' || row[section] === null)
      ? row : null
  }

  const mutations = useDraftNoteMutations({
    identity: `${caseId}:${encounter.id}:${initialNote.id}`,
    writable: visitWritable && !finalized,
    toneHint, initialTone: initialNote.tone_hint,
    getVersion: () => expectedVersion.current,
    acknowledgeVersion: versions.acknowledgeMetadataVersion,
    onError: (message) => toast.error(message),
    saveTone: async (tone, expected) => {
      setTonePending(true)
      try {
        const result = await savePainFollowUpNoteToneHint(caseId, encounter.id, tone, {
          noteId: initialNote.id, expectedUpdatedAt: expected,
        })
        if ('error' in result) return result
        if (!result.data) return { error: 'Unable to confirm the saved tone version. Reload the note.' }
        const row = confirmedRow(result.data.savedNote)
        if (!row || row.updated_at !== result.data.updated_at || row.tone_hint !== result.data.tone_hint) {
          return { error: 'Unable to confirm the saved tone version. Reload the note.' }
        }
        if (active.current) versions.acknowledgeSavedNote(row)
        return result
      } finally {
        if (active.current) setTonePending(false)
      }
    },
  })

  async function run(
    action: (isActive: () => boolean) => Promise<ActionResult>,
    successMessage: string,
    section?: PainFollowUpSection,
    terminal = false,
  ) {
    if (running.current || !active.current) return
    running.current = true
    setPending(true)
    setRegeneratingSection(section ?? null)
    try {
      await mutations.run(async (context) => {
        const result = await action(context.isActive)
        if (!context.isActive()) return
        if (result.error) throw new Error(result.error)
        toast.success(successMessage)
        if (terminal) { context.finish(); router.refresh() }
      })
    } finally {
      running.current = false
      if (active.current) { setPending(false); setRegeneratingSection(null) }
    }
  }

  const resetDialog = <ClinicalResetDialog caseId={caseId}
    target={{ kind: 'pain_follow_up_notes', id: initialNote.id }} disabled={pending || tonePending} />

  const editValues = {
    encounter_id: encounter.id,
    reviewed_visit_date: encounter.encounter_date,
    treatment_decision: decision,
    expected_updated_at: expectedVersion.current,
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

  async function saveDraft(isActive: () => boolean) {
    const result = await savePainFollowUpNote(caseId, {
      ...editValues,
      expected_updated_at: expectedVersion.current,
    })
    if ('error' in result) return { error: result.error }
    const saved = result.data && 'savedNote' in result.data ? result.data.savedNote : undefined
    if (!isActive()) return { error: 'The note is no longer editable.' }
    const row = confirmedRow(saved)
    if (!row) return { error: 'Unable to confirm the saved note version. Reload before finalizing.' }
    versions.acknowledgeSavedNote(row)
    setSavedNote(row)
    setNote(Object.fromEntries(painFollowUpNoteSections.map((section) => [section, row[section] ?? ''])) as Record<PainFollowUpSection, string>)
    setDecision(visitDecisionDraft(row.visit_treatment_decision))
    return { data: { updated_at: row.updated_at } }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold">Telehealth follow-up note</h2>
          <Badge variant="outline">{finalized ? 'Finalized' : 'Draft'}</Badge>
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
                  saveDraft,
                  'Follow-up note saved',
                )}
              >
                <Save className="mr-2 h-4 w-4" />Save Draft
              </Button>
              <Button
                disabled={actionDisabled}
                onClick={() => void run(
                  async (isActive) => {
                    const saved = await saveDraft(isActive)
                    if ('error' in saved) return saved
                    if (!isActive()) return { error: 'The note is no longer editable.' }
                    return finalizePainFollowUpNote(caseId, encounter.id, saved.data.updated_at)
                  },
                  'Follow-up note finalized successfully',
                  undefined, true,
                )}
              >
                <Lock className="mr-2 h-4 w-4" />Finalize &amp; Complete Visit
              </Button>
            </>
          )}
        </div>
      </div>

      {!finalized && <ToneDirectionCard value={toneHint} onChange={setToneHint}
        onBlur={mutations.saveTone} disabled={actionDisabled}
        description="Edits apply to subsequent section regenerations. Saved automatically on blur." />}
      <VisitTreatmentDecisionFields value={decision} onChange={setDecision}
        saved={savedNote?.visit_treatment_decision} plan={note.treatment_plan}
        visitDate={encounter.encounter_date} education={note.patient_education}
        disabled={actionDisabled} historical={finalized} />
      <div className="space-y-6">
        {painFollowUpNoteSections.map((section) => {
          const label = painFollowUpNoteSectionLabels[section]
          return <div key={section} className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-base font-semibold" htmlFor={section}>{label}</Label>
              {!finalized && <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" size="sm" variant="ghost" disabled={actionDisabled}>
                    {regeneratingSection === section ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                    Regenerate
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Regenerate Section</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will replace the current content of &ldquo;{label}&rdquo; with newly generated content. Other sections will not be affected. Continue?
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction disabled={actionDisabled} onClick={() => void run(async (isActive) => {
                      const result = await regeneratePainFollowUpSectionAction(caseId, encounter.id, section, undefined, expectedVersion.current)
                      if ('error' in result) return result
                      if (!isActive()) return { error: 'The note is no longer editable.' }
                      const row = confirmedRow(result.data?.savedNote)
                      if (!row) return { error: 'Unable to confirm the regenerated note version. Reload the note.' }
                      versions.acknowledgeSavedNote(row)
                      setSavedNote(row)
                      setNote((current) => ({ ...current, [section]: row[section] ?? '' }))
                      return { data: { success: true } }
                    }, `${label} regenerated`, section)}>
                      Regenerate
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>}
            </div>
            <Textarea id={section} value={note[section]} disabled={actionDisabled}
              rows={sectionRows[section]} className="resize-y"
              onChange={(event) => setNote((current) => ({ ...current, [section]: event.target.value }))} />
          </div>
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
