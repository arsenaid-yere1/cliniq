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
  })

  it('passes the rendered note version to finalization', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null })

    await expect(finalizePainFollowUpNote(CASE_ID, ENCOUNTER_ID)).resolves.toEqual({
      data: { success: true },
    })
    expect(mockSupabase.rpc).toHaveBeenCalledWith('finalize_pain_follow_up', {
      p_case_id: CASE_ID,
      p_encounter_id: ENCOUNTER_ID,
      p_note_id: NOTE_ID,
      p_document_id: DOCUMENT_ID,
      p_expected_updated_at: UPDATED_AT,
    })
    expect(revalidatePath).toHaveBeenCalledWith(`/patients/${CASE_ID}/documents`)
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
    mockSupabase.rpc.mockResolvedValueOnce({
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
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'database internals' },
    })

    await expect(finalizePainFollowUpNote(CASE_ID, ENCOUNTER_ID)).resolves.toEqual({
      error: 'Unable to finalize follow-up note',
    })
    expect(remove).toHaveBeenCalledOnce()
    expect(documentBuilder.update).toHaveBeenCalledOnce()
  })
})
