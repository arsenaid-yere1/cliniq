import { notFound } from 'next/navigation'
import { getPatientWithCases } from '@/actions/patients'
import { PatientDetail } from '@/components/patients/patient-detail'

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ patientId: string }>
}) {
  const { patientId } = await params
  const { data, error } = await getPatientWithCases(patientId)

  if (error || !data) notFound()

  return <PatientDetail patient={data.patient} cases={data.cases} />
}
