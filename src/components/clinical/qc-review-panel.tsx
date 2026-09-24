'use client'

import { actOnQualityFinding, getQualityReviewRuns } from '@/actions/case-quality-review-findings'
import { isDeterministicReviewRule } from '@/lib/qc/review-rules'
import { deriveReviewAssessment } from '@/lib/qc/review-findings'
import { useEffect, useState, useTransition } from 'react'
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
  verifyFinding,
  markFindingResolved,
  fixFinding,
} from '@/actions/case-quality-reviews'
import {
  qcSeverityValues,
  findingFixEligibility,
  getFindingScore,
  type QualityFinding,
  type QcSeverity,
  type QcStep,
  type FindingOverridesMap,
  type FindingOverrideEntry,
  type FindingResolutionSource,
} from '@/lib/validations/case-quality-review'
import { useCaseStatus } from '@/components/patients/case-status-context'
import { LOCKED_STATUSES, type CaseStatus } from '@/lib/constants/case-status'
import {
  AlertCircle,
  AlertTriangle,
  Info,
  RefreshCw,
  Check,
  X,
  Pencil,
  Undo2,
  CheckCircle2,
  Wand2,
  Loader2,
} from 'lucide-react'
import { FindingEditDialog } from './finding-edit-dialog'
import { FindingDismissDialog } from './finding-dismiss-dialog'

// Only registered deterministic rules can be replayed by Verify.
const canVerify = (finding: QualityFinding) => finding.provenance === 'deterministic' && !!finding.rule_id && isDeterministicReviewRule(finding.rule_id)

const resolutionSourceLabels: Record<FindingResolutionSource, string> = {
  auto_recheck: 'Auto-resolved on Recheck',
  manual_verify: 'Verified',
  manual_resolve: 'Marked resolved',
}

interface ReviewRow {
  id: string
  episode_id?: string | null
  review_version?: string | null
  review_coverage?: {complete?:boolean;limitations?:string[]} | null
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
  pain_follow_up: 'Pain Follow-Up',
  procedure: 'Procedure',
  discharge: 'Discharge',
  case_summary: 'Case Summary',
  cross_step: 'Cross-Step',
}

