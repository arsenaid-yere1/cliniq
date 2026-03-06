import { notFound } from 'next/navigation'
import { getPatientCase } from '@/actions/patients'
import { getCaseDashboardStats } from '@/actions/dashboard'
import { getTimelineEvents } from '@/actions/timeline'
import { CaseOverview } from '@/components/patients/case-overview'
import { CaseStatCards } from '@/components/cases/case-stat-cards'
import { CaseRecentActivity } from '@/components/cases/case-recent-activity'

export default async function CaseDashboardPage({
  params,
}: {
  params: Promise<{ caseId: string }>
}) {
  const { caseId } = await params
  const [caseResult, statsResult, timelineResult] = await Promise.all([
    getPatientCase(caseId),
    getCaseDashboardStats(caseId),
    getTimelineEvents(caseId),
  ])

  if (caseResult.error || !caseResult.data) {
    notFound()
  }

  return (
    <div className="space-y-6">
      <CaseStatCards stats={statsResult.data} />
      <CaseOverview caseData={caseResult.data} />
      <CaseRecentActivity events={timelineResult.data.slice(0, 5)} />
    </div>
  )
}
