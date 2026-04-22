import { listInvoices, getBillingSummary, getInvoiceFormData } from '@/actions/billing'
import { getPatientCase } from '@/actions/patients'
import { BillingPageClient } from '@/components/billing/billing-page-client'

export default async function BillingPage({
  params,
}: {
  params: Promise<{ caseId: string }>
}) {
  const { caseId } = await params
  const [{ data: invoices }, { data: summary }, { data: invoiceFormData }, patientCase] = await Promise.all([
    listInvoices(caseId),
    getBillingSummary(caseId),
    getInvoiceFormData(caseId),
    getPatientCase(caseId),
  ])

  const patientLastName = patientCase.data?.patient?.last_name ?? null

  return (
    <BillingPageClient
      caseId={caseId}
      invoices={invoices}
      summary={summary}
      invoiceFormData={invoiceFormData}
      patientLastName={patientLastName}
    />
  )
}
