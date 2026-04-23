'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, RefreshCw, Loader2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import dynamic from 'next/dynamic'
const PdfViewer = dynamic(() => import('@/components/documents/pdf-viewer').then(mod => ({ default: mod.PdfViewer })), { ssr: false })
import { useCaseStatus } from '@/components/patients/case-status-context'
import { LOCKED_STATUSES, type CaseStatus } from '@/lib/constants/case-status'
import { XRayExtractionForm } from './x-ray-extraction-form'
import { getDocumentPreviewUrl } from '@/actions/documents'
import { extractXRayReport } from '@/actions/x-ray-extractions'
import type { XRayReviewFormValues, XRayFinding } from '@/lib/validations/x-ray-extraction'

const confidenceColors: Record<string, string> = {
  high: 'bg-green-100 text-green-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-red-100 text-red-800',
}

type Extraction = {
  id: string
  document_id: string
  case_id: string
  body_region: string | null
  laterality: string | null
  scan_date: string | null
  procedure_description: string | null
  view_count: number | null
  views_description: string | null
  reading_type: string | null
  ordering_provider: string | null
  reading_provider: string | null
  reason_for_study: string | null
  impression_summary: string | null
  findings: unknown
  ai_confidence: string | null
  extraction_status: string
  extraction_error: string | null
  extraction_notes: string | null
  review_status: string
  provider_overrides: Record<string, unknown>
  extracted_at: string | null
  document: {
    file_name: string
    file_path: string
  } | null
}

type Laterality = 'left' | 'right' | 'bilateral'
type ReadingType = 'formal_radiology' | 'in_office_alignment'

function coerceLaterality(v: string | null | undefined): Laterality | null {
  if (v === 'left' || v === 'right' || v === 'bilateral') return v
  return null
}

function coerceReadingType(v: string | null | undefined): ReadingType | null {
  if (v === 'formal_radiology' || v === 'in_office_alignment') return v
  return null
}

export function XRayExtractionReview({
  extraction,
  onBack,
}: {
  extraction: Extraction
  onBack: () => void
}) {
  const caseStatus = useCaseStatus()
  const isLocked = LOCKED_STATUSES.includes(caseStatus as CaseStatus)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [isReExtracting, setIsReExtracting] = useState(false)

  useEffect(() => {
    if (extraction.document?.file_path) {
      getDocumentPreviewUrl(extraction.document.file_path).then((result) => {
        if (result.url) setPdfUrl(result.url)
      })
    }
  }, [extraction.document?.file_path])

  const isManualEntry = extraction.extraction_status === 'failed'
  const overrides = extraction.provider_overrides as Partial<XRayReviewFormValues> | undefined
  const findings = (Array.isArray(extraction.findings) ? extraction.findings : []) as XRayFinding[]

  const defaultValues: XRayReviewFormValues = {
    body_region: (overrides?.body_region ?? extraction.body_region) || '',
    laterality: overrides?.laterality ?? coerceLaterality(extraction.laterality),
    scan_date: (overrides?.scan_date ?? extraction.scan_date) || null,
    procedure_description: (overrides?.procedure_description ?? extraction.procedure_description) || null,
    view_count: overrides?.view_count ?? extraction.view_count ?? null,
    views_description: (overrides?.views_description ?? extraction.views_description) || null,
    reading_type: overrides?.reading_type ?? coerceReadingType(extraction.reading_type),
    ordering_provider: (overrides?.ordering_provider ?? extraction.ordering_provider) || null,
    reading_provider: (overrides?.reading_provider ?? extraction.reading_provider) || null,
    reason_for_study: (overrides?.reason_for_study ?? extraction.reason_for_study) || null,
    findings: (overrides?.findings ?? findings) as XRayFinding[],
    impression_summary: (overrides?.impression_summary ?? extraction.impression_summary) || null,
  }

  async function handleReExtract() {
    setIsReExtracting(true)
    const result = await extractXRayReport(extraction.document_id)
    setIsReExtracting(false)
    if (result.error) {
      toast.error(`Re-extraction failed: ${result.error}`)
    } else {
      toast.success('Re-extraction started')
      onBack()
    }
  }

  return (
    <div className="flex flex-col gap-4 h-[calc(100svh-14rem)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="font-medium">
              {extraction.document?.file_name ?? 'X-Ray Extraction'}
            </h2>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {extraction.ai_confidence && (
                <Badge variant="outline" className={confidenceColors[extraction.ai_confidence]}>
                  {extraction.ai_confidence} confidence
                </Badge>
              )}
              {extraction.reading_type === 'in_office_alignment' && (
                <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200">
                  In-office alignment read
                </Badge>
              )}
              {extraction.extraction_status === 'failed' && (
                <Badge variant="destructive">Failed</Badge>
              )}
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleReExtract}
          disabled={isLocked || isReExtracting}
        >
          {isReExtracting
            ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
            : <RefreshCw className="h-3 w-3 mr-1" />}
          Re-extract
        </Button>
      </div>

      {extraction.ai_confidence === 'low' && extraction.extraction_status === 'completed' && (
        <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Extraction confidence is low. Please verify all fields carefully.
        </div>
      )}

      {extraction.extraction_notes && extraction.extraction_status === 'completed' && (
        <div className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
          <strong>Notes:</strong> {extraction.extraction_notes}
        </div>
      )}

      <div className="flex gap-6 min-h-0 flex-1">
        <div className="w-1/2 min-h-0 border rounded-lg overflow-hidden">
          {pdfUrl ? (
            <PdfViewer url={pdfUrl} className="h-full" />
          ) : (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
        <div className="w-1/2 overflow-y-auto">
          <XRayExtractionForm
            extractionId={extraction.id}
            defaultValues={defaultValues}
            isManualEntry={isManualEntry}
            onActionComplete={onBack}
          />
        </div>
      </div>
    </div>
  )
}
