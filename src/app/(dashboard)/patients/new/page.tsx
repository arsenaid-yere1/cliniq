import { PatientWizard } from '@/components/patients/patient-wizard'

export default function NewPatientPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">New Patient Case</h1>
      <PatientWizard />
    </div>
  )
}
