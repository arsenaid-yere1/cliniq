import { listAttorneys } from '@/actions/attorneys'
import { AttorneyListTable } from '@/components/attorneys/attorney-list-table'

export default async function AttorneysPage() {
  const { data: attorneys } = await listAttorneys()

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Attorneys</h1>
      <AttorneyListTable attorneys={attorneys} />
    </div>
  )
}
