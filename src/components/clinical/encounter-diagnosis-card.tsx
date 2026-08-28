'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DiagnosisCombobox, type ClinicalDiagnosis } from '@/components/clinical/diagnosis-combobox'
import { saveEncounterDiagnoses } from '@/actions/clinical-encounters'
import {
  getEncounterDiagnosisSuggestions,
  suggestCurrentEncounterDiagnoses,
  type EncounterDiagnosisSuggestion,
} from '@/actions/visit-diagnoses'
import { prepareEvaluationVisit } from '@/actions/initial-visit-notes'
import { normalizeVisitDiagnoses } from '@/lib/clinical/visit-diagnoses'
import type { NoteVisitType } from '@/lib/claude/generate-initial-visit'

export type EncounterDiagnosisState = {
  encounterId: string
  diagnoses: unknown
  confirmedAt: string | null
}

export const CURRENT_VISIT_INTAKE_SAVED_EVENT = 'cliniq:current-visit-intake-saved'

export function EncounterDiagnosisCard({
  caseId,
  visitType,
  state,
  locked,
}: {
  caseId: string
  visitType: NoteVisitType
  state: EncounterDiagnosisState | null
  locked: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [diagnoses, setDiagnoses] = useState<ClinicalDiagnosis[]>(() => {
    try { return normalizeVisitDiagnoses(state?.diagnoses ?? []) }
    catch { return [] }
  })
  const [suggestions, setSuggestions] = useState<EncounterDiagnosisSuggestion[]>([])
  const [dirty, setDirty] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestionStatus, setSuggestionStatus] = useState<'idle' | 'ready' | 'insufficient' | 'error'>('idle')
  const [suggestionError, setSuggestionError] = useState<string | null>(null)
  const userEditedRef = useRef(false)
  const attemptedEncounterRef = useRef<string | null>(null)

  const requestCurrentVisitSuggestions = useCallback(async (force = false) => {
    if (!state?.encounterId || locked || state.confirmedAt) return
    if (!force && (userEditedRef.current || diagnoses.length > 0)) return

    setSuggesting(true)
    setSuggestionError(null)
    const result = await suggestCurrentEncounterDiagnoses(caseId, state.encounterId)
    setSuggesting(false)

    if (result.error) {
      setSuggestionStatus('error')
      setSuggestionError(result.error)
      return
    }
    if (result.status === 'insufficient_source') {
      setSuggestionStatus('insufficient')
      return
    }

    setDiagnoses(result.data)
    setDirty(result.data.length > 0)
    userEditedRef.current = false
    setSuggestionStatus('ready')
  }, [caseId, diagnoses.length, locked, state])

  useEffect(() => {
    if (!state?.encounterId) return
    let active = true
    void getEncounterDiagnosisSuggestions(caseId, state.encounterId).then((result) => {
      if (active && !result.error) setSuggestions(result.data)
    })
    return () => { active = false }
  }, [caseId, state?.encounterId])

  useEffect(() => {
    if (!state?.encounterId || attemptedEncounterRef.current === state.encounterId) return
    attemptedEncounterRef.current = state.encounterId
    const timeoutId = window.setTimeout(() => void requestCurrentVisitSuggestions(), 0)
    return () => window.clearTimeout(timeoutId)
  }, [requestCurrentVisitSuggestions, state?.encounterId])

  useEffect(() => {
    function handleIntakeSaved(event: Event) {
      const savedVisitType = (event as CustomEvent<{ visitType?: NoteVisitType }>).detail?.visitType
      if (savedVisitType !== visitType || userEditedRef.current) return
      void requestCurrentVisitSuggestions(true)
    }
    window.addEventListener(CURRENT_VISIT_INTAKE_SAVED_EVENT, handleIntakeSaved)
    return () => window.removeEventListener(CURRENT_VISIT_INTAKE_SAVED_EVENT, handleIntakeSaved)
  }, [requestCurrentVisitSuggestions, visitType])

  function prepare() {
    startTransition(async () => {
      const result = await prepareEvaluationVisit(caseId, visitType)
      if (result.error) toast.error(result.error)
      else { toast.success('Visit prepared'); router.refresh() }
    })
  }

  function confirm() {
    if (!state) return
    startTransition(async () => {
      const result = await saveEncounterDiagnoses(caseId, state.encounterId, diagnoses)
      if (result.error) toast.error(result.error)
      else {
        setDirty(false)
        toast.success('Visit diagnoses confirmed')
        router.refresh()
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Diagnoses for this visit</CardTitle>
        <CardDescription>
          Historical diagnoses are unchecked suggestions. Only diagnoses you select and confirm belong to this encounter.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!state ? (
          <Button type="button" variant="outline" onClick={prepare} disabled={locked || pending}>
            Prepare visit to select diagnoses
          </Button>
        ) : (
          <>
            <DiagnosisCombobox
              value={diagnoses}
              suggestions={suggestions}
              disabled={locked || pending || suggesting}
              onChange={(value) => {
                userEditedRef.current = true
                setDiagnoses(value)
                setDirty(true)
              }}
            />
            {suggesting && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Suggesting diagnoses from this visit…
              </p>
            )}
            {!suggesting && suggestionStatus === 'ready' && (
              <p className="text-xs text-muted-foreground">
                {diagnoses.length > 0
                  ? 'Provisional suggestions from this visit are shown above. Review, edit, and confirm them.'
                  : 'No diagnosis was suggested from the saved current-visit evidence. You can add one manually.'}
              </p>
            )}
            {!suggesting && suggestionStatus === 'insufficient' && (
              <p className="text-xs text-muted-foreground">
                Save current symptoms or exam findings to see diagnosis suggestions automatically.
              </p>
            )}
            {!suggesting && suggestionStatus === 'error' && (
              <p className="text-xs text-destructive">{suggestionError}</p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {!locked && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void requestCurrentVisitSuggestions(true)}
                  disabled={pending || suggesting}
                >
                  <Sparkles className="mr-2 h-3.5 w-3.5" />
                  Refresh from current visit
                </Button>
              )}
              {!locked && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={confirm}
                  disabled={pending || suggesting || (!dirty && state.confirmedAt !== null)}
                >
                  {state.confirmedAt ? 'Reconfirm diagnoses' : 'Confirm diagnoses'}
                </Button>
              )}
              <span className="text-xs text-muted-foreground">
                {state.confirmedAt
                  ? `Confirmed ${new Date(state.confirmedAt).toLocaleString()}`
                  : 'Review and confirm diagnoses for this visit'}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
