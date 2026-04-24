'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import Link from 'next/link'
import { FileText, Loader2, AlertCircle, FileUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { OrthoExtractionReview } from './ortho-extraction-review'

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
  created_at: string
  extracted_at: string | null
  document: {
    file_name: string
    file_path: string
  } | null
}

const confidenceColors: Record<string, string> = {
  high: 'bg-green-100 text-green-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-red-100 text-red-800',
}

const reviewStatusConfig: Record<string, { label: string; className: string }> = {
  pending_review: { label: 'Pending Review', className: 'border-border text-foreground' },
  approved: { label: 'Approved', className: 'bg-green-100 text-green-800' },
  edited: { label: 'Edited', className: 'bg-blue-100 text-blue-800' },
  rejected: { label: 'Rejected', className: 'bg-red-100 text-red-800' },
}

export function OrthoExtractionList({
  extractions,
  caseId,
}: {
  extractions: Extraction[]
  caseId: string
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedExtraction = extractions.find((e) => e.id === selectedId)

  if (selectedExtraction) {
    return (
      <OrthoExtractionReview
        extraction={selectedExtraction}
        onBack={() => setSelectedId(null)}
      />
    )
  }

  if (extractions.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
        <p>No orthopedic extractions yet.</p>
        <p className="text-sm mt-1 mb-4">Upload an orthopedic report to get started.</p>
        <Button asChild size="sm">
          <Link href={`/patients/${caseId}/documents`}>
            <FileUp className="h-4 w-4 mr-2" />
            Upload Orthopedic Report
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {extractions.map((extraction) => {
        const diagnoses = Array.isArray(extraction.diagnoses) ? extraction.diagnoses : []
        const complaints = Array.isArray(extraction.present_complaints) ? extraction.present_complaints : []

        return (
          <button
            key={extraction.id}
            onClick={() => {
              if (extraction.extraction_status === 'processing') return
              setSelectedId(extraction.id)
            }}
            className={cn(
              'w-full text-left border rounded-lg p-4 transition-colors hover:bg-accent/50',
              extraction.extraction_status === 'processing' && 'opacity-70 cursor-wait',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium truncate">
                    {extraction.document?.file_name ?? 'Unknown document'}
                  </span>
                </div>
                {extraction.extraction_status === 'completed' && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    {extraction.examining_provider && (
                      <span>{extraction.examining_provider}</span>
                    )}
                    {extraction.report_date && (
                      <>
                        <span>·</span>
                        <span>{format(new Date(extraction.report_date), 'MM/dd/yyyy')}</span>
                      </>
                    )}
                    {(diagnoses.length > 0 || complaints.length > 0) && (
                      <>
                        <span>·</span>
                        <span>
                          {diagnoses.length} diagnos{diagnoses.length === 1 ? 'is' : 'es'} · {complaints.length} complaint{complaints.length === 1 ? '' : 's'}
                        </span>
                      </>
                    )}
                  </div>
                )}
                {extraction.extraction_status === 'processing' && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Extracting...</span>
                  </div>
                )}
                {extraction.extraction_status === 'failed' && (
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertCircle className="h-3 w-3" />
                    <span>{extraction.extraction_error ?? 'Extraction failed'}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {extraction.extraction_status === 'completed' && extraction.ai_confidence && (
                  <Badge variant="outline" className={confidenceColors[extraction.ai_confidence]}>
                    {extraction.ai_confidence}
                  </Badge>
                )}
                {extraction.extraction_status === 'completed' && (
                  <Badge
                    variant="outline"
                    className={reviewStatusConfig[extraction.review_status]?.className}
                  >
                    {reviewStatusConfig[extraction.review_status]?.label ?? extraction.review_status}
                  </Badge>
                )}
                {extraction.extraction_status === 'failed' && (
                  <Badge variant="outline" className="text-muted-foreground">
                    Enter Manually
                  </Badge>
                )}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
