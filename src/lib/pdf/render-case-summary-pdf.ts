import { renderToBuffer } from '@react-pdf/renderer'
import { CaseSummaryPdf, type CaseSummaryPdfData } from './case-summary-template'
import { createClient } from '@/lib/supabase/server'
import { format } from 'date-fns'
import React from 'react'
import { formatReasonForVisit } from '@/lib/constants/clinical-note-header'

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

function formatDateForPdf(value: string | null | undefined): string {
  if (!value) return '—'
  try {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value)
    if (isNaN(d.getTime())) return '—'
    return format(d, 'MM/dd/yyyy')
  } catch {
    return '—'
  }
}

interface SummaryRow {
  chief_complaint: string | null
  imaging_findings: unknown
  prior_treatment: unknown
  symptoms_timeline: unknown
  suggested_diagnoses: unknown
  ai_confidence: string | null
  extraction_notes: string | null
  review_status: string
  reviewed_at: string | null
  provider_overrides: Record<string, unknown> | null
  generated_at: string | null
}

interface RenderPdfInput {
  summary: SummaryRow
  caseId: string
}

export async function renderCaseSummaryPdf(input: RenderPdfInput): Promise<Buffer> {
  const supabase = await createClient()

  // Fetch case + patient
  const { data: caseData } = await supabase
    .from('cases')
    .select('accident_date, accident_type, assigned_provider_id, patient:patients!inner(first_name, last_name, date_of_birth)')
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

  // Logo base64
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

  // Signature base64
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

  // Address
  const addressParts = [
    clinicSettings?.address_line1,
    clinicSettings?.address_line2,
    [clinicSettings?.city, clinicSettings?.state].filter(Boolean).join(', ') + (clinicSettings?.zip_code ? ` ${clinicSettings.zip_code}` : ''),
  ].filter(Boolean).join(', ')

  const patient = caseData?.patient as unknown as { first_name: string; last_name: string; date_of_birth: string | null } | undefined

  // Merge provider_overrides over AI fields (same pattern as card)
  const overrides = (input.summary.provider_overrides && Object.keys(input.summary.provider_overrides).length > 0)
    ? input.summary.provider_overrides as Record<string, unknown>
    : null

  const chiefComplaint = (overrides?.chief_complaint as string | null | undefined) ?? input.summary.chief_complaint
  const imagingFindings = ((overrides?.imaging_findings ?? input.summary.imaging_findings) as CaseSummaryPdfData['imagingFindings'] | null) ?? []

  const rawPrior = (overrides?.prior_treatment ?? input.summary.prior_treatment) as Partial<CaseSummaryPdfData['priorTreatment']> | null
  const priorTreatment: CaseSummaryPdfData['priorTreatment'] = {
    modalities: rawPrior?.modalities ?? [],
    total_visits: rawPrior?.total_visits ?? null,
    treatment_period: rawPrior?.treatment_period ?? null,
    gaps: rawPrior?.gaps ?? [],
  }

  const rawTimeline = (overrides?.symptoms_timeline ?? input.summary.symptoms_timeline) as Partial<CaseSummaryPdfData['symptomsTimeline']> | null
  const symptomsTimeline: CaseSummaryPdfData['symptomsTimeline'] = {
    onset: rawTimeline?.onset ?? null,
    progression: rawTimeline?.progression ?? [],
    current_status: rawTimeline?.current_status ?? null,
    pain_levels: rawTimeline?.pain_levels ?? [],
  }

  const suggestedDiagnoses = ((overrides?.suggested_diagnoses ?? input.summary.suggested_diagnoses) as CaseSummaryPdfData['suggestedDiagnoses'] | null) ?? []

  const pdfData: CaseSummaryPdfData = {
    clinicName: clinicSettings?.clinic_name || undefined,
    clinicAddress: addressParts || undefined,
    clinicPhone: clinicSettings?.phone || undefined,
    clinicFax: clinicSettings?.fax || undefined,
    clinicLogoBase64,

    patientName: patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown',
    dob: formatDateForPdf(patient?.date_of_birth),
    dateOfInjury: formatDateForPdf(caseData?.accident_date as string | null | undefined),
    accidentType: formatReasonForVisit(caseData?.accident_type as string | null | undefined) || null,

    generatedAt: formatDateForPdf(input.summary.generated_at),
    reviewStatus: (input.summary.review_status as CaseSummaryPdfData['reviewStatus']) || 'pending_review',
    reviewedAt: input.summary.reviewed_at ? formatDateForPdf(input.summary.reviewed_at) : null,
    aiConfidence: (input.summary.ai_confidence as CaseSummaryPdfData['aiConfidence']) || null,

    chiefComplaint,
    imagingFindings,
    priorTreatment,
    symptomsTimeline,
    suggestedDiagnoses,
    extractionNotes: input.summary.extraction_notes,

    providerName: providerProfile?.display_name || undefined,
    providerCredentials: providerProfile?.credentials || undefined,
    providerNpi: providerProfile?.npi_number || undefined,
    providerSignatureBase64,
  }

  const element = React.createElement(CaseSummaryPdf, { data: pdfData })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToBuffer(element as any)
}
