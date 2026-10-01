// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect, type ReactNode } from 'react'
const remove = vi.hoisted(() => vi.fn())
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/actions/documents', () => ({ removeDocument: remove, getDocumentDownloadUrl: vi.fn(), getDocumentPreviewUrl: vi.fn() }))
vi.mock('react-pdf', () => ({
  pdfjs: { version: 'test', GlobalWorkerOptions: {} },
  Document: ({ children, onLoadSuccess }: { children: ReactNode; onLoadSuccess: (r: { numPages: number }) => void }) => {
    useEffect(() => { onLoadSuccess({ numPages: 2 }) }, []) // eslint-disable-line react-hooks/exhaustive-deps
    return <div>{children}</div>
  },
  Page: ({ pageNumber }: { pageNumber: number }) => <div>PDF page {pageNumber}</div>,
}))
import { DocumentCard } from '../document-card'
import { PdfPreview } from '../pdf-preview'
const doc = { id: 'doc', case_id: 'case', file_name: 'Example report.pdf', file_path: 'example.pdf', mime_type: 'application/pdf', document_type: 'other', status: 'reviewed', created_at: '2026-09-01', content_date: null, procedure_number: null, revision_status: null, revision_number: null, notes: null, uploaded_by: null }
afterEach(cleanup)
it('names removal, retains confirmation, and protects locked/revision documents', () => {
  const view = render(<DocumentCard document={doc} patientLastName={null} />)
  fireEvent.click(screen.getByRole('button', { name: 'Remove document: Example report.pdf' }))
  expect(screen.getByRole('alertdialog')).toBeTruthy(); expect(remove).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  view.rerender(<DocumentCard document={doc} patientLastName={null} isLocked />)
  expect((screen.getByRole('button', { name: 'Remove document: Example report.pdf' }) as HTMLButtonElement).disabled).toBe(true)
  view.rerender(<DocumentCard document={{ ...doc, revision_status: 'superseded_note' }} patientLastName={null} />)
  expect((screen.getByRole('button', { name: 'Remove document: Example report.pdf' }) as HTMLButtonElement).disabled).toBe(true)
})
it('names PDF pagination, announces the page, and keeps boundary controls disabled', async () => {
  render(<PdfPreview url="synthetic.pdf" fileName="Example report.pdf" open onOpenChange={vi.fn()} />)
  await screen.findByText('Page 1 of 2')
  expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
  expect(screen.getByText('Page 2 of 2')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Previous page' }))
  expect(screen.getByText('Page 1 of 2')).toBeTruthy()
})
