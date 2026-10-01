// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from '@/test-utils/visit-render'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { initialVisitSections } from '@/lib/validations/initial-visit-note'
const { load, generate, remove } = vi.hoisted(() => ({ load: vi.fn(), generate: vi.fn(), remove: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/patients/case-status-context', () => ({ useCaseStatus: () => 'active' }))
vi.mock('@/components/clinical/clinical-reset-dialog', () => ({ ClinicalResetDialog: () => null }))
vi.mock('@/actions/clinical-orders', () => ({ getClinicalOrders: load, generateClinicalOrder: generate, deleteClinicalOrder: remove }))
vi.mock('@/actions/initial-visit-notes', () => ({}))
vi.mock('@/actions/documents', () => ({ getDocumentDownloadUrl: vi.fn() }))
import { InitialVisitEditor } from '../initial-visit-editor'
const note = { ...Object.fromEntries(initialVisitSections.map(section => [section, 'Synthetic narrative'])), id: 'note', status: 'finalized', updated_at: 'v1', visit_date: '2026-09-10' }
function fixture(episodeId = 'episode') {
  return <InitialVisitEditor key={episodeId} caseId="case" episodeId={episodeId} notesByVisitType={{ initial_visit: note, pain_evaluation_visit: null }} intakesByVisitType={{ initial_visit: null, pain_evaluation_visit: null }} documentFilePathByVisitType={{ initial_visit: null, pain_evaluation_visit: null }} defaultVisitType="initial_visit" canGenerate initialVitals={null} clinicSettings={null} providerProfile={null} clinicLogoUrl={null} providerSignatureUrl={null} caseData={null} painEvalMissingPriorVitals={false} siblingDatesByVisitType={{ initial_visit: null, pain_evaluation_visit: null }} />
}
const row = { id: 'order', order_type: 'imaging', status: 'completed', document: { file_path: 'synthetic.pdf' }, created_at: '2026-09-10' }
beforeEach(() => { vi.resetAllMocks(); load.mockResolvedValue({ data: [] }); generate.mockResolvedValue({ data: {} }); remove.mockResolvedValue({ data: {} }) })
afterEach(cleanup)
it.each(['reported', 'rejected'])('blocks generation on %s read failure and retries explicitly', async kind => {
  if (kind === 'reported') load.mockResolvedValueOnce({ error: 'Unavailable' }); else load.mockRejectedValueOnce(new Error('Offline'))
  render(fixture()); await userEvent.click(screen.getByRole('tab', { name: 'Orders' }))
  await screen.findByRole('button', { name: 'Retry loading companion documents' })
  expect((screen.getByRole('button', { name: 'Generate Imaging Orders' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading companion documents' }))
  await waitFor(() => expect((screen.getByRole('button', { name: 'Generate Imaging Orders' }) as HTMLButtonElement).disabled).toBe(false))
  expect(generate).not.toHaveBeenCalled()
})
it('retains confirmed rows and downloads when a refresh fails', async () => {
  load.mockResolvedValueOnce({ data: [row] }).mockResolvedValueOnce({ error: 'Unavailable' })
  render(fixture()); await userEvent.click(screen.getByRole('tab', { name: 'Orders' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Generate Chiropractic Order' }))
  await screen.findByText(/Previously loaded documents are still shown/)
  expect(screen.getByRole('button', { name: 'Delete Imaging Orders' })).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Download PDF' }) as HTMLButtonElement).disabled).toBe(false)
  expect((screen.getByRole('button', { name: 'Generate Chiropractic Order' }) as HTMLButtonElement).disabled).toBe(true)
})
it('shows loading and ignores a late response from an earlier episode', async () => {
  let resolve!: (value: unknown) => void; load.mockReturnValueOnce(new Promise(done => { resolve = done }))
  const view = render(fixture()); await userEvent.click(screen.getByRole('tab', { name: 'Orders' }))
  expect(screen.getByText('Loading companion documents…')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Generate Imaging Orders' }) as HTMLButtonElement).disabled).toBe(true)
  view.rerender(fixture('new-episode')); await userEvent.click(screen.getByRole('tab', { name: 'Orders' }))
  await waitFor(() => expect(load).toHaveBeenLastCalledWith('case', 'initial_visit', 'new-episode'))
  await act(async () => resolve({ data: [row] }))
  expect(screen.queryByRole('button', { name: 'Delete Imaging Orders' })).toBeNull()
})
