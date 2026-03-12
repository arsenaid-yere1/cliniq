import { notFound } from 'next/navigation'
import { getPatientCase } from '@/actions/patients'
import { CaseSidebar } from '@/components/patients/case-sidebar'
import { CaseStatusProvider } from '@/components/patients/case-status-context'

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

  return (
    <CaseStatusProvider status={data.case_status}>
      <div className="flex h-full -m-6">
        <CaseSidebar caseData={data} />
        <div className="flex-1 p-6">{children}</div>
      </div>
    </CaseStatusProvider>
  )
}
