import { buildDownloadFilename } from './build-download-filename'

const docTypeFilenameLabels: Record<string, string> = {
  mri_report: 'MRIReport',
  chiro_report: 'ChiroReport',
  pain_management: 'PainManagement',
  pt_report: 'PTReport',
  orthopedic_report: 'OrthopedicReport',
  ct_scan: 'CTScan',
  x_ray: 'XRay',
  initial_visit: 'InitialVisit',
  procedure: 'Procedure',
  discharge: 'Discharge',
  invoice: 'Invoice',
  lien_agreement: 'LienAgreement',
  procedure_consent: 'ProcedureConsent',
}

// file_name values written by the server when document_type = 'generated'.
const generatedFileNameLabels: Record<string, string> = {
  'Discharge Summary': 'DischargeSummary',
  'Initial Visit Note': 'InitialVisitNote',
  'Pain Evaluation Visit Note': 'PainEvaluationVisitNote',
  'Pain Management Follow-Up': 'PainManagementFollowUp',
  'PRP Procedure Note': 'ProcedureNote',
  'Imaging Orders': 'ImagingOrders',
  'Chiropractic Therapy Order': 'ChiropracticOrder',
}

export interface DocumentDownloadNameInput {
  file_name: string
  document_type: string
  mime_type: string | null
  created_at: string
  content_date: string | null
  procedure_number: number | null
}

export function buildDocumentCardFilename(
  doc: DocumentDownloadNameInput,
  lastName: string | null,
): string {
  const extension = (() => {
    const match = doc.file_name.match(/\.([a-zA-Z0-9]+)$/)
    if (match) return match[1].toLowerCase()
    if (doc.mime_type === 'application/pdf') return 'pdf'
    return 'pdf'
  })()

  const date = doc.content_date ?? doc.created_at

  if (doc.document_type === 'generated') {
    const mapped = generatedFileNameLabels[doc.file_name] ?? 'Generated'
    const docType = mapped === 'ProcedureNote' && doc.procedure_number != null
      ? `ProcedureNote${doc.procedure_number}`
      : mapped
    return buildDownloadFilename({ lastName, docType, date, extension })
  }

  const mappedDocType = docTypeFilenameLabels[doc.document_type]
  if (mappedDocType) {
    return buildDownloadFilename({ lastName, docType: mappedDocType, date, extension })
  }

  const baseName = doc.file_name.replace(/\.[a-zA-Z0-9]+$/, '')
  const slug = baseName.replace(/[^A-Za-z0-9-]+/g, '').slice(0, 40) || 'Document'
  return buildDownloadFilename({ lastName, docType: slug, date, extension })
}
