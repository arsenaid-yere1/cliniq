import { notFound } from 'next/navigation'
import { getPatientCase } from '@/actions/patients'
import { CaseOverview } from '@/components/patients/case-overview'

export default async function CaseDashboardPage({
  params,
}: {
  params: Promise<{ caseId: string }>
}) {
  const { caseId } = await params
  const { data, error } = await getPatientCase(caseId)

  if (error || !data) {
    notFound()
  }

  return <CaseOverview caseData={data} />
}
