import { renderToBuffer } from '@react-pdf/renderer'
import { InitialVisitPdf, type InitialVisitPdfData } from './initial-visit-template'
import { createClient } from '@/lib/supabase/server'
import { format, differenceInYears } from 'date-fns'
import React from 'react'

function getMimeType(path: string): string {
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg'
  if (path.endsWith('.svg')) return 'image/svg+xml'
  return ''
}

async function imageToBase64(data: Blob, mime: string): Promise<string> {
  const buffer = Buffer.from(await data.arrayBuffer())
  // Normalize all images to PNG for @react-pdf/renderer compatibility
  // (SVG is unsupported, JPEG can have rendering issues in some versions)
  if (mime !== 'image/png') {
    const sharp = (await import('sharp')).default
    const pngBuffer = await sharp(buffer).png().toBuffer()
    return `data:image/png;base64,${pngBuffer.toString('base64')}`
  }
  return `data:image/png;base64,${buffer.toString('base64')}`
}

interface RenderPdfInput {
  note: Record<string, unknown>
  caseId: string
  userId: string // kept for backwards compat but provider is looked up from case
}

export async function renderInitialVisitPdf(input: RenderPdfInput): Promise<Buffer> {
  const supabase = await createClient()

  // Fetch case + patient data
  const { data: caseData } = await supabase
    .from('cases')
    .select('accident_date, accident_type, assigned_provider_id, patient:patients!inner(first_name, last_name, date_of_birth, gender)')
    .eq('id', input.caseId)
    .is('deleted_at', null)
    .single()

  // Fetch clinic settings
  const { data: clinicSettings } = await supabase
    .from('clinic_settings')
    .select('*')
    .is('deleted_at', null)
    .maybeSingle()

  // Fetch provider profile from case's assigned provider
  const assignedProviderId = caseData?.assigned_provider_id as string | null
  let providerProfile: { display_name: string; credentials: string | null; npi_number: string | null; signature_storage_path: string | null } | null = null
  if (assignedProviderId) {
    const { data } = await supabase
      .from('provider_profiles')
      .select('display_name, credentials, npi_number, signature_storage_path')
      .eq('id', assignedProviderId)
      .is('deleted_at', null)
      .maybeSingle()
    providerProfile = data
  }

  // Fetch logo as base64 (if exists — only PNG/JPEG supported by @react-pdf/renderer)
  let clinicLogoBase64: string | undefined
  console.log('[PDF] logo_storage_path:', clinicSettings?.logo_storage_path ?? 'NOT SET')
  if (clinicSettings?.logo_storage_path) {
    const mime = getMimeType(clinicSettings.logo_storage_path)
    console.log('[PDF] Logo mime type resolved:', mime || 'UNSUPPORTED')
    if (mime) {
      const { data: logoData, error: logoError } = await supabase.storage
        .from('clinic-assets')
        .download(clinicSettings.logo_storage_path)
      if (logoError) {
        console.error('[PDF] Logo download failed:', logoError.message)
      } else if (logoData) {
        clinicLogoBase64 = await imageToBase64(logoData, mime)
        console.log('[PDF] Logo loaded, format:', mime)
      } else {
        console.warn('[PDF] Logo download returned null data')
      }
    } else {
      console.warn('[PDF] Unsupported logo format:', clinicSettings.logo_storage_path)
    }
  }

  // Fetch signature as base64 (if exists — only PNG/JPEG supported)
  let providerSignatureBase64: string | undefined
  if (providerProfile?.signature_storage_path) {
    const mime = getMimeType(providerProfile.signature_storage_path)
    if (mime) {
      const { data: sigData } = await supabase.storage
        .from('clinic-assets')
        .download(providerProfile.signature_storage_path)
      if (sigData) {
        providerSignatureBase64 = await imageToBase64(sigData, mime)
      }
    }
  }

  // Assemble address
  const addressParts = [
    clinicSettings?.address_line1,
    clinicSettings?.address_line2,
    [clinicSettings?.city, clinicSettings?.state].filter(Boolean).join(', ') + (clinicSettings?.zip_code ? ` ${clinicSettings.zip_code}` : ''),
  ].filter(Boolean).join(', ')

  const patient = caseData?.patient as unknown as { first_name: string; last_name: string; date_of_birth: string | null; gender: string | null } | undefined
  const patientDob = patient?.date_of_birth ? new Date(patient.date_of_birth) : null

  const pdfData: InitialVisitPdfData = {
    clinicName: clinicSettings?.clinic_name || undefined,
    clinicAddress: addressParts || undefined,
    clinicPhone: clinicSettings?.phone || undefined,
    clinicFax: clinicSettings?.fax || undefined,
    clinicLogoBase64,

    patientName: patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown',
    dob: patientDob ? format(patientDob, 'MM/dd/yyyy') : '—',
    age: patientDob ? differenceInYears(new Date(), patientDob) : 0,
    dateOfVisit: format(new Date(), 'MM/dd/yyyy'),
    indication: 'Pain Management Evaluation',
    dateOfInjury: caseData?.accident_date ? format(new Date(caseData.accident_date), 'MM/dd/yyyy') : '—',

    introduction: input.note.introduction as string | null,
    history_of_accident: input.note.history_of_accident as string | null,
    post_accident_history: input.note.post_accident_history as string | null,
    chief_complaint: input.note.chief_complaint as string | null,
    past_medical_history: input.note.past_medical_history as string | null,
    social_history: input.note.social_history as string | null,
    review_of_systems: input.note.review_of_systems as string | null,
    physical_exam: input.note.physical_exam as string | null,
    imaging_findings: input.note.imaging_findings as string | null,
    medical_necessity: input.note.medical_necessity as string | null,
    diagnoses: input.note.diagnoses as string | null,
    treatment_plan: input.note.treatment_plan as string | null,
    patient_education: input.note.patient_education as string | null,
    prognosis: input.note.prognosis as string | null,
    time_complexity_attestation: input.note.time_complexity_attestation as string | null,
    clinician_disclaimer: input.note.clinician_disclaimer as string | null,

    providerName: providerProfile?.display_name || undefined,
    providerCredentials: providerProfile?.credentials || undefined,
    providerNpi: providerProfile?.npi_number || undefined,
    providerSignatureBase64,
  }

  const element = React.createElement(InitialVisitPdf, { data: pdfData })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToBuffer(element as any)
}
