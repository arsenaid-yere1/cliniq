import { notFound } from 'next/navigation'
import { getPatientCase } from '@/actions/patients'
import { getCaseDashboardStats } from '@/actions/dashboard'
import { getTimelineEvents } from '@/actions/timeline'
import { getCaseSummary, checkSummaryStaleness } from '@/actions/case-summaries'
import { CaseOverview } from '@/components/patients/case-overview'
import { CaseStatCards } from '@/components/cases/case-stat-cards'
import { CaseRecentActivity } from '@/components/cases/case-recent-activity'
import { CaseSummaryCard } from '@/components/clinical/case-summary-card'
import { getCurrentUserWithRole } from '@/lib/auth/require-role'

export default async function CaseDashboardPage({
  params,
}: {
  params: Promise<{ caseId: string }>
}) {
  const { caseId } = await params
  const [caseResult, statsResult, timelineResult, summaryResult, stalenessResult, me] = await Promise.all([
    getPatientCase(caseId),
    getCaseDashboardStats(caseId),
    getTimelineEvents(caseId),
    getCaseSummary(caseId),
    checkSummaryStaleness(caseId),
    getCurrentUserWithRole(),
  ])
  const isAdmin = me?.role === 'admin'

  if (caseResult.error || !caseResult.data) {
    notFound()
  }

  return (
    <div className="space-y-6">
      <CaseStatCards stats={statsResult.data} />
      <CaseOverview caseData={caseResult.data} isAdmin={isAdmin} />
      <CaseSummaryCard
        caseId={caseId}
        summary={summaryResult.data ?? null}
        isStale={stalenessResult.data?.isStale ?? false}
      />
      <CaseRecentActivity events={timelineResult.data.slice(0, 5)} />
    </div>
  )
}
