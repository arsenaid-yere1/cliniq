'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { changedFollowUpSources, type FollowUpReviewState } from '@/lib/clinical/pain-follow-up-source'
import { painFollowUpNoteSections, painFollowUpNoteSectionLabels } from '@/lib/validations/pain-follow-up-note'

const sourceLabels: Record<string, string> = { encounter: 'Current visit', patient: 'Patient information', provider: 'Provider information', latestCompletedEncounter: 'Previous completed visit', priorEpisodeDischarge: 'Prior episode discharge', performedProcedures: 'Earlier procedures', provider_intake: 'Documented intake', npi_number: 'NPI', telehealth_consent_at: 'Consent date', encounter_type: 'Visit type' }

function Facts({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">Not documented</span>
  if (Array.isArray(value)) return <ul className="space-y-2">{value.map((item, index) => <li key={index}><Facts value={item} /></li>)}</ul>
  if (typeof value === 'object') return <dl className="space-y-1">{Object.entries(value).filter(([key]) => key !== 'id' && key !== 'recommendation_id').map(([key, item]) => <div key={key} className="border-l pl-3"><dt className="font-medium capitalize">{sourceLabels[key] ?? key.replaceAll('_', ' ')}</dt><dd><Facts value={item} /></dd></div>)}</dl>
  return <span className="whitespace-pre-wrap">{typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value)}</span>
}

export function FollowUpSourceReview({ review, current, disabled, onApply, onDiscard, onReview }: {
  review: FollowUpReviewState | null
  current: Record<string, unknown>
  disabled: boolean
  onApply: () => void
  onDiscard: () => void
  onReview: () => void
}) {
  const [confirmed, setConfirmed] = useState(false)
  const [open, setOpen] = useState(false)
  if (!review) return <p role="alert" className="rounded-md border p-4">Visit information could not be checked. Your draft is preserved. Refresh to try again before generating or signing.</p>
  const changes = changedFollowUpSources(review.baseline, review.snapshot)
  const proposal = review.proposal
  const staleProposal = !!proposal && (proposal.base_version !== review.note_version || proposal.source_fingerprint !== review.snapshot.fingerprint)
  const sections = proposal?.scope === 'full' ? painFollowUpNoteSections : painFollowUpNoteSections.filter((key) => key === proposal?.scope)
  return <section aria-label="Visit information review" className="space-y-3 rounded-md border p-4">
    <p role="status" className="font-medium">{review.freshness === 'changed' ? 'Visit information changed since this note was prepared' : review.freshness === 'unknown' ? 'The source version for this draft is unavailable' : review.reviewed ? 'Saved note reviewed against current visit information' : 'Review the complete saved note against current visit information before signing'}</p>
    {!!changes.length && <ul className="list-inside list-disc text-sm">{changes.map((label) => <li key={label}>{label}</li>)}</ul>}
    {staleProposal && <p role="alert">The note or visit information changed while this proposal was prepared. Discard it and generate another.</p>}
    <Button variant="outline" onClick={() => setOpen(!open)}>{open ? 'Hide source information' : 'Review changes and keep my edits'}</Button>
    {(open || proposal?.status === 'ready') && <div className="space-y-4 text-sm">
      <details open><summary className="cursor-pointer font-medium">Current visit information and dated history</summary><Facts value={review.snapshot.data} /></details>
      {review.baseline && <details><summary className="cursor-pointer font-medium">Previously reviewed information</summary><Facts value={review.baseline.data} /></details>}
      {proposal?.status === 'ready' && proposal.proposed && <div className="space-y-4">
        <h3 className="font-semibold">Compare proposed replacement</h3>
        {sections.map((key) => <div key={key}>
          <h4 className="mb-2 font-medium">{painFollowUpNoteSectionLabels[key]}</h4>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded bg-muted p-3"><p className="mb-2 font-medium">Current draft</p><p className="whitespace-pre-wrap">{String(current[key] ?? '')}</p></div>
            <div className="rounded border p-3"><p className="mb-2 font-medium">Proposed draft</p><p className="whitespace-pre-wrap">{proposal.proposed![key]}</p></div>
          </div>
        </div>)}
        {['full', 'treatment_plan'].includes(proposal.scope) && <div className="grid gap-3 md:grid-cols-2"><div><h4>Current procedure recommendations</h4><Facts value={current.procedure_recommendations} /></div><div><h4>Proposed procedure recommendations</h4><Facts value={proposal.proposed.procedure_recommendations} /></div></div>}
        {proposal.scope !== 'full' && <p>After applying this section, review the complete note before signing.</p>}
      </div>}
      <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={disabled} onChange={(event) => setConfirmed(event.target.checked)} />{proposal?.status === 'ready' ? 'I reviewed the proposed replacement against current visit information' : 'I reconciled the complete saved note with current visit information'}</label>
      {proposal?.status === 'ready' ? <Button disabled={disabled || !confirmed || staleProposal} onClick={onApply}>Apply reviewed replacement</Button> : <Button disabled={disabled || !confirmed} onClick={onReview}>Confirm source review and keep my text</Button>}
    </div>}
    {proposal?.status === 'pending' && <p role="status">A proposed draft is being prepared. Your saved text is unchanged. Refresh to check progress, or discard to cancel.</p>}
    {proposal?.status === 'failed' && <p role="alert">{proposal.error ?? 'Generation failed. Your saved text is unchanged.'}</p>}
    {proposal && <Button variant="outline" disabled={disabled} onClick={onDiscard}>Discard proposal</Button>}
  </section>
}
