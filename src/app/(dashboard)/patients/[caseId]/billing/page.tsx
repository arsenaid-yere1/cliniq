import { listInvoices, getBillingSummary, getInvoiceFormData } from '@/actions/billing'
import { BillingPageClient } from '@/components/billing/billing-page-client'

export default async function BillingPage({
  params,
}: {
  params: Promise<{ caseId: string }>
}) {
  const { caseId } = await params
  const [{ data: invoices }, { data: summary }, { data: invoiceFormData }] = await Promise.all([
    listInvoices(caseId),
    getBillingSummary(caseId),
    getInvoiceFormData(caseId),
  ])

  return (
    <BillingPageClient
      caseId={caseId}
      invoices={invoices}
      summary={summary}
      invoiceFormData={invoiceFormData}
    />
  )
}
