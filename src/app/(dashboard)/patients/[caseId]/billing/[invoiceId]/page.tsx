import { notFound } from 'next/navigation'
import { getInvoiceWithContext } from '@/actions/billing'
import { getClinicLogoUrl } from '@/actions/settings'
import { listServiceCatalog } from '@/actions/service-catalog'
import { InvoiceDetailClient } from '@/components/billing/invoice-detail-client'

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ caseId: string; invoiceId: string }>
}) {
  const { caseId, invoiceId } = await params

  const [invoiceResult, logoResult, catalogResult] = await Promise.all([
    getInvoiceWithContext(invoiceId),
    getClinicLogoUrl(),
    listServiceCatalog(),
  ])

  if (invoiceResult.error || !invoiceResult.data?.invoice) {
    notFound()
  }

  const { invoice, clinic, providerProfile } = invoiceResult.data

  return (
    <InvoiceDetailClient
      invoice={invoice}
      clinic={clinic}
      providerProfile={providerProfile}
      clinicLogoUrl={logoResult.url ?? null}
      caseId={caseId}
      catalogItems={catalogResult.data ?? []}
    />
  )
}
