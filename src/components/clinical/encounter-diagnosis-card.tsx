'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DiagnosisCombobox, type ClinicalDiagnosis } from '@/components/clinical/diagnosis-combobox'
import { saveEncounterDiagnoses } from '@/actions/clinical-encounters'
import { getEncounterDiagnosisSuggestions, type EncounterDiagnosisSuggestion } from '@/actions/visit-diagnoses'
import { prepareEvaluationVisit } from '@/actions/initial-visit-notes'
import { normalizeVisitDiagnoses } from '@/lib/clinical/visit-diagnoses'
import type { NoteVisitType } from '@/lib/claude/generate-initial-visit'

export type EncounterDiagnosisState = {
  encounterId: string
  diagnoses: unknown
  confirmedAt: string | null
}

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

  useEffect(() => {
    if (!state?.encounterId) return
    let active = true
    void getEncounterDiagnosisSuggestions(caseId, state.encounterId).then((result) => {
      if (active && !result.error) setSuggestions(result.data)
    })
    return () => { active = false }
  }, [caseId, state?.encounterId])

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
              disabled={locked || pending}
              onChange={(value) => { setDiagnoses(value); setDirty(true) }}
            />
            <div className="flex flex-wrap items-center gap-3">
              {!locked && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={confirm}
                  disabled={pending || (!dirty && state.confirmedAt !== null)}
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
