import { describe, expect, it, vi } from 'vitest'
const createClient = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/features/return-tele-visits', () => ({ requireReturnTeleVisitsMutation: vi.fn() }))
const CASE = '10000000-0000-4000-8000-000000000001'
const NOTE = '20000000-0000-4000-8000-000000000001'

describe('legacy unsigned revision entry points', () => {
  it.each(['initial', 'procedure', 'follow-up'])('rejects %s unfinalize without touching the signed PDF', async kind => {
    const result = kind === 'initial'
      ? await (await import('../initial-visit-notes')).unfinalizeInitialVisitNote(CASE, 'initial_visit')
      : kind === 'procedure'
        ? await (await import('../procedure-notes')).unfinalizeProcedureNote(NOTE, CASE)
        : await (await import('../pain-follow-up-notes')).unfinalizePainFollowUpNote(CASE, NOTE)
    expect(result.error).toContain('audited Edit control')
    expect(createClient).not.toHaveBeenCalled()
  })
})
