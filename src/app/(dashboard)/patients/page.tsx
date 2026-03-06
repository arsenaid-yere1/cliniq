import { listPatientCases } from '@/actions/patients'
import { PatientListPageClient } from '@/components/patients/patient-list-page-client'

export default async function PatientsPage() {
  const { data: cases } = await listPatientCases()

  return <PatientListPageClient cases={cases} />
}
