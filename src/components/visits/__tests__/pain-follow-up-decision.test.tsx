// @vitest-environment jsdom
import { followUpReviewFixture } from '@/test-utils/follow-up-source'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tables } from '@/types/database'
import { painFollowUpNoteSections } from '@/lib/validations/pain-follow-up-note'
const { save, finalize, refresh, error } = vi.hoisted(() => ({ save: vi.fn(), finalize: vi.fn(), refresh: vi.fn(), error: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error } }))
vi.mock('@/components/patients/case-status-context', () => ({ useCaseStatus: () => 'active' }))
vi.mock('@/components/clinical/clinical-reset-dialog', () => ({ ClinicalResetDialog: () => null }))
vi.mock('@/components/procedures/procedure-order-dialog', () => ({ ProcedureOrderDialog: () => null }))
vi.mock('@/actions/pain-follow-up-notes', () => ({ savePainFollowUpNote: save, finalizePainFollowUpNote: finalize, generatePainFollowUpNote: vi.fn(), regeneratePainFollowUpSectionAction: vi.fn() }))
import { PainFollowUpEditor } from '../pain-follow-up-editor'
const encounter = { id: 'encounter', status: 'in_progress', encounter_date: '2026-09-10' } as Tables<'clinical_encounters'>
const initialNote = { ...Object.fromEntries(painFollowUpNoteSections.map((section) => [section, 'Reviewed text'])), id: 'note', status: 'draft', updated_at: 'v1', procedure_recommendations: [], visit_treatment_decision: { schema_version: 1, decision: 'accepted', details: null, reviewed_plan_hash: 'hash', reviewed_plan: 'Reviewed text', visit_date: '2026-09-10', confirmed_by: '10000000-0000-4000-8000-000000000001', confirmed_at: '2026-09-10T12:00:00Z' } } as unknown as Tables<'pain_follow_up_notes'>
beforeEach(() => { vi.clearAllMocks(); save.mockResolvedValue({ data: { success: true, savedNote: { updated_at: 'v2' } } }); finalize.mockResolvedValue({ data: { success: true } }) })
afterEach(cleanup)
describe('follow-up explicit decision workflow', () => {
  it('does not save on mount and confirms unchanged Accepted on Save Draft', async () => {
    render(<PainFollowUpEditor caseId="case" encounter={encounter} initialNote={initialNote} />)
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith('case', expect.objectContaining({ treatment_decision: { decision: 'accepted', details: null }, expected_updated_at: 'v1', reviewed_visit_date: '2026-09-10' })))
    expect(finalize).not.toHaveBeenCalled()
  })
  it('signs the reviewed saved version without silently changing its text', async () => {
    render(<PainFollowUpEditor caseId="case" encounter={encounter} initialNote={initialNote} review={followUpReviewFixture('v1')} />)
    fireEvent.click(screen.getByRole('button', { name: 'Finalize & Complete Visit' }))
    await waitFor(() => expect(finalize).toHaveBeenCalledWith('case', 'encounter', 'v1'))
    expect(save).not.toHaveBeenCalled()
  })
  it('retains the draft after failed Save and does not allow signing dirty text', async () => {
    save.mockResolvedValue({ error: 'Note changed. Reload before saving' })
    render(<PainFollowUpEditor caseId="case" encounter={encounter} initialNote={initialNote} review={followUpReviewFixture('v1')} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'partially_accepted' } })
    fireEvent.change(screen.getByLabelText('Accepted treatments and limitations (required)'), { target: { value: 'Home exercise only; injection deferred.' } })
    expect((screen.getByRole('button', { name: 'Finalize & Complete Visit' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    await waitFor(() => expect(error).toHaveBeenCalledWith('Note changed. Reload before saving'))
    expect(finalize).not.toHaveBeenCalled()
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('partially_accepted')
    expect((screen.getByLabelText('Accepted treatments and limitations (required)') as HTMLTextAreaElement).value).toContain('Home exercise only')
  })
  it.each([
    'Home exercise reviewed. The patient verbalized understanding.',
    'Home exercise reviewed. Further explanation is needed.',
  ])('saves the reviewed education unchanged, independently of agreement: %s', async (education) => {
    render(<PainFollowUpEditor caseId="case" encounter={encounter} initialNote={{ ...initialNote, patient_education: 'The patient verbalized understanding.' }} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Patient Education' }), { target: { value: education } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'not_documented' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith('case', expect.objectContaining({ patient_education: education, treatment_decision: { decision: 'not_documented', details: null } })))
  })
  it('locks the decision during an inactive episode or correction', () => {
    render(<PainFollowUpEditor caseId="case" encounter={encounter} initialNote={initialNote} episodeWritable={false} />)
    expect((screen.getByRole('button', { name: 'Save Draft' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('combobox').closest('fieldset')?.disabled).toBe(true)
  })
})

describe('note refresh and source-review protection', () => {
  it('keeps unsaved text when an external note version arrives', () => {
    const view = render(<PainFollowUpEditor caseId="case" encounter={encounter} initialNote={initialNote} review={followUpReviewFixture('v1')} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Subjective' }), { target: { value: 'My unsaved correction' } })
    const newer = { ...initialNote, updated_at: 'v2', subjective: 'Other saved correction' }
    view.rerender(<PainFollowUpEditor caseId="case" encounter={encounter} initialNote={newer} review={followUpReviewFixture('v2')} />)
    expect((screen.getByRole('textbox', { name: 'Subjective' }) as HTMLTextAreaElement).value).toBe('My unsaved correction')
    expect((screen.getByRole('button', { name: 'Save Draft' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Discard local edits and load saved version' }))
    expect((screen.getByRole('textbox', { name: 'Subjective' }) as HTMLTextAreaElement).value).toBe('Other saved correction')
  })
  it('adopts external content when the editor has no unsaved edits', () => {
    const view = render(<PainFollowUpEditor caseId="case" encounter={encounter} initialNote={initialNote} />)
    view.rerender(<PainFollowUpEditor caseId="case" encounter={encounter} initialNote={{ ...initialNote, updated_at: 'v2', subjective: 'Reviewed replacement' }} />)
    expect((screen.getByRole('textbox', { name: 'Subjective' }) as HTMLTextAreaElement).value).toBe('Reviewed replacement')
  })
  it('does not allow a changed or unavailable source review to sign', () => {
    const view = render(<PainFollowUpEditor caseId="case" encounter={encounter} initialNote={initialNote} review={{ ...followUpReviewFixture('v1'), freshness: 'changed', reviewed: false }} />)
    expect(screen.getByText('Visit information changed since this note was prepared')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Finalize & Complete Visit' }) as HTMLButtonElement).disabled).toBe(true)
    view.rerender(<PainFollowUpEditor caseId="case" encounter={encounter} initialNote={initialNote} review={null} />)
    expect((screen.getByRole('button', { name: 'Save Draft' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Finalize & Complete Visit' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
