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

  const [reviewResult, stalenessResult] = await Promise.all([
    getCaseQualityReview(caseId),
    checkQualityReviewStaleness(caseId),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Quality Review</h1>
        <p className="text-sm text-muted-foreground">
          AI review of the full case workflow. Manual trigger only.
        </p>
      </div>
      <QcReviewPanel
        caseId={caseId}
        review={reviewResult.data ?? null}
        isStale={stalenessResult.data?.isStale ?? false}
      />
    </div>
  )
}
