// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { followUpReviewFixture } from '@/test-utils/follow-up-source'
import { FollowUpSourceReview } from '../follow-up-source-review'
import { painFollowUpNoteResultSchema, painFollowUpNoteSections } from '@/lib/validations/pain-follow-up-note'
afterEach(cleanup)
const callbacks = { onApply: vi.fn(), onDiscard: vi.fn(), onReview: vi.fn() }
describe('follow-up source review controls', () => {
  it('does not describe unavailable sources as current', () => {
    render(<FollowUpSourceReview review={null} current={{}} disabled={false} {...callbacks} />)
    expect(screen.getByRole('alert').textContent).toContain('could not be checked')
  })
  it('requires deliberate whole-note confirmation for manual reconciliation', () => {
    render(<FollowUpSourceReview review={{ ...followUpReviewFixture('v1'), reviewed: false, freshness: 'unknown' }} current={{}} disabled={false} {...callbacks} />)
    expect(screen.getByRole('status').textContent).toContain('source version')
    fireEvent.click(screen.getByRole('button', { name: 'Review changes and keep my edits' }))
    const confirm = screen.getByRole('button', { name: 'Confirm source review and keep my text' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    expect(callbacks.onReview).toHaveBeenCalled()
  })
  it('recovers a ready plan proposal with linked recommendations and explicit acceptance', () => {
    const review = followUpReviewFixture('v1')
    review.proposal = { id: 'proposal', status: 'ready', scope: 'treatment_plan', base_version: 'v1', source_fingerprint: review.snapshot.fingerprint, error: null, created_at: 'today', proposed: painFollowUpNoteResultSchema.parse({ ...Object.fromEntries(painFollowUpNoteSections.map((key) => [key, 'Proposed plan'])), procedure_recommendations: [] }) }
    render(<FollowUpSourceReview review={review} current={{ treatment_plan: 'Provider plan', procedure_recommendations: [] }} disabled={false} {...callbacks} />)
    expect(screen.getByText('Provider plan')).toBeTruthy()
    expect(screen.getByText('Proposed procedure recommendations')).toBeTruthy()
    expect(screen.getByText(/After applying this section/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Apply reviewed replacement' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed replacement' }))
    expect(callbacks.onApply).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Discard proposal' }))
    expect(callbacks.onDiscard).toHaveBeenCalled()
  })
})
