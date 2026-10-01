import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockSupabase, mockTableResults } from '@/test-utils/supabase-mock'

const mocks = vi.hoisted(() => ({ info: vi.fn(), writable: vi.fn() }))
let client: ReturnType<typeof createMockSupabase>
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ ...client, storage: { from: () => ({ info: mocks.info }) } }) }))
vi.mock('@/actions/case-status', () => ({ assertCaseWritable: mocks.writable, assertCaseNotClosed: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { getUploadSession, reconcileDocumentUpload, saveDocumentMetadata } from '../documents'
import { uploadStoragePath } from '@/lib/validations/document'

const input = {
  caseId: '31940000-0000-4000-8000-000000000001', uploadId: '41940000-0000-4000-8000-000000000001',
  fileName: 'report (1).pdf', fileSize: 10, mimeType: 'application/pdf' as const, documentType: 'mri_report' as const,
}
const filePath = uploadStoragePath(input.caseId, input.uploadId, input.fileName)
const metadata = { ...input, filePath, fileSizeBytes: input.fileSize }
beforeEach(() => {
  vi.clearAllMocks()
  client = createMockSupabase()
  mockTableResults(client, { cases: { data: { id: input.caseId }, error: null }, users: { data: { is_active: true }, error: null } })
  client.rpc.mockResolvedValue({ data: [{ document_id: input.uploadId, created: false }], error: null })
  mocks.writable.mockResolvedValue({ error: null })
  mocks.info.mockResolvedValue({ data: { size: 10, contentType: 'application/pdf' }, error: null })
})
describe('upload registration', () => {
  it('reuses the exact server-derived path and passes stable identity to the transaction', async () => {
    expect((await getUploadSession(input)).data?.storagePath).toBe(filePath)
    expect((await getUploadSession(input)).data?.storagePath).toBe(filePath)
    expect(await saveDocumentMetadata(metadata)).toEqual({ data: { id: input.uploadId, created: false } })
    expect(client.rpc).toHaveBeenCalledWith('register_uploaded_document', expect.objectContaining({ p_upload_id: input.uploadId, p_file_path: filePath, p_legacy_path: false }))
    expect(client.from).not.toHaveBeenCalledWith('documents')
    expect(client.from).not.toHaveBeenCalledWith('case_status_history')
  })
  it('routes legacy timestamp paths through the same transaction', async () => {
    const result = await saveDocumentMetadata({ ...metadata, uploadId: undefined, filePath: `cases/${input.caseId}/1759276800000-report__1_.pdf` })
    expect(result.data).toBeDefined()
    expect(client.rpc).toHaveBeenCalledWith('register_uploaded_document', expect.objectContaining({ p_legacy_path: true, p_upload_id: expect.any(String) }))
  })
  it.each([
    { filePath: 'cases/other/report.pdf' }, { fileSizeBytes: 0 }, { fileSizeBytes: 1.5 },
    { mimeType: 'text/plain' }, { uploadId: 'invalid' }, { fileSizeBytes: 52428801 },
  ])('rejects invalid registration before any writes: %j', async (change) => {
    expect((await saveDocumentMetadata({ ...metadata, ...change })).error).toBeTruthy()
    expect(client.rpc).not.toHaveBeenCalled()
  })
  it('retains conflicts and locked errors', async () => {
    client.rpc.mockResolvedValue({ data: null, error: { message: 'Upload identity conflict' } })
    expect((await saveDocumentMetadata(metadata)).error).toBe('Upload identity conflict')
    mocks.writable.mockResolvedValue({ error: 'This case is locked' })
    expect((await getUploadSession(input, { allowLocked: true })).error).toBe('This case is locked')
    expect(mocks.writable).toHaveBeenLastCalledWith(expect.anything(), input.caseId, { allowLockedForAdmin: true })
  })
  it('requires authentication and an active user', async () => {
    client.auth.getUser.mockResolvedValue({ data: { user: null } })
    expect((await saveDocumentMetadata(metadata)).error).toBe('Not authenticated')
    client.auth.getUser.mockResolvedValue({ data: { user: { id: 'actor' } } })
    mockTableResults(client, { users: { data: { is_active: false }, error: null } })
    expect((await reconcileDocumentUpload({ ...input, filePath })).error).toBe('Active user required')
    expect(mocks.info).not.toHaveBeenCalled()
  })
})
describe('transfer reconciliation', () => {
  it('recognizes a completed transfer without uploading again', async () => {
    expect(await reconcileDocumentUpload({ ...input, filePath })).toEqual({ data: { state: 'present' } })
    expect(mocks.info).toHaveBeenCalledWith(filePath)
  })
  it.each([{ code: 'NoSuchKey', statusCode: '404' }, { statusCode: '404' }, { code: 'not_found', statusCode: '404' }])('permits restarting only a documented missing object: %j', async (error) => {
    mocks.info.mockResolvedValue({ data: null, error })
    expect((await reconcileDocumentUpload({ ...input, filePath })).data?.state).toBe('missing')
  })
  it.each([
    { data: null, error: { statusCode: '403' } }, { data: null, error: { code: 'NoSuchBucket', statusCode: '404' } },
    { data: {}, error: null }, { data: { size: 20, contentType: 'application/pdf' }, error: null },
    { data: { size: 10, contentType: 'image/png' }, error: null },
  ])('retains uncertainty or conflict without allocating another path: %j', async (response) => {
    mocks.info.mockResolvedValue(response)
    expect((await reconcileDocumentUpload({ ...input, filePath })).error).toBeTruthy()
    expect(client.rpc).not.toHaveBeenCalled()
  })
  it('catches rejected storage calls', async () => {
    mocks.info.mockRejectedValue(new Error('offline'))
    expect((await reconcileDocumentUpload({ ...input, filePath })).error).toContain('Unable to confirm')
  })
})
