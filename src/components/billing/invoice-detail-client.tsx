'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { Pencil, Trash2, ArrowLeft } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CreateInvoiceDialog } from './create-invoice-dialog'
import { deleteInvoice } from '@/actions/billing'
import type { InvoiceLineItemFormValues } from '@/lib/validations/invoice'

interface InvoiceData {
  id: string
  invoice_number: string
  invoice_type: string
  invoice_date: string
  claim_type: string
  indication: string | null
  diagnoses_snapshot: Array<{ icd10_code: string | null; description: string }>
  payee_name: string | null
  payee_address: string | null
  notes: string | null
  total_amount: number
  paid_amount: number
  status: string
  line_items: Array<{
    id: string
    procedure_id: string | null
    service_date: string | null
    cpt_code: string
    description: string
    quantity: number
    unit_price: number
    total_price: number
  }>
  case: {
    id: string
    case_number: string
    accident_date: string | null
    assigned_provider_id: string | null
    patient: {
      first_name: string
      last_name: string
      date_of_birth: string | null
    } | null
    attorney: {
      first_name: string
      last_name: string
      firm_name: string | null
      address_line1: string | null
      address_line2: string | null
      city: string | null
      state: string | null
      zip_code: string | null
    } | null
  }
}

interface ClinicData {
  clinic_name: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  zip_code: string | null
  phone: string | null
  fax: string | null
}

interface ProviderProfileData {
  display_name: string | null
  credentials: string | null
  npi_number: string | null
}

interface InvoiceFormData {
  caseData: {
    id: string
    accident_date: string | null
    patient: {
      first_name: string
      last_name: string
      date_of_birth: string | null
    } | null
    attorney: {
      first_name: string
      last_name: string
      firm_name: string | null
      address_line1: string | null
      address_line2: string | null
      city: string | null
      state: string | null
      zip_code: string | null
    } | null
  }
  clinic: ClinicData | null
  providerProfile: ProviderProfileData | null
  diagnoses: Array<{ icd10_code: string | null; description: string }>
  indication: string
  prePopulatedLineItems: InvoiceLineItemFormValues[]
}

interface InvoiceDetailClientProps {
  invoice: InvoiceData
  clinic: ClinicData | null
  providerProfile: ProviderProfileData | null
  clinicLogoUrl: string | null
  caseId: string
}

const statusColors: Record<string, string> = {
  paid: 'bg-green-100 text-green-800 border-green-200',
  pending: 'bg-amber-100 text-amber-800 border-amber-200',
  draft: 'bg-gray-100 text-gray-800 border-gray-200',
}

function formatDate(date: string | null) {
  if (!date) return 'N/A'
  return format(new Date(date + 'T00:00:00'), 'MM/dd/yyyy')
}

