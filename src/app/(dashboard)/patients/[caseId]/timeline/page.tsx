import { getTimelineEvents } from '@/actions/timeline'
import { CaseTimeline } from '@/components/timeline/case-timeline'

export default async function TimelinePage({
  params,
}: {
  params: Promise<{ caseId: string }>
}) {
  const { caseId } = await params
  const { data: events } = await getTimelineEvents(caseId)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Timeline</h1>
      <CaseTimeline events={events} />
    </div>
  )
}
