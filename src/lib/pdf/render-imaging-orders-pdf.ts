import { renderToBuffer } from '@react-pdf/renderer'
import { ImagingOrdersPdf, type ImagingOrdersPdfData } from './imaging-orders-template'
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

interface RenderInput {
  orderData: Record<string, unknown>
  clinicSettings: Record<string, unknown> | null
  providerProfile: Record<string, unknown> | null
  patientDob: string | null
}

export async function renderImagingOrdersPdf(input: RenderInput): Promise<Buffer> {
  const supabase = await createClient()
  const cs = input.clinicSettings as Record<string, string | null> | null
  const pp = input.providerProfile as Record<string, string | null> | null
  const od = input.orderData as {
    patient_name: string
    date_of_order: string
    ordering_provider: string
    ordering_provider_npi: string | null
    orders: Array<{ body_region: string; modality: string; icd10_codes: string[]; clinical_indication: string }>
  }

  // Fetch clinic logo
  let clinicLogoBase64: string | undefined
  if (cs?.logo_storage_path) {
    const mime = getMimeType(cs.logo_storage_path)
    if (mime) {
      const { data: logoData } = await supabase.storage.from('clinic-assets').download(cs.logo_storage_path)
      if (logoData) clinicLogoBase64 = await imageToBase64(logoData, mime)
    }
  }

  // Fetch provider signature
  let providerSignatureBase64: string | undefined
  if (pp?.signature_storage_path) {
    const mime = getMimeType(pp.signature_storage_path)
    if (mime) {
      const { data: sigData } = await supabase.storage.from('clinic-assets').download(pp.signature_storage_path)
      if (sigData) providerSignatureBase64 = await imageToBase64(sigData, mime)
    }
  }

  const addressParts = [
    cs?.address_line1,
    cs?.address_line2,
    [cs?.city, cs?.state].filter(Boolean).join(', ') + (cs?.zip_code ? ` ${cs.zip_code}` : ''),
  ].filter(Boolean).join(', ')

  const pdfData: ImagingOrdersPdfData = {
    clinicName: cs?.clinic_name || undefined,
    clinicAddress: addressParts || undefined,
    clinicPhone: cs?.phone || undefined,
    clinicFax: cs?.fax || undefined,
    clinicLogoBase64,
    patientName: od.patient_name,
    dob: input.patientDob ? format(new Date(input.patientDob), 'MM/dd/yyyy') : '—',
    dateOfOrder: od.date_of_order || format(new Date(), 'MM/dd/yyyy'),
    orders: od.orders,
    orderingProvider: od.ordering_provider,
    orderingProviderNpi: od.ordering_provider_npi || undefined,
    providerSignatureBase64,
  }

  const element = React.createElement(ImagingOrdersPdf, { data: pdfData })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToBuffer(element as any)
}
