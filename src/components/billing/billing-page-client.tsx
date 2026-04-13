'use client'

import { useState } from 'react'
import { BillingSummaryCard } from './billing-summary-card'
import { BillingTable } from './billing-table'
import { CreateInvoiceDialog } from './create-invoice-dialog'
import type { InvoiceLineItemFormValues } from '@/lib/validations/invoice'

interface Invoice {
  id: string
  invoice_date: string
  invoice_number: string
  total_amount: number
  paid_amount: number
  status: string
}

interface BillingSummary {
  total_billed: number
  total_paid: number
  balance_due: number
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
  clinic: {
    clinic_name: string | null
    address_line1: string | null
    address_line2: string | null
    city: string | null
    state: string | null
    zip_code: string | null
    phone: string | null
    fax: string | null
  } | null
  providerProfile: {
    display_name: string | null
    credentials: string | null
    npi_number: string | null
  } | null
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

interface BillingPageClientProps {
  caseId: string
  invoices: Invoice[]
  summary: BillingSummary | null
  invoiceFormData: InvoiceFormData | null
}

export function BillingPageClient({
  caseId,
  invoices,
  summary,
  invoiceFormData,
}: BillingPageClientProps) {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Billing</h1>
      {summary && <BillingSummaryCard summary={summary} />}
      <BillingTable
        invoices={invoices}
        caseId={caseId}
        onCreateClick={() => setIsCreateDialogOpen(true)}
      />
      {invoiceFormData && (
        <CreateInvoiceDialog
          open={isCreateDialogOpen}
          onOpenChange={setIsCreateDialogOpen}
          caseId={caseId}
          formData={invoiceFormData}
        />
      )}
    </div>
  )
}
