import { notFound } from 'next/navigation'
import { getPatientCase } from '@/actions/patients'
import { CaseSidebar } from '@/components/patients/case-sidebar'
import { CaseStatusProvider } from '@/components/patients/case-status-context'
import { getActiveOrLatestEpisode } from '@/lib/clinical/episode-context'
import { VisitUnsavedChangesProvider } from '@/components/visits/visit-unsaved-changes-context'
import { VisitNavigationProvider } from '@/components/visits/visit-navigation-context'

export default async function CaseDashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ caseId: string }>
}) {
  const { caseId } = await params
  const { data, error } = await getPatientCase(caseId)

  if (error || !data) {
    notFound()
  }

  const episode = await getActiveOrLatestEpisode(caseId)

  return (
    <CaseStatusProvider status={data.case_status}>
      <VisitNavigationProvider key={caseId}>
      <VisitUnsavedChangesProvider>
      <div className="flex min-h-full flex-col -m-6 md:flex-row">
        <CaseSidebar
          caseData={data}
          episodeStatus={episode ? {
            number: episode.episode_number,
            status: episode.status,
          } : null}
        />
        <div className="min-w-0 flex-1 p-4 sm:p-6">{children}</div>
      </div>
      </VisitUnsavedChangesProvider>
      </VisitNavigationProvider>
    </CaseStatusProvider>
  )
}
