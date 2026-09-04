'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createProcedureOrderFromRecommendation } from '@/actions/procedure-orders'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { buildSeriesOptionLabel, getSeriesRelationshipDescription, getSeriesUnavailableMessage, START_SEPARATE_SERIES_LABEL, type ProcedureSeriesChoice } from '@/lib/clinical/procedure-series-labels'
import type { ProcedureRecommendation } from '@/lib/validations/pain-follow-up-note'

type Selection = { relationship: 'current' | 'prior'; seriesId: string } | { relationship: 'separate'; seriesId: null }

export function ProcedureOrderDialog({ caseId, episodeId, encounterId, recommendation, seriesChoices = [], seriesLoadError = false }: {
  caseId: string; episodeId: string; encounterId: string; recommendation: ProcedureRecommendation
  seriesChoices: ProcedureSeriesChoice[]; seriesLoadError?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [selection, setSelection] = useState<Selection | null>(null)
  const matchingChoices = seriesChoices.filter((choice) => choice.procedureType === recommendation.procedure_type)
  function changeOpen(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) setSelection(null)
  }

  async function submit() {
    if (!selection || seriesLoadError) return
    setPending(true)
    try {
      const common = {
        case_id: caseId, episode_id: episodeId, source_encounter_id: encounterId,
        source_recommendation_id: recommendation.recommendation_id,
        procedure_type: recommendation.procedure_type, sites: recommendation.sites,
        diagnoses: recommendation.diagnoses, clinical_rationale: recommendation.rationale,
        priority: 'routine' as const,
      }
      const result = selection.relationship === 'separate'
        ? await createProcedureOrderFromRecommendation({ ...common, series_relationship: 'separate', selected_series_id: null })
        : await createProcedureOrderFromRecommendation({ ...common, series_relationship: selection.relationship, selected_series_id: selection.seriesId })
      if ('error' in result && result.error) return toast.error(result.error)
      changeOpen(false)
      toast.success('Procedure order created')
      router.refresh()
    } catch {
      toast.error('Something went wrong. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button size="sm">Create Procedure Order</Button></DialogTrigger>
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>Create procedure order</DialogTitle>
        <DialogDescription>Choose how this order relates to prior treatment. This choice is saved with the order; Save Draft does not save it.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="rounded-md border p-3 text-sm"><p className="font-medium uppercase">{recommendation.procedure_type}</p><p>{recommendation.sites.join(', ')}</p><p className="mt-2 text-muted-foreground">{recommendation.rationale}</p></div>
        {seriesLoadError ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">Series choices could not be loaded. Refresh the page before creating this order.</div> : <RadioGroup aria-label="Series relationship" value={selection ? selection.seriesId ?? 'separate' : ''} onValueChange={(value) => {
          if (value === 'separate') setSelection({ relationship: 'separate', seriesId: null })
          else { const choice = matchingChoices.find((item) => item.id === value); if (choice?.eligible) setSelection({ relationship: choice.relationship, seriesId: choice.id }) }
        }}>
          {matchingChoices.map((choice) => <label key={choice.id} className="flex gap-3 rounded-lg border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60">
            <RadioGroupItem value={choice.id} disabled={!choice.eligible} data-disabled={!choice.eligible || undefined} className="mt-0.5" />
            <span className="space-y-1"><span className="block text-sm font-medium">{buildSeriesOptionLabel(choice)}</span><span className="block text-xs text-muted-foreground">{choice.eligible ? getSeriesRelationshipDescription(choice) : getSeriesUnavailableMessage(choice.unavailableReason)}</span></span>
          </label>)}
          <label className="flex gap-3 rounded-lg border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
            <RadioGroupItem value="separate" className="mt-0.5" />
            <span className="space-y-1"><span className="block text-sm font-medium">{START_SEPARATE_SERIES_LABEL}</span><span className="block text-xs text-muted-foreground">{getSeriesRelationshipDescription()}</span></span>
          </label>
        </RadioGroup>}
      </div>
      <DialogFooter><Button onClick={submit} disabled={pending || !selection || seriesLoadError}>{pending ? 'Creating…' : 'Create Order'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
