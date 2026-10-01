'use client'

import { useEffect, useState } from 'react'
import { useFormContext, useWatch } from 'react-hook-form'
import type { CreatePatientCaseValues } from '@/lib/validations/patient'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getAttorney } from '@/actions/attorneys'
import { getProviderProfileById } from '@/actions/settings'
import { CASE_STATUS_CONFIG } from '@/lib/constants/case-status'

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
    <div className="flex flex-col gap-1 py-1 sm:flex-row sm:justify-between sm:gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words font-medium sm:text-right">{value}</span>
    </div>
  )
}

type ReferenceState = { id: string; status: 'loading' | 'ready' | 'error'; label?: string }
async function attorneyLabel(id: string) {
  const result = await getAttorney(id)
  if (!result.data || result.error) throw new Error('Attorney could not be loaded')
  const a = result.data
  return `${a.last_name}, ${a.first_name}${a.firm_name ? ` — ${a.firm_name}` : ''}`
}
async function providerLabel(id: string) {
  const result = await getProviderProfileById(id)
  if (!result.data || result.error) throw new Error('Provider could not be loaded')
  return `${result.data.display_name}${result.data.credentials ? `, ${result.data.credentials}` : ''}`
}
function useReferenceLabel(id: string, load: (id: string) => Promise<string>) {
  const [state, setState] = useState<ReferenceState>({ id, status: 'loading' })
  if (state.id !== id) setState({ id, status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!id) return
    let active = true
    load(id).then(label => { if (active) setState({ id, status: 'ready', label }) })
      .catch(() => { if (active) setState({ id, status: 'error' }) })
    return () => { active = false }
  }, [id, load, attempt])
  // Identity comparison prevents a previous name from flashing before the effect runs.
  const current = state?.id === id ? state : null
  return { ready: !!id && current?.status === 'ready', failed: current?.status === 'error',
    label: !id ? 'Not selected' : current?.status === 'ready' ? current.label : current?.status === 'error' ? 'Unable to load' : 'Loading…',
    retry: () => { setState({ id, status: 'loading' }); setAttempt(n => n + 1) } }
}

export function WizardStepReview({ goToStep, disabled = false, onReadinessChange }: {
  goToStep: (step: number) => void; disabled?: boolean; onReadinessChange?: (ready: boolean) => void
}) {
  const form = useFormContext<CreatePatientCaseValues>()
  const values = useWatch({ control: form.control })
  const attorney = useReferenceLabel(values.attorney_id ?? '', attorneyLabel)
  const provider = useReferenceLabel(values.assigned_provider_id ?? '', providerLabel)
  const ready = attorney.ready && provider.ready
  useEffect(() => { onReadinessChange?.(ready) }, [ready, onReadinessChange])

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
          <Button disabled={disabled} variant="link" size="sm" type="button" onClick={() => goToStep(0)}>
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
          <Button disabled={disabled} variant="link" size="sm" type="button" onClick={() => goToStep(1)}>
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
          <Button disabled={disabled} variant="link" size="sm" type="button" onClick={() => goToStep(1)}>
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
          <ReviewRow label="Attorney" value={attorney.label} />
          {attorney.failed && <Button disabled={disabled} type="button" variant="outline" onClick={attorney.retry}>Retry attorney</Button>}
          <ReviewRow label="Assigned provider" value={provider.label} />
          {provider.failed && <Button disabled={disabled} type="button" variant="outline" onClick={provider.retry}>Retry provider</Button>}
          <ReviewRow label="Case status" value={CASE_STATUS_CONFIG[values.case_status ?? 'intake'].label} />
          <ReviewRow label="Lien on File" value={values.lien_on_file ? 'Yes' : 'No'} />
        </CardContent>
      </Card>
    </div>
  )
}
