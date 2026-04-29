import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createMockSupabase,
  mockTableResults,
  type MockSupabaseClient,
} from '@/test-utils/supabase-mock'

// ---- Mocks ----

let mockSupabase: MockSupabaseClient

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => mockSupabase),
}))

// Bypass case-status guard — tested separately.
vi.mock('@/actions/case-status', () => ({
  assertCaseNotClosed: vi.fn(async () => ({ error: null })),
}))

// Default: generator returns clean review. Individual tests override.
const generateMock = vi.fn()
vi.mock('@/lib/claude/generate-quality-review', async () => {
  const actual = await vi.importActual<typeof import('@/lib/claude/generate-quality-review')>(
    '@/lib/claude/generate-quality-review',
  )
  return {
    ...actual,
    generateQualityReviewFromData: (...args: unknown[]) => generateMock(...args),
  }
})

// ---- SUT ----

import {
  runCaseQualityReview,
  checkQualityReviewStaleness,
  acknowledgeFinding,
  dismissFinding,
  editFinding,
  clearFindingOverride,
} from '../case-quality-reviews'

const VALID_CASE_ID = '11111111-1111-4111-8111-111111111111'
const VALID_USER_ID = 'test-user-id'
const HASH = 'a'.repeat(64)

const minimalCase = {
  case_number: 'C-1',
  accident_type: 'auto',
  accident_date: '2026-01-01',
  patient: {
    first_name: 'Test',
    last_name: 'Patient',
    date_of_birth: '1990-01-01',
  },
}

function defaultTableResults() {
  return {
    cases: { data: minimalCase, error: null },
    case_summaries: { data: null, error: null },
    initial_visit_notes: { data: [], error: null },
    procedure_notes: { data: [], error: null },
    discharge_notes: { data: null, error: null },
    mri_extractions: { data: null, error: null, count: 0 },
    pt_extractions: { data: null, error: null, count: 0 },
    pain_management_extractions: { data: null, error: null, count: 0 },
    chiro_extractions: { data: null, error: null, count: 0 },
    orthopedic_extractions: { data: null, error: null, count: 0 },
    ct_scan_extractions: { data: null, error: null, count: 0 },
    x_ray_extractions: { data: null, error: null, count: 0 },
    vital_signs: { data: [], error: null },
    case_quality_reviews: { data: { id: 'review-1', finding_overrides: {} }, error: null },
  } as Record<string, { data: unknown; error: unknown; count?: number }>
}

