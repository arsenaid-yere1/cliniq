import { describe, it, expect, vi, beforeEach } from 'vitest'
import { acquireGenerationLock } from '@/lib/supabase/generation-lock'

/**
 * Minimal Supabase client mock matching the call chain used by
 * acquireGenerationLock:
 *   supabase.from(table).update(payload).eq(...).in(...).select(...).maybeSingle()
 * or
 *   supabase.from(table).update(payload).eq(...).eq(...).lt(...).select(...).maybeSingle()
 *
 * Each update() call returns a fresh builder that records the chain and
 * resolves to the queued response.
 */
type Resp = { data: { id: string } | null; error: { code?: string; message: string } | null }

function makeBuilder(resp: Resp) {
  const builder: Record<string, unknown> = {}
  const chain = ['update', 'eq', 'in', 'lt', 'select']
  for (const fn of chain) {
    builder[fn] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(async () => resp)
  return builder
}

function makeClient(responses: Resp[]) {
  let i = 0
  return {
    from: vi.fn(() => {
      const resp = responses[i++] ?? { data: null, error: null }
      return makeBuilder(resp)
    }),
  }
}

describe('acquireGenerationLock', () => {
  beforeEach(() => vi.clearAllMocks())

  it('acquires the lock when the row is in draft state', async () => {
    const supabase = makeClient([{ data: { id: 'rec1' }, error: null }])
    const result = await acquireGenerationLock(
      supabase as never,
      'procedure_notes',
      'rec1',
      'user1',
    )
    expect(result).toEqual({ acquired: true })
    expect(supabase.from).toHaveBeenCalledTimes(1)
    expect(supabase.from).toHaveBeenCalledWith('procedure_notes')
  })

  it('acquires the lock when the row is in failed state', async () => {
    // The single draft-or-failed query returns a row regardless of which of
    // the two statuses matched.
    const supabase = makeClient([{ data: { id: 'rec1' }, error: null }])
    const result = await acquireGenerationLock(
      supabase as never,
      'initial_visit_notes',
      'rec1',
      'user1',
    )
    expect(result).toEqual({ acquired: true })
  })

  it('acquires the lock via stale recovery when draft/failed query returns nothing', async () => {
    const supabase = makeClient([
      { data: null, error: null },          // draft/failed attempt: no match
      { data: { id: 'rec1' }, error: null }, // stale recovery attempt: match
    ])
    const result = await acquireGenerationLock(
      supabase as never,
      'discharge_notes',
      'rec1',
      'user1',
    )
    expect(result).toEqual({ acquired: true })
    expect(supabase.from).toHaveBeenCalledTimes(2)
  })

  it('rejects when row is generating and not stale', async () => {
    const supabase = makeClient([
      { data: null, error: null }, // no draft/failed match
      { data: null, error: null }, // no stale match either → in-flight, recent
    ])
    const result = await acquireGenerationLock(
      supabase as never,
      'procedure_notes',
      'rec1',
      'user1',
    )
    expect(result.acquired).toBe(false)
    if (!result.acquired) {
      expect(result.reason).toContain('Generation already in progress')
    }
  })

  it('rejects on DB error during draft/failed acquisition', async () => {
    const supabase = makeClient([
      { data: null, error: { message: 'connection lost' } },
    ])
    const result = await acquireGenerationLock(
      supabase as never,
      'case_summaries',
      'rec1',
      'user1',
    )
    expect(result.acquired).toBe(false)
    if (!result.acquired) {
      expect(result.reason).toContain('Database error')
    }
  })

  it('rejects on DB error during stale recovery', async () => {
    const supabase = makeClient([
      { data: null, error: null },
      { data: null, error: { message: 'timeout' } },
    ])
    const result = await acquireGenerationLock(
      supabase as never,
      'procedure_notes',
      'rec1',
      'user1',
    )
    expect(result.acquired).toBe(false)
    if (!result.acquired) {
      expect(result.reason).toContain('Database error')
    }
  })
})
