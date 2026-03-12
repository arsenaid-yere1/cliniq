import { format } from 'date-fns'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { FileUp, Stethoscope, ClipboardList, Receipt, Lock } from 'lucide-react'
import { CaseActions } from '@/components/patients/case-actions'

interface CaseOverviewProps {
  caseData: {
    id: string
    case_number: string
    case_status: string
    accident_date: string | null
    accident_type: string | null
    accident_description: string | null
    case_open_date: string | null
    patient: {
      first_name: string
      last_name: string
      middle_name: string | null
      date_of_birth: string
      gender: string | null
      phone_primary: string | null
      email: string | null
      address_line1: string | null
      address_line2: string | null
      city: string | null
      state: string | null
      zip_code: string | null
    } | null
    attorney: {
      first_name: string
      last_name: string
      firm_name: string | null
    } | null
  }
}

const accidentTypeLabels: Record<string, string> = {
  auto: 'Auto Accident',
  slip_and_fall: 'Slip and Fall',
  workplace: 'Workplace Injury',
  other: 'Other',
}

const genderLabels: Record<string, string> = {
  male: 'Male',
  female: 'Female',
  other: 'Other',
  prefer_not_to_say: 'Prefer not to say',
}

const quickActions = [
  { label: 'Upload Document', icon: FileUp },
  { label: 'Add Clinical Note', icon: Stethoscope },
  { label: 'Record Procedure', icon: ClipboardList },
  { label: 'Create Invoice', icon: Receipt },
]

export function CaseOverview({ caseData }: CaseOverviewProps) {
  const patient = caseData.patient
  const attorney = caseData.attorney

  const address = patient
    ? [patient.address_line1, patient.address_line2, patient.city, patient.state, patient.zip_code]
        .filter(Boolean)
        .join(', ')
    : null

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Case Summary</CardTitle>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" disabled>
                Edit
              </Button>
            </TooltipTrigger>
            <TooltipContent>Coming Soon</TooltipContent>
          </Tooltip>
        </CardHeader>
        <CardContent className="space-y-6">
          {patient && (
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Patient Demographics</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">Name</dt>
                  <dd>
                    {patient.first_name} {patient.middle_name ? `${patient.middle_name} ` : ''}{patient.last_name}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Date of Birth</dt>
                  <dd>{format(new Date(patient.date_of_birth + 'T00:00:00'), 'MM/dd/yyyy')}</dd>
                </div>
                {patient.gender && (
                  <div>
                    <dt className="text-muted-foreground">Gender</dt>
                    <dd>{genderLabels[patient.gender] ?? patient.gender}</dd>
                  </div>
                )}
                {patient.phone_primary && (
                  <div>
                    <dt className="text-muted-foreground">Phone</dt>
                    <dd>{patient.phone_primary}</dd>
                  </div>
                )}
                {patient.email && (
                  <div>
                    <dt className="text-muted-foreground">Email</dt>
                    <dd>{patient.email}</dd>
                  </div>
                )}
                {address && (
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Address</dt>
                    <dd>{address}</dd>
                  </div>
                )}
              </dl>
            </section>
          )}

          <section>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Case Details</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-muted-foreground">Case Number</dt>
                <dd className="font-mono">{caseData.case_number}</dd>
              </div>
              {caseData.accident_date && (
                <div>
                  <dt className="text-muted-foreground">Accident Date</dt>
                  <dd>{format(new Date(caseData.accident_date + 'T00:00:00'), 'MM/dd/yyyy')}</dd>
                </div>
              )}
              {caseData.accident_type && (
                <div>
                  <dt className="text-muted-foreground">Accident Type</dt>
                  <dd>{accidentTypeLabels[caseData.accident_type] ?? caseData.accident_type}</dd>
                </div>
              )}
              {caseData.accident_description && (
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Description</dt>
                  <dd>{caseData.accident_description}</dd>
                </div>
              )}
            </dl>
          </section>

          {attorney && (
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Attorney</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">Name</dt>
                  <dd>{attorney.first_name} {attorney.last_name}</dd>
                </div>
                {attorney.firm_name && (
                  <div>
                    <dt className="text-muted-foreground">Firm</dt>
                    <dd>{attorney.firm_name}</dd>
                  </div>
                )}
              </dl>
            </section>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Case Actions</CardTitle>
        </CardHeader>
        <CardContent>
          {caseData.case_status === 'closed' && (
            <div className="flex items-center gap-2 p-3 mb-4 bg-muted border rounded-lg text-sm text-muted-foreground">
              <Lock className="h-4 w-4 shrink-0" />
              This case is closed. No modifications are allowed until it is reopened.
            </div>
          )}
          <div className="flex gap-3 flex-wrap">
            {caseData.case_status !== 'closed' && quickActions.map((action) => (
              <Tooltip key={action.label}>
                <TooltipTrigger asChild>
                  <Button variant="outline" disabled>
                    <action.icon className="h-4 w-4 mr-2" />
                    {action.label}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Coming Soon</TooltipContent>
              </Tooltip>
            ))}
            <CaseActions caseId={caseData.id} caseStatus={caseData.case_status} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
