'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { Pencil, Trash2, ArrowLeft, Download } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import { deleteInvoice, generateInvoicePdf } from '@/actions/billing'
import { buildDownloadFilename } from '@/lib/filenames/build-download-filename'
import { issueInvoice, markInvoicePaid, voidInvoice, markInvoiceOverdue, writeOffInvoice } from '@/actions/invoice-status'
import { ALLOWED_TRANSITIONS, INVOICE_STATUS_COLORS, INVOICE_STATUS_LABELS, type InvoiceStatus } from '@/lib/constants/invoice-status'
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
      firm_name: string | null
      phone: string | null
      fax: string | null
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
      firm_name: string | null
      phone: string | null
      fax: string | null
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
  facilityLineItems: InvoiceLineItemFormValues[]
  catalogItems: Array<{
    id: string
    cpt_code: string
    description: string
    default_price: number
    sort_order: number
  }>
}

interface InvoiceDetailClientProps {
  invoice: InvoiceData
  clinic: ClinicData | null
  providerProfile: ProviderProfileData | null
  clinicLogoUrl: string | null
  caseId: string
  catalogItems: Array<{
    id: string
    cpt_code: string
    description: string
    default_price: number
    sort_order: number
  }>
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
  catalogItems,
}: InvoiceDetailClientProps) {
  const router = useRouter()
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [showVoidDialog, setShowVoidDialog] = useState(false)
  const [voidReason, setVoidReason] = useState('')
  const [showWriteOffDialog, setShowWriteOffDialog] = useState(false)
  const [writeOffReason, setWriteOffReason] = useState('')

  const currentStatus = invoice.status as InvoiceStatus
  const availableTransitions = ALLOWED_TRANSITIONS[currentStatus] ?? []
  const isDraft = currentStatus === 'draft'

  const patient = invoice.case?.patient
  const attorney = invoice.case?.attorney
  const balance = Number(invoice.total_amount) - Number(invoice.paid_amount)

  async function handleTransition(action: () => Promise<{ error: string | null }>, successMsg: string) {
    setIsTransitioning(true)
    const result = await action()
    setIsTransitioning(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success(successMsg)
      router.refresh()
    }
  }

  async function handleVoid() {
    setIsTransitioning(true)
    const result = await voidInvoice(invoice.id, voidReason)
    setIsTransitioning(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Invoice voided')
      setShowVoidDialog(false)
      setVoidReason('')
      router.refresh()
    }
  }

  async function handleWriteOff() {
    setIsTransitioning(true)
    const result = await writeOffInvoice(invoice.id, writeOffReason)
    setIsTransitioning(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Invoice written off')
      setShowWriteOffDialog(false)
      setWriteOffReason('')
      router.refresh()
    }
  }

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
    facilityLineItems: [],
    catalogItems,
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
          <Button
            variant="outline"
            size="sm"
            disabled={isGeneratingPdf}
            onClick={async () => {
              setIsGeneratingPdf(true)
              try {
                const result = await generateInvoicePdf(invoice.id)
                if (result.error) {
                  toast.error(result.error)
                  return
                }
                const bytes = Uint8Array.from(atob(result.data!), c => c.charCodeAt(0))
                const blob = new Blob([bytes], { type: 'application/pdf' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = buildDownloadFilename({
                  lastName: invoice.case.patient?.last_name,
                  docType: invoice.invoice_type === 'facility' ? 'MedicalFacilityInvoice' : 'MedicalInvoice',
                  date: invoice.invoice_date,
                })
                a.click()
                URL.revokeObjectURL(url)
              } finally {
                setIsGeneratingPdf(false)
              }
            }}
          >
            <Download className="h-4 w-4 mr-1" />
            {isGeneratingPdf ? 'Generating...' : 'Download PDF'}
          </Button>
          {isDraft && (
            <>
              <Button variant="outline" size="sm" onClick={() => setIsEditOpen(true)}>
                <Pencil className="h-4 w-4 mr-1" />
                Edit
              </Button>
              <Button variant="outline" size="sm" className="text-destructive" onClick={() => setShowDeleteConfirm(true)}>
                <Trash2 className="h-4 w-4 mr-1" />
                Delete
              </Button>
            </>
          )}
          {availableTransitions.includes('issued') && (
            <Button
              size="sm"
              disabled={isTransitioning}
              onClick={() => handleTransition(() => issueInvoice(invoice.id), 'Invoice issued')}
            >
              Issue Invoice
            </Button>
          )}
          {availableTransitions.includes('paid') && (
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700"
              disabled={isTransitioning}
              onClick={() => handleTransition(() => markInvoicePaid(invoice.id), 'Invoice marked as paid')}
            >
              Mark as Paid
            </Button>
          )}
          {availableTransitions.includes('overdue') && (
            <Button
              variant="outline"
              size="sm"
              className="text-amber-600 border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950"
              disabled={isTransitioning}
              onClick={() => handleTransition(() => markInvoiceOverdue(invoice.id), 'Invoice marked as overdue')}
            >
              Mark Overdue
            </Button>
          )}
          {availableTransitions.includes('void') && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              disabled={isTransitioning}
              onClick={() => setShowVoidDialog(true)}
            >
              Void Invoice
            </Button>
          )}
          {availableTransitions.includes('uncollectible') && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              disabled={isTransitioning}
              onClick={() => setShowWriteOffDialog(true)}
            >
              Write Off
            </Button>
          )}
        </div>
      </div>

      {/* Invoice Document */}
      <div className="bg-background border rounded-lg p-8 space-y-6 print:border-none print:p-0">
        {/* Clinic Header */}
        <div className="flex items-start justify-between border-b pb-4">
          <div className="flex items-start gap-4">
            {clinicLogoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={clinicLogoUrl} alt="Clinic logo" className="h-16 object-contain" />
            )}
            <div>
              {clinic?.clinic_name && <p className="font-bold text-lg">{clinic.clinic_name}</p>}
              {clinicAddress && <p className="text-sm text-muted-foreground">{clinicAddress}</p>}
              {clinic?.phone && <p className="text-sm text-muted-foreground">Phone: {clinic.phone}</p>}
              {clinic?.fax && <p className="text-sm text-muted-foreground">Fax: {clinic.fax}</p>}
            </div>
          </div>
          <div className="text-right">
            <Badge variant="outline" className={INVOICE_STATUS_COLORS[invoice.status as InvoiceStatus] ?? ''}>
              {INVOICE_STATUS_LABELS[invoice.status as InvoiceStatus] ?? invoice.status}
            </Badge>
            <p className="text-sm text-muted-foreground mt-1 font-mono">{invoice.invoice_number}</p>
            <p className="text-sm text-muted-foreground">{formatDate(invoice.invoice_date)}</p>
          </div>
        </div>

        {/* Title */}
        <h2 className="text-xl font-bold text-center">
          {invoice.invoice_type === 'facility' ? 'Medical Facility Invoice' : 'Medical Invoice'}
        </h2>

        {/* Patient / Case Info Table */}
        <div className="rounded-md border">
          <Table>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium w-[140px]">Patient</TableCell>
                <TableCell>{patient ? `${patient.first_name} ${patient.last_name}` : 'N/A'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">DOB</TableCell>
                <TableCell>{patient?.date_of_birth ? formatDate(patient.date_of_birth) : 'N/A'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Date of Injury</TableCell>
                <TableCell>{invoice.case?.accident_date ? formatDate(invoice.case.accident_date) : 'N/A'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Claim Type</TableCell>
                <TableCell>{invoice.claim_type}</TableCell>
              </TableRow>
              {invoice.indication && (
                <TableRow>
                  <TableCell className="font-medium">Indication</TableCell>
                  <TableCell>{invoice.indication}</TableCell>
                </TableRow>
              )}
              <TableRow>
                <TableCell className="font-medium">Provider</TableCell>
                <TableCell>
                  {providerProfile
                    ? `${providerProfile.display_name}${providerProfile.credentials ? `, ${providerProfile.credentials}` : ''}`
                    : 'N/A'}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Facility</TableCell>
                <TableCell>{clinic?.clinic_name ?? 'N/A'}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {/* Diagnoses Table */}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[140px]">ICD-10 Code</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.diagnoses_snapshot && invoice.diagnoses_snapshot.length > 0 ? (
                invoice.diagnoses_snapshot.map((dx, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{dx.icd10_code ?? '—'}</TableCell>
                    <TableCell>{dx.description}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={2} className="text-muted-foreground">None</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Attorney Table */}
        <div className="rounded-md border">
          <Table>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium w-[140px]">Firm</TableCell>
                <TableCell>{attorney?.firm_name ?? 'N/A'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Address</TableCell>
                <TableCell>
                  {attorney
                    ? [attorney.address_line1, attorney.address_line2, attorney.city, attorney.state, attorney.zip_code].filter(Boolean).join(', ') || 'N/A'
                    : 'N/A'}
                </TableCell>
              </TableRow>
              {attorney?.phone && (
                <TableRow>
                  <TableCell className="font-medium">Phone</TableCell>
                  <TableCell>{attorney.phone}</TableCell>
                </TableRow>
              )}
              {attorney?.fax && (
                <TableRow>
                  <TableCell className="font-medium">Fax</TableCell>
                  <TableCell>{attorney.fax}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
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

      {/* Void Reason Dialog */}
      <AlertDialog open={showVoidDialog} onOpenChange={(open) => { setShowVoidDialog(open); if (!open) setVoidReason('') }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void Invoice</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently void invoice {invoice.invoice_number}. Please provide a reason.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder="Reason for voiding..."
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleVoid} disabled={isTransitioning || voidReason.trim().length === 0}>
              {isTransitioning ? 'Voiding...' : 'Void Invoice'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Write Off Reason Dialog */}
      <AlertDialog open={showWriteOffDialog} onOpenChange={(open) => { setShowWriteOffDialog(open); if (!open) setWriteOffReason('') }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Write Off Invoice</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark invoice {invoice.invoice_number} as uncollectible. Please provide a reason.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder="Reason for writing off..."
            value={writeOffReason}
            onChange={(e) => setWriteOffReason(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleWriteOff} disabled={isTransitioning || writeOffReason.trim().length === 0}>
              {isTransitioning ? 'Writing off...' : 'Write Off'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
