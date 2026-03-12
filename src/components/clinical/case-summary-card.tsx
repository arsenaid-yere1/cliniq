'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Sparkles, RefreshCw, Check, Pencil, Loader2, AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { generateCaseSummary, approveCaseSummary } from '@/actions/case-summaries'
import { CaseSummaryEditDialog } from './case-summary-edit-dialog'
import type {
  ImagingFinding,
  PriorTreatment,
  SymptomsTimeline,
  SuggestedDiagnosis,
  CaseSummaryEditValues,
} from '@/lib/validations/case-summary'
import { useCaseStatus } from '@/components/patients/case-status-context'

const reviewStatusColors: Record<string, string> = {
  pending_review: '',
  approved: 'border-green-500 bg-green-50 text-green-700',
  edited: 'border-blue-500 bg-blue-50 text-blue-700',
  rejected: 'border-red-500 bg-red-50 text-red-700',
}

const reviewStatusLabels: Record<string, string> = {
  pending_review: 'Needs Review',
  approved: 'Approved',
  edited: 'Edited',
  rejected: 'Rejected',
}

const confidenceColors: Record<string, string> = {
  high: 'border-green-500 bg-green-50 text-green-700',
  medium: 'border-yellow-500 bg-yellow-50 text-yellow-700',
  low: 'border-red-500 bg-red-50 text-red-700',
}

const severityColors: Record<string, string> = {
  mild: 'bg-yellow-100 text-yellow-800',
  moderate: 'bg-orange-100 text-orange-800',
  severe: 'bg-red-100 text-red-800',
}

// DB row type
interface CaseSummaryRow {
  id: string
  case_id: string
  chief_complaint: string | null
  imaging_findings: ImagingFinding[]
  prior_treatment: PriorTreatment
  symptoms_timeline: SymptomsTimeline
  suggested_diagnoses: SuggestedDiagnosis[]
  ai_confidence: string | null
  extraction_notes: string | null
  review_status: string
  provider_overrides: Partial<CaseSummaryEditValues> | Record<string, never>
  generation_status: string
  generation_error: string | null
}

interface CaseSummaryCardProps {
  caseId: string
  summary: CaseSummaryRow | null
  isStale: boolean
}

