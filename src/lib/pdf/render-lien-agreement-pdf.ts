import { renderToBuffer } from '@react-pdf/renderer'
import { LienAgreementPdf, type LienAgreementPdfData } from './lien-agreement-template'
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

interface RenderLienAgreementPdfInput {
  caseId: string
}

export async function renderLienAgreementPdf(input: RenderLienAgreementPdfInput): Promise<Buffer> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Fetch case with patient and attorney, plus clinic settings
  const [caseResult, clinicResult] = await Promise.all([
    supabase
      .from('cases')
      .select(`
        *,
        patient:patients(*),
        attorney:attorneys(*)
      `)
      .eq('id', input.caseId)
      .is('deleted_at', null)
      .single(),
    supabase
      .from('clinic_settings')
      .select('*')
      .is('deleted_at', null)
      .maybeSingle(),
  ])

  if (caseResult.error || !caseResult.data) {
    throw new Error(caseResult.error?.message ?? 'Case not found')
  }

  const caseData = caseResult.data
  const clinicSettings = clinicResult.data
  const patient = caseData.patient as { first_name: string; last_name: string; date_of_birth: string | null } | null
  const attorney = caseData.attorney as { first_name: string; last_name: string; firm_name: string | null } | null

  // Fetch assigned provider profile and their supervising provider
  let providerLine = ''
  if (caseData.assigned_provider_id) {
    const { data: providerProfile } = await supabase
      .from('provider_profiles')
      .select('display_name, credentials, supervising_provider_id')
      .eq('id', caseData.assigned_provider_id)
      .is('deleted_at', null)
      .maybeSingle()

    if (providerProfile) {
      const treatingName = providerProfile.display_name +
        (providerProfile.credentials ? `, ${providerProfile.credentials}` : '')

      if (providerProfile.supervising_provider_id) {
        const { data: supervisingProfile } = await supabase
          .from('provider_profiles')
          .select('display_name, credentials')
          .eq('id', providerProfile.supervising_provider_id)
          .is('deleted_at', null)
          .maybeSingle()

        if (supervisingProfile) {
          const supervisingName = supervisingProfile.display_name +
            (supervisingProfile.credentials ? `, ${supervisingProfile.credentials}` : '')
          providerLine = `${supervisingName} / ${treatingName}`
        } else {
          providerLine = treatingName
        }
      } else {
        providerLine = treatingName
      }
    }
  }

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

  const pdfData: LienAgreementPdfData = {
    clinicLogoBase64,
    clinicAddress: addressParts || undefined,
    clinicPhone: clinicSettings?.phone || undefined,
    clinicFax: clinicSettings?.fax || undefined,

    attorneyName: attorney ? `${attorney.first_name} ${attorney.last_name}` : undefined,
    firmName: attorney?.firm_name || undefined,

    patientName: patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown',
    dateOfBirth: patient?.date_of_birth ? format(new Date(patient.date_of_birth + 'T00:00:00'), 'MM/dd/yyyy') : '—',
    dateOfInjury: caseData.accident_date ? format(new Date(caseData.accident_date + 'T00:00:00'), 'MM/dd/yyyy') : '—',

    providerLine,
  }

  const element = React.createElement(LienAgreementPdf, { data: pdfData })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToBuffer(element as any)
}
