import { z } from 'zod'

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const

export const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

export const documentTypeEnum = z.enum(['mri_report', 'chiro_report', 'pain_management', 'pt_report', 'orthopedic_report', 'ct_scan', 'x_ray', 'generated', 'lien_agreement', 'procedure_consent', 'other', 'initial_visit', 'procedure', 'discharge', 'invoice'])

export const documentUploadMetaSchema = z.object({
  caseId: z.string().uuid(),
  uploadId: z.string().uuid().optional(),
  fileName: z.string().min(1),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE, 'File must be under 50MB'),
  mimeType: z.enum(ALLOWED_MIME_TYPES),
  documentType: documentTypeEnum,
})

export type DocumentUploadMeta = z.infer<typeof documentUploadMetaSchema>
export type DocumentType = z.infer<typeof documentTypeEnum>

export function uploadStoragePath(caseId: string, uploadId: string, fileName: string) {
  return `cases/${caseId}/${uploadId}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`
}

export const documentRegistrationSchema = documentUploadMetaSchema.extend({
  filePath: z.string().min(1),
}).refine((input) => {
  if (input.uploadId) return input.filePath === uploadStoragePath(input.caseId, input.uploadId, input.fileName)
  const prefix = `cases/${input.caseId}/`
  const suffix = `-${input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  return input.filePath.startsWith(prefix) && input.filePath.endsWith(suffix)
    && /^\d{13}$/.test(input.filePath.slice(prefix.length, -suffix.length))
}, { message: 'Invalid document path', path: ['filePath'] })

export const documentReconciliationSchema = documentUploadMetaSchema.extend({
  uploadId: z.string().uuid(),
  filePath: z.string().min(1),
}).refine((input) => input.filePath === uploadStoragePath(input.caseId, input.uploadId, input.fileName), {
  message: 'Invalid document path', path: ['filePath'],
})
