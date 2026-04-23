import { PatientWizard, type ExistingPatientSummary } from '@/components/patients/patient-wizard'
import { getPatientForNewCase } from '@/actions/patients'

export default async function NewPatientPage({
  searchParams,
}: {
  searchParams: Promise<{ patientId?: string }>
}) {
  const { patientId } = await searchParams

  let existingPatient: ExistingPatientSummary | undefined
  if (patientId) {
    const result = await getPatientForNewCase(patientId)
    if ('data' in result && result.data) {
      existingPatient = result.data
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">
        {existingPatient ? 'New Case' : 'New Patient Case'}
      </h1>
      <PatientWizard existingPatient={existingPatient} />
    </div>
  )
}