export function CaseSummaryCard({ caseId, summary, isStale }: CaseSummaryCardProps) {
  const [isPending, startTransition] = useTransition()
  const [editOpen, setEditOpen] = useState(false)
  const caseStatus = useCaseStatus()
  const isClosed = caseStatus === 'closed'

  function handleGenerate() {
    startTransition(async () => {
      const result = await generateCaseSummary(caseId)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Summary generated successfully')
      }
    })
  }

  function handleApprove() {
    startTransition(async () => {
      const result = await approveCaseSummary(caseId)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Summary approved')
      }
    })
  }

  function handleRegenerate() {
    startTransition(async () => {
      const result = await generateCaseSummary(caseId)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Summary regenerated successfully')
      }
    })
  }

  // No summary state
  if (!summary) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Clinical Case Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6 space-y-3">
            <p className="text-sm text-muted-foreground">
              No summary generated yet. Approve at least one clinical extraction to generate a summary.
            </p>
            <Button onClick={handleGenerate} disabled={isClosed || isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
              Generate Summary
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Generating state
  if (summary.generation_status === 'processing') {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Clinical Case Summary</CardTitle>
          <Badge variant="outline">Generating...</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-4 w-1/2" />
        </CardContent>
      </Card>
    )
  }

  // Failed state
  if (summary.generation_status === 'failed') {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Clinical Case Summary</CardTitle>
          <Badge variant="destructive">Failed</Badge>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800 mb-4">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {summary.generation_error || 'Summary generation failed.'}
          </div>
          <Button onClick={handleRegenerate} disabled={isClosed || isPending} variant="outline">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  // Completed state — merge provider overrides
  const overrides = (summary.provider_overrides && Object.keys(summary.provider_overrides).length > 0)
    ? summary.provider_overrides as Partial<CaseSummaryEditValues>
    : null

  const chiefComplaint = overrides?.chief_complaint ?? summary.chief_complaint
  const imagingFindings = (overrides?.imaging_findings ?? summary.imaging_findings ?? []) as ImagingFinding[]
  const rawPriorTreatment = (overrides?.prior_treatment ?? summary.prior_treatment) as Partial<PriorTreatment> | null
  const priorTreatment: PriorTreatment = {
    modalities: rawPriorTreatment?.modalities ?? [],
    total_visits: rawPriorTreatment?.total_visits ?? null,
    treatment_period: rawPriorTreatment?.treatment_period ?? null,
    gaps: rawPriorTreatment?.gaps ?? [],
  }
  const rawSymptomsTimeline = (overrides?.symptoms_timeline ?? summary.symptoms_timeline) as Partial<SymptomsTimeline> | null
  const symptomsTimeline: SymptomsTimeline = {
    onset: rawSymptomsTimeline?.onset ?? null,
    progression: rawSymptomsTimeline?.progression ?? [],
    current_status: rawSymptomsTimeline?.current_status ?? null,
    pain_levels: rawSymptomsTimeline?.pain_levels ?? [],
  }
  const suggestedDiagnoses = (overrides?.suggested_diagnoses ?? summary.suggested_diagnoses ?? []) as SuggestedDiagnosis[]

  const showApprove = summary.review_status === 'pending_review'
  const showRegenerate = summary.review_status !== 'pending_review' || isStale

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle>Clinical Case Summary</CardTitle>
            {isStale && (
              <Badge variant="outline" className="border-amber-500 bg-amber-50 text-amber-700">
                Outdated
              </Badge>
            )}
            <Badge variant="outline" className={reviewStatusColors[summary.review_status]}>
              {reviewStatusLabels[summary.review_status] || summary.review_status}
            </Badge>
            {summary.ai_confidence && (
              <Badge variant="outline" className={confidenceColors[summary.ai_confidence]}>
                {summary.ai_confidence} confidence
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {showApprove && (
              <Button variant="outline" size="sm" onClick={handleApprove} disabled={isClosed || isPending}>
                {isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
                Approve
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} disabled={isClosed}>
              <Pencil className="h-3 w-3 mr-1" />
              Edit
            </Button>
            {showRegenerate && (
              <Button variant="outline" size="sm" onClick={handleRegenerate} disabled={isClosed || isPending}>
                {isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                Regenerate
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Chief Complaint */}
          <section>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Chief Complaint</h3>
            <p className="text-sm">{chiefComplaint || 'No chief complaint recorded.'}</p>
          </section>

          {/* Imaging Findings */}
          <section>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Imaging Findings</h3>
            {imagingFindings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No imaging findings.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {imagingFindings.map((finding, i) => (
                  <div key={i} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{finding.body_region}</span>
                      {finding.severity && (
                        <Badge variant="outline" className={severityColors[finding.severity]}>
                          {finding.severity}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{finding.summary}</p>
                    {finding.key_findings.length > 0 && (
                      <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5">
                        {finding.key_findings.map((kf, j) => (
                          <li key={j}>{kf}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Prior Treatment */}
          <section>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Prior Treatment</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {priorTreatment.modalities.length > 0 && (
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Modalities</dt>
                  <dd>{priorTreatment.modalities.join(', ')}</dd>
                </div>
              )}
              {priorTreatment.total_visits != null && (
                <div>
                  <dt className="text-muted-foreground">Total Visits</dt>
                  <dd>{priorTreatment.total_visits}</dd>
                </div>
              )}
              {priorTreatment.treatment_period && (
                <div>
                  <dt className="text-muted-foreground">Period</dt>
                  <dd>{priorTreatment.treatment_period}</dd>
                </div>
              )}
            </dl>
            {priorTreatment.gaps.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-medium text-amber-700 mb-1">Treatment Gaps</p>
                {priorTreatment.gaps.map((gap, i) => (
                  <p key={i} className="text-xs text-amber-600">
                    {gap.from} to {gap.to} ({gap.days} days)
                  </p>
                ))}
              </div>
            )}
          </section>

          {/* Symptoms Timeline */}
          <section>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Symptoms Timeline</h3>
            <div className="space-y-2 text-sm">
              {symptomsTimeline.onset && (
                <div>
                  <span className="text-muted-foreground">Onset: </span>
                  {symptomsTimeline.onset}
                </div>
              )}
              {symptomsTimeline.progression.length > 0 && (
                <div className="space-y-1">
                  {symptomsTimeline.progression.map((step, i) => (
                    <div key={i} className="flex gap-2">
                      {step.date && <span className="text-muted-foreground text-xs shrink-0">{step.date}</span>}
                      <span className="text-xs">{step.description}</span>
                    </div>
                  ))}
                </div>
              )}
              {symptomsTimeline.current_status && (
                <div>
                  <span className="text-muted-foreground">Current: </span>
                  {symptomsTimeline.current_status}
                </div>
              )}
              {symptomsTimeline.pain_levels.length > 0 && (
                <div className="flex gap-2 flex-wrap mt-1">
                  {symptomsTimeline.pain_levels.map((pl, i) => (
                    <Badge key={i} variant="outline" className="text-xs">
                      {pl.date ? `${pl.date}: ` : ''}{pl.level}/10{pl.context ? ` (${pl.context})` : ''}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Suggested Diagnoses */}
          <section>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Suggested Diagnoses</h3>
            {suggestedDiagnoses.length === 0 ? (
              <p className="text-sm text-muted-foreground">No diagnoses suggested.</p>
            ) : (
              <div className="space-y-2">
                {suggestedDiagnoses.map((dx, i) => (
                  <div key={i} className="flex items-start justify-between border rounded-lg p-2">
                    <div>
                      <span className="text-sm font-medium">{dx.diagnosis}</span>
                      {dx.icd10_code && (
                        <span className="text-xs text-muted-foreground ml-2 font-mono">{dx.icd10_code}</span>
                      )}
                      {dx.supporting_evidence && (
                        <p className="text-xs text-muted-foreground mt-0.5">{dx.supporting_evidence}</p>
                      )}
                    </div>
                    <Badge variant="outline" className={confidenceColors[dx.confidence]}>
                      {dx.confidence}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Extraction Notes */}
          {summary.extraction_notes && (
            <div className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
              <strong>Notes:</strong> {summary.extraction_notes}
            </div>
          )}
        </CardContent>
      </Card>

      <CaseSummaryEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        caseId={caseId}
        summary={summary}
        overrides={overrides}
      />
    </>
  )
}
