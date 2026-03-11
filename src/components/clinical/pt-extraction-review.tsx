'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, RefreshCw, Loader2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import dynamic from 'next/dynamic'
const PdfViewer = dynamic(() => import('@/components/documents/pdf-viewer').then(mod => ({ default: mod.PdfViewer })), { ssr: false })
import { PtExtractionForm } from './pt-extraction-form'
import { getDocumentPreviewUrl } from '@/actions/documents'
import { extractPtReport } from '@/actions/pt-extractions'
import type {
  PtReviewFormValues,
  PainRatings,
  PtRomMeasurement,
  MuscleStrength,
  PalpationFinding,
  SpecialTest,
  NeurologicalScreening,
  FunctionalTest,
  OutcomeMeasure,
  TreatmentGoal,
  PlanOfCare,
  PtDiagnosis,
} from '@/lib/validations/pt-extraction'

const confidenceColors: Record<string, string> = {
  high: 'bg-green-100 text-green-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-red-100 text-red-800',
}

type Extraction = {
  id: string
  document_id: string
  case_id: string
  evaluation_date: string | null
  date_of_injury: string | null
  evaluating_therapist: string | null
  referring_provider: string | null
  chief_complaint: string | null
  mechanism_of_injury: string | null
  pain_ratings: unknown
  functional_limitations: string | null
  prior_treatment: string | null
  work_status: string | null
  postural_assessment: string | null
  gait_analysis: string | null
  range_of_motion: unknown
  muscle_strength: unknown
  palpation_findings: unknown
  special_tests: unknown
  neurological_screening: unknown
  functional_tests: unknown
  outcome_measures: unknown
  clinical_impression: string | null
  causation_statement: string | null
  prognosis: string | null
  short_term_goals: unknown
  long_term_goals: unknown
  plan_of_care: unknown
  diagnoses: unknown
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

const emptyPainRatings: PainRatings = { at_rest: null, with_activity: null, worst: null, best: null }
const emptyNeuro: NeurologicalScreening = { reflexes: [], sensation: null, motor_notes: null }
const emptyPlanOfCare: PlanOfCare = { frequency: null, duration: null, modalities: [], home_exercise_program: null, re_evaluation_schedule: null }

export function PtExtractionReview({
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
  const overrides = extraction.provider_overrides as Partial<PtReviewFormValues> | undefined

  const painRatings = (overrides?.pain_ratings ?? extraction.pain_ratings ?? emptyPainRatings) as PainRatings
  const rangeOfMotion = (overrides?.range_of_motion ?? extraction.range_of_motion ?? []) as PtRomMeasurement[]
  const muscleStrength = (overrides?.muscle_strength ?? extraction.muscle_strength ?? []) as MuscleStrength[]
  const palpationFindings = (overrides?.palpation_findings ?? extraction.palpation_findings ?? []) as PalpationFinding[]
  const specialTests = (overrides?.special_tests ?? extraction.special_tests ?? []) as SpecialTest[]
  const neuroScreening = (overrides?.neurological_screening ?? extraction.neurological_screening ?? emptyNeuro) as NeurologicalScreening
  const functionalTests = (overrides?.functional_tests ?? extraction.functional_tests ?? []) as FunctionalTest[]
  const outcomeMeasures = (overrides?.outcome_measures ?? extraction.outcome_measures ?? []) as OutcomeMeasure[]
  const shortTermGoals = (overrides?.short_term_goals ?? extraction.short_term_goals ?? []) as TreatmentGoal[]
  const longTermGoals = (overrides?.long_term_goals ?? extraction.long_term_goals ?? []) as TreatmentGoal[]
  const planOfCare = (overrides?.plan_of_care ?? extraction.plan_of_care ?? emptyPlanOfCare) as PlanOfCare
  const diagnoses = (overrides?.diagnoses ?? extraction.diagnoses ?? []) as PtDiagnosis[]

  const defaultValues: PtReviewFormValues = {
    evaluation_date: (overrides?.evaluation_date ?? extraction.evaluation_date) || null,
    date_of_injury: (overrides?.date_of_injury ?? extraction.date_of_injury) || null,
    evaluating_therapist: (overrides?.evaluating_therapist ?? extraction.evaluating_therapist) || null,
    referring_provider: (overrides?.referring_provider ?? extraction.referring_provider) || null,
    chief_complaint: (overrides?.chief_complaint ?? extraction.chief_complaint) || null,
    mechanism_of_injury: (overrides?.mechanism_of_injury ?? extraction.mechanism_of_injury) || null,
    pain_ratings: painRatings,
    functional_limitations: (overrides?.functional_limitations ?? extraction.functional_limitations) || null,
    prior_treatment: (overrides?.prior_treatment ?? extraction.prior_treatment) || null,
    work_status: (overrides?.work_status ?? extraction.work_status) || null,
    postural_assessment: (overrides?.postural_assessment ?? extraction.postural_assessment) || null,
    gait_analysis: (overrides?.gait_analysis ?? extraction.gait_analysis) || null,
    range_of_motion: Array.isArray(rangeOfMotion) ? rangeOfMotion : [],
    muscle_strength: Array.isArray(muscleStrength) ? muscleStrength : [],
    palpation_findings: Array.isArray(palpationFindings) ? palpationFindings : [],
    special_tests: Array.isArray(specialTests) ? specialTests : [],
    neurological_screening: neuroScreening,
    functional_tests: Array.isArray(functionalTests) ? functionalTests : [],
    outcome_measures: Array.isArray(outcomeMeasures) ? outcomeMeasures : [],
    clinical_impression: (overrides?.clinical_impression ?? extraction.clinical_impression) || null,
    causation_statement: (overrides?.causation_statement ?? extraction.causation_statement) || null,
    prognosis: (overrides?.prognosis ?? extraction.prognosis) || null,
    short_term_goals: Array.isArray(shortTermGoals) ? shortTermGoals : [],
    long_term_goals: Array.isArray(longTermGoals) ? longTermGoals : [],
    plan_of_care: planOfCare,
    diagnoses: Array.isArray(diagnoses) ? diagnoses : [],
  }

  async function handleReExtract() {
    setIsReExtracting(true)
    const result = await extractPtReport(extraction.document_id)
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
              {extraction.document?.file_name ?? 'PT Extraction'}
            </h2>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {extraction.evaluating_therapist && (
                <span>{extraction.evaluating_therapist}</span>
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
          <PtExtractionForm
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
