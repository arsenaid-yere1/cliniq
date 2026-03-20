import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { createMockSupabase, createMockQueryBuilder, mockTableResults, type MockSupabaseClient } from '@/test-utils/supabase-mock'
import { TEST_ATTORNEY_ID, TEST_USER_ID, validAttorneyData } from '@/test-utils/fixtures'

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
  createAttorney,
  updateAttorney,
  deleteAttorney,
  getAttorney,
  listAttorneys,
} from '../attorneys'

// ---- Tests ----

describe('createAttorney', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('returns validation errors for missing required fields', async () => {
    const result = await createAttorney({ first_name: '', last_name: '' })
    expect(result.error).toBeDefined()
    expect(result.error).not.toBeNull()
  })

  it('creates attorney with valid data', async () => {
    const created = { id: TEST_ATTORNEY_ID, ...validAttorneyData }
    mockTableResults(mockSupabase, {
      attorneys: { data: created, error: null },
    })

    const result = await createAttorney(validAttorneyData)
    expect(result.data).toEqual(created)
    expect(mockSupabase.from).toHaveBeenCalledWith('attorneys')
  })

  it('returns DB error on insert failure', async () => {
    mockTableResults(mockSupabase, {
      attorneys: { data: null, error: { message: 'unique violation' } },
    })

    const result = await createAttorney(validAttorneyData)
    expect(result.error).toBe('unique violation')
  })

  it('normalizes empty email to null', async () => {
    const created = { id: TEST_ATTORNEY_ID, ...validAttorneyData, email: null }
    const builder = createMockQueryBuilder({ data: created, error: null })
    mockSupabase.from.mockReturnValue(builder)

    const result = await createAttorney({ ...validAttorneyData, email: '' })
    expect(result.data).toBeDefined()
    expect(builder.insert).toHaveBeenCalled()
    const insertArg = builder.insert.mock.calls[0][0]
    expect(insertArg.email).toBeNull()
  })

  it('passes user id as created_by and updated_by', async () => {
    const builder = createMockQueryBuilder({ data: { id: TEST_ATTORNEY_ID }, error: null })
    mockSupabase.from.mockReturnValue(builder)

    await createAttorney(validAttorneyData)
    const insertCall = builder.insert.mock.calls[0][0]
    expect(insertCall.created_by_user_id).toBe(TEST_USER_ID)
    expect(insertCall.updated_by_user_id).toBe(TEST_USER_ID)
  })
})

describe('updateAttorney', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('returns validation errors for invalid data', async () => {
    const result = await updateAttorney(TEST_ATTORNEY_ID, { first_name: '', last_name: '' })
    expect(result.error).toBeDefined()
  })

  it('updates attorney with valid data', async () => {
    const updated = { id: TEST_ATTORNEY_ID, ...validAttorneyData, first_name: 'Jane' }
    mockTableResults(mockSupabase, {
      attorneys: { data: updated, error: null },
    })

    const result = await updateAttorney(TEST_ATTORNEY_ID, { ...validAttorneyData, first_name: 'Jane' })
    expect(result.data).toEqual(updated)
  })

  it('returns DB error on update failure', async () => {
    mockTableResults(mockSupabase, {
      attorneys: { data: null, error: { message: 'not found' } },
    })

    const result = await updateAttorney(TEST_ATTORNEY_ID, validAttorneyData)
    expect(result.error).toBe('not found')
  })
})

describe('deleteAttorney', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('soft-deletes by setting deleted_at', async () => {
    const builder = createMockQueryBuilder({ data: null, error: null })
    mockSupabase.from.mockReturnValue(builder)

    const result = await deleteAttorney(TEST_ATTORNEY_ID)
    expect(result.success).toBe(true)
    expect(builder.update).toHaveBeenCalled()
    const updateArg = builder.update.mock.calls[0][0]
    expect(updateArg).toHaveProperty('deleted_at')
  })

  it('returns error on DB failure', async () => {
    mockTableResults(mockSupabase, {
      attorneys: { data: null, error: { message: 'permission denied' } },
    })

    const result = await deleteAttorney(TEST_ATTORNEY_ID)
    expect(result.error).toBe('permission denied')
  })
})

describe('getAttorney', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('returns attorney data', async () => {
    const attorney = { id: TEST_ATTORNEY_ID, ...validAttorneyData }
    mockTableResults(mockSupabase, {
      attorneys: { data: attorney, error: null },
    })

    const result = await getAttorney(TEST_ATTORNEY_ID)
    expect(result.data).toEqual(attorney)
  })

  it('filters out soft-deleted records', async () => {
    const builder = createMockQueryBuilder({ data: { id: TEST_ATTORNEY_ID }, error: null })
    mockSupabase.from.mockReturnValue(builder)

    await getAttorney(TEST_ATTORNEY_ID)
    expect(builder.is).toHaveBeenCalledWith('deleted_at', null)
  })

  it('returns error when not found', async () => {
    mockTableResults(mockSupabase, {
      attorneys: { data: null, error: { message: 'not found' } },
    })

    const result = await getAttorney(TEST_ATTORNEY_ID)
    expect(result.error).toBe('not found')
  })
})

describe('listAttorneys', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('returns list of attorneys', async () => {
    const list = [{ id: '1', first_name: 'A', last_name: 'B' }]
    mockTableResults(mockSupabase, {
      attorneys: { data: list, error: null },
    })

    const result = await listAttorneys()
    expect(result.data).toEqual(list)
  })

  it('returns empty array on error', async () => {
    mockTableResults(mockSupabase, {
      attorneys: { data: null, error: { message: 'timeout' } },
    })

    const result = await listAttorneys()
    expect(result.data).toEqual([])
    expect(result.error).toBe('timeout')
  })

  it('applies search filter via or()', async () => {
    const builder = createMockQueryBuilder({ data: [], error: null })
    mockSupabase.from.mockReturnValue(builder)

    await listAttorneys('Connor')
    expect(builder.or).toHaveBeenCalled()
  })

  it('does not apply or() when no search term', async () => {
    const builder = createMockQueryBuilder({ data: [], error: null })
    mockSupabase.from.mockReturnValue(builder)

    await listAttorneys()
    expect(builder.or).not.toHaveBeenCalled()
  })

  it('orders by last_name ascending', async () => {
    const builder = createMockQueryBuilder({ data: [], error: null })
    mockSupabase.from.mockReturnValue(builder)

    await listAttorneys()
    expect(builder.order).toHaveBeenCalledWith('last_name', { ascending: true })
  })
})
