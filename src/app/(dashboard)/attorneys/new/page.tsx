import { AttorneyForm } from '@/components/attorneys/attorney-form'

export default function NewAttorneyPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">New Attorney</h1>
      <AttorneyForm />
    </div>
  )
}
