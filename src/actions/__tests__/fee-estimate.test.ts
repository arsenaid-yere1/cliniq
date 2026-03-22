import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabase, createMockQueryBuilder, mockTableResults, type MockSupabaseClient } from '@/test-utils/supabase-mock'
import { validFeeEstimateItem } from '@/test-utils/fixtures'

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
  listFeeEstimateConfig,
  createFeeEstimateItem,
  updateFeeEstimateItem,
  deleteFeeEstimateItem,
  getFeeEstimateTotals,
} from '../fee-estimate'

// ---- Tests ----

describe('listFeeEstimateConfig', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('returns list of items', async () => {
    const items = [
      { id: '1', description: 'Initial Consultation', fee_category: 'professional', price_min: 500, price_max: 1000, sort_order: 1 },
    ]
    mockTableResults(mockSupabase, {
      fee_estimate_config: { data: items, error: null },
    })

    const result = await listFeeEstimateConfig()
    expect(result.data).toEqual(items)
  })

  it('returns empty array on error', async () => {
    mockTableResults(mockSupabase, {
      fee_estimate_config: { data: null, error: { message: 'timeout' } },
    })

    const result = await listFeeEstimateConfig()
    expect(result.data).toEqual([])
    expect(result.error).toBe('timeout')
  })

  it('orders by sort_order ascending', async () => {
    const builder = createMockQueryBuilder({ data: [], error: null })
    mockSupabase.from.mockReturnValue(builder)

    await listFeeEstimateConfig()
    expect(builder.order).toHaveBeenCalledWith('sort_order', { ascending: true })
  })
})

describe('createFeeEstimateItem', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('returns validation errors for missing fields', async () => {
    const result = await createFeeEstimateItem({ description: '', fee_category: 'professional', price_min: -1, price_max: 0 } as never)
    expect(result.error).toBeDefined()
  })

  it('creates item with next sort_order', async () => {
    const created = { id: 'fe-1', ...validFeeEstimateItem, sort_order: 6 }
    mockSupabase.from.mockImplementation(() => {
      return createMockQueryBuilder({ data: created, error: null })
    })

    const result = await createFeeEstimateItem(validFeeEstimateItem)
    expect(result.data).toBeDefined()
  })

  it('returns error on insert failure', async () => {
    mockSupabase.from.mockImplementation(() => {
      return createMockQueryBuilder({ data: null, error: { message: 'insert failed' } })
    })

    const result = await createFeeEstimateItem(validFeeEstimateItem)
    expect(result.error).toBe('insert failed')
  })
})

describe('updateFeeEstimateItem', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('updates item with valid data', async () => {
    const updated = { id: 'fe-1', ...validFeeEstimateItem, price_max: 1500 }
    mockTableResults(mockSupabase, {
      fee_estimate_config: { data: updated, error: null },
    })

    const result = await updateFeeEstimateItem('fe-1', { ...validFeeEstimateItem, price_max: 1500 })
    expect(result.data).toEqual(updated)
  })

  it('returns error on update failure', async () => {
    mockTableResults(mockSupabase, {
      fee_estimate_config: { data: null, error: { message: 'not found' } },
    })

    const result = await updateFeeEstimateItem('fe-1', validFeeEstimateItem)
    expect(result.error).toBe('not found')
  })
})

describe('deleteFeeEstimateItem', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('soft-deletes by setting deleted_at', async () => {
    const builder = createMockQueryBuilder({ data: null, error: null })
    mockSupabase.from.mockReturnValue(builder)

    const result = await deleteFeeEstimateItem('fe-1')
    expect(result.success).toBe(true)
    expect(builder.update).toHaveBeenCalled()
  })

  it('returns error on DB failure', async () => {
    mockTableResults(mockSupabase, {
      fee_estimate_config: { data: null, error: { message: 'permission denied' } },
    })

    const result = await deleteFeeEstimateItem('fe-1')
    expect(result.error).toBe('permission denied')
  })
})

describe('getFeeEstimateTotals', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('sums min/max per category correctly', async () => {
    const items = [
      { fee_category: 'professional', price_min: '500.00', price_max: '1000.00' },
      { fee_category: 'professional', price_min: '300.00', price_max: '600.00' },
      { fee_category: 'practice_center', price_min: '800.00', price_max: '1500.00' },
    ]
    mockTableResults(mockSupabase, {
      fee_estimate_config: { data: items, error: null },
    })

    const result = await getFeeEstimateTotals()
    expect(result).toEqual({
      professional_min: 800,
      professional_max: 1600,
      practice_center_min: 800,
      practice_center_max: 1500,
    })
  })

  it('returns all zeros when no items', async () => {
    mockTableResults(mockSupabase, {
      fee_estimate_config: { data: [], error: null },
    })

    const result = await getFeeEstimateTotals()
    expect(result).toEqual({
      professional_min: 0,
      professional_max: 0,
      practice_center_min: 0,
      practice_center_max: 0,
    })
  })

  it('returns all zeros on null data', async () => {
    mockTableResults(mockSupabase, {
      fee_estimate_config: { data: null, error: { message: 'error' } },
    })

    const result = await getFeeEstimateTotals()
    expect(result).toEqual({
      professional_min: 0,
      professional_max: 0,
      practice_center_min: 0,
      practice_center_max: 0,
    })
  })

  it('handles single category only', async () => {
    const items = [
      { fee_category: 'practice_center', price_min: '200.00', price_max: '400.00' },
      { fee_category: 'practice_center', price_min: '100.00', price_max: '300.00' },
    ]
    mockTableResults(mockSupabase, {
      fee_estimate_config: { data: items, error: null },
    })

    const result = await getFeeEstimateTotals()
    expect(result).toEqual({
      professional_min: 0,
      professional_max: 0,
      practice_center_min: 300,
      practice_center_max: 700,
    })
  })
})
