// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VisitTreatmentDecisionFields } from '../visit-treatment-decision-fields'
import { visitDecisionDraft } from '@/lib/validations/visit-treatment-decision'
afterEach(cleanup)
const saved = { schema_version: 1, decision: 'declined', details: 'Requested time', reviewed_plan: 'Home exercise', reviewed_plan_hash: 'hash', visit_date: '2026-09-10', confirmed_by: '13000000-0000-4000-8000-000000000001', confirmed_at: '2026-09-10T10:00:00Z' }
describe('visit decision fields', () => {
  it('shows the Accepted suggestion without submitting or adding a confirmation step', () => {
    const onChange = vi.fn()
    render(<VisitTreatmentDecisionFields value={visitDecisionDraft(null)} onChange={onChange} saved={null} plan="Home exercise" visitDate={null} />)
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('accepted')
    expect(screen.getByText('Accepted — pending clinician review')).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText(/Saving or signing also confirms that the Patient Education text is accurate/)).toBeTruthy()
    expect(screen.getByText(/correct or remove that statement/)).toBeTruthy()
  })
  it('preserves a saved refusal and captures an explicit alternative', () => {
    const onChange = vi.fn()
    render(<VisitTreatmentDecisionFields value={visitDecisionDraft(saved)} onChange={onChange} saved={saved} plan="Home exercise" visitDate="2026-09-10" />)
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('declined')
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Requested time')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'not_documented' } })
    expect(onChange).toHaveBeenCalledWith({ decision: 'not_documented', details: 'Requested time' })
  })
  it('shows changed-plan review and disables a locked fieldset', () => {
    render(<VisitTreatmentDecisionFields value={visitDecisionDraft(saved)} onChange={vi.fn()} saved={saved} plan="New plan" visitDate="2026-09-10" disabled />)
    expect(screen.getByRole('status').textContent).toContain('plan or visit date changed')
    expect(screen.getByRole('group').hasAttribute('disabled')).toBe(true)
  })
  it('does not display an Accepted default as a historical fact', () => {
    render(<VisitTreatmentDecisionFields value={visitDecisionDraft(null)} onChange={vi.fn()} saved={null} plan="" visitDate={null} historical />)
    expect(screen.getByText('Not documented')).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
  })
})
