import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMockQueryBuilder,
  createMockSupabase,
  type MockSupabaseClient,
} from '@/test-utils/supabase-mock'

const CASE_ID = '10000000-0000-4000-8000-000000000001'
const NOTE_ID = '20000000-0000-4000-8000-000000000001'
const ENCOUNTER_ID = '30000000-0000-4000-8000-000000000001'
const DOCUMENT_ID = '40000000-0000-4000-8000-000000000001'
const FILE_PATH = 'cases/test/follow-up.pdf'

let mockSupabase: MockSupabaseClient & {
  storage: { from: ReturnType<typeof vi.fn> }
}
let noteBuilder: ReturnType<typeof createMockQueryBuilder>
const remove = vi.fn()

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(() => mockSupabase) }))
vi.mock('@/lib/features/return-tele-visits', () => ({
  requireReturnTeleVisitsMutation: vi.fn(() => null),
}))

import { revalidatePath } from 'next/cache'
import { requireReturnTeleVisitsMutation } from '@/lib/features/return-tele-visits'
import { unfinalizePainFollowUpNote } from '../pain-follow-up-notes'

describe('unfinalizePainFollowUpNote', () => {
  beforeEach(() => {
    const base = createMockSupabase()
    mockSupabase = Object.assign(base, {
      storage: { from: vi.fn(() => ({ remove })) },
    })
    noteBuilder = createMockQueryBuilder({
      data: {
        document_id: DOCUMENT_ID,
        document: { file_path: FILE_PATH },
      },
      error: null,
    })
    mockSupabase.from.mockReturnValue(noteBuilder)
    mockSupabase.rpc.mockResolvedValue({ data: ENCOUNTER_ID, error: null })
    remove.mockResolvedValue({ error: null })
    vi.mocked(requireReturnTeleVisitsMutation).mockReturnValue(null)
    vi.clearAllMocks()
  })

  it('returns before database access when return visits are disabled', async () => {
    vi.mocked(requireReturnTeleVisitsMutation).mockReturnValueOnce({ error: 'Disabled' })

    await expect(unfinalizePainFollowUpNote(CASE_ID, NOTE_ID)).resolves.toEqual({ error: 'Disabled' })
    expect(mockSupabase.auth.getUser).not.toHaveBeenCalled()
  })

  it('requires an authenticated user', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null })

    await expect(unfinalizePainFollowUpNote(CASE_ID, NOTE_ID)).resolves.toEqual({
      error: 'Not authenticated',
    })
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it('reopens the note, then removes storage and revalidates affected routes', async () => {
    await expect(unfinalizePainFollowUpNote(CASE_ID, NOTE_ID)).resolves.toEqual({
      data: { encounterId: ENCOUNTER_ID },
    })
    expect(noteBuilder.select).toHaveBeenCalledWith('document_id,document:documents(file_path)')
    expect(mockSupabase.rpc).toHaveBeenCalledWith('unfinalize_pain_follow_up', {
      p_case_id: CASE_ID,
      p_note_id: NOTE_ID,
    })
    expect(remove).toHaveBeenCalledWith([FILE_PATH])
    expect(revalidatePath).toHaveBeenCalledWith(`/patients/${CASE_ID}/visits`)
    expect(revalidatePath).toHaveBeenCalledWith(`/patients/${CASE_ID}/visits/${ENCOUNTER_ID}`)
    expect(revalidatePath).toHaveBeenCalledWith(`/patients/${CASE_ID}/documents`)
    expect(revalidatePath).toHaveBeenCalledWith(`/patients/${CASE_ID}/timeline`)
  })

  it.each([
    [
      'Remove procedure orders and billing claims before reopening this note',
      'Remove procedure orders and billing claims before reopening this note',
    ],
    ['Finalized note is not writable', 'This finalized follow-up note can no longer be reopened'],
    ['database internals', 'Unable to reopen note'],
  ])('maps RPC failure %s without deleting storage', async (message, expected) => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: { message } })

    await expect(unfinalizePainFollowUpNote(CASE_ID, NOTE_ID)).resolves.toEqual({ error: expected })
    expect(remove).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('keeps the committed reopen successful when storage cleanup fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    remove.mockResolvedValueOnce({ error: { message: 'storage unavailable' } })

    await expect(unfinalizePainFollowUpNote(CASE_ID, NOTE_ID)).resolves.toEqual({
      data: { encounterId: ENCOUNTER_ID },
    })
    expect(consoleError).toHaveBeenCalledWith(
      'Unable to remove unfinalized follow-up PDF from storage',
      { documentId: DOCUMENT_ID },
    )
    consoleError.mockRestore()
  })
})
