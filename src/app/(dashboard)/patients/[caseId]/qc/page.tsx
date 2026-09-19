import { qualityReviewV3Enabled } from '@/lib/qc/review-config'
import { getQualityReviewRuns } from '@/actions/case-quality-review-findings'
import {
  getCaseQualityReview,
  checkQualityReviewStaleness,
} from '@/actions/case-quality-reviews'
import { QcReviewPanel } from '@/components/clinical/qc-review-panel'

export default async function CaseQcPage({
  params,
}: {
  params: Promise<{ caseId: string }>
}) {
  const { caseId } = await params

  const [reviewResult, stalenessResult, attemptsResult] = await Promise.all([
    getCaseQualityReview(caseId),
    checkQualityReviewStaleness(caseId),
    getQualityReviewRuns(caseId),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Quality Review</h1>
        <p className="text-sm text-muted-foreground">
          AI review of the full case workflow. Manual trigger only.
        </p>
      </div>
      {attemptsResult.error && <p role="alert">{attemptsResult.error}</p>}
      {reviewResult.error ? <p role="alert">{reviewResult.error}</p> : <QcReviewPanel
        caseId={caseId}
        review={reviewResult.data ?? null}
        isStale={stalenessResult.data?.isStale ?? false}
        modern={qualityReviewV3Enabled()}
        attempts={attemptsResult.data}
        freshnessUnknown={'freshness' in (stalenessResult.data ?? {}) && stalenessResult.data?.freshness === 'unknown'}
      />}
    </div>
  )
}
