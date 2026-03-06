'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, RefreshCw, Loader2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PdfViewer } from '@/components/documents/pdf-viewer'
import { MriExtractionForm } from './mri-extraction-form'
import { getDocumentPreviewUrl } from '@/actions/documents'
import { extractMriReport } from '@/actions/mri-extractions'
import type { MriReviewFormValues, Finding } from '@/lib/validations/mri-extraction'

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
  mri_date: string | null
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

export function MriExtractionReview({
  extraction,
  onBack,
}: {
  extraction: Extraction
  onBack: () => void
}) {
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
  const overrides = extraction.provider_overrides as Partial<MriReviewFormValues> | undefined
  const findings = (Array.isArray(extraction.findings) ? extraction.findings : []) as Finding[]

  const defaultValues: MriReviewFormValues = {
    body_region: (overrides?.body_region ?? extraction.body_region) || '',
    mri_date: (overrides?.mri_date ?? extraction.mri_date) || null,
    findings: (overrides?.findings ?? findings) as Finding[],
    impression_summary: (overrides?.impression_summary ?? extraction.impression_summary) || null,
  }

  async function handleReExtract() {
    setIsReExtracting(true)
    const result = await extractMriReport(extraction.document_id)
    setIsReExtracting(false)
    if (result.error) {
      toast.error(`Re-extraction failed: ${result.error}`)
    } else {
      toast.success('Re-extraction started')
      onBack()
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="font-medium">
              {extraction.document?.file_name ?? 'MRI Extraction'}
            </h2>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {extraction.ai_confidence && (
                <Badge variant="outline" className={confidenceColors[extraction.ai_confidence]}>
                  {extraction.ai_confidence} confidence
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
          disabled={isReExtracting}
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

      <div className="flex gap-6" style={{ height: 'calc(100vh - 280px)' }}>
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
          <MriExtractionForm
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
