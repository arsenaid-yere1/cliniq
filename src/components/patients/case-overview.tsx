'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import Link from 'next/link'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { FileUp, Stethoscope, ClipboardList, Receipt, Lock, Pencil, FileSignature, Loader2 } from 'lucide-react'
import { StatusChangeDropdown } from '@/components/patients/status-change-dropdown'
import { LOCKED_STATUSES, type CaseStatus } from '@/lib/constants/case-status'
import { CaseOverviewEditDialog } from '@/components/patients/case-overview-edit-dialog'
import { generateLienAgreement } from '@/actions/lien'
import { generateProcedureConsent } from '@/actions/procedure-consents'

interface CaseOverviewProps {
  caseData: {
    id: string
    case_number: string
    case_status: string
    accident_date: string | null
    accident_type: string | null
    accident_description: string | null
    case_open_date: string | null
    attorney_id: string | null
    assigned_provider_id: string | null
    lien_on_file: boolean
    patient: {
      id: string
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
  { label: 'Upload Document', icon: FileUp, href: 'documents' },
  { label: 'Add Clinical Note', icon: Stethoscope, href: 'clinical' },
  { label: 'Record Procedure', icon: ClipboardList, href: 'procedures' },
  { label: 'Create Invoice', icon: Receipt, href: 'billing' },
]

export function CaseOverview({ caseData }: CaseOverviewProps) {
  const [editOpen, setEditOpen] = useState(false)
  const [generatingLien, setGeneratingLien] = useState(false)
  const [generatingConsent, setGeneratingConsent] = useState(false)
  const patient = caseData.patient
  const attorney = caseData.attorney
  const isLocked = LOCKED_STATUSES.includes(caseData.case_status as CaseStatus)

  async function handleGenerateLien() {
    if (!caseData.attorney_id) {
      toast.error('An attorney must be assigned before generating a lien agreement')
      return
    }
    setGeneratingLien(true)
    try {
      const result = await generateLienAgreement(caseData.id)
      if ('error' in result && result.error) {
        toast.error(result.error)
        return
      }
      if ('data' in result && result.data?.base64) {
        const bytes = atob(result.data.base64)
        const arr = new Uint8Array(bytes.length)
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
        const blob = new Blob([arr], { type: 'application/pdf' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'Authorization-and-Lien-Agreement.pdf'
        a.click()
        URL.revokeObjectURL(url)
      }
      toast.success('Lien agreement generated')
    } finally {
      setGeneratingLien(false)
    }
  }

  async function handleGenerateConsent() {
    setGeneratingConsent(true)
    try {
      const result = await generateProcedureConsent({ caseId: caseData.id })
      if ('error' in result && result.error) {
        toast.error(result.error)
        return
      }
      if ('data' in result && result.data?.base64) {
        const bytes = atob(result.data.base64)
        const arr = new Uint8Array(bytes.length)
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
        const blob = new Blob([arr], { type: 'application/pdf' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'Procedure-Consent-Form.pdf'
        a.click()
        URL.revokeObjectURL(url)
      }
      toast.success('Procedure consent form generated')
    } finally {
      setGeneratingConsent(false)
    }
  }

  const address = patient
    ? [patient.address_line1, patient.address_line2, patient.city, patient.state, patient.zip_code]
        .filter(Boolean)
        .join(', ')
    : null

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Case Actions</CardTitle>
        </CardHeader>
        <CardContent>
          {isLocked && (
            <div className="flex items-center gap-2 p-3 mb-4 bg-muted border rounded-lg text-sm text-muted-foreground">
              <Lock className="h-4 w-4 shrink-0" />
              This case is {caseData.case_status === 'archived' ? 'archived' : 'closed'}. No modifications are allowed until it is reopened.
            </div>
          )}
          <div className="flex gap-3 flex-wrap">
            {quickActions.map((action) => {
              return isLocked ? (
                <Button key={action.label} variant="outline" disabled>
                  <action.icon className="h-4 w-4 mr-2" />
                  {action.label}
                </Button>
              ) : (
                <Button key={action.label} variant="outline" asChild>
                  <Link href={`/patients/${caseData.id}/${action.href}`}>
                    <action.icon className="h-4 w-4 mr-2" />
                    {action.label}
                  </Link>
                </Button>
              )
            })}
            <StatusChangeDropdown caseId={caseData.id} currentStatus={caseData.case_status as CaseStatus} />
            <Button
              variant="outline"
              onClick={handleGenerateLien}
              disabled={isLocked || generatingLien || !caseData.attorney_id}
            >
              {generatingLien ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileSignature className="h-4 w-4 mr-2" />
              )}
              Generate Lien Agreement
            </Button>
            <Button
              variant="outline"
              onClick={handleGenerateConsent}
              disabled={isLocked || generatingConsent}
            >
              {generatingConsent ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileSignature className="h-4 w-4 mr-2" />
              )}
              Generate Procedure Consent Form
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Case Summary</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} disabled={isLocked}>
            <Pencil className="h-3 w-3 mr-1" />
            Edit
          </Button>
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

      {patient && (
        <CaseOverviewEditDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          caseId={caseData.id}
          patientId={patient.id}
          patient={patient}
          caseDetails={{
            accident_date: caseData.accident_date,
            accident_type: caseData.accident_type,
            accident_description: caseData.accident_description,
            attorney_id: caseData.attorney_id,
            assigned_provider_id: caseData.assigned_provider_id,
            lien_on_file: caseData.lien_on_file,
          }}
        />
      )}
    </div>
  )
}
