import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { listMriExtractions } from '@/actions/mri-extractions'
import { listChiroExtractions } from '@/actions/chiro-extractions'
import { MriExtractionList } from '@/components/clinical/mri-extraction-list'
import { ChiroExtractionList } from '@/components/clinical/chiro-extraction-list'

export default async function ClinicalDataPage({
  params,
}: {
  params: Promise<{ caseId: string }>
}) {
  const { caseId } = await params
  const [{ data: mriExtractions }, { data: chiroExtractions }] = await Promise.all([
    listMriExtractions(caseId),
    listChiroExtractions(caseId),
  ])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Clinical Data</h1>
      <Tabs defaultValue="mri">
        <TabsList>
          <TabsTrigger value="mri">MRI Reports</TabsTrigger>
          <TabsTrigger value="chiro">Chiro Reports</TabsTrigger>
        </TabsList>
        <TabsContent value="mri">
          <MriExtractionList extractions={mriExtractions} caseId={caseId} />
        </TabsContent>
        <TabsContent value="chiro">
          <ChiroExtractionList extractions={chiroExtractions} caseId={caseId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
