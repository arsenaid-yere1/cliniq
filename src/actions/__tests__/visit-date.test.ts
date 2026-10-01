import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockSupabase } from '@/test-utils/supabase-mock'
import { savePreGenerationVisitDate } from '../visit-date'

let client: ReturnType<typeof createMockSupabase>
const scopeError = vi.hoisted(() => ({ value: undefined as string | undefined }))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => client }))
vi.mock('@/lib/clinical/evaluation-scope', () => ({ resolveEvaluationEpisode: async () => ({ error: scopeError.value }) }))
vi.mock('@/lib/clinical/discharge-scope', () => ({ resolveDischargeScope: async () => ({ error: scopeError.value }) }))
vi.mock('@/lib/clinical/revalidate-visit-views', () => ({ revalidateVisitViews: vi.fn() }))
const input = {
  caseId: '11930000-0000-4000-8000-000000000001', episodeId: '21930000-0000-4000-8000-000000000001',
  kind: 'initial_visit' as const, visitDate: '2026-09-01', expectedNoteId: null, expectedDate: null,
}
const token = { noteId: '31930000-0000-4000-8000-000000000001', visitDate: input.visitDate, updatedAt: '2026-09-30T00:00:00Z' }
beforeEach(() => { client = createMockSupabase(); scopeError.value = undefined })
describe('savePreGenerationVisitDate', () => {
  it('rejects invalid calendar dates before contacting the database', async () => {
    expect(await savePreGenerationVisitDate({ ...input, visitDate: '2026-02-30' })).toMatchObject({ code: 'invalid_date' })
    expect(client.auth.getUser).not.toHaveBeenCalled()
  })
  it('saves an explicitly scoped date with the original observed token', async () => {
    client.rpc.mockResolvedValue({ data: { data: token }, error: null })
    expect(await savePreGenerationVisitDate(input)).toEqual({ data: token })
    expect(client.rpc).toHaveBeenCalledWith('save_pre_generation_visit_date', {
      p_case_id: input.caseId, p_episode_id: input.episodeId, p_kind: input.kind, p_date: input.visitDate,
      p_expected_note_id: null, p_expected_date: null,
    })
  })
  it('returns a canonical conflict without retrying another editor’s date', async () => {
    client.rpc.mockResolvedValue({ data: { conflict: token }, error: null })
    expect(await savePreGenerationVisitDate(input)).toMatchObject({ code: 'conflict', conflict: token })
    expect(client.rpc).toHaveBeenCalledTimes(1)
  })
  it('retries only one transient transaction failure, preserving the token', async () => {
    client.rpc.mockResolvedValueOnce({ data: null, error: { code: '40P01' } })
      .mockResolvedValueOnce({ data: { data: token }, error: null })
    expect(await savePreGenerationVisitDate(input)).toEqual({ data: token })
    expect(client.rpc.mock.calls[0]).toEqual(client.rpc.mock.calls[1])
  })
  it('does not loop on repeated transaction failures', async () => {
    client.rpc.mockResolvedValue({ data: null, error: { code: '40001' } })
    expect(await savePreGenerationVisitDate(input)).toMatchObject({ code: 'save_failed' })
    expect(client.rpc).toHaveBeenCalledTimes(2)
  })
  it.each(['23514', '22007'])('maps date constraint %s to a field error', async code => {
    client.rpc.mockResolvedValue({ data: null, error: { code, message: 'Date ordering failed' } })
    expect(await savePreGenerationVisitDate(input)).toEqual({ code: 'invalid_date', error: 'Date ordering failed' })
  })
  it('rejects unwritable scopes without invoking persistence', async () => {
    scopeError.value = 'Case is locked'
    expect(await savePreGenerationVisitDate(input)).toEqual({ code: 'locked', error: 'Case is locked' })
    expect(client.rpc).not.toHaveBeenCalled()
  })
  it('does not report a transport exception as a successful save', async () => {
    client.rpc.mockRejectedValue(new Error('private database detail'))
    const result = await savePreGenerationVisitDate(input)
    expect(result).toMatchObject({ code: 'save_failed' })
    expect(result.error).not.toContain('private database detail')
  })
})
