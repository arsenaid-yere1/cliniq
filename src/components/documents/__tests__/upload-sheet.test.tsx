// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
const mocks = vi.hoisted(() => ({ session: vi.fn(), metadata: vi.fn(), reconcile: vi.fn(), tus: vi.fn(), auth: vi.fn(), extract: vi.fn(), refresh: vi.fn(), error: vi.fn() }))
vi.mock('@/actions/documents', () => ({ getUploadSession: mocks.session, saveDocumentMetadata: mocks.metadata, reconcileDocumentUpload: mocks.reconcile }))
vi.mock('@/lib/tus-upload', () => ({ createTusUpload: mocks.tus }))
vi.mock('@supabase/ssr', () => ({ createBrowserClient: () => ({ auth: { getSession: mocks.auth } }) }))
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: vi.fn() } }))
vi.mock('@/actions/mri-extractions', () => ({ extractMriReport: mocks.extract }))
vi.mock('@/actions/chiro-extractions', () => ({ extractChiroReport: mocks.extract }))
vi.mock('@/actions/pain-management-extractions', () => ({ extractPainManagementReport: mocks.extract }))
vi.mock('@/actions/pt-extractions', () => ({ extractPtReport: mocks.extract }))
vi.mock('@/actions/orthopedic-extractions', () => ({ extractOrthopedicReport: mocks.extract }))
vi.mock('@/actions/ct-scan-extractions', () => ({ extractCtScanReport: mocks.extract }))
vi.mock('@/actions/x-ray-extractions', () => ({ extractXRayReport: mocks.extract }))
import { UploadSheet } from '../upload-sheet'
function mount() {
  function Harness() {
    const [open, setOpen] = useState(true)
    return <><button onClick={() => setOpen(true)}>Open upload</button><UploadSheet caseId="case" open={open} onOpenChange={setOpen} onUploadComplete={mocks.refresh} /></>
  }
  return render(<Harness />)
}
async function choose(names = ['first.pdf']) {
  await userEvent.upload(screen.getByLabelText('Choose documents to upload'), names.map(n => new File(['fixture'], n, { type: 'application/pdf' })))
}
const start = () => fireEvent.click(screen.getByRole('button', { name: /Upload \d file/ }))
beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockImplementation(async input => ({ data: { storagePath: `path/${input.uploadId}` } }))
  mocks.metadata.mockImplementation(async input => ({ data: { id: input.uploadId, created: true } }))
  mocks.reconcile.mockResolvedValue({ data: { state: 'missing' } })
  mocks.auth.mockResolvedValue({ data: { session: { access_token: 'fresh' } } })
  mocks.tus.mockImplementation(options => ({ start: () => options.onSuccess() }))
  mocks.extract.mockResolvedValue({})
})
afterEach(() => { cleanup(); document.body.style.pointerEvents = '' })
it('retries registration without another transfer or duplicate extraction after a lost response', async () => {
  mocks.metadata.mockRejectedValueOnce(new Error('Response lost')).mockResolvedValueOnce({ data: { id: 'committed', created: false } })
  mount(); await choose(); start()
  await screen.findByRole('button', { name: 'Retry saving document' })
  fireEvent.click(screen.getByRole('button', { name: 'Retry saving document' }))
  await screen.findByText(/Uploaded —/)
  expect(mocks.tus).toHaveBeenCalledOnce()
  expect(mocks.metadata).toHaveBeenCalledTimes(2)
  expect(mocks.metadata.mock.calls[0]).toEqual(mocks.metadata.mock.calls[1])
  expect(mocks.extract).not.toHaveBeenCalled()
})
it.each(['present', 'missing'])('reconciles transfer loss before retrying: %s', async (state) => {
  mocks.tus.mockImplementationOnce(options => ({ start: () => options.onError(new Error('transfer lost')) }))
  mocks.reconcile.mockResolvedValue({ data: { state } })
  mount(); await choose(); start()
  await screen.findByRole('button', { name: 'Retry upload' })
  fireEvent.click(screen.getByRole('button', { name: 'Retry upload' }))
  await screen.findByText(/Uploaded —/)
  expect(mocks.reconcile).toHaveBeenCalledOnce()
  expect(mocks.tus).toHaveBeenCalledTimes(state === 'present' ? 1 : 2)
  expect(mocks.session.mock.calls[0][0].uploadId).toBe(mocks.session.mock.calls[1][0].uploadId)
})
it('keeps successful rows during mixed failures and removes only the failed queue row', async () => {
  mocks.metadata.mockResolvedValueOnce({ data: { id: 'first', created: true } }).mockResolvedValueOnce({ error: 'Save failed' })
  mount(); await choose(['first.pdf','second.pdf']); start()
  await screen.findByRole('button', { name: 'Retry saving document' })
  expect(screen.getByText(/Uploaded —/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Remove second.pdf from queue' }))
  expect(screen.queryByText('second.pdf')).toBeNull()
  expect(screen.getByText('first.pdf')).toBeTruthy()
})
it('guards rapid submissions, type changes, file drops and closing while busy', async () => {
  let finish!: () => void
  mocks.tus.mockImplementation(options => ({ start: () => { finish = options.onSuccess } }))
  mount(); await choose(); const button = screen.getByRole('button', { name: /Upload \d file/ }); fireEvent.click(button); fireEvent.click(button)
  await waitFor(() => expect(mocks.tus).toHaveBeenCalledOnce())
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  expect(screen.getByRole('dialog')).toBeTruthy()
  await act(async () => finish())
  expect(mocks.metadata).toHaveBeenCalledOnce()
})
it('retains authentication failures and clears unfinished queue on close/reopen', async () => {
  mocks.auth.mockResolvedValue({ data: { session: null } })
  mount(); await choose(); start()
  await screen.findByRole('button', { name: 'Retry upload' })
  expect(screen.getByText(/Not authenticated/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  fireEvent.click(screen.getByRole('button', { name: 'Open upload' }))
  expect(screen.queryByText('first.pdf')).toBeNull()
})
it.each(['returned','rejected'])('catches %s extraction failure and refreshes persisted status', async (kind) => {
  if (kind === 'returned') mocks.extract.mockResolvedValue({ error: 'failed' })
  else mocks.extract.mockRejectedValue(new Error('offline'))
  mount(); await choose(); start()
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(2))
  expect(mocks.error).toHaveBeenCalled()
  expect(screen.getByText(/Uploaded —/)).toBeTruthy()
})
it('keeps transfer uncertainty failed without a new transfer', async () => {
  mocks.tus.mockImplementationOnce(options => ({ start: () => options.onError(new Error('lost')) }))
  mocks.reconcile.mockResolvedValue({ error: 'Unable to confirm transfer' })
  mount(); await choose(); start()
  await screen.findByRole('button', { name: 'Retry upload' })
  fireEvent.click(screen.getByRole('button', { name: 'Retry upload' }))
  await screen.findByText('Unable to confirm transfer')
  expect(mocks.tus).toHaveBeenCalledOnce()
  expect(mocks.metadata).not.toHaveBeenCalled()
})
