import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockSupabase, type MockSupabaseClient } from '@/test-utils/supabase-mock'

const CASE_ID = '10000000-0000-4000-8000-000000000001'
const ENCOUNTER_ID = '20000000-0000-4000-8000-000000000001'
const NOTE_ID = '30000000-0000-4000-8000-000000000001'

let mockSupabase: MockSupabaseClient

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(() => mockSupabase) }))
vi.mock('@/lib/features/return-tele-visits', () => ({
  requireReturnTeleVisitsMutation: vi.fn(() => null),
}))

import { revalidatePath } from 'next/cache'
import { requireReturnTeleVisitsMutation } from '@/lib/features/return-tele-visits'
import { resetPainFollowUpNote } from '../pain-follow-up-notes'

describe('resetPainFollowUpNote', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
    vi.mocked(requireReturnTeleVisitsMutation).mockReturnValue(null)
    vi.clearAllMocks()
  })

  it('returns before database access when return visits are disabled', async () => {
    vi.mocked(requireReturnTeleVisitsMutation).mockReturnValueOnce({ error: 'Disabled' })

    await expect(resetPainFollowUpNote(CASE_ID, ENCOUNTER_ID)).resolves.toEqual({ error: 'Disabled' })
    expect(mockSupabase.auth.getUser).not.toHaveBeenCalled()
  })

  it('requires an authenticated user', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    })

    await expect(resetPainFollowUpNote(CASE_ID, ENCOUNTER_ID)).resolves.toEqual({
      error: 'Not authenticated',
    })
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it('calls the reset RPC and revalidates the encounter route', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: NOTE_ID, error: null })

    await expect(resetPainFollowUpNote(CASE_ID, ENCOUNTER_ID)).resolves.toEqual({
      data: { success: true, noteId: NOTE_ID },
    })
    expect(mockSupabase.rpc).toHaveBeenCalledWith('reset_pain_follow_up', {
      p_case_id: CASE_ID,
      p_encounter_id: ENCOUNTER_ID,
    })
    expect(revalidatePath).toHaveBeenCalledWith(`/patients/${CASE_ID}/visits/${ENCOUNTER_ID}`)
  })

  it.each([
    ['Follow-up note not found', 'No follow-up note to reset'],
    ['Only draft or failed follow-up notes can be reset', 'Only draft or failed follow-up notes can be reset'],
    ['Care episode is not writable', 'This visit is no longer writable'],
  ])('maps expected RPC error %s', async (message, expected) => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: { message } })

    await expect(resetPainFollowUpNote(CASE_ID, ENCOUNTER_ID)).resolves.toEqual({ error: expected })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('does not expose unexpected RPC details', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'sensitive database details' },
    })

    await expect(resetPainFollowUpNote(CASE_ID, ENCOUNTER_ID)).resolves.toEqual({
      error: 'Unable to reset follow-up note',
    })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
