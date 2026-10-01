// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { DocumentCard } from '../document-card'
import { EXTRACTION_TYPES, summarizeExtractions } from '@/lib/documents/extraction-summary'
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/actions/documents', () => ({ getDocumentDownloadUrl: vi.fn(), getDocumentPreviewUrl: vi.fn(), removeDocument: vi.fn() }))
const doc = { id: 'doc', case_id: 'case', file_name: 'Report.pdf', file_path: 'path', mime_type: 'application/pdf', document_type: 'mri_report', status: 'reviewed', created_at: '2026-09-30T00:00:00Z', content_date: null, procedure_number: null, revision_status: null, revision_number: null, notes: null, uploaded_by: null }
const row = { id: 'r', document_id: 'doc', extraction_status: 'completed', review_status: 'pending_review', created_at: '2026-09-30T00:00:00Z' }
afterEach(cleanup)
it.each(Object.keys(EXTRACTION_TYPES))('links existing %s findings to their clinical tab', type => {
  render(<DocumentCard document={{ ...doc, document_type: type, extraction_summary: summarizeExtractions(type, [row], 0) }} patientLastName={null} />)
  expect(screen.getByRole('link', { name: 'Open clinical data' }).getAttribute('href')).toBe(`/patients/case/clinical?tab=${EXTRACTION_TYPES[type as keyof typeof EXTRACTION_TYPES].tab}`)
  expect(screen.getByText('Document review: Reviewed')).toBeTruthy()
  expect(screen.getByText('Findings available for review')).toBeTruthy()
})
it.each(['unconfirmed','processing','stale','unavailable'])('does not imply a recovery link for %s', kind => {
  const rows = kind === 'unconfirmed' ? [] : kind === 'unavailable' ? null : [{ ...row, extraction_status: 'processing' }]
  const summary = summarizeExtractions('mri_report', rows, kind === 'stale' ? Date.parse(row.created_at) + 900000 : 0)
  render(<DocumentCard document={{ ...doc, extraction_summary: summary }} onRefresh={vi.fn()} patientLastName={null} />)
  expect(screen.queryByRole('link')).toBeNull()
  expect(screen.getByRole('button', { name: 'Refresh status' })).toBeTruthy()
})
it('keeps existing revision restrictions and exposes mixed row counts', () => {
  const summary = summarizeExtractions('mri_report', [{ ...row, extraction_status: 'failed' }, row], 0)
  render(<DocumentCard document={{ ...doc, extraction_summary: summary, revision_status: 'superseded_note' }} patientLastName={null} />)
  expect(screen.getByText(/1 failed · 1 awaiting review/)).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Remove document: Report.pdf' }) as HTMLButtonElement).disabled).toBe(true)
})
