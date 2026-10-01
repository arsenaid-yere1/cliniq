// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
const mocks = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/actions/documents', () => ({ listDocuments: mocks.list }))
vi.mock('@/components/patients/case-status-context', () => ({ useCaseStatus: () => 'active' }))
vi.mock('../upload-sheet', () => ({ UploadSheet: () => null }))
vi.mock('../document-card', () => ({ DocumentCard: ({ document }: { document: { file_name: string } }) => <p>{document.file_name}</p> }))
import { DocumentList } from '../document-list'
import { summarizeExtractions } from '@/lib/documents/extraction-summary'
type Doc = ComponentProps<typeof DocumentList>['documents'][number]
const doc: Doc = { id: 'doc', case_id: 'case', file_name: 'Report.pdf', file_path: 'path', mime_type: 'application/pdf', document_type: 'mri_report', status: 'reviewed', created_at: '2026-09-30T00:00:00Z', content_date: null, procedure_number: null, revision_status: null, revision_number: null, notes: null, uploaded_by: null }
const processing = { ...doc, extraction_summary: summarizeExtractions('mri_report', [{ id: 'r', document_id: 'doc', extraction_status: 'processing', review_status: 'pending_review', created_at: new Date().toISOString() }], Date.now()) }
beforeEach(() => { vi.resetAllMocks(); mocks.list.mockResolvedValue({ data: [doc] }) })
afterEach(() => { cleanup(); vi.useRealTimers() })
it('preserves loaded rows on returned and rejected errors, then retries', async () => {
  mocks.list.mockResolvedValueOnce({ error: 'offline', data: [] }).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: [{ ...doc, file_name: 'Updated.pdf' }] })
  render(<DocumentList documents={[doc]} caseId="case" patientLastName={null} />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Refresh status' })))
  expect(screen.getByRole('alert')).toBeTruthy(); expect(screen.getByText('Report.pdf')).toBeTruthy()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry loading documents' })))
  expect(screen.getByText('Report.pdf')).toBeTruthy()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry loading documents' })))
  expect(screen.getByText('Updated.pdf')).toBeTruthy(); expect(screen.queryByRole('alert')).toBeNull()
})
it('does not overlap requests and ignores results from a previous case', async () => {
  let finish!: (value: { data: Doc[] }) => void
  mocks.list.mockReturnValue(new Promise(resolve => { finish = resolve }))
  const view = render(<DocumentList documents={[doc]} caseId="old" patientLastName={null} />)
  await act(async () => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('focus')) })
  expect(mocks.list).toHaveBeenCalledOnce()
  view.rerender(<DocumentList documents={[{ ...doc, file_name: 'New case.pdf' }]} caseId="new" patientLastName={null} />)
  await act(async () => finish({ data: [{ ...doc, file_name: 'Old response.pdf' }] }))
  expect(screen.getByText('New case.pdf')).toBeTruthy(); expect(screen.queryByText('Old response.pdf')).toBeNull()
})
it('polls every five seconds only while visible and processing, then cleans up', async () => {
  vi.useFakeTimers(); mocks.list.mockResolvedValue({ data: [processing] })
  const view = render(<DocumentList documents={[processing]} caseId="case" patientLastName={null} />)
  await act(async () => vi.advanceTimersByTimeAsync(4999)); expect(mocks.list).not.toHaveBeenCalled()
  await act(async () => vi.advanceTimersByTimeAsync(1)); expect(mocks.list).toHaveBeenCalledOnce()
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  await act(async () => vi.advanceTimersByTimeAsync(15000)); expect(mocks.list).toHaveBeenCalledOnce()
  visibility.mockRestore()
  mocks.list.mockResolvedValue({ data: [doc] })
  await act(async () => window.dispatchEvent(new Event('focus')))
  const calls = mocks.list.mock.calls.length
  await act(async () => vi.advanceTimersByTimeAsync(15000)); expect(mocks.list).toHaveBeenCalledTimes(calls)
  view.unmount(); window.dispatchEvent(new Event('focus')); expect(mocks.list).toHaveBeenCalledTimes(calls)
})
it('bounds polling to fifteen minutes and manual refresh restarts a check', async () => {
  vi.useFakeTimers(); mocks.list.mockResolvedValue({ data: [processing] })
  render(<DocumentList documents={[processing]} caseId="case" patientLastName={null} />)
  await act(async () => vi.advanceTimersByTimeAsync(15 * 60 * 1000))
  const calls = mocks.list.mock.calls.length
  expect(calls).toBe(179)
  await act(async () => vi.advanceTimersByTimeAsync(20000)); expect(mocks.list).toHaveBeenCalledTimes(calls)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Refresh status' })))
  await act(async () => vi.advanceTimersByTimeAsync(5000)); expect(mocks.list).toHaveBeenCalledTimes(calls + 2)
})
it('labels search and filter removal while retaining counts', async () => {
  render(<DocumentList documents={[doc]} caseId="case" patientLastName={null} />)
  expect(screen.getByLabelText('Search documents')).toBeTruthy()
  expect(screen.getByLabelText('Document type filter')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Reviewed' }))
  expect(screen.getByRole('button', { name: 'Remove Reviewed filter' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Remove Reviewed filter' }))
  expect(screen.queryByRole('button', { name: 'Remove Reviewed filter' })).toBeNull()
  expect(screen.getByText('Showing 1 of 1 documents')).toBeTruthy()
})
