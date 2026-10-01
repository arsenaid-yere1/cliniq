import { describe, expect, it } from 'vitest'
import { isUploadBusy, transitionUpload, type UploadEntry } from '../upload-state'
const file = {} as File
const staged: UploadEntry = { uploadId: 'one', file, documentType: 'mri_report', phase: 'staged', progress: 0 }
describe('upload queue transitions', () => {
  it('retains identity through transfer and registration recovery', () => {
    const preparing = transitionUpload(staged, { ...staged, phase: 'preparing' })
    expect(isUploadBusy(preparing)).toBe(true)
    const failed = transitionUpload(preparing, { ...preparing, phase: 'transfer_failed', storagePath: 'path', error: 'offline' })
    const retry = transitionUpload(failed, { ...failed, phase: 'preparing' })
    const registering = transitionUpload(retry, { ...retry, phase: 'registering', progress: 100, storagePath: 'path' })
    const metadataFailed = transitionUpload(registering, { ...registering, phase: 'registration_failed', error: 'offline' })
    expect(isUploadBusy(metadataFailed)).toBe(false)
    expect(transitionUpload(metadataFailed, { ...registering })).toEqual(registering)
  })
  it('rejects identity/type/path mutation and re-upload after registration', () => {
    expect(() => transitionUpload(staged, { ...staged, phase: 'preparing', documentType: 'other' })).toThrow()
    expect(() => transitionUpload(staged, { ...staged, phase: 'preparing', uploadId: 'two' })).toThrow()
    const failed: UploadEntry = { ...staged, phase: 'registration_failed', progress: 100, storagePath: 'path', error: 'offline' }
    expect(() => transitionUpload(failed, { ...failed, phase: 'uploading' })).toThrow()
    expect(() => transitionUpload(failed, { ...failed, phase: 'registering', storagePath: 'other' })).toThrow()
  })
})
