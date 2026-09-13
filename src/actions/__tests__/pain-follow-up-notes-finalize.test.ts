import { followUpReviewFixture } from '@/test-utils/follow-up-source'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMockQueryBuilder,
  createMockSupabase,
  type MockSupabaseClient,
} from '@/test-utils/supabase-mock'

const CASE_ID = '10000000-0000-4000-8000-000000000001'
const ENCOUNTER_ID = '20000000-0000-4000-8000-000000000001'
const EPISODE_ID = '30000000-0000-4000-8000-000000000001'
const NOTE_ID = '40000000-0000-4000-8000-000000000001'
const DOCUMENT_ID = '50000000-0000-4000-8000-000000000001'
const UPDATED_AT = '2026-09-03T12:00:00.000Z'

let mockSupabase: MockSupabaseClient & {
  storage: { from: ReturnType<typeof vi.fn> }
}
let noteBuilder: ReturnType<typeof createMockQueryBuilder>
let documentBuilder: ReturnType<typeof createMockQueryBuilder>
const upload = vi.fn()
const remove = vi.fn()

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(() => mockSupabase) }))
vi.mock('@/lib/features/return-tele-visits', () => ({
  requireReturnTeleVisitsMutation: vi.fn(() => null),
}))
vi.mock('@/lib/pdf/render-pain-follow-up-pdf', () => ({
  renderPainFollowUpPdf: vi.fn(async () => Buffer.from('follow-up pdf')),
}))

import { renderPainFollowUpPdf } from '@/lib/pdf/render-pain-follow-up-pdf'
import { revalidatePath } from 'next/cache'
import { finalizePainFollowUpNote } from '../pain-follow-up-notes'

function configureNote(status = 'draft') {
  noteBuilder = createMockQueryBuilder({
    data: {
      id: NOTE_ID,
      case_id: CASE_ID,
      episode_id: EPISODE_ID,
      encounter_id: ENCOUNTER_ID,
      status,
      updated_at: UPDATED_AT,
      document_id: status === 'finalized' ? DOCUMENT_ID : null,
      procedure_recommendations: [],
    },
    error: null,
  })
  documentBuilder = createMockQueryBuilder({ data: { id: DOCUMENT_ID }, error: null })
  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'pain_follow_up_notes') return noteBuilder
    if (table === 'documents') return documentBuilder
    return createMockQueryBuilder()
  })
}

function finalizationResult(result: unknown) {
  mockSupabase.rpc.mockImplementation((_name: string, args: { p_action: string }) => Promise.resolve(
    args.p_action === 'read' ? { data: followUpReviewFixture(UPDATED_AT, ENCOUNTER_ID), error: null } : result,
  ))
}

describe('finalizePainFollowUpNote', () => {
  beforeEach(() => {
    const base = createMockSupabase()
    mockSupabase = Object.assign(base, {
      storage: { from: vi.fn(() => ({ upload, remove })) },
    })
    upload.mockResolvedValue({ error: null })
    remove.mockResolvedValue({ error: null })
    configureNote()
    vi.clearAllMocks()
    finalizationResult({ data: null, error: null })
  })

  it('does not render or sign an intervening edit after explicit Save', async () => {
    expect(await finalizePainFollowUpNote(CASE_ID, ENCOUNTER_ID, 'older-version')).toEqual({ error: 'The note changed after saving. Review it before finalizing.' })
    expect(upload).not.toHaveBeenCalled()
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it('passes the rendered note version to finalization', async () => {
    finalizationResult({ data: null, error: null })

    await expect(finalizePainFollowUpNote(CASE_ID, ENCOUNTER_ID)).resolves.toEqual({
      data: { success: true },
    })
    expect(mockSupabase.rpc).toHaveBeenCalledWith('follow_up_review', {
      p_action: 'finalize',
      p_proposal_id: null,
      p_payload: { document_id: DOCUMENT_ID, source_fingerprint: 'current-source' },
      p_case_id: CASE_ID,
      p_encounter_id: ENCOUNTER_ID,
      p_expected_updated_at: UPDATED_AT,
    })
    expect(revalidatePath).toHaveBeenCalledWith(`/patients/${CASE_ID}/documents`)
    expect(renderPainFollowUpPdf).toHaveBeenCalledWith(CASE_ID, ENCOUNTER_ID, expect.objectContaining({ updated_at: UPDATED_AT }), followUpReviewFixture(UPDATED_AT, ENCOUNTER_ID).snapshot)
  })

  it('keeps the existing action-level replay for finalized notes', async () => {
    configureNote('finalized')

    await expect(finalizePainFollowUpNote(CASE_ID, ENCOUNTER_ID)).resolves.toEqual({
      data: { success: true, replayed: true },
    })
    expect(upload).not.toHaveBeenCalled()
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it('cleans up a stale or competing finalization and returns a review message', async () => {
    finalizationResult({
      data: null,
      error: { message: 'Follow-up note changed; review and finalize again' },
    })

    await expect(finalizePainFollowUpNote(CASE_ID, ENCOUNTER_ID)).resolves.toEqual({
      error: 'The follow-up note changed. Review it and try finalizing again.',
    })
    expect(remove).toHaveBeenCalledOnce()
    expect(documentBuilder.update).toHaveBeenCalledWith(expect.objectContaining({
      deleted_at: expect.any(String),
      updated_by_user_id: 'test-user-id',
    }))
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('retains cleanup and a generic error for unexpected RPC failures', async () => {
    finalizationResult({
      data: null,
      error: { message: 'database internals' },
    })

    await expect(finalizePainFollowUpNote(CASE_ID, ENCOUNTER_ID)).resolves.toEqual({
      error: 'Unable to finalize follow-up note',
    })
    expect(remove).toHaveBeenCalledOnce()
    expect(documentBuilder.update).toHaveBeenCalledOnce()
  })
  it('preserves the file when cleanup cannot confirm the document is unreferenced', async () => {
    finalizationResult({ data: null, error: { message: 'response lost' } })
    documentBuilder.single
      .mockResolvedValueOnce({ data: { id: DOCUMENT_ID }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'Signed revision documents are retained' } })
    await finalizePainFollowUpNote(CASE_ID, ENCOUNTER_ID)
    expect(documentBuilder.update).toHaveBeenCalledOnce()
    expect(remove).not.toHaveBeenCalled()
  })


it('rejects unreviewed sources before rendering or uploading', async () => {
  mockSupabase.rpc.mockResolvedValue({ data: { ...followUpReviewFixture(UPDATED_AT, ENCOUNTER_ID), reviewed: false, freshness: 'changed' }, error: null })
  expect(await finalizePainFollowUpNote(CASE_ID, ENCOUNTER_ID)).toEqual({ error: 'Review the saved note against current visit information before signing.' })
  expect(upload).not.toHaveBeenCalled()
})

})
