// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ClinicalResetPreview } from '@/lib/validations/clinical-reset'
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/actions/clinical-reset', () => ({ previewClinicalReset: vi.fn(), applyClinicalReset: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))
import { previewClinicalReset, applyClinicalReset } from '@/actions/clinical-reset'
import { ClinicalResetDialog } from '../clinical-reset-dialog'
const preview: ClinicalResetPreview = {
  case_id: '10000000-0000-4000-8000-000000000001', case_status: 'closed', case_version: '2026-09-08',
  episode_id: '20000000-0000-4000-8000-000000000001', episode_version: '2026-09-08', episode_number: 1,
  episode_status: 'discharged', is_admin: true, latest_episode: true, open_correction: false, reopened: false,
  notes: [{ id: '30000000-0000-4000-8000-000000000001', kind: 'discharge_notes', status: 'finalized', updated_at: '2026-09-08', visit_type: null, date: '2026-09-01', procedure_id: null, encounter_id: null, blockers: [] }],
}

describe('clinical reset confirmation', () => {
  beforeEach(() => { cleanup(); vi.clearAllMocks(); vi.mocked(previewClinicalReset).mockResolvedValue({ data: preview }); vi.mocked(applyClinicalReset).mockResolvedValue({ data: { operationId: 'op' } }) })
  it('reactivates without selecting notes by default', async () => {
    const user = userEvent.setup()
    render(<ClinicalResetDialog caseId={preview.case_id} />)
    await user.click(screen.getByRole('button', { name: 'Reactivate case' }))
    await screen.findByText('Episode 1 · discharged')
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
    await user.type(screen.getByRole('textbox'), 'Resume this case')
    await user.click(screen.getAllByRole('button', { name: 'Reactivate case' }).at(-1)!)
    await waitFor(() => expect(applyClinicalReset).toHaveBeenCalledWith(expect.objectContaining({ notes: [], reactivate: true, reason: 'Resume this case' })))
  })
  it('requires administrator permission for signed reset', async () => {
    vi.mocked(previewClinicalReset).mockResolvedValue({ data: { ...preview, is_admin: false } })
    render(<ClinicalResetDialog caseId={preview.case_id} target={{ kind: 'discharge_notes', id: preview.notes[0].id }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await screen.findByText('An administrator is required for this operation.')
    expect((screen.getByRole('button', { name: 'Reactivate case' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('identifies billing blockers and prevents submitting the selected reset', async () => {
    vi.mocked(previewClinicalReset).mockResolvedValue({ data: { ...preview, notes: [{ ...preview.notes[0], blockers: [{ kind: 'billing', id: 'invoice-1', message: 'Resolve the invoice first' }] }] } })
    render(<ClinicalResetDialog caseId={preview.case_id} target={{ kind: 'discharge_notes', id: preview.notes[0].id }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await screen.findByRole('link', { name: 'View invoice' })
    await userEvent.type(screen.getByRole('textbox'), 'Reset the generated note')
    expect((screen.getByRole('button', { name: 'Reactivate case' }) as HTMLButtonElement).disabled).toBe(true)
    expect(applyClinicalReset).not.toHaveBeenCalled()
  })
  it('keeps the same operation key for an uncertain retry and refreshes stale previews explicitly', async () => {
    vi.mocked(applyClinicalReset).mockRejectedValueOnce(new Error('network'))
    render(<ClinicalResetDialog caseId={preview.case_id} />)
    await userEvent.click(screen.getByRole('button', { name: 'Reactivate case' }))
    await screen.findByRole('textbox')
    await userEvent.type(screen.getByRole('textbox'), 'Resume this case')
    await userEvent.click(screen.getAllByRole('button', { name: 'Reactivate case' }).at(-1)!)
    await screen.findByText('Unable to confirm the result. Retry to check this operation safely.')
    await userEvent.click(screen.getAllByRole('button', { name: 'Reactivate case' }).at(-1)!)
    const calls = vi.mocked(applyClinicalReset).mock.calls
    expect(calls[0][0].request_key).toBe(calls[1][0].request_key)
  })
  it('blocks a targeted note that disappeared from the refreshed preview', async () => {
    vi.mocked(previewClinicalReset).mockResolvedValue({ data: { ...preview, notes: [] } })
    render(<ClinicalResetDialog caseId={preview.case_id} target={{ kind: 'discharge_notes', id: preview.notes[0].id }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await screen.findByText('This note is no longer available. Refresh the preview.')
    await userEvent.type(screen.getByRole('textbox'), 'Reset this note')
    expect((screen.getByRole('button', { name: 'Reactivate case' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('allows ordinary draft reset without an administrator or reason', async () => {
    vi.mocked(previewClinicalReset).mockResolvedValue({ data: { ...preview, case_status: 'active', episode_status: 'active', is_admin: false, notes: [{ ...preview.notes[0], status: 'draft' }] } })
    render(<ClinicalResetDialog caseId={preview.case_id} target={{ kind: 'discharge_notes', id: preview.notes[0].id }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    const submit = await screen.findByRole('button', { name: 'Reset note' })
    await userEvent.click(submit)
    await waitFor(() => expect(applyClinicalReset).toHaveBeenCalledWith(expect.objectContaining({ reactivate: false, reason: '', notes: [expect.objectContaining({ id: preview.notes[0].id })] })))
  })

})
