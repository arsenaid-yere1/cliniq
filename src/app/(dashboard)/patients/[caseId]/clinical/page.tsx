import { listMriExtractions } from '@/actions/mri-extractions'
import { MriExtractionList } from '@/components/clinical/mri-extraction-list'

export default async function ClinicalDataPage({
  params,
}: {
  params: Promise<{ caseId: string }>
}) {
  const { caseId } = await params
  const { data: extractions } = await listMriExtractions(caseId)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Clinical Data</h1>
      <MriExtractionList extractions={extractions} caseId={caseId} />
    </div>
  )
}