function findingDeepLink(caseId: string, finding: QualityFinding, episodeId?: string | null): string {
  // The persisted review owns its findings; model output does not select an episode.
  const episodeQuery = episodeId ? `episode=${encodeURIComponent(episodeId)}` : ''
  switch (finding.step) {
    case 'initial_visit':
    case 'pain_evaluation':
      return `/patients/${caseId}/initial-visit?${episodeQuery ? `${episodeQuery}&` : ''}visitType=${finding.step === 'pain_evaluation' ? 'pain_evaluation_visit' : 'initial_visit'}`
    case 'procedure':
      return finding.procedure_id
        ? `/patients/${caseId}/procedures/${finding.procedure_id}/note`
        : `/patients/${caseId}/procedures`
    case 'pain_follow_up':
      return finding.encounter_id ? `/patients/${caseId}/visits/${finding.encounter_id}` : `/patients/${caseId}/visits`
    case 'discharge':
      return `/patients/${caseId}/discharge${episodeQuery ? `?${episodeQuery}` : ''}`
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
  modern = false,
  freshnessUnknown = false,
  attempts = [],
}: {
  caseId: string
  review: ReviewRow | null
  isStale: boolean
  modern?: boolean
  freshnessUnknown?: boolean
  attempts?: Awaited<ReturnType<typeof getQualityReviewRuns>>['data']
}) {
  const [isPending, startTransition] = useTransition()
  // Optimistic local flag — flips on click so the panel shows the Reviewing
  // card immediately. The server action awaits Claude (~30s) before
  // returning, so without this the UI sits on the old completed state and
  // shows zero feedback during the wait. router.refresh() at the end pulls
  // fresh DB state which clears the flag implicitly because review is then
  // either completed or failed.
  const [optimisticGenerating, setOptimisticGenerating] = useState(false)
  // Per-finding optimistic fix flag. Mirrors `optimisticGenerating` but
  // scoped to a specific finding hash. fixFinding takes ~40s end-to-end
  // (regen + full recheck); without this the FindingCard shows no feedback
  // until the action returns. Cleared by the action's onSuccess/onError.
  const [optimisticFixingHashes, setOptimisticFixingHashes] = useState<Set<string>>(new Set())
  const router = useRouter()
  const caseStatus = useCaseStatus()
  const isLocked = LOCKED_STATUSES.includes(caseStatus as CaseStatus)
  const writesPaused = review?.review_version === 'qc-v3' && !modern
  const lastRun = attempts[0]
  const attemptProcessing = lastRun?.status === 'processing'
  const [olderAttempts,setOlderAttempts] = useState<typeof attempts>([])
  const [hasOlder,setHasOlder] = useState(true)
  const allAttempts = [...new Map([...olderAttempts,...attempts].map(run => [run.id,run])).values()].sort((a,b) => b.started_at.localeCompare(a.started_at) || b.id.localeCompare(a.id))
  useEffect(() => {
    if (!modern || (!attemptProcessing && !optimisticGenerating)) return
    const timer = setInterval(() => router.refresh(),3000)
    return () => clearInterval(timer)
  },[modern,attemptProcessing,optimisticGenerating,router])

  // Poll the server component tree while a fix is in flight so the recheck's
  // mid-flight DB transitions (new review row, new findings, carry-over
  // overrides) surface without waiting for the action to return. Mirrors the
  // GeneratingProgress polling pattern.
  useEffect(() => {
    if (optimisticFixingHashes.size === 0) return
    const id = setInterval(() => router.refresh(), 3000)
    return () => clearInterval(id)
  }, [optimisticFixingHashes, router])

  const beginFix = (hash: string) => {
    setOptimisticFixingHashes((prev) => {
      const next = new Set(prev)
      next.add(hash)
      return next
    })
  }
  const endFix = (hash: string) => {
    setOptimisticFixingHashes((prev) => {
      const next = new Set(prev)
      next.delete(hash)
      return next
    })
  }

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

  const handleRun = () => runReview('Quality Review completed', runCaseQualityReview)
  const handleRecheck = () =>
    runReview('Quality Review updated', recheckCaseQualityReview)

  // Optimistic generating — flipped on the moment the user clicks
  // Run/Recheck/Retry. Shown until the action returns and router.refresh()
  // brings back the real row in either processing/completed/failed state.
  if (optimisticGenerating && (!modern || !review || review.generation_status !== 'completed')) {
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
            {lastRun?.error_message ?? (attemptProcessing ? 'Review in progress…' : 'No completed review. Reviews current saved notes and supporting evidence.')}
          </p>
          <Button onClick={handleRun} disabled={isPending || isLocked || writesPaused || !!attemptProcessing}>
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
          <Button onClick={handleRun} disabled={isPending || isLocked || writesPaused || !!attemptProcessing}>
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
    const hash = f.key ?? ''
    const savedOverride = overrides[hash] ?? null
    const override = modern && savedOverride?.status === 'fix_in_progress' && !attempts.some(run => run.id === savedOverride.fix_run_id && run.status === 'processing') ? null : savedOverride
    return { finding: f, hash, override }
  })

  const isDismissed = (o: FindingOverrideEntry | null) => o?.status === 'dismissed'
  const isResolved = (o: FindingOverrideEntry | null) => o?.status === 'resolved'

  const grouped: Record<QcSeverity, typeof hydrated> = {
    critical: hydrated.filter((h) => h.finding.severity === 'critical'),
    warning: hydrated.filter((h) => h.finding.severity === 'warning'),
    info: hydrated.filter((h) => h.finding.severity === 'info'),
  }

  // Active counts subtract both dismissed and resolved.
  const counts = {
    critical: grouped.critical.filter(
      (h) => !isDismissed(h.override) && !isResolved(h.override),
    ).length,
    warning: grouped.warning.filter(
      (h) => !isDismissed(h.override) && !isResolved(h.override),
    ).length,
    info: grouped.info.filter(
      (h) => !isDismissed(h.override) && !isResolved(h.override),
    ).length,
  }
  const dismissedCount = hydrated.filter((h) => isDismissed(h.override)).length
  const resolvedCount = hydrated.filter((h) => isResolved(h.override)).length

  // Total score = sum of `score` across findings that still count as open.
  // Dismissed entries are excluded (provider judged them non-issues).
  // Resolved entries are excluded (provider or auto-recheck cleared them).
  // Acknowledged + edited entries still count — issue stands, provider has just seen it.
  const totalScore = hydrated
    .filter((h) => !isDismissed(h.override) && !isResolved(h.override))
    .reduce((sum, h) => sum + getFindingScore(h.finding), 0)

  const assessment = deriveReviewAssessment(findings,overrides,review.review_coverage?.complete ?? review.overall_assessment !== 'incomplete',f => f.key ?? '')

  // Sort each severity group descending by score so the heaviest finding renders first.
  for (const sev of qcSeverityValues) {
    grouped[sev].sort(
      (a, b) => getFindingScore(b.finding) - getFindingScore(a.finding),
    )
  }

  return (
    <div className="space-y-4">
      {writesPaused && <p role="status">Quality Review updates are paused. The completed review remains available.</p>}
      {modern && review.review_version !== 'qc-v3' && <p role="status">Legacy review. Recheck to use the current review checks and finding actions.</p>}
      {(optimisticGenerating || attemptProcessing) && <p role="status">Review in progress. The last completed review remains below.</p>}
      {lastRun?.error_message && <p role="alert" className="text-sm text-destructive">Latest attempt: {lastRun.error_message}</p>}
      {freshnessUnknown && <p role="status">Freshness could not be checked. Recheck when source data is available.</p>}
      {!!review.review_coverage?.limitations?.length && <details><summary>Review coverage limitations</summary><ul className="list-disc pl-5">{review.review_coverage.limitations.map(item => <li key={item}>{item}</li>)}</ul></details>}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>
              {assessment.overall_assessment === 'incomplete' ? 'Review incomplete' : assessment.active_count === 0 ? 'No outstanding findings' : 'Review complete'}
            </CardTitle>
            {assessment.summary && (
              <p className="mt-1 text-sm text-muted-foreground">{assessment.summary}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isStale && <Badge variant="outline">Stale</Badge>}
            <Button
              onClick={handleRecheck}
              disabled={isPending || isLocked || writesPaused || !!attemptProcessing}
              variant="outline"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Recheck
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span
              className="rounded-md bg-muted px-2 py-1"
              title="Sum of clinical-impact scores across open findings"
            >
              Total score: <strong>{totalScore}</strong>
            </span>
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
            {resolvedCount > 0 && (
              <span className="text-muted-foreground">
                Resolved: <strong>{resolvedCount}</strong>
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Higher score = more clinical impact. Dismissed and resolved findings excluded. Recheck distinguishes findings not detected again from verified resolution. Recurring findings reopen.
          </p>
        </CardContent>
      </Card>

      {qcSeverityValues
        .slice()
        .reverse()
        .map((sev) => {
          const items = grouped[sev]
          if (items.length === 0) return null
          const active = items.filter(
            (h) => !isDismissed(h.override) && !isResolved(h.override),
          )
          const resolved = items.filter((h) => isResolved(h.override))
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
                    episodeId={review.episode_id}
                    reviewId={review.review_version === 'qc-v3' ? review.id : undefined}
                    hash={h.hash}
                    finding={h.finding}
                    override={h.override}
                    isLocked={isLocked || writesPaused || (modern && review.review_version !== 'qc-v3')}
                    optimisticFixing={optimisticFixingHashes.has(h.hash)}
                    onFixStart={beginFix}
                    onFixEnd={endFix}
                  />
                ))}

                {resolved.length > 0 && (
                  <details className="mt-2 rounded-md border border-dashed border-emerald-300 bg-emerald-50/50 p-2">
                    <summary className="cursor-pointer text-xs text-emerald-700">
                      Resolved ({resolved.length})
                    </summary>
                    <div className="mt-2 space-y-2">
                      {resolved.map((h) => (
                        <FindingCard
                          key={h.hash}
                          caseId={caseId}
                          episodeId={review.episode_id}
                          reviewId={review.review_version === 'qc-v3' ? review.id : undefined}
                          hash={h.hash}
                          finding={h.finding}
                          override={h.override}
                          isLocked={isLocked || writesPaused || (modern && review.review_version !== 'qc-v3')}
                        />
                      ))}
                    </div>
                  </details>
                )}

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
                          episodeId={review.episode_id}
                          reviewId={review.review_version === 'qc-v3' ? review.id : undefined}
                          hash={h.hash}
                          finding={h.finding}
                          override={h.override}
                          isLocked={isLocked || writesPaused || (modern && review.review_version !== 'qc-v3')}
                        />
                      ))}
                    </div>
                  </details>
                )}
              </CardContent>
            </Card>
          )
        })}

      {modern && allAttempts.length > 0 && <details>
        <summary>Review history</summary>
        <ul className="space-y-2 p-2">{allAttempts.map(attempt => <li key={attempt.id}>
          <p>{new Date(attempt.started_at).toLocaleString()} · {attempt.status}</p>
          {Array.isArray(attempt.finding_transitions) && attempt.finding_transitions.map((raw,index) => {
            const transition = raw as {outcome?:string;finding?:{message?:string}}
            return <p key={index} className="text-sm">{transition.outcome === 'not_detected' ? 'Not detected on recheck' : transition.outcome === 'recurring' ? 'Recurring' : 'Verified resolved'}: {transition.finding?.message}</p>
          })}
        </li>)}</ul>
        {hasOlder && allAttempts.length >= 20 && <Button variant="outline" onClick={async () => {
          const last = allAttempts.at(-1)!
          const result = await getQualityReviewRuns(caseId,{startedAt:last.started_at,id:last.id})
          if (result.error) toast.error(result.error)
          else {setOlderAttempts(old => [...old,...result.data]);setHasOlder(result.data.length === 20)}
        }}>Load older reviews</Button>}
      </details>}
      {findings.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No findings detected in the reviewed sources. Check coverage limitations above.
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function FindingCard({
  caseId,
  episodeId,
  reviewId,
  hash,
  finding,
  override,
  isLocked,
  optimisticFixing = false,
  onFixStart,
  onFixEnd,
}: {
  caseId: string
  reviewId?: string
  episodeId?: string | null
  hash: string
  finding: QualityFinding
  override: FindingOverrideEntry | null
  isLocked: boolean
  optimisticFixing?: boolean
  onFixStart?: (hash: string) => void
  onFixEnd?: (hash: string) => void
}) {
  const [isPending, startTransition] = useTransition()
  const [editOpen, setEditOpen] = useState(false)
  const [dismissOpen, setDismissOpen] = useState(false)
  const router = useRouter()

  const Icon = severityConfig[finding.severity].icon
  // Optimistic flag wins: while the fix server action is in flight (or the
  // panel-level poll is catching up), force the spinner state regardless of
  // whatever finding_overrides looks like in the server-rendered prop.
  const status = optimisticFixing
    ? 'fix_in_progress'
    : (override?.status ?? 'pending')
  const displayMessage = override?.edited_message ?? finding.message
  const displayRationale = override?.edited_rationale ?? finding.rationale
  const displayToneHint =
    override?.edited_suggested_tone_hint ?? finding.suggested_tone_hint

  const handleAck = () =>
    startTransition(async () => {
      const r = reviewId ? await actOnQualityFinding(caseId,reviewId,hash,'acknowledge') : await acknowledgeFinding(caseId, hash)
      if (r.error) toast.error(r.error)
      else {
        toast.success('Finding acknowledged')
        router.refresh()
      }
    })
  const handleClear = () =>
    startTransition(async () => {
      const r = reviewId ? await actOnQualityFinding(caseId,reviewId,hash,'clear') : await clearFindingOverride(caseId, hash)
      if (r.error) toast.error(r.error)
      else {
        toast.success('Override cleared')
        router.refresh()
      }
    })
  const handleVerify = () =>
    startTransition(async () => {
      const r = reviewId ? await actOnQualityFinding(caseId,reviewId,hash,'verify') : await verifyFinding(caseId, hash)
      if (r.error) {
        toast.error(r.error)
      } else if (r.data && 'resolved' in r.data && r.data.resolved) {
        toast.success('Finding verified and resolved')
        router.refresh()
      } else {
        const reason =
          r.data && 'reason' in r.data
            ? (r.data.reason ?? 'Finding could not be verified')
            : 'Finding could not be verified'
        toast.warning(reason)
      }
    })
  const handleMarkResolved = () =>
    startTransition(async () => {
      const r = reviewId ? await actOnQualityFinding(caseId,reviewId,hash,'resolve') : await markFindingResolved(caseId, hash)
      if (r.error) toast.error(r.error)
      else {
        toast.success('Finding marked resolved')
        router.refresh()
      }
    })
  const handleFix = () => {
    onFixStart?.(hash)
    startTransition(async () => {
      try {
        const r = reviewId ? await actOnQualityFinding(caseId,reviewId,hash,'fix') : await fixFinding(caseId, hash)
        if (r.error) toast.error(r.error)
        else if (r.data && 'outcome' in r.data && r.data.outcome === 'applied_but_still_present') toast.warning('Section updated; the finding is still present')
        else toast.success('Section updated; finding not detected on recheck')
      } finally {
        onFixEnd?.(hash)
        router.refresh()
      }
    })
  }

  const eligibility = findingFixEligibility(finding)

  const containerClass =
    status === 'dismissed' || status === 'resolved'
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
            <Badge
              variant="outline"
              title="Clinical-impact score (1-10). Tier bands: critical 7-10, warning 4-6, info 1-3."
            >
              Score {getFindingScore(finding)}
            </Badge>
            {status !== 'pending' && (
              <Badge
                variant={status === 'dismissed' ? 'outline' : 'default'}
                className={
                  status === 'resolved'
                    ? 'capitalize bg-emerald-600 text-white'
                    : 'capitalize'
                }
              >
                {status === 'fix_in_progress' ? 'Fixing' : status}
              </Badge>
            )}
          </div>
          <p className="text-sm font-medium">{displayMessage}</p>
          {!!finding.evidence?.length && <details><summary className="text-xs cursor-pointer">Source evidence</summary><ul className="space-y-2 text-xs break-words">{finding.evidence.map((e,index) => <li key={index}><span>{e.source_id.split(':')[0].replaceAll('_',' ')} · {e.field.replaceAll('_',' ')}{e.source_date ? ` · ${e.source_date.slice(0,10)}` : ' · Date unavailable'}</span><blockquote>{e.missing ? 'Not documented in this field' : e.quote}</blockquote></li>)}</ul></details>}
          {finding.step === 'pain_follow_up' && !finding.encounter_id && <p className="text-xs">Exact visit unavailable; the editor link opens the visits list.</p>}
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
          {override?.status === 'resolved' && (
            <p className="flex items-center gap-1 text-xs text-emerald-700">
              <CheckCircle2 className="h-3 w-3" />
              {override.resolution_source
                ? resolutionSourceLabels[override.resolution_source]
                : 'Resolved'}
              {override.resolved_at &&
                ` · ${new Date(override.resolved_at).toLocaleDateString()}`}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Link
              href={findingDeepLink(caseId, finding, episodeId)}
              className="text-xs text-primary underline"
            >
              View in editor →
            </Link>
            {status === 'fix_in_progress' && (
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Applying fix and rechecking…
              </span>
            )}
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
                {eligibility.fixable ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleFix}
                    disabled={isPending}
                  >
                    <Wand2 className="mr-1 h-3 w-3" />
                    Fix with AI
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled
                    title={eligibility.reason}
                  >
                    <Wand2 className="mr-1 h-3 w-3" />
                    Fix with AI
                  </Button>
                )}
                {canVerify(finding) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleVerify}
                    disabled={isPending}
                  >
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    Verify
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleMarkResolved}
                  disabled={isPending}
                >
                  <Check className="mr-1 h-3 w-3" />
                  Mark Resolved
                </Button>
              </>
            )}
            {!isLocked && (status === 'acknowledged' || status === 'edited') && (
              <>
                {eligibility.fixable && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleFix}
                    disabled={isPending}
                  >
                    <Wand2 className="mr-1 h-3 w-3" />
                    Fix with AI
                  </Button>
                )}
                {canVerify(finding) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleVerify}
                    disabled={isPending}
                  >
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    Verify
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleMarkResolved}
                  disabled={isPending}
                >
                  <Check className="mr-1 h-3 w-3" />
                  Mark Resolved
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleClear}
                  disabled={isPending}
                >
                  <Undo2 className="mr-1 h-3 w-3" />
                  Undo
                </Button>
              </>
            )}
            {!isLocked && status === 'dismissed' && (
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
            {/* Resolved → read-only, no action buttons */}
          </div>
        </div>
      </div>

      {editOpen && (
        <FindingEditDialog
          caseId={caseId}
          reviewId={reviewId}
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
          reviewId={reviewId}
          hash={hash}
          onClose={() => setDismissOpen(false)}
        />
      )}
    </>
  )
}
