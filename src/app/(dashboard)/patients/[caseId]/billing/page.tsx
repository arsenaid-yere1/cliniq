import { listInvoices, getBillingSummary } from '@/actions/billing'
import { BillingSummaryCard } from '@/components/billing/billing-summary-card'
import { BillingTable } from '@/components/billing/billing-table'

export default async function BillingPage({
  params,
}: {
  params: Promise<{ caseId: string }>
}) {
  const { caseId } = await params
  const [{ data: invoices }, { data: summary }] = await Promise.all([
    listInvoices(caseId),
    getBillingSummary(caseId),
  ])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Billing</h1>
      {summary && <BillingSummaryCard summary={summary} />}
      <BillingTable invoices={invoices} />
    </div>
  )
}
