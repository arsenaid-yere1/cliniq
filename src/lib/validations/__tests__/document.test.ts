import { describe, it, expect } from 'vitest'
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  documentTypeEnum,
  documentUploadMetaSchema,
} from '../document'

describe('ALLOWED_MIME_TYPES', () => {
  it('includes PDF, JPEG, PNG, WebP, and DOCX', () => {
    expect(ALLOWED_MIME_TYPES).toContain('application/pdf')
    expect(ALLOWED_MIME_TYPES).toContain('image/jpeg')
    expect(ALLOWED_MIME_TYPES).toContain('image/png')
    expect(ALLOWED_MIME_TYPES).toContain('image/webp')
    expect(ALLOWED_MIME_TYPES).toContain(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
  })
})

describe('MAX_FILE_SIZE', () => {
  it('is 50MB', () => {
    expect(MAX_FILE_SIZE).toBe(50 * 1024 * 1024)
  })
})

describe('documentTypeEnum', () => {
  it('accepts all valid document types', () => {
    const types = [
      'mri_report',
      'chiro_report',
      'pain_management',
      'pt_report',
      'orthopedic_report',
      'ct_scan',
      'generated',
      'other',
    ]
    for (const type of types) {
      expect(documentTypeEnum.safeParse(type).success).toBe(true)
    }
  })

  it('rejects invalid document type', () => {
    expect(documentTypeEnum.safeParse('x_ray').success).toBe(false)
  })
})

describe('documentUploadMetaSchema', () => {
  const validMeta = {
    caseId: '550e8400-e29b-41d4-a716-446655440000',
    fileName: 'report.pdf',
    fileSize: 1024,
    mimeType: 'application/pdf' as const,
    documentType: 'mri_report' as const,
  }

  it('accepts valid upload metadata', () => {
    const result = documentUploadMetaSchema.safeParse(validMeta)
    expect(result.success).toBe(true)
  })

  it('rejects non-UUID caseId', () => {
    const result = documentUploadMetaSchema.safeParse({
      ...validMeta,
      caseId: 'not-a-uuid',
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty fileName', () => {
    const result = documentUploadMetaSchema.safeParse({
      ...validMeta,
      fileName: '',
    })
    expect(result.success).toBe(false)
  })

  it('rejects file size exceeding 50MB', () => {
    const result = documentUploadMetaSchema.safeParse({
      ...validMeta,
      fileSize: MAX_FILE_SIZE + 1,
    })
    expect(result.success).toBe(false)
  })

  it('rejects zero file size', () => {
    const result = documentUploadMetaSchema.safeParse({
      ...validMeta,
      fileSize: 0,
    })
    expect(result.success).toBe(false)
  })

  it('rejects disallowed MIME type', () => {
    const result = documentUploadMetaSchema.safeParse({
      ...validMeta,
      mimeType: 'text/plain',
    })
    expect(result.success).toBe(false)
  })
})
