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

const mockGetCurrentUserWithRole = vi.fn()
vi.mock('@/lib/auth/require-role', () => ({
  getCurrentUserWithRole: () => mockGetCurrentUserWithRole(),
}))

// ---- SUT ----

import {
  assertCaseNotClosed,
  assertCaseWritable,
  updateCaseStatus,
  autoAdvanceFromIntake,
  closeCase,
  reopenCase,
  startReturnCareEpisode,
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
    expect(result.error).toContain('locked')
  })

  it('returns error for an archived case', async () => {
    mockTableResults(mockSupabase, {
      cases: { data: { case_status: 'archived' }, error: null },
    })
    const result = await assertCaseNotClosed(mockSupabase as never, TEST_CASE_ID)
    expect(result.error).toContain('locked')
  })

  it('returns error for a pending_settlement case', async () => {
    mockTableResults(mockSupabase, {
      cases: { data: { case_status: 'pending_settlement' }, error: null },
    })
    const result = await assertCaseNotClosed(mockSupabase as never, TEST_CASE_ID)
    expect(result.error).toContain('locked')
    expect(result.error).toContain('Pending Settlement')
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
    mockGetCurrentUserWithRole.mockResolvedValue({ id: TEST_USER_ID, role: 'staff' })
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

  it('admin override performs an otherwise-illegal transition (archived → active)', async () => {
    mockGetCurrentUserWithRole.mockResolvedValue({ id: TEST_USER_ID, role: 'admin' })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'cases') {
        return createMockQueryBuilder({ data: { case_status: 'archived' }, error: null })
      }
      return createMockQueryBuilder({ data: null, error: null })
    })

    // archived normally only allows → closed
    const result = await updateCaseStatus(TEST_CASE_ID, 'active', undefined, { override: true })
    expect(result).toEqual({ data: { success: true } })
  })

  it('admin override skips the medical-invoice prerequisite for closed', async () => {
    mockGetCurrentUserWithRole.mockResolvedValue({ id: TEST_USER_ID, role: 'admin' })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'cases') {
        return createMockQueryBuilder({ data: { case_status: 'active' }, error: null })
      }
      // invoices returns nothing — would normally block closed
      return createMockQueryBuilder({ data: null, error: null })
    })

    const result = await updateCaseStatus(TEST_CASE_ID, 'closed', undefined, { override: true })
    expect(result).toEqual({ data: { success: true } })
  })

  it('ignores override flag for a non-admin (still blocked)', async () => {
    mockGetCurrentUserWithRole.mockResolvedValue({ id: TEST_USER_ID, role: 'staff' })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'cases') {
        return createMockQueryBuilder({ data: { case_status: 'archived' }, error: null })
      }
      return createMockQueryBuilder({ data: null, error: null })
    })

    const result = await updateCaseStatus(TEST_CASE_ID, 'active', undefined, { override: true })
    expect(result.error).toContain('Cannot change status')
  })

  it('allows intake → pending_imaging without invoice', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'cases') {
        return createMockQueryBuilder({ data: { case_status: 'intake' }, error: null })
      }
      return createMockQueryBuilder({ data: null, error: null })
    })

    const result = await updateCaseStatus(TEST_CASE_ID, 'pending_imaging')
    expect(result).toEqual({ data: { success: true } })
  })
})

describe('assertCaseWritable', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
    mockGetCurrentUserWithRole.mockResolvedValue({ id: TEST_USER_ID, role: 'staff' })
  })

  it('bypasses the lock for an admin when allowLockedForAdmin is set', async () => {
    mockGetCurrentUserWithRole.mockResolvedValue({ id: TEST_USER_ID, role: 'admin' })
    mockTableResults(mockSupabase, {
      cases: { data: { case_status: 'closed' }, error: null },
    })
    const result = await assertCaseWritable(mockSupabase as never, TEST_CASE_ID, { allowLockedForAdmin: true })
    expect(result.error).toBeNull()
  })

  it('still blocks a non-admin on a locked case even with allowLockedForAdmin', async () => {
    mockGetCurrentUserWithRole.mockResolvedValue({ id: TEST_USER_ID, role: 'staff' })
    mockTableResults(mockSupabase, {
      cases: { data: { case_status: 'closed' }, error: null },
    })
    const result = await assertCaseWritable(mockSupabase as never, TEST_CASE_ID, { allowLockedForAdmin: true })
    expect(result.error).toContain('locked')
  })

  it('blocks a locked case when allowLockedForAdmin is not set (default)', async () => {
    mockGetCurrentUserWithRole.mockResolvedValue({ id: TEST_USER_ID, role: 'admin' })
    mockTableResults(mockSupabase, {
      cases: { data: { case_status: 'closed' }, error: null },
    })
    const result = await assertCaseWritable(mockSupabase as never, TEST_CASE_ID)
    expect(result.error).toContain('locked')
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

describe('startReturnCareEpisode', () => {
  const encounterInput = {
    case_id: TEST_CASE_ID,
    modality: 'telehealth' as const,
    scheduled_start: '2026-09-01T17:00:00.000Z',
    scheduled_end: '2026-09-01T17:30:00.000Z',
    encounter_date: '2026-09-01',
    provider_id: '880e8400-e29b-41d4-a716-446655440000',
    provider_intake: {},
    patient_reported_measurements: {},
  }

  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('creates the episode and encounter through one RPC call', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: [{
        episode_id: '110e8400-e29b-41d4-a716-446655440000',
        encounter_id: '220e8400-e29b-41d4-a716-446655440000',
        replayed: false,
      }],
      error: null,
    })

    const result = await startReturnCareEpisode(
      TEST_CASE_ID,
      'Pain returned after discharge',
      encounterInput,
      'return-visit-001',
    )

    expect(mockSupabase.rpc).toHaveBeenCalledTimes(1)
    expect(mockSupabase.rpc).toHaveBeenCalledWith('start_return_episode', expect.objectContaining({
      p_case_id: TEST_CASE_ID,
      p_modality: 'telehealth',
      p_idempotency_key: 'return-visit-001',
    }))
    expect(result).toEqual({
      data: {
        episodeId: '110e8400-e29b-41d4-a716-446655440000',
        encounterId: '220e8400-e29b-41d4-a716-446655440000',
        replayed: false,
      },
    })
  })

  it('returns the replayed result for an idempotent retry', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: [{
        episode_id: '110e8400-e29b-41d4-a716-446655440000',
        encounter_id: '220e8400-e29b-41d4-a716-446655440000',
        replayed: true,
      }],
      error: null,
    })

    const result = await startReturnCareEpisode(
      TEST_CASE_ID,
      'Pain returned after discharge',
      encounterInput,
      'return-visit-001',
    )

    expect(result.data?.replayed).toBe(true)
  })

  it('rejects cross-case encounter input before database access', async () => {
    const result = await startReturnCareEpisode(
      TEST_CASE_ID,
      'Pain returned after discharge',
      { ...encounterInput, case_id: '220e8400-e29b-41d4-a716-446655440000' },
      'return-visit-001',
    )

    expect(result.error).toContain('same case')
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it('returns a stable active-episode conflict', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'This case already has an active care episode' },
    })

    const result = await startReturnCareEpisode(
      TEST_CASE_ID,
      'Pain returned after discharge',
      encounterInput,
      'return-visit-001',
    )

    expect(result.error).toBe('This case already has an active care episode')
  })
})
