'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, RefreshCw, Loader2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import dynamic from 'next/dynamic'
const PdfViewer = dynamic(() => import('@/components/documents/pdf-viewer').then(mod => ({ default: mod.PdfViewer })), { ssr: false })
import { useCaseStatus } from '@/components/patients/case-status-context'
import { OrthoExtractionForm } from './ortho-extraction-form'
import { getDocumentPreviewUrl } from '@/actions/documents'
import { extractOrthopedicReport } from '@/actions/orthopedic-extractions'
import type {
  OrthopedicReviewFormValues,
  PresentComplaint,
  CurrentMedication,
  OrthoPhysicalExamRegion,
  DiagnosticStudy,
  OrthoDiagnosis,
  Recommendation,
} from '@/lib/validations/orthopedic-extraction'

const confidenceColors: Record<string, string> = {
  high: 'bg-green-100 text-green-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-red-100 text-red-800',
}

type Extraction = {
  id: string
  document_id: string
  case_id: string
  report_date: string | null
  date_of_injury: string | null
  examining_provider: string | null
  provider_specialty: string | null
  patient_age: number | null
  patient_sex: string | null
  hand_dominance: string | null
  height: string | null
  weight: string | null
  current_employment: string | null
  history_of_injury: string | null
  past_medical_history: string | null
  surgical_history: string | null
  previous_complaints: string | null
  subsequent_complaints: string | null
  allergies: string | null
  social_history: string | null
  family_history: string | null
  present_complaints: unknown
  current_medications: unknown
  physical_exam: unknown
  diagnostics: unknown
  diagnoses: unknown
  recommendations: unknown
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

export function OrthoExtractionReview({
  extraction,
  onBack,
}: {
  extraction: Extraction
  onBack: () => void
}) {
  const caseStatus = useCaseStatus()
  const isClosed = caseStatus === 'closed'
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
  const overrides = extraction.provider_overrides as Partial<OrthopedicReviewFormValues> | undefined

  const presentComplaints = (overrides?.present_complaints ?? extraction.present_complaints ?? []) as PresentComplaint[]
  const currentMedications = (overrides?.current_medications ?? extraction.current_medications ?? []) as CurrentMedication[]
  const physicalExam = (overrides?.physical_exam ?? extraction.physical_exam ?? []) as OrthoPhysicalExamRegion[]
  const diagnostics = (overrides?.diagnostics ?? extraction.diagnostics ?? []) as DiagnosticStudy[]
  const diagnoses = (overrides?.diagnoses ?? extraction.diagnoses ?? []) as OrthoDiagnosis[]
  const recommendations = (overrides?.recommendations ?? extraction.recommendations ?? []) as Recommendation[]

  const defaultValues: OrthopedicReviewFormValues = {
    report_date: (overrides?.report_date ?? extraction.report_date) || null,
    date_of_injury: (overrides?.date_of_injury ?? extraction.date_of_injury) || null,
    examining_provider: (overrides?.examining_provider ?? extraction.examining_provider) || null,
    provider_specialty: (overrides?.provider_specialty ?? extraction.provider_specialty) || null,
    patient_age: overrides?.patient_age !== undefined ? overrides.patient_age : extraction.patient_age ?? null,
    patient_sex: (overrides?.patient_sex ?? extraction.patient_sex) || null,
    hand_dominance: (overrides?.hand_dominance ?? extraction.hand_dominance) || null,
    height: (overrides?.height ?? extraction.height) || null,
    weight: (overrides?.weight ?? extraction.weight) || null,
    current_employment: (overrides?.current_employment ?? extraction.current_employment) || null,
    history_of_injury: (overrides?.history_of_injury ?? extraction.history_of_injury) || null,
    past_medical_history: (overrides?.past_medical_history ?? extraction.past_medical_history) || null,
    surgical_history: (overrides?.surgical_history ?? extraction.surgical_history) || null,
    previous_complaints: (overrides?.previous_complaints ?? extraction.previous_complaints) || null,
    subsequent_complaints: (overrides?.subsequent_complaints ?? extraction.subsequent_complaints) || null,
    allergies: (overrides?.allergies ?? extraction.allergies) || null,
    social_history: (overrides?.social_history ?? extraction.social_history) || null,
    family_history: (overrides?.family_history ?? extraction.family_history) || null,
    present_complaints: Array.isArray(presentComplaints) ? presentComplaints : [],
    current_medications: Array.isArray(currentMedications) ? currentMedications : [],
    physical_exam: Array.isArray(physicalExam) ? physicalExam : [],
    diagnostics: Array.isArray(diagnostics) ? diagnostics : [],
    diagnoses: Array.isArray(diagnoses) ? diagnoses : [],
    recommendations: Array.isArray(recommendations) ? recommendations : [],
  }

  async function handleReExtract() {
    setIsReExtracting(true)
    const result = await extractOrthopedicReport(extraction.document_id)
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
              {extraction.document?.file_name ?? 'Orthopedic Extraction'}
            </h2>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {extraction.examining_provider && (
                <span>{extraction.examining_provider}</span>
              )}
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
          disabled={isClosed || isReExtracting}
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
          <OrthoExtractionForm
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