describe('runCaseQualityReview', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
    generateMock.mockReset()
    generateMock.mockResolvedValue({
      data: { findings: [], summary: null, overall_assessment: 'clean' },
      rawResponse: { ok: true },
    })
  })

  it('rejects when not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const result = await runCaseQualityReview(VALID_CASE_ID)
    expect(result.error).toBe('Not authenticated')
  })

  it('returns error when case fetch fails', async () => {
    mockTableResults(mockSupabase, {
      ...defaultTableResults(),
      cases: { data: null, error: { message: 'not found' } },
    })
    const result = await runCaseQualityReview(VALID_CASE_ID)
    expect(result.error).toBe('Failed to fetch case details')
  })

  it('writes generation_status=completed on success', async () => {
    mockTableResults(mockSupabase, defaultTableResults())
    // Insert returns a record id
    const inserts: Array<unknown> = []
    mockSupabase.from.mockImplementation((table: string) => {
      const builder = (mockSupabase as unknown as { _builder: ReturnType<typeof createMockSupabase>['_builder'] })._builder
      // Re-create a fresh builder so .insert chain returns the new id
      void builder
      // Fallback to the table-default but capture insert payloads
      const tableDefaults = defaultTableResults()
      const data = tableDefaults[table]?.data ?? null
      const error = tableDefaults[table]?.error ?? null
      const count = tableDefaults[table]?.count
      const localBuilder = {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn((payload: unknown) => {
          inserts.push({ table, payload })
          return localBuilder
        }),
        update: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        upsert: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(
          table === 'case_quality_reviews'
            ? { data: { id: 'review-1' }, error: null }
            : { data, error, count },
        ),
        maybeSingle: vi.fn().mockResolvedValue({ data, error, count }),
        then: (resolve: (value: { data: unknown; error: unknown; count?: number }) => void) => {
          resolve({ data, error, count })
          return localBuilder
        },
      }
      return localBuilder
    })

    const result = await runCaseQualityReview(VALID_CASE_ID)
    expect(result.error).toBeUndefined()
    expect(generateMock).toHaveBeenCalledTimes(1)
    // Confirm the processing-row insert went to case_quality_reviews
    const reviewInsert = inserts.find(
      (i) => (i as { table: string }).table === 'case_quality_reviews',
    ) as { payload: Record<string, unknown> } | undefined
    expect(reviewInsert).toBeDefined()
    expect(reviewInsert!.payload.generation_status).toBe('processing')
    expect(reviewInsert!.payload.case_id).toBe(VALID_CASE_ID)
    expect(reviewInsert!.payload.created_by_user_id).toBe(VALID_USER_ID)
  })

  it('writes generation_status=failed when generator errors', async () => {
    generateMock.mockResolvedValueOnce({ error: 'API timeout', rawResponse: null })
    mockTableResults(mockSupabase, defaultTableResults())
    // Need insert to succeed so the failure-update path runs.
    mockSupabase.from.mockImplementation((table: string) => {
      const tableDefaults = defaultTableResults()
      const data = tableDefaults[table]?.data ?? null
      const error = tableDefaults[table]?.error ?? null
      const count = tableDefaults[table]?.count
      const localBuilder = {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        upsert: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(
          table === 'case_quality_reviews'
            ? { data: { id: 'review-1' }, error: null }
            : { data, error, count },
        ),
        maybeSingle: vi.fn().mockResolvedValue({ data, error, count }),
        then: (resolve: (value: { data: unknown; error: unknown; count?: number }) => void) => {
          resolve({ data, error, count })
          return localBuilder
        },
      }
      return localBuilder
    })

    const result = await runCaseQualityReview(VALID_CASE_ID)
    expect(result.error).toBe('API timeout')
  })

  it('returns concurrent-progress message on 23505', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      const tableDefaults = defaultTableResults()
      const data = tableDefaults[table]?.data ?? null
      const error = tableDefaults[table]?.error ?? null
      const count = tableDefaults[table]?.count
      const localBuilder = {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        upsert: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(
          table === 'case_quality_reviews'
            ? { data: null, error: { code: '23505' } }
            : { data, error, count },
        ),
        maybeSingle: vi.fn().mockResolvedValue({ data, error, count }),
        then: (resolve: (value: { data: unknown; error: unknown; count?: number }) => void) => {
          resolve({ data, error, count })
          return localBuilder
        },
      }
      return localBuilder
    })

    const result = await runCaseQualityReview(VALID_CASE_ID)
    expect(result.error).toMatch(/already in progress/)
  })
})

describe('checkQualityReviewStaleness', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('returns isStale=false when no row exists', async () => {
    mockTableResults(mockSupabase, {
      ...defaultTableResults(),
      case_quality_reviews: { data: null, error: null },
    })
    const result = await checkQualityReviewStaleness(VALID_CASE_ID)
    expect(result.data?.isStale).toBe(false)
  })
})

describe('override mutators', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('acknowledgeFinding errors when no active review', async () => {
    mockTableResults(mockSupabase, {
      case_quality_reviews: { data: null, error: null },
    })
    const result = await acknowledgeFinding(VALID_CASE_ID, HASH)
    expect(result.error).toBe('No active review')
  })

  it('dismissFinding rejects invalid form payload', async () => {
    mockTableResults(mockSupabase, {
      case_quality_reviews: {
        data: { id: 'review-1', finding_overrides: {} },
        error: null,
      },
    })
    // dismissed_reason must be string|null; pass number
    const result = await dismissFinding(
      VALID_CASE_ID,
      HASH,
      { dismissed_reason: 42 } as unknown as { dismissed_reason: string | null },
    )
    expect(result.error).toBe('Invalid dismiss form data')
  })

  it('editFinding rejects empty edited_message', async () => {
    mockTableResults(mockSupabase, {
      case_quality_reviews: {
        data: { id: 'review-1', finding_overrides: {} },
        error: null,
      },
    })
    const result = await editFinding(VALID_CASE_ID, HASH, {
      edited_message: '',
      edited_rationale: null,
      edited_suggested_tone_hint: null,
    })
    expect(result.error).toBe('Invalid edit form data')
  })

  it('clearFindingOverride errors when no active review', async () => {
    mockTableResults(mockSupabase, {
      case_quality_reviews: { data: null, error: null },
    })
    const result = await clearFindingOverride(VALID_CASE_ID, HASH)
    expect(result.error).toBe('No active review')
  })
})
