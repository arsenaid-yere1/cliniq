import { describe, expect, it } from 'vitest'
import { buildDocumentCardFilename } from '../build-document-card-filename'

describe('buildDocumentCardFilename', () => {
  it('uses a descriptive PDF filename for pain-management follow-up documents', () => {
    expect(buildDocumentCardFilename({
      file_name: 'Pain Management Follow-Up',
      document_type: 'generated',
      mime_type: 'application/pdf',
      created_at: '2026-08-27T17:00:00Z',
      content_date: '2026-08-27',
      procedure_number: null,
    }, 'Smith')).toBe('Smith_PainManagementFollowUp_2026-08-27.pdf')
  })

  it('keeps the numbered procedure-note naming behavior', () => {
    expect(buildDocumentCardFilename({
      file_name: 'PRP Procedure Note',
      document_type: 'generated',
      mime_type: 'application/pdf',
      created_at: '2026-08-27T17:00:00Z',
      content_date: '2026-08-27',
      procedure_number: 2,
    }, 'Smith')).toBe('Smith_ProcedureNote2_2026-08-27.pdf')
  })
})
