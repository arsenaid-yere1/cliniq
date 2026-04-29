'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { GeneratingProgress } from '@/components/clinical/generating-progress'
import {
  runCaseQualityReview,
  recheckCaseQualityReview,
  acknowledgeFinding,
  clearFindingOverride,
} from '@/actions/case-quality-reviews'
import {
  qcSeverityValues,
  computeFindingHash,
  type QualityFinding,
  type QcSeverity,
  type QcStep,
  type FindingOverridesMap,
  type FindingOverrideEntry,
} from '@/lib/validations/case-quality-review'
import { useCaseStatus } from '@/components/patients/case-status-context'
import { LOCKED_STATUSES, type CaseStatus } from '@/lib/constants/case-status'
import { AlertCircle, AlertTriangle, Info, RefreshCw, Check, X, Pencil, Undo2 } from 'lucide-react'
import { FindingEditDialog } from './finding-edit-dialog'
import { FindingDismissDialog } from './finding-dismiss-dialog'

interface ReviewRow {
  id: string
  generation_status: 'pending' | 'processing' | 'completed' | 'failed'
  generation_error: string | null
  findings: QualityFinding[] | null
  finding_overrides: FindingOverridesMap | null
  summary: string | null
  overall_assessment: string | null
  sections_done: number
  sections_total: number
  generated_at: string | null
}

const severityConfig: Record<
  QcSeverity,
  { icon: typeof Info; label: string; badgeVariant: 'destructive' | 'secondary' | 'outline' }
> = {
  critical: { icon: AlertCircle, label: 'Critical', badgeVariant: 'destructive' },
  warning: { icon: AlertTriangle, label: 'Warning', badgeVariant: 'secondary' },
  info: { icon: Info, label: 'Info', badgeVariant: 'outline' },
}

const stepLabels: Record<QcStep, string> = {
  initial_visit: 'Initial Visit',
  pain_evaluation: 'Pain Evaluation',
  procedure: 'Procedure',
  discharge: 'Discharge',
  case_summary: 'Case Summary',
  cross_step: 'Cross-Step',
}

function findingDeepLink(caseId: string, finding: QualityFinding): string {
  switch (finding.step) {
    case 'initial_visit':
    case 'pain_evaluation':
      return `/patients/${caseId}/initial-visit`
    case 'procedure':
      return finding.procedure_id
        ? `/patients/${caseId}/procedures/${finding.procedure_id}/note`
        : `/patients/${caseId}/procedures`
    case 'discharge':
      return `/patients/${caseId}/discharge`
    case 'case_summary':
      return `/patients/${caseId}`
    case 'cross_step':
    default:
      return `/patients/${caseId}`
  }
}

