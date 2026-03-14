import { z } from 'zod'

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const

export const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

export const documentTypeEnum = z.enum(['mri_report', 'chiro_report', 'pain_management', 'pt_report', 'orthopedic_report', 'ct_scan', 'generated', 'other'])

export const documentUploadMetaSchema = z.object({
  caseId: z.string().uuid(),
  fileName: z.string().min(1),
  fileSize: z.number().positive().max(MAX_FILE_SIZE, 'File must be under 50MB'),
  mimeType: z.enum(ALLOWED_MIME_TYPES),
  documentType: documentTypeEnum,
})

export type DocumentUploadMeta = z.infer<typeof documentUploadMetaSchema>
export type DocumentType = z.infer<typeof documentTypeEnum>
