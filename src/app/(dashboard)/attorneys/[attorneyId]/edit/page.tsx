import { notFound } from 'next/navigation'
import { getAttorney } from '@/actions/attorneys'
import { AttorneyForm } from '@/components/attorneys/attorney-form'

export default async function EditAttorneyPage({
  params,
}: {
  params: Promise<{ attorneyId: string }>
}) {
  const { attorneyId } = await params
  const { data: attorney, error } = await getAttorney(attorneyId)

  if (error || !attorney) {
    notFound()
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Edit Attorney</h1>
      <AttorneyForm initialData={attorney} />
    </div>
  )
}
