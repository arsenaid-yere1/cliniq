'use client'

import { useEffect, useState } from 'react'
import { useFormContext } from 'react-hook-form'
import type { CreatePatientCaseValues } from '@/lib/validations/patient'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getAttorney } from '@/actions/attorneys'

const ACCIDENT_TYPE_LABELS: Record<string, string> = {
  auto: 'Auto',
  slip_and_fall: 'Slip and Fall',
  workplace: 'Workplace',
  other: 'Other',
}

const GENDER_LABELS: Record<string, string> = {
  male: 'Male',
  female: 'Female',
  other: 'Other',
  prefer_not_to_say: 'Prefer not to say',
}

function ReviewRow({ label, value }: { label: string; value: string | undefined | null }) {
  if (!value) return null
  return (
    <div className="flex justify-between py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

export function WizardStepReview({ goToStep }: { goToStep: (step: number) => void }) {
  const form = useFormContext<CreatePatientCaseValues>()
  const values = form.getValues()
  const [attorneyName, setAttorneyName] = useState<string | null>(null)

  useEffect(() => {
    async function loadAttorney() {
      if (values.attorney_id && values.attorney_id !== '') {
        const result = await getAttorney(values.attorney_id)
        if ('data' in result && result.data) {
          const a = result.data
          setAttorneyName(
            `${a.last_name}, ${a.first_name}${a.firm_name ? ` — ${a.firm_name}` : ''}`
          )
        }
      }
    }
    loadAttorney()
  }, [values.attorney_id])

  const fullAddress = [
    values.address_line1,
    values.address_line2,
    [values.city, values.state, values.zip_code].filter(Boolean).join(', '),
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Patient Identity</CardTitle>
          <Button variant="link" size="sm" type="button" onClick={() => goToStep(0)}>
            Edit
          </Button>
        </CardHeader>
        <CardContent className="space-y-1">
          <ReviewRow
            label="Name"
            value={[values.first_name, values.middle_name, values.last_name]
              .filter(Boolean)
              .join(' ')}
          />
          <ReviewRow label="Date of Birth" value={values.date_of_birth} />
          <ReviewRow
            label="Gender"
            value={values.gender ? GENDER_LABELS[values.gender] : undefined}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Contact Information</CardTitle>
          <Button variant="link" size="sm" type="button" onClick={() => goToStep(1)}>
            Edit
          </Button>
        </CardHeader>
        <CardContent className="space-y-1">
          <ReviewRow label="Phone" value={values.phone_primary} />
          <ReviewRow label="Email" value={values.email} />
          <ReviewRow label="Address" value={fullAddress || undefined} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Case Details</CardTitle>
          <Button variant="link" size="sm" type="button" onClick={() => goToStep(1)}>
            Edit
          </Button>
        </CardHeader>
        <CardContent className="space-y-1">
          <ReviewRow label="Accident Date" value={values.accident_date} />
          <ReviewRow
            label="Accident Type"
            value={values.accident_type ? ACCIDENT_TYPE_LABELS[values.accident_type] : undefined}
          />
          <ReviewRow label="Description" value={values.accident_description} />
          <ReviewRow label="Attorney" value={attorneyName} />
          {values.lien_on_file && <ReviewRow label="Lien on File" value="Yes" />}
        </CardContent>
      </Card>
    </div>
  )
}
