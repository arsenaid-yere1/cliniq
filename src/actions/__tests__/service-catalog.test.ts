import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabase, createMockQueryBuilder, mockTableResults, type MockSupabaseClient } from '@/test-utils/supabase-mock'
import { validServiceCatalogItem } from '@/test-utils/fixtures'

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
  listServiceCatalog,
  createServiceCatalogItem,
  updateServiceCatalogItem,
  deleteServiceCatalogItem,
  getServiceCatalogPriceMap,
} from '../service-catalog'

// ---- Tests ----

describe('listServiceCatalog', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('returns list of items', async () => {
    const items = [{ id: '1', cpt_code: '99213', description: 'Visit', default_price: 150, sort_order: 1 }]
    mockTableResults(mockSupabase, {
      service_catalog: { data: items, error: null },
    })

    const result = await listServiceCatalog()
    expect(result.data).toEqual(items)
  })

  it('returns empty array on error', async () => {
    mockTableResults(mockSupabase, {
      service_catalog: { data: null, error: { message: 'timeout' } },
    })

    const result = await listServiceCatalog()
    expect(result.data).toEqual([])
    expect(result.error).toBe('timeout')
  })

  it('orders by sort_order ascending', async () => {
    const builder = createMockQueryBuilder({ data: [], error: null })
    mockSupabase.from.mockReturnValue(builder)

    await listServiceCatalog()
    expect(builder.order).toHaveBeenCalledWith('sort_order', { ascending: true })
  })
})

describe('createServiceCatalogItem', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('returns validation errors for missing fields', async () => {
    const result = await createServiceCatalogItem({ cpt_code: '', description: '', default_price: -1 } as never)
    expect(result.error).toBeDefined()
  })

  it('creates item with next sort_order', async () => {
    const created = { id: 'sc-1', ...validServiceCatalogItem, sort_order: 4 }
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'service_catalog') {
        // First call: select max sort_order, second call: insert
        return createMockQueryBuilder({ data: created, error: null })
      }
      return createMockQueryBuilder()
    })

    const result = await createServiceCatalogItem(validServiceCatalogItem)
    expect(result.data).toBeDefined()
  })

  it('returns error on insert failure', async () => {
    mockSupabase.from.mockImplementation(() => {
      return createMockQueryBuilder({ data: null, error: { message: 'duplicate cpt' } })
    })

    const result = await createServiceCatalogItem(validServiceCatalogItem)
    expect(result.error).toBe('duplicate cpt')
  })
})

describe('updateServiceCatalogItem', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('updates item with valid data', async () => {
    const updated = { id: 'sc-1', ...validServiceCatalogItem, default_price: 200 }
    mockTableResults(mockSupabase, {
      service_catalog: { data: updated, error: null },
    })

    const result = await updateServiceCatalogItem('sc-1', { ...validServiceCatalogItem, default_price: 200 })
    expect(result.data).toEqual(updated)
  })

  it('returns error on update failure', async () => {
    mockTableResults(mockSupabase, {
      service_catalog: { data: null, error: { message: 'not found' } },
    })

    const result = await updateServiceCatalogItem('sc-1', validServiceCatalogItem)
    expect(result.error).toBe('not found')
  })
})

describe('deleteServiceCatalogItem', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('soft-deletes by setting deleted_at', async () => {
    const builder = createMockQueryBuilder({ data: null, error: null })
    mockSupabase.from.mockReturnValue(builder)

    const result = await deleteServiceCatalogItem('sc-1')
    expect(result.success).toBe(true)
    expect(builder.update).toHaveBeenCalled()
  })

  it('returns error on DB failure', async () => {
    mockTableResults(mockSupabase, {
      service_catalog: { data: null, error: { message: 'permission denied' } },
    })

    const result = await deleteServiceCatalogItem('sc-1')
    expect(result.error).toBe('permission denied')
  })
})

describe('getServiceCatalogPriceMap', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('returns price map from catalog items', async () => {
    const items = [
      { cpt_code: '99213', default_price: '150.00' },
      { cpt_code: '99214', default_price: '250.00' },
    ]
    mockTableResults(mockSupabase, {
      service_catalog: { data: items, error: null },
    })

    const result = await getServiceCatalogPriceMap()
    expect(result).toEqual({ '99213': 150, '99214': 250 })
  })

  it('returns empty map when no items', async () => {
    mockTableResults(mockSupabase, {
      service_catalog: { data: [], error: null },
    })

    const result = await getServiceCatalogPriceMap()
    expect(result).toEqual({})
  })

  it('returns empty map on null data', async () => {
    mockTableResults(mockSupabase, {
      service_catalog: { data: null, error: { message: 'error' } },
    })

    const result = await getServiceCatalogPriceMap()
    expect(result).toEqual({})
  })
})
