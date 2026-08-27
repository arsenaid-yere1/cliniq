import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { format } from 'date-fns'
import { createClient } from '@/lib/supabase/server'
import { PainFollowUpPdf } from './pain-follow-up-template'

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

export async function renderPainFollowUpPdf(caseId: string, encounterId: string, note: Record<string, unknown>) {
  const supabase = await createClient()
  const [{ data: caseData }, { data: encounter }, { data: clinicSettings }] = await Promise.all([
    supabase.from('cases').select('patient:patients!inner(first_name,last_name,date_of_birth)')
      .eq('id', caseId).is('deleted_at', null).single(),
    supabase.from('clinical_encounters').select('*,provider:provider_profiles(display_name,credentials,npi_number,signature_storage_path)')
      .eq('id', encounterId).eq('case_id', caseId).is('deleted_at', null).single(),
    supabase.from('clinic_settings').select('*').is('deleted_at', null).maybeSingle(),
  ])
  const patient = caseData?.patient as unknown as { first_name: string; last_name: string; date_of_birth: string | null } | null
  const provider = encounter?.provider as unknown as {
    display_name: string
    credentials: string | null
    npi_number: string | null
    signature_storage_path: string | null
  } | null
  const date = encounter?.encounter_date ?? encounter?.scheduled_start?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)

  let clinicLogoBase64: string | undefined
  if (clinicSettings?.logo_storage_path) {
    const mime = getMimeType(clinicSettings.logo_storage_path)
    if (mime) {
      const { data: logoData } = await supabase.storage.from('clinic-assets').download(clinicSettings.logo_storage_path)
      if (logoData) clinicLogoBase64 = await imageToBase64(logoData, mime)
    }
  }

  let providerSignatureBase64: string | undefined
  if (provider?.signature_storage_path) {
    const mime = getMimeType(provider.signature_storage_path)
    if (mime) {
      const { data: signatureData } = await supabase.storage.from('clinic-assets').download(provider.signature_storage_path)
      if (signatureData) providerSignatureBase64 = await imageToBase64(signatureData, mime)
    }
  }

  const addressParts = [
    clinicSettings?.address_line1,
    clinicSettings?.address_line2,
    [clinicSettings?.city, clinicSettings?.state].filter(Boolean).join(', ') + (clinicSettings?.zip_code ? ` ${clinicSettings.zip_code}` : ''),
  ].filter(Boolean).join(', ')

  const labels: Array<[string, string]> = [
    ['Subjective','subjective'],['Interval History','interval_history'],['Review of Systems','review_of_systems'],
    ['Telehealth Observations','telehealth_observations'],['Imaging Review','imaging_review'],['Assessment','assessment'],
    ['Diagnoses','diagnoses'],['Treatment Plan','treatment_plan'],['Patient Education','patient_education'],
    ['Follow-Up','follow_up'],['Clinician Disclaimer','clinician_disclaimer'],
  ]
  const element = React.createElement(PainFollowUpPdf, { data: {
    clinicName: clinicSettings?.clinic_name || undefined,
    clinicAddress: addressParts || undefined,
    clinicPhone: clinicSettings?.phone || undefined,
    clinicFax: clinicSettings?.fax || undefined,
    clinicLogoBase64,
    patientName: patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown',
    dob: patient?.date_of_birth ? format(new Date(`${patient.date_of_birth}T00:00:00`), 'MM/dd/yyyy') : '—',
    dateOfService: format(new Date(`${date}T00:00:00`), 'MM/dd/yyyy'),
    modality: encounter?.modality === 'telehealth' ? 'Telehealth (audio/video)' : (encounter?.modality ?? 'Unknown'),
    consent: encounter?.telehealth_consent_obtained ? 'Obtained' : 'Not documented',
    patientLocation: encounter?.patient_location_state ?? 'Not documented',
    providerLocation: encounter?.provider_location ?? 'Not documented',
    connectionMethod: encounter?.connection_method ?? 'Not documented',
    providerName: provider?.display_name ?? 'Provider not documented',
    providerCredentials: provider?.credentials,
    providerNpi: provider?.npi_number,
    providerSignatureBase64,
    sections: labels.map(([label,key]) => ({ label, value: note[key] as string | null })),
  } })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToBuffer(element as any)
}
