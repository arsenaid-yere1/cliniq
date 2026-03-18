import { renderToBuffer } from '@react-pdf/renderer'
import { InvoicePdf, type InvoicePdfData } from './invoice-template'
import { createClient } from '@/lib/supabase/server'
import { format } from 'date-fns'
import React from 'react'

function getMimeType(path: string): string {
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg'
  if (path.endsWith('.svg')) return 'image/svg+xml'
  return ''
}

async function imageToBase64(data: Blob, mime: string): Promise<string> {
  const buffer = Buffer.from(await data.arrayBuffer())
  if (mime !== 'image/png') {
    const sharp = (await import('sharp')).default
    const pngBuffer = await sharp(buffer).png().toBuffer()
    return `data:image/png;base64,${pngBuffer.toString('base64')}`
  }
  return `data:image/png;base64,${buffer.toString('base64')}`
}

interface RenderInvoicePdfInput {
  invoiceId: string
}

export async function renderInvoicePdf(input: RenderInvoicePdfInput): Promise<Buffer> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Parallel fetch: invoice+case+patient+attorney, clinic settings
  const [invoiceResult, clinicResult] = await Promise.all([
    supabase
      .from('invoices')
      .select(`
        *,
        line_items:invoice_line_items(*),
        case:cases(
          *,
          patient:patients(*),
          attorney:attorneys(*)
        )
      `)
      .eq('id', input.invoiceId)
      .is('deleted_at', null)
      .single(),
    supabase
      .from('clinic_settings')
      .select('*')
      .is('deleted_at', null)
      .maybeSingle(),
  ])

  if (invoiceResult.error || !invoiceResult.data) {
    throw new Error(invoiceResult.error?.message ?? 'Invoice not found')
  }

  const invoice = invoiceResult.data
  const clinicSettings = clinicResult.data
  const caseData = invoice.case as Record<string, unknown> | null

  // Fetch assigned provider profile (not the logged-in user)
  const assignedProviderId = caseData?.assigned_provider_id as string | null
  let providerProfile: { display_name: string; credentials: string | null } | null = null
  if (assignedProviderId) {
    const { data } = await supabase
      .from('provider_profiles')
      .select('display_name, credentials')
      .eq('id', assignedProviderId)
      .is('deleted_at', null)
      .maybeSingle()
    providerProfile = data
  }
  const patient = (caseData?.patient ?? null) as { first_name: string; last_name: string; date_of_birth: string | null } | null
  const attorney = (caseData?.attorney ?? null) as { first_name: string; last_name: string; firm_name: string | null; address_line1: string | null; address_line2: string | null; city: string | null; state: string | null; zip_code: string | null } | null

  // Fetch clinic logo as base64
  let clinicLogoBase64: string | undefined
  if (clinicSettings?.logo_storage_path) {
    const mime = getMimeType(clinicSettings.logo_storage_path)
    if (mime) {
      const { data: logoData } = await supabase.storage
        .from('clinic-assets')
        .download(clinicSettings.logo_storage_path)
      if (logoData) {
        clinicLogoBase64 = await imageToBase64(logoData, mime)
      }
    }
  }

  // Assemble clinic address
  const addressParts = [
    clinicSettings?.address_line1,
    clinicSettings?.address_line2,
    [clinicSettings?.city, clinicSettings?.state].filter(Boolean).join(', ') + (clinicSettings?.zip_code ? ` ${clinicSettings.zip_code}` : ''),
  ].filter(Boolean).join(', ')

  // Assemble attorney address
  let attorneyAddress: string | undefined
  if (attorney) {
    const streetParts = [attorney.address_line1, attorney.address_line2].filter(Boolean).join(', ')
    const cityStateZipParts = [attorney.city, attorney.state].filter(Boolean).join(', ') + (attorney.zip_code ? ` ${attorney.zip_code}` : '')
    attorneyAddress = [streetParts, cityStateZipParts].filter(Boolean).join(', ') || undefined
  }

  // Format line items
  const lineItems = ((invoice.line_items ?? []) as Array<{
    service_date: string | null
    cpt_code: string
    description: string
    quantity: number
    total_price: number
  }>).map((item) => ({
    serviceDate: item.service_date ? format(new Date(item.service_date + 'T00:00:00'), 'MM/dd/yyyy') : 'N/A',
    cptCode: item.cpt_code,
    description: item.description,
    quantity: item.quantity,
    amount: Number(item.total_price),
  }))

  const balance = Number(invoice.total_amount) - Number(invoice.paid_amount)

  const pdfData: InvoicePdfData = {
    clinicName: clinicSettings?.clinic_name || undefined,
    clinicAddress: addressParts || undefined,
    clinicPhone: clinicSettings?.phone || undefined,
    clinicFax: clinicSettings?.fax || undefined,
    clinicLogoBase64,

    invoiceNumber: invoice.invoice_number,
    invoiceDate: format(new Date(invoice.invoice_date + 'T00:00:00'), 'MM/dd/yyyy'),
    invoiceType: invoice.invoice_type,
    status: invoice.status,

    patientName: patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown',
    dob: patient?.date_of_birth ? format(new Date(patient.date_of_birth + 'T00:00:00'), 'MM/dd/yyyy') : '—',
    dateOfInjury: caseData?.accident_date ? format(new Date(caseData.accident_date as string + 'T00:00:00'), 'MM/dd/yyyy') : '—',
    claimType: invoice.claim_type,
    indication: invoice.indication || undefined,

    providerName: providerProfile?.display_name || undefined,
    providerCredentials: providerProfile?.credentials || undefined,
    facilityName: clinicSettings?.clinic_name || undefined,

    diagnoses: (invoice.diagnoses_snapshot ?? []) as Array<{ icd10_code: string | null; description: string }>,

    attorneyName: attorney ? `${attorney.first_name} ${attorney.last_name}` : undefined,
    firmName: attorney?.firm_name || undefined,
    attorneyAddress: attorneyAddress || undefined,

    lineItems,
    balanceDue: balance,

    payeeName: invoice.payee_name || undefined,
    payeeAddress: invoice.payee_address || undefined,
    notes: invoice.notes || undefined,
  }

  const element = React.createElement(InvoicePdf, { data: pdfData })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToBuffer(element as any)
}
