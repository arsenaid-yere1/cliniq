import { describe, it, expect } from 'vitest'
import { serviceCatalogItemSchema } from '../service-catalog'

const validItem = {
  cpt_code: '97110',
  description: 'Therapeutic exercises',
  default_price: 150,
}

describe('serviceCatalogItemSchema', () => {
  it('accepts valid item', () => {
    expect(serviceCatalogItemSchema.safeParse(validItem).success).toBe(true)
  })

  it('accepts item with optional id as UUID', () => {
    expect(
      serviceCatalogItemSchema.safeParse({
        ...validItem,
        id: '550e8400-e29b-41d4-a716-446655440000',
      }).success,
    ).toBe(true)
  })

  it('rejects invalid UUID for id', () => {
    expect(
      serviceCatalogItemSchema.safeParse({ ...validItem, id: 'not-a-uuid' }).success,
    ).toBe(false)
  })

  it('accepts item without id', () => {
    expect(
      serviceCatalogItemSchema.safeParse({ ...validItem }).success,
    ).toBe(true)
  })

  it('coerces string default_price to number', () => {
    const result = serviceCatalogItemSchema.safeParse({ ...validItem, default_price: '150.00' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.default_price).toBe(150)
    }
  })

  it('coerces string sort_order to int', () => {
    const result = serviceCatalogItemSchema.safeParse({ ...validItem, sort_order: '1' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sort_order).toBe(1)
    }
  })

  it('rejects negative default_price', () => {
    expect(
      serviceCatalogItemSchema.safeParse({ ...validItem, default_price: -1 }).success,
    ).toBe(false)
  })

  it('accepts zero default_price', () => {
    expect(
      serviceCatalogItemSchema.safeParse({ ...validItem, default_price: 0 }).success,
    ).toBe(true)
  })

  it('rejects empty cpt_code', () => {
    expect(
      serviceCatalogItemSchema.safeParse({ ...validItem, cpt_code: '' }).success,
    ).toBe(false)
  })

  it('rejects empty description', () => {
    expect(
      serviceCatalogItemSchema.safeParse({ ...validItem, description: '' }).success,
    ).toBe(false)
  })
})
