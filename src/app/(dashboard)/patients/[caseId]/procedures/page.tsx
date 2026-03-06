import { listProcedures } from '@/actions/procedures'
import { ProcedureTable } from '@/components/procedures/procedure-table'

export default async function ProceduresPage({
  params,
}: {
  params: Promise<{ caseId: string }>
}) {
  const { caseId } = await params
  const { data: procedures } = await listProcedures(caseId)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Procedures</h1>
      <ProcedureTable procedures={procedures} />
    </div>
  )
}
