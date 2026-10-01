// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from '@/test-utils/visit-render'
import type { ComponentProps } from 'react'
const m = vi.hoisted(() => ({ vitals: vi.fn(), date: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/patients/case-status-context', () => ({ useCaseStatus: () => 'active' }))
vi.mock('@/components/clinical/clinical-reset-dialog', () => ({ ClinicalResetDialog: () => null }))
vi.mock('@/components/clinical/generating-progress', () => ({ GeneratingProgress: () => <p>Generating fixture</p> }))
vi.mock('@/actions/documents', () => ({ getDocumentDownloadUrl: vi.fn() }))
vi.mock('@/actions/discharge-notes', () => ({ saveDischargeVitals: m.vitals }))
vi.mock('@/actions/visit-date', () => ({ savePreGenerationVisitDate: m.date }))
import { DischargeNoteEditor } from '@/components/discharge/discharge-note-editor'
const props = { caseId: 'case', episodeId: 'episode', note: { id: 'note', status: 'draft', visit_date: '2026-09-10', updated_at: 'v1' }, canGenerate: true, clinicSettings: null, providerProfile: null, clinicLogoUrl: null, providerSignatureUrl: null, caseData: null, documentFilePath: null, defaultVitals: null, correctionContext: null, isStale: false, earliestDate: null } as unknown as ComponentProps<typeof DischargeNoteEditor>
beforeEach(() => {
  vi.resetAllMocks(); m.vitals.mockResolvedValue({ data: {} })
  m.date.mockImplementation(async input => ({ data: { noteId: 'note', visitDate: input.visitDate, updatedAt: 'v2' } }))
})
afterEach(cleanup)
const changeVitals = () => fireEvent.change(screen.getByRole('spinbutton', { name: 'Heart Rate' }), { target: { value: '80' } })
const changeDate = () => fireEvent.change(screen.getByLabelText('Date of Visit'), { target: { value: '2026-09-11' } })
it('does not mark dirty vitals saved when the date is saved, or dirty date saved when vitals are saved', async () => {
  render(<DischargeNoteEditor {...props} />)
  changeVitals(); changeDate(); fireEvent.blur(screen.getByLabelText('Date of Visit'))
  await waitFor(() => expect(m.date).toHaveBeenCalledOnce())
  await screen.findByText('Unsaved changes')
  fireEvent.click(screen.getByRole('button', { name: 'Save Vitals' }))
  await screen.findByText('Saved')
  changeDate() // same acknowledged date; then choose another unsaved date
  fireEvent.change(screen.getByLabelText('Date of Visit'), { target: { value: '2026-09-12' } })
  changeVitals(); fireEvent.click(screen.getByRole('button', { name: 'Save Vitals' }))
  await screen.findByText('Unsaved changes')
})
it.each(['returned','rejected'])('keeps %s vitals errors after date success until a successful retry', async kind => {
  if (kind === 'returned') m.vitals.mockResolvedValueOnce({ error: 'Vitals unavailable' })
  else m.vitals.mockRejectedValueOnce(new Error('offline'))
  render(<DischargeNoteEditor {...props} />)
  changeVitals(); changeDate(); fireEvent.blur(screen.getByLabelText('Date of Visit'))
  await waitFor(() => expect(m.date).toHaveBeenCalledOnce())
  fireEvent.click(screen.getByRole('button', { name: 'Save Vitals' }))
  await screen.findByText('Save failed · Unsaved changes')
  fireEvent.click(screen.getByRole('button', { name: 'Save Vitals' }))
  await screen.findByText('Saved')
})
it('reports pending child saves and clears their contribution across episode identity changes', async () => {
  let finish!: (value: { data: object }) => void
  m.vitals.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  const view = render(<DischargeNoteEditor {...props} />)
  changeVitals(); fireEvent.click(screen.getByRole('button', { name: 'Save Vitals' }))
  await screen.findByText('Saving…')
  view.rerender(<DischargeNoteEditor {...props} episodeId="other-episode" />)
  expect(screen.getByText('No unsaved changes')).toBeTruthy()
  await act(async () => finish({ data: {} }))
  expect(screen.getByText('No unsaved changes')).toBeTruthy()
})
