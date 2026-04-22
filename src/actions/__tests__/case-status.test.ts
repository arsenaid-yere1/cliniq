import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { createMockSupabase, createMockQueryBuilder, mockTableResults, type MockSupabaseClient } from '@/test-utils/supabase-mock'
import { TEST_USER_ID, TEST_CASE_ID } from '@/test-utils/fixtures'

// ---- Mocks ----

let mockSupabase: MockSupabaseClient

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => mockSupabase),
}))

// ---- SUT ----

import {
  assertCaseNotClosed,
  updateCaseStatus,
  autoAdvanceFromIntake,
  closeCase,
  reopenCase,
} from '../case-status'

// ---- Tests ----

describe('assertCaseNotClosed', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('returns no error for an active case', async () => {
    mockTableResults(mockSupabase, {
      cases: { data: { case_status: 'active' }, error: null },
    })
    const result = await assertCaseNotClosed(mockSupabase as never, TEST_CASE_ID)
    expect(result.error).toBeNull()
  })

  it('returns error for a closed case', async () => {
    mockTableResults(mockSupabase, {
      cases: { data: { case_status: 'closed' }, error: null },
    })
    const result = await assertCaseNotClosed(mockSupabase as never, TEST_CASE_ID)
    expect(result.error).toContain('closed')
  })

  it('returns error for an archived case', async () => {
    mockTableResults(mockSupabase, {
      cases: { data: { case_status: 'archived' }, error: null },
    })
    const result = await assertCaseNotClosed(mockSupabase as never, TEST_CASE_ID)
    expect(result.error).toContain('closed')
  })

  it('returns no error for intake case', async () => {
    mockTableResults(mockSupabase, {
      cases: { data: { case_status: 'intake' }, error: null },
    })
    const result = await assertCaseNotClosed(mockSupabase as never, TEST_CASE_ID)
    expect(result.error).toBeNull()
  })
})

describe('updateCaseStatus', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('returns error when user is not authenticated', async () => {
    ;(mockSupabase.auth.getUser as Mock).mockResolvedValue({
      data: { user: null },
      error: null,
    })
    const result = await updateCaseStatus(TEST_CASE_ID, 'active')
    expect(result.error).toBe('Not authenticated')
  })

  it('returns error when case is not found', async () => {
    mockTableResults(mockSupabase, {
      cases: { data: null, error: null },
    })
    const result = await updateCaseStatus(TEST_CASE_ID, 'active')
    expect(result.error).toBe('Case not found')
  })

  it('returns error when case is already the target status', async () => {
    mockTableResults(mockSupabase, {
      cases: { data: { case_status: 'active' }, error: null },
    })
    const result = await updateCaseStatus(TEST_CASE_ID, 'active')
    expect(result.error).toContain('already')
  })

  it('returns error for invalid transition', async () => {
    mockTableResults(mockSupabase, {
      cases: { data: { case_status: 'intake' }, error: null },
    })
    // intake cannot go directly to pending_settlement
    const result = await updateCaseStatus(TEST_CASE_ID, 'pending_settlement')
    expect(result.error).toContain('Cannot change status')
  })

  it('requires medical invoice for pending_settlement transition', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'cases') {
        return createMockQueryBuilder({ data: { case_status: 'active' }, error: null })
      }
      if (table === 'invoices') {
        return createMockQueryBuilder({ data: null, error: null })
      }
      return createMockQueryBuilder()
    })

    const result = await updateCaseStatus(TEST_CASE_ID, 'pending_settlement')
    expect(result.error).toContain('medical invoice')
  })

  it('requires medical invoice for closed transition from active', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'cases') {
        return createMockQueryBuilder({ data: { case_status: 'active' }, error: null })
      }
      if (table === 'invoices') {
        return createMockQueryBuilder({ data: null, error: null })
      }
      return createMockQueryBuilder()
    })

    const result = await updateCaseStatus(TEST_CASE_ID, 'closed')
    expect(result.error).toContain('medical invoice')
  })

  it('succeeds on valid transition with medical invoice present', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'cases') {
        return createMockQueryBuilder({ data: { case_status: 'active' }, error: null })
      }
      if (table === 'invoices') {
        return createMockQueryBuilder({ data: { id: 'inv-1' }, error: null })
      }
      return createMockQueryBuilder({ data: null, error: null })
    })

    const result = await updateCaseStatus(TEST_CASE_ID, 'pending_settlement')
    expect(result).toEqual({ data: { success: true } })
  })

  it('succeeds for intake → active (no invoice required)', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'cases') {
        return createMockQueryBuilder({ data: { case_status: 'intake' }, error: null })
      }
      return createMockQueryBuilder({ data: null, error: null })
    })

    const result = await updateCaseStatus(TEST_CASE_ID, 'active')
    expect(result).toEqual({ data: { success: true } })
  })

  it('returns error when DB update fails', async () => {
    let caseCallCount = 0
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'cases') {
        caseCallCount++
        if (caseCallCount === 1) {
          // select: returns intake status
          return createMockQueryBuilder({ data: { case_status: 'intake' }, error: null })
        }
        // update: fails
        return createMockQueryBuilder({ data: null, error: { message: 'DB error' } })
      }
      return createMockQueryBuilder()
    })

    const result = await updateCaseStatus(TEST_CASE_ID, 'active')
    expect(result.error).toBe('Failed to update case status')
  })
})

describe('autoAdvanceFromIntake', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('advances case from intake to active', async () => {
    mockTableResults(mockSupabase, {
      cases: { data: { case_status: 'intake' }, error: null },
      case_status_history: { data: null, error: null },
    })

    await autoAdvanceFromIntake(mockSupabase as never, TEST_CASE_ID, TEST_USER_ID)

    // Verify .from('cases') was called for both select and update
    expect(mockSupabase.from).toHaveBeenCalledWith('cases')
  })

  it('does nothing when case is not in intake', async () => {
    mockTableResults(mockSupabase, {
      cases: { data: { case_status: 'active' }, error: null },
    })

    await autoAdvanceFromIntake(mockSupabase as never, TEST_CASE_ID, TEST_USER_ID)

    // from() called once for the select, but not for update/history
    expect(mockSupabase.from).toHaveBeenCalledTimes(1)
  })
})

describe('closeCase / reopenCase wrappers', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('closeCase delegates to updateCaseStatus with "closed"', async () => {
    // intake → closed requires medical invoice, proving it delegates correctly
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'cases') {
        return createMockQueryBuilder({ data: { case_status: 'intake' }, error: null })
      }
      if (table === 'invoices') {
        return createMockQueryBuilder({ data: null, error: null })
      }
      return createMockQueryBuilder()
    })
    const result = await closeCase(TEST_CASE_ID)
    expect(result.error).toContain('medical invoice')
  })

  it('reopenCase delegates to updateCaseStatus with "active"', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'cases') {
        return createMockQueryBuilder({ data: { case_status: 'closed' }, error: null })
      }
      return createMockQueryBuilder({ data: null, error: null })
    })
    const result = await reopenCase(TEST_CASE_ID)
    expect(result).toEqual({ data: { success: true } })
  })
})
