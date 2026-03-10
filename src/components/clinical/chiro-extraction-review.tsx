'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, RefreshCw, Loader2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PdfViewer } from '@/components/documents/pdf-viewer'
import { ChiroExtractionForm } from './chiro-extraction-form'
import { getDocumentPreviewUrl } from '@/actions/documents'
import { extractChiroReport } from '@/actions/chiro-extractions'
import type {
  ChiroReviewFormValues,
  TreatmentDates,
  Diagnosis,
  TreatmentModality,
  FunctionalOutcomes,
  PlateauStatement,
} from '@/lib/validations/chiro-extraction'

const reportTypeLabels: Record<string, string> = {
  initial_evaluation: 'Initial Evaluation',
  soap_note: 'SOAP Note',
  re_evaluation: 'Re-Evaluation',
  discharge_summary: 'Discharge Summary',
  other: 'Other',
}

const confidenceColors: Record<string, string> = {
  high: 'bg-green-100 text-green-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-red-100 text-red-800',
}

type Extraction = {
  id: string
  document_id: string
  case_id: string
  report_type: string | null
  report_date: string | null
  treatment_dates: unknown
  diagnoses: unknown
  treatment_modalities: unknown
  functional_outcomes: unknown
  plateau_statement: unknown
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

const emptyTreatmentDates: TreatmentDates = {
  first_visit: null,
  last_visit: null,
  total_visits: null,
  visit_dates: [],
  treatment_gaps: [],
}

const emptyFunctionalOutcomes: FunctionalOutcomes = {
  pain_levels: [],
  disability_scores: [],
  progress_status: null,
}

const emptyPlateauStatement: PlateauStatement = {
  present: false,
  mmi_reached: null,
  date: null,
  verbatim_statement: null,
  residual_complaints: [],
  permanent_restrictions: [],
  impairment_rating_percent: null,
  future_care_recommended: null,
}

export function ChiroExtractionReview({
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
  const overrides = extraction.provider_overrides as Partial<ChiroReviewFormValues> | undefined

  const reportType = (overrides?.report_type ?? extraction.report_type ?? 'other') as ChiroReviewFormValues['report_type']
  const treatmentDates = (overrides?.treatment_dates ?? extraction.treatment_dates ?? emptyTreatmentDates) as TreatmentDates
  const diagnoses = (overrides?.diagnoses ?? extraction.diagnoses ?? []) as Diagnosis[]
  const treatmentModalities = (overrides?.treatment_modalities ?? extraction.treatment_modalities ?? []) as TreatmentModality[]
  const functionalOutcomes = (overrides?.functional_outcomes ?? extraction.functional_outcomes ?? emptyFunctionalOutcomes) as FunctionalOutcomes
  const plateauStatement = (overrides?.plateau_statement ?? extraction.plateau_statement ?? emptyPlateauStatement) as PlateauStatement

  const defaultValues: ChiroReviewFormValues = {
    report_type: reportType,
    report_date: (overrides?.report_date ?? extraction.report_date) || null,
    treatment_dates: treatmentDates,
    diagnoses: Array.isArray(diagnoses) ? diagnoses : [],
    treatment_modalities: Array.isArray(treatmentModalities) ? treatmentModalities : [],
    functional_outcomes: functionalOutcomes,
    plateau_statement: plateauStatement,
  }

  async function handleReExtract() {
    setIsReExtracting(true)
    const result = await extractChiroReport(extraction.document_id)
    setIsReExtracting(false)
    if (result.error) {
      toast.error(`Re-extraction failed: ${result.error}`)
    } else {
      toast.success('Re-extraction started')
      onBack()
    }
  }

  const reportLabel = extraction.report_type
    ? reportTypeLabels[extraction.report_type] ?? extraction.report_type
    : 'Chiro Extraction'

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-280px)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="font-medium">
              {extraction.document?.file_name ?? reportLabel}
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
          <ChiroExtractionForm
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