function formatCurrency(amount: number) {
  return `$${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function InvoiceDetailClient({
  invoice,
  clinic,
  providerProfile,
  clinicLogoUrl,
  caseId,
}: InvoiceDetailClientProps) {
  const router = useRouter()
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const patient = invoice.case?.patient
  const attorney = invoice.case?.attorney
  const balance = Number(invoice.total_amount) - Number(invoice.paid_amount)

  async function handleDelete() {
    setIsDeleting(true)
    const result = await deleteInvoice(invoice.id, caseId)
    setIsDeleting(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Invoice deleted')
      router.push(`/patients/${caseId}/billing`)
    }
    setShowDeleteConfirm(false)
  }

  // Build form data for the edit dialog
  const editFormData: InvoiceFormData = {
    caseData: {
      id: caseId,
      accident_date: invoice.case?.accident_date ?? null,
      patient: patient ?? null,
      attorney: attorney ?? null,
    },
    clinic,
    providerProfile,
    diagnoses: invoice.diagnoses_snapshot ?? [],
    indication: invoice.indication ?? '',
    prePopulatedLineItems: [],
  }

  const clinicAddressParts: string[] = []
  if (clinic?.address_line1) clinicAddressParts.push(clinic.address_line1)
  if (clinic?.address_line2) clinicAddressParts.push(clinic.address_line2)
  const cityStateZip = [clinic?.city, clinic?.state, clinic?.zip_code].filter(Boolean).join(', ')
  if (cityStateZip) clinicAddressParts.push(cityStateZip)
  const clinicAddress = clinicAddressParts.join(', ')

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/patients/${caseId}/billing`}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Billing
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setIsEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-1" />
            Edit
          </Button>
          <Button variant="outline" size="sm" className="text-destructive" onClick={() => setShowDeleteConfirm(true)}>
            <Trash2 className="h-4 w-4 mr-1" />
            Delete
          </Button>
        </div>
      </div>

      {/* Invoice Document */}
      <div className="bg-white border rounded-lg p-8 space-y-6 print:border-none print:p-0">
        {/* Clinic Header */}
        <div className="flex items-start justify-between border-b pb-4">
          <div className="flex items-start gap-4">
            {clinicLogoUrl && (
              <Image
                src={clinicLogoUrl}
                alt="Clinic logo"
                width={80}
                height={80}
                className="object-contain"
              />
            )}
            <div>
              {clinic?.clinic_name && <p className="font-bold text-lg">{clinic.clinic_name}</p>}
              {clinicAddress && <p className="text-sm text-muted-foreground">{clinicAddress}</p>}
              {clinic?.phone && <p className="text-sm text-muted-foreground">Phone: {clinic.phone}</p>}
              {clinic?.fax && <p className="text-sm text-muted-foreground">Fax: {clinic.fax}</p>}
            </div>
          </div>
          <div className="text-right">
            <Badge variant="outline" className={statusColors[invoice.status] ?? ''}>
              {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
            </Badge>
            <p className="text-sm text-muted-foreground mt-1 font-mono">{invoice.invoice_number}</p>
            <p className="text-sm text-muted-foreground">{formatDate(invoice.invoice_date)}</p>
          </div>
        </div>

        {/* Title */}
        <h2 className="text-xl font-bold text-center">
          {invoice.invoice_type === 'facility' ? 'Medical Facility Invoice' : 'Medical Invoice'}
        </h2>

        {/* 3-column info block */}
        <div className="grid grid-cols-3 gap-6 text-sm">
          {/* Patient Info */}
          <div className="space-y-1">
            <h3 className="font-semibold text-muted-foreground uppercase text-xs tracking-wide">Patient</h3>
            {patient ? (
              <>
                <p className="font-medium">{patient.first_name} {patient.last_name}</p>
                {patient.date_of_birth && <p>DOB: {formatDate(patient.date_of_birth)}</p>}
              </>
            ) : <p className="text-muted-foreground">N/A</p>}
            {invoice.case?.accident_date && <p>Date of Injury: {formatDate(invoice.case.accident_date)}</p>}
            <p>Claim Type: {invoice.claim_type}</p>
            {invoice.indication && <p>Indication: {invoice.indication}</p>}
            {providerProfile && (
              <p>Provider: {providerProfile.display_name}{providerProfile.credentials ? `, ${providerProfile.credentials}` : ''}</p>
            )}
          </div>

          {/* Diagnoses */}
          <div className="space-y-1">
            <h3 className="font-semibold text-muted-foreground uppercase text-xs tracking-wide">Diagnoses</h3>
            {invoice.diagnoses_snapshot && invoice.diagnoses_snapshot.length > 0 ? (
              <ul className="space-y-0.5">
                {invoice.diagnoses_snapshot.map((dx, i) => (
                  <li key={i}>
                    {dx.icd10_code && <span className="font-mono text-xs mr-1">{dx.icd10_code}</span>}
                    <span>{dx.description}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-muted-foreground">None</p>}
          </div>

          {/* Attorney */}
          <div className="space-y-1">
            <h3 className="font-semibold text-muted-foreground uppercase text-xs tracking-wide">Attorney</h3>
            {attorney ? (
              <>
                <p className="font-medium">{attorney.first_name} {attorney.last_name}</p>
                {attorney.firm_name && <p>{attorney.firm_name}</p>}
                <p>{[attorney.address_line1, attorney.address_line2, attorney.city, attorney.state, attorney.zip_code].filter(Boolean).join(', ')}</p>
              </>
            ) : <p className="text-muted-foreground">N/A</p>}
          </div>
        </div>

        {/* Line Items Table */}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">DATE</TableHead>
                <TableHead className="w-[80px]">CPT</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-[60px] text-right">QTY</TableHead>
                <TableHead className="w-[120px] text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.line_items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{formatDate(item.service_date)}</TableCell>
                  <TableCell className="font-mono text-xs">{item.cpt_code}</TableCell>
                  <TableCell>{item.description}</TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right">{formatCurrency(item.total_price)}</TableCell>
                </TableRow>
              ))}
              {/* Total row */}
              <TableRow className="font-semibold">
                <TableCell colSpan={4} className="text-right">Total Balance Due:</TableCell>
                <TableCell className="text-right">{formatCurrency(balance)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {/* Payee */}
        {(invoice.payee_name || invoice.payee_address) && (
          <div className="text-sm pt-2">
            <p className="font-medium">Please make the check payable to:</p>
            <p>{invoice.payee_name}{invoice.payee_address ? `, ${invoice.payee_address}` : ''}</p>
          </div>
        )}

        {/* Notes */}
        {invoice.notes && (
          <div className="text-sm pt-2 border-t">
            <p className="font-medium text-muted-foreground">Notes</p>
            <p>{invoice.notes}</p>
          </div>
        )}
      </div>

      {/* Edit Dialog */}
      <CreateInvoiceDialog
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        caseId={caseId}
        formData={editFormData}
        existingInvoice={invoice}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Invoice</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete invoice {invoice.invoice_number}? This action can be undone by an administrator.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
