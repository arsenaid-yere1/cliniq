export const EXTRACTION_TYPES = {
  mri_report: { table: 'mri_extractions', tab: 'mri' },
  chiro_report: { table: 'chiro_extractions', tab: 'chiro' },
  pain_management: { table: 'pain_management_extractions', tab: 'pain-management' },
  pt_report: { table: 'pt_extractions', tab: 'pt' },
  orthopedic_report: { table: 'orthopedic_extractions', tab: 'orthopedic' },
  ct_scan: { table: 'ct_scan_extractions', tab: 'ct-scan' },
  x_ray: { table: 'x_ray_extractions', tab: 'x-ray' },
} as const
export const PROCESSING_WINDOW_MS = 15 * 60 * 1000
export type ExtractionDocumentType = keyof typeof EXTRACTION_TYPES
export function extractionType(type: string) {
  return Object.hasOwn(EXTRACTION_TYPES, type) ? EXTRACTION_TYPES[type as ExtractionDocumentType] : null
}
export function clinicalTab(value: unknown) {
  return Object.values(EXTRACTION_TYPES).find(({ tab }) => tab === value)?.tab ?? 'mri'
}
export interface ExtractionEvidence {
  id: string
  document_id: string
  extraction_status: string
  review_status: string
  created_at: string
}
export interface ExtractionSummary {
  kind: 'uploaded' | 'unconfirmed' | 'processing' | 'stale' | 'failed' | 'review' | 'reviewed' | 'rejected' | 'unavailable'
  label: string
  tab: string | null
  canOpen: boolean
  total: number
  processing: number
  failed: number
  awaitingReview: number
  reviewed: number
  rejected: number
  processingSince: string | null
}
export function summarizeExtractions(type: string, rows: ExtractionEvidence[] | null, now: number): ExtractionSummary {
  const mapping = extractionType(type)
  const base: ExtractionSummary = {
    kind: 'uploaded', label: 'Uploaded', tab: mapping?.tab ?? null, canOpen: false,
    total: 0, processing: 0, failed: 0, awaitingReview: 0, reviewed: 0, rejected: 0, processingSince: null,
  }
  if (!mapping) return base
  if (!rows || rows.some(r => !['processing','completed','failed'].includes(r.extraction_status)
    || !['pending_review','approved','edited','rejected'].includes(r.review_status)
    || !Number.isFinite(Date.parse(r.created_at)))) {
    return { ...base, kind: 'unavailable', label: 'Extraction status unavailable' }
  }
  if (!rows.length) return { ...base, kind: 'unconfirmed', label: 'Uploaded — extraction not confirmed' }
  const processing = rows.filter(r => r.extraction_status === 'processing')
  const completed = rows.filter(r => r.extraction_status === 'completed')
  base.total = rows.length
  base.processing = processing.length
  base.failed = rows.filter(r => r.extraction_status === 'failed').length
  base.awaitingReview = completed.filter(r => r.review_status === 'pending_review').length
  base.reviewed = completed.filter(r => ['approved','edited'].includes(r.review_status)).length
  base.rejected = rows.filter(r => r.review_status === 'rejected').length
  base.canOpen = completed.length + base.failed > 0
  base.processingSince = processing.map(r => r.created_at).sort()[0] ?? null
  if (processing.length) {
    const stale = now - Date.parse(base.processingSince!) >= PROCESSING_WINDOW_MS
    return { ...base, kind: stale ? 'stale' : 'processing', label: stale ? 'Processing status not confirmed' : 'Extraction in progress' }
  }
  if (base.failed) return { ...base, kind: 'failed', label: 'Extraction needs attention' }
  if (base.rejected) return { ...base, kind: 'rejected', label: 'Review needs attention' }
  if (base.awaitingReview) return { ...base, kind: 'review', label: 'Findings available for review' }
  return { ...base, kind: 'reviewed', label: 'Existing findings reviewed' }
}
