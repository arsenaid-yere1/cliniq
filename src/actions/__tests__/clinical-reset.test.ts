import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockSupabase } from '@/test-utils/supabase-mock'
import type { ClinicalResetRequest } from '@/lib/validations/clinical-reset'
let supabase: ReturnType<typeof createMockSupabase>
vi.mock('@/lib/supabase/server', () => ({ createClient: () => supabase }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/features/return-tele-visits', () => ({ requireReturnTeleVisitsMutation: vi.fn(() => null) }))
import { applyClinicalReset, previewClinicalReset } from '../clinical-reset'
import { requireReturnTeleVisitsMutation } from '@/lib/features/return-tele-visits'
import { revalidatePath } from 'next/cache'
const request: ClinicalResetRequest = {
  case_id: '10000000-0000-4000-8000-000000000001', episode_id: '20000000-0000-4000-8000-000000000001',
  case_version: '2026-09-08T00:00:00Z', episode_version: '2026-09-08T00:00:00Z',
  reactivate: true, reason: 'Fresh start requested', request_key: '30000000-0000-4000-8000-000000000001', notes: [],
}

describe('clinical reset actions', () => {
  beforeEach(() => { supabase = createMockSupabase(); vi.clearAllMocks(); vi.mocked(requireReturnTeleVisitsMutation).mockReturnValue(null) })
  it('submits reactivation without selecting any notes and refreshes all case routes', async () => {
    supabase.rpc.mockResolvedValue({ data: 'operation-id', error: null })
    expect(await applyClinicalReset(request)).toEqual({ data: { operationId: 'operation-id' } })
    expect(supabase.rpc).toHaveBeenCalledWith('apply_clinical_reset', { p_request: request })
    expect(revalidatePath).toHaveBeenCalledWith(`/patients/${request.case_id}`, 'layout')
  })
  it('rejects invalid and duplicate selections before database access', async () => {
    const note = { kind: 'discharge_notes' as const, id: request.case_id, updated_at: request.case_version }
    expect(await applyClinicalReset({ ...request, notes: [note, note] })).toHaveProperty('error', 'Duplicate note selection')
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
  it('does not bypass the follow-up feature flag through bulk reset', async () => {
    vi.mocked(requireReturnTeleVisitsMutation).mockReturnValue({ error: 'Disabled' })
    expect(await applyClinicalReset({ ...request, notes: [{ kind: 'pain_follow_up_notes', id: request.case_id, updated_at: request.case_version }] })).toEqual({ error: 'Disabled' })
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
  it.each([
    [{ code: '40P01', message: 'deadlock internals' }, 'The case changed. Refresh and try again.'],
    [{ code: 'P0001', message: 'Resolve billing claims and procedure orders before resetting this note' }, 'Resolve billing claims and procedure orders before resetting this note'],
    [{ code: 'XX000', message: 'sensitive internals' }, 'Unable to reset clinical records. Refresh and try again.'],
  ])('maps transaction failure without refreshing completed state', async (error, message) => {
    supabase.rpc.mockResolvedValue({ data: null, error })
    expect(await applyClinicalReset(request)).toEqual({ error: message })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
  it('preserves the explicit episode in the preview', async () => {
    supabase.rpc.mockResolvedValue({ data: { episode_id: request.episode_id }, error: null })
    await previewClinicalReset(request.case_id, request.episode_id)
    expect(supabase.rpc).toHaveBeenCalledWith('preview_clinical_reset', { p_case_id: request.case_id, p_episode_id: request.episode_id })
  })
})
