import { getCaseVisitOverview } from '@/actions/visit-summaries'
import { VisitLoadError, VisitsOverview } from '@/components/visits/visits-overview'

export default async function VisitsPage({ params, searchParams }: {
  params: Promise<{ caseId: string }>
  searchParams?: Promise<{ episode?: string }>
}) {
  const { caseId } = await params
  const selection = await searchParams
  const result = await getCaseVisitOverview(caseId)
  if (!result.data) return <VisitLoadError message={result.error} />
  return <VisitsOverview overview={result.data} requestedEpisodeId={selection?.episode} />
}