export function QcReviewPanel({
  caseId,
  review,
  isStale,
}: {
  caseId: string
  review: ReviewRow | null
  isStale: boolean
}) {
  const [isPending, startTransition] = useTransition()
  // Optimistic local flag — flips on click so the panel shows the Reviewing
  // card immediately. The server action awaits Claude (~30s) before
  // returning, so without this the UI sits on the old completed state and
  // shows zero feedback during the wait. router.refresh() at the end pulls
  // fresh DB state which clears the flag implicitly because review is then
  // either completed or failed.
  const [optimisticGenerating, setOptimisticGenerating] = useState(false)
  const router = useRouter()
  const caseStatus = useCaseStatus()
  const isLocked = LOCKED_STATUSES.includes(caseStatus as CaseStatus)

  const runReview = (label: string, action: typeof runCaseQualityReview) => {
    setOptimisticGenerating(true)
    startTransition(async () => {
      const result = await action(caseId)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(label)
      }
      setOptimisticGenerating(false)
      router.refresh()
    })
  }

  const handleRun = () => runReview('QC review started', runCaseQualityReview)
  const handleRecheck = () =>
    runReview('QC review re-running', recheckCaseQualityReview)

  // Optimistic generating — flipped on the moment the user clicks
  // Run/Recheck/Retry. Shown until the action returns and router.refresh()
  // brings back the real row in either processing/completed/failed state.
  if (optimisticGenerating) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Reviewing case…</CardTitle>
        </CardHeader>
        <CardContent>
          {review ? (
            <GeneratingProgress
              realtimeTable="case_quality_reviews"
              noteId={review.id}
              initialProgress={{ done: review.sections_done, total: review.sections_total }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Starting review…</p>
          )}
          <Skeleton className="mt-4 h-32" />
        </CardContent>
      </Card>
    )
  }

  // Empty state
  if (!review) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Run quality review</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Reviews the full case workflow chain. Reads finalized notes plus extractions.
          </p>
          <Button onClick={handleRun} disabled={isPending || isLocked}>
            Run Review
          </Button>
        </CardContent>
      </Card>
    )
  }

  // Processing (server-confirmed)
  if (review.generation_status === 'processing') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Reviewing case…</CardTitle>
        </CardHeader>
        <CardContent>
          <GeneratingProgress
            realtimeTable="case_quality_reviews"
            noteId={review.id}
            initialProgress={{ done: review.sections_done, total: review.sections_total }}
          />
          <Skeleton className="mt-4 h-32" />
        </CardContent>
      </Card>
    )
  }

  // Failed
  if (review.generation_status === 'failed') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-destructive">Review failed</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-destructive">{review.generation_error || 'Unknown error'}</p>
          <Button onClick={handleRun} disabled={isPending || isLocked}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  // Completed
  const findings = review.findings ?? []
  const overrides: FindingOverridesMap = review.finding_overrides ?? {}

  const hydrated = findings.map((f) => {
    const hash = computeFindingHash(f)
    const override = overrides[hash] ?? null
    return { finding: f, hash, override }
  })

  const isDismissed = (o: FindingOverrideEntry | null) => o?.status === 'dismissed'

  const grouped: Record<QcSeverity, typeof hydrated> = {
    critical: hydrated.filter((h) => h.finding.severity === 'critical'),
    warning: hydrated.filter((h) => h.finding.severity === 'warning'),
    info: hydrated.filter((h) => h.finding.severity === 'info'),
  }

  const counts = {
    critical: grouped.critical.filter((h) => !isDismissed(h.override)).length,
    warning: grouped.warning.filter((h) => !isDismissed(h.override)).length,
    info: grouped.info.filter((h) => !isDismissed(h.override)).length,
  }
  const dismissedCount = hydrated.filter((h) => isDismissed(h.override)).length

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>
              Review {review.overall_assessment === 'clean' ? 'clean' : 'complete'}
            </CardTitle>
            {review.summary && (
              <p className="mt-1 text-sm text-muted-foreground">{review.summary}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isStale && <Badge variant="outline">Stale</Badge>}
            <Button
              onClick={handleRecheck}
              disabled={isPending || isLocked}
              variant="outline"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Recheck
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 text-sm">
            <span>
              Critical: <strong>{counts.critical}</strong>
            </span>
            <span>
              Warning: <strong>{counts.warning}</strong>
            </span>
            <span>
              Info: <strong>{counts.info}</strong>
            </span>
            {dismissedCount > 0 && (
              <span className="text-muted-foreground">
                Dismissed: <strong>{dismissedCount}</strong>
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Recheck wipes all overrides — fresh review starts clean.
          </p>
        </CardContent>
      </Card>

      {qcSeverityValues
        .slice()
        .reverse()
        .map((sev) => {
          const items = grouped[sev]
          if (items.length === 0) return null
          const active = items.filter((h) => !isDismissed(h.override))
          const dismissed = items.filter((h) => isDismissed(h.override))
          return (
            <Card key={sev}>
              <CardHeader>
                <CardTitle className="text-base">
                  {severityConfig[sev].label} ({active.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {active.map((h) => (
                  <FindingCard
                    key={h.hash}
                    caseId={caseId}
                    hash={h.hash}
                    finding={h.finding}
                    override={h.override}
                    isLocked={isLocked}
                  />
                ))}

                {dismissed.length > 0 && (
                  <details className="mt-2 rounded-md border border-dashed p-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      Dismissed ({dismissed.length})
                    </summary>
                    <div className="mt-2 space-y-2">
                      {dismissed.map((h) => (
                        <FindingCard
                          key={h.hash}
                          caseId={caseId}
                          hash={h.hash}
                          finding={h.finding}
                          override={h.override}
                          isLocked={isLocked}
                        />
                      ))}
                    </div>
                  </details>
                )}
              </CardContent>
            </Card>
          )
        })}

      {findings.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No findings — chain is clean.
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function FindingCard({
  caseId,
  hash,
  finding,
  override,
  isLocked,
}: {
  caseId: string
  hash: string
  finding: QualityFinding
  override: FindingOverrideEntry | null
  isLocked: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const [editOpen, setEditOpen] = useState(false)
  const [dismissOpen, setDismissOpen] = useState(false)
  const router = useRouter()

  const Icon = severityConfig[finding.severity].icon
  const status = override?.status ?? 'pending'
  const displayMessage = override?.edited_message ?? finding.message
  const displayRationale = override?.edited_rationale ?? finding.rationale
  const displayToneHint =
    override?.edited_suggested_tone_hint ?? finding.suggested_tone_hint

  const handleAck = () =>
    startTransition(async () => {
      const r = await acknowledgeFinding(caseId, hash)
      if (r.error) toast.error(r.error)
      else {
        toast.success('Finding acknowledged')
        router.refresh()
      }
    })
  const handleClear = () =>
    startTransition(async () => {
      const r = await clearFindingOverride(caseId, hash)
      if (r.error) toast.error(r.error)
      else {
        toast.success('Override cleared')
        router.refresh()
      }
    })

  const containerClass =
    status === 'dismissed'
      ? 'flex items-start gap-3 rounded-md border p-3 opacity-60'
      : 'flex items-start gap-3 rounded-md border p-3'

  return (
    <>
      <div className={containerClass}>
        <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <div className="flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline">{stepLabels[finding.step]}</Badge>
            {finding.section_key && (
              <Badge variant="secondary">{finding.section_key}</Badge>
            )}
            {status !== 'pending' && (
              <Badge
                variant={status === 'dismissed' ? 'outline' : 'default'}
                className="capitalize"
              >
                {status}
              </Badge>
            )}
          </div>
          <p className="text-sm font-medium">{displayMessage}</p>
          {displayRationale && (
            <p className="text-xs text-muted-foreground">{displayRationale}</p>
          )}
          {displayToneHint && (
            <p className="text-xs italic text-muted-foreground">
              Suggested tone: {displayToneHint}
            </p>
          )}
          {override?.status === 'dismissed' && override.dismissed_reason && (
            <p className="text-xs text-muted-foreground">
              Dismissed: {override.dismissed_reason}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Link
              href={findingDeepLink(caseId, finding)}
              className="text-xs text-primary underline"
            >
              View in editor →
            </Link>
            {!isLocked && status === 'pending' && (
              <>
                <Button size="sm" variant="outline" onClick={handleAck} disabled={isPending}>
                  <Check className="mr-1 h-3 w-3" />
                  Acknowledge
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditOpen(true)}
                  disabled={isPending}
                >
                  <Pencil className="mr-1 h-3 w-3" />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDismissOpen(true)}
                  disabled={isPending}
                >
                  <X className="mr-1 h-3 w-3" />
                  Dismiss
                </Button>
              </>
            )}
            {!isLocked && status !== 'pending' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleClear}
                disabled={isPending}
              >
                <Undo2 className="mr-1 h-3 w-3" />
                Undo
              </Button>
            )}
          </div>
        </div>
      </div>

      {editOpen && (
        <FindingEditDialog
          caseId={caseId}
          hash={hash}
          initialValues={{
            edited_message: displayMessage,
            edited_rationale: displayRationale,
            edited_suggested_tone_hint: displayToneHint,
          }}
          onClose={() => setEditOpen(false)}
        />
      )}
      {dismissOpen && (
        <FindingDismissDialog
          caseId={caseId}
          hash={hash}
          onClose={() => setDismissOpen(false)}
        />
      )}
    </>
  )
}
