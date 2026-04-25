import { listPatients } from '@/actions/patients'
import { PeopleListPageClient } from '@/components/patients/people-list-page-client'

export default async function PeoplePage() {
  const { data: patients } = await listPatients()

  return <PeopleListPageClient patients={patients} />
}
