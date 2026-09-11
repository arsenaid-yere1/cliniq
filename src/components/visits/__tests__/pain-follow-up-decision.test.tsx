// @vitest-environment jsdom
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
const initialNote = { ...Object.fromEntries(painFollowUpNoteSections.map((section) => [section, 'Reviewed text'])), id: 'note', status: 'draft', updated_at: 'v1', procedure_recommendations: [], visit_treatment_decision: null } as unknown as Tables<'pain_follow_up_notes'>
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
  it('saves the selected response before signing that saved version', async () => {
    render(<PainFollowUpEditor caseId="case" encounter={encounter} initialNote={initialNote} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'not_documented' } })
    fireEvent.click(screen.getByRole('button', { name: 'Finalize & Complete Visit' }))
    await waitFor(() => expect(finalize).toHaveBeenCalledWith('case', 'encounter', 'v2'))
    expect(save).toHaveBeenCalledWith('case', expect.objectContaining({ treatment_decision: { decision: 'not_documented', details: null } }))
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(finalize.mock.invocationCallOrder[0])
  })
  it('retains the draft selection and details after failed Save and does not sign', async () => {
    save.mockResolvedValue({ error: 'Note changed. Reload before saving' })
    render(<PainFollowUpEditor caseId="case" encounter={encounter} initialNote={initialNote} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'partially_accepted' } })
    fireEvent.change(screen.getByLabelText('Accepted treatments and limitations (required)'), { target: { value: 'Home exercise only; injection deferred.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Finalize & Complete Visit' }))
    await waitFor(() => expect(error).toHaveBeenCalledWith('Note changed. Reload before saving'))
    expect(finalize).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('partially_accepted')
    expect((screen.getByLabelText('Accepted treatments and limitations (required)') as HTMLTextAreaElement).value).toContain('Home exercise only')
  })
  it('locks the decision during an inactive episode or correction', () => {
    render(<PainFollowUpEditor caseId="case" encounter={encounter} initialNote={initialNote} episodeWritable={false} />)
    expect((screen.getByRole('button', { name: 'Save Draft' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('combobox').closest('fieldset')?.disabled).toBe(true)
  })
})
