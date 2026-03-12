import { renderToBuffer } from '@react-pdf/renderer'
import { ProcedureNotePdf, type ProcedureNotePdfData } from './procedure-note-template'
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
  procedureId: string
  caseId: string
  userId: string
}

export async function renderProcedureNotePdf(input: RenderPdfInput): Promise<Buffer> {
  const supabase = await createClient()

  // Fetch case + patient data
  const { data: caseData } = await supabase
    .from('cases')
    .select('accident_date, accident_type, patient:patients!inner(first_name, last_name, date_of_birth, gender)')
    .eq('id', input.caseId)
    .is('deleted_at', null)
    .single()

  // Fetch procedure record
  const { data: procedure } = await supabase
    .from('procedures')
    .select('procedure_date, procedure_name, procedure_number, injection_site, laterality, diagnoses')
    .eq('id', input.procedureId)
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

  // Assemble indication from procedure diagnoses
  const diagnosesArr = Array.isArray(procedure?.diagnoses)
    ? (procedure.diagnoses as Array<{ description: string }>)
    : []
  const indication = diagnosesArr.map((d) => d.description).join(', ') || 'PRP Injection'

  // Assemble procedure name string
  const procedureName = procedure?.injection_site
    ? `${procedure.procedure_name} \u2013 ${procedure.injection_site}`
    : procedure?.procedure_name || 'PRP Injection'

  const pdfData: ProcedureNotePdfData = {
    clinicName: clinicSettings?.clinic_name || undefined,
    clinicAddress: addressParts || undefined,
    clinicPhone: clinicSettings?.phone || undefined,
    clinicFax: clinicSettings?.fax || undefined,
    clinicLogoBase64,

    patientName: patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown',
    dob: patient?.date_of_birth ? format(new Date(patient.date_of_birth + 'T00:00:00'), 'MM/dd/yyyy') : '\u2014',
    dateOfVisit: procedure?.procedure_date
      ? format(new Date(procedure.procedure_date + 'T00:00:00'), 'MM/dd/yyyy')
      : format(new Date(), 'MM/dd/yyyy'),
    indication,
    dateOfInjury: caseData?.accident_date ? format(new Date(caseData.accident_date + 'T00:00:00'), 'MM/dd/yyyy') : '\u2014',
    procedureName,
    procedureNumber: procedure?.procedure_number ?? 1,
    injectionSite: procedure?.injection_site || '\u2014',
    laterality: procedure?.laterality || '\u2014',

    patient_header: input.note.patient_header as string | null,
    subjective: input.note.subjective as string | null,
    past_medical_history: input.note.past_medical_history as string | null,
    allergies: input.note.allergies as string | null,
    current_medications: input.note.current_medications as string | null,
    social_history: input.note.social_history as string | null,
    review_of_systems: input.note.review_of_systems as string | null,
    objective_vitals: input.note.objective_vitals as string | null,
    objective_physical_exam: input.note.objective_physical_exam as string | null,
    assessment_summary: input.note.assessment_summary as string | null,
    procedure_indication: input.note.procedure_indication as string | null,
    procedure_preparation: input.note.procedure_preparation as string | null,
    procedure_prp_prep: input.note.procedure_prp_prep as string | null,
    procedure_anesthesia: input.note.procedure_anesthesia as string | null,
    procedure_injection: input.note.procedure_injection as string | null,
    procedure_post_care: input.note.procedure_post_care as string | null,
    procedure_followup: input.note.procedure_followup as string | null,
    assessment_and_plan: input.note.assessment_and_plan as string | null,
    patient_education: input.note.patient_education as string | null,
    prognosis: input.note.prognosis as string | null,
    clinician_disclaimer: input.note.clinician_disclaimer as string | null,

    providerName: providerProfile?.display_name || undefined,
    providerCredentials: providerProfile?.credentials || undefined,
    providerNpi: providerProfile?.npi_number || undefined,
    providerSignatureBase64,
  }

  const element = React.createElement(ProcedureNotePdf, { data: pdfData })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToBuffer(element as any)
}
