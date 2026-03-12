import { renderToBuffer } from '@react-pdf/renderer'
import { DischargeNotePdf, type DischargeNotePdfData } from './discharge-note-template'
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

interface RenderPdfInput {
  note: Record<string, unknown>
  caseId: string
  userId: string
}

export async function renderDischargeNotePdf(input: RenderPdfInput): Promise<Buffer> {
  const supabase = await createClient()

  // Fetch case + patient data
  const { data: caseData } = await supabase
    .from('cases')
    .select('accident_date, accident_type, patient:patients!inner(first_name, last_name, date_of_birth, gender)')
    .eq('id', input.caseId)
    .is('deleted_at', null)
    .single()

  // Fetch clinic settings
  const { data: clinicSettings } = await supabase
    .from('clinic_settings')
    .select('*')
    .is('deleted_at', null)
    .maybeSingle()

  // Fetch provider profile
  const { data: providerProfile } = await supabase
    .from('provider_profiles')
    .select('display_name, credentials, npi_number, signature_storage_path')
    .eq('user_id', input.userId)
    .is('deleted_at', null)
    .maybeSingle()

  // Fetch logo as base64
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

  // Fetch signature as base64
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

  // Assemble indication from case summary / accident type
  const indication = caseData?.accident_type
    ? `Personal injury — ${caseData.accident_type}`
    : 'Post-PRP Series Follow-Up and Discharge Evaluation'

  const pdfData: DischargeNotePdfData = {
    clinicName: clinicSettings?.clinic_name || undefined,
    clinicAddress: addressParts || undefined,
    clinicPhone: clinicSettings?.phone || undefined,
    clinicFax: clinicSettings?.fax || undefined,
    clinicLogoBase64,

    patientName: patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown',
    dob: patient?.date_of_birth ? format(new Date(patient.date_of_birth + 'T00:00:00'), 'MM/dd/yyyy') : '\u2014',
    dateOfVisit: format(new Date(), 'MM/dd/yyyy'),
    visitType: 'Post-PRP Series Follow-Up and Discharge Evaluation',
    indication,
    dateOfInjury: caseData?.accident_date ? format(new Date(caseData.accident_date + 'T00:00:00'), 'MM/dd/yyyy') : '\u2014',

    patient_header: input.note.patient_header as string | null,
    subjective: input.note.subjective as string | null,
    objective_vitals: input.note.objective_vitals as string | null,
    objective_general: input.note.objective_general as string | null,
    objective_cervical: input.note.objective_cervical as string | null,
    objective_lumbar: input.note.objective_lumbar as string | null,
    objective_neurological: input.note.objective_neurological as string | null,
    diagnoses: input.note.diagnoses as string | null,
    assessment: input.note.assessment as string | null,
    plan_and_recommendations: input.note.plan_and_recommendations as string | null,
    patient_education: input.note.patient_education as string | null,
    prognosis: input.note.prognosis as string | null,
    clinician_disclaimer: input.note.clinician_disclaimer as string | null,

    providerName: providerProfile?.display_name || undefined,
    providerCredentials: providerProfile?.credentials || undefined,
    providerNpi: providerProfile?.npi_number || undefined,
    providerSignatureBase64,
  }

  const element = React.createElement(DischargeNotePdf, { data: pdfData })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToBuffer(element as any)
}
