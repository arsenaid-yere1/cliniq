import { expect, it } from 'vitest'
import { EXTRACTION_TYPES, summarizeExtractions, clinicalTab, type ExtractionEvidence } from '../extraction-summary'
const now = Date.parse('2026-09-30T18:00:00Z')
const row: ExtractionEvidence = { id: 'r', document_id: 'd', extraction_status: 'completed', review_status: 'pending_review', created_at: '2026-09-30T17:59:00Z' }
it.each(Object.keys(EXTRACTION_TYPES))('maps supported type %s with no rows honestly', type => {
  expect(summarizeExtractions(type, [], now)).toMatchObject({ kind: 'unconfirmed', canOpen: false, tab: EXTRACTION_TYPES[type as keyof typeof EXTRACTION_TYPES].tab })
})
it('keeps unsupported uploads separate from extraction', () => expect(summarizeExtractions('other', null, now)).toMatchObject({ kind: 'uploaded', tab: null }))
it.each([
  ['processing','pending_review','processing',false], ['failed','pending_review','failed',true],
  ['completed','pending_review','review',true], ['completed','approved','reviewed',true],
  ['completed','edited','reviewed',true], ['completed','rejected','rejected',true],
  ['unexpected','approved','unavailable',false], ['completed','unexpected','unavailable',false],
])('reduces %s/%s to %s', (extraction_status, review_status, kind, canOpen) => {
  expect(summarizeExtractions('mri_report', [{ ...row, extraction_status, review_status }], now)).toMatchObject({ kind, canOpen })
})
it('counts existing regions without claiming completeness and preserves mixed failure evidence', () => {
  const rows = [row, { ...row, id: 'b', review_status: 'approved' }, { ...row, id: 'c', extraction_status: 'failed' }]
  expect(summarizeExtractions('mri_report', rows, now)).toMatchObject({ kind: 'failed', failed: 1, awaitingReview: 1, reviewed: 1, total: 3 })
  rows.push({ ...row, id: 'd', extraction_status: 'processing' })
  expect(summarizeExtractions('mri_report', rows, now)).toMatchObject({ kind: 'processing', failed: 1, canOpen: true })
})
it('uses persisted start time for stale processing without implying review access', () => {
  expect(summarizeExtractions('mri_report', [{ ...row, extraction_status: 'processing', created_at: '2026-09-30T17:00:00Z' }], now)).toMatchObject({ kind: 'stale', canOpen: false, processingSince: '2026-09-30T17:00:00Z' })
  expect(summarizeExtractions('mri_report', null, now).kind).toBe('unavailable')
})
it('allowlists clinical tabs', () => {
  expect(clinicalTab('pt')).toBe('pt')
  expect(clinicalTab(['pt'])).toBe('mri')
  expect(clinicalTab('malicious')).toBe('mri')
})
