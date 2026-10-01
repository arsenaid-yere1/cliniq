import type { DocumentType } from '@/lib/validations/document'

interface UploadDescriptor {
  uploadId: string
  file: File
  documentType: DocumentType
}

export type UploadEntry = UploadDescriptor & (
  | { phase: 'staged'; progress: 0 }
  | { phase: 'preparing'; progress: number; storagePath?: string }
  | { phase: 'uploading'; progress: number; storagePath: string }
  | { phase: 'transfer_failed'; progress: number; storagePath?: string; error: string }
  | { phase: 'registering'; progress: 100; storagePath: string }
  | { phase: 'registration_failed'; progress: 100; storagePath: string; error: string }
  | { phase: 'uploaded'; progress: 100; storagePath: string; documentId: string }
)

const transitions: Record<UploadEntry['phase'], UploadEntry['phase'][]> = {
  staged: ['preparing'],
  preparing: ['uploading', 'registering', 'transfer_failed'],
  uploading: ['uploading', 'registering', 'transfer_failed'],
  transfer_failed: ['preparing'],
  registering: ['uploaded', 'registration_failed'],
  registration_failed: ['registering'],
  uploaded: [],
}

export function transitionUpload<T extends UploadEntry>(current: UploadEntry, next: T): T {
  if (current.uploadId !== next.uploadId || current.file !== next.file
    || current.documentType !== next.documentType || !transitions[current.phase].includes(next.phase)) {
    throw new Error('Invalid upload transition')
  }
  if ('storagePath' in current && current.storagePath
    && (!('storagePath' in next) || current.storagePath !== next.storagePath)) {
    throw new Error('Upload path cannot change')
  }
  return next
}

export function isUploadBusy(entry: UploadEntry) {
  return ['preparing', 'uploading', 'registering'].includes(entry.phase)
}
