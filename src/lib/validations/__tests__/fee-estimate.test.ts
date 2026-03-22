import { describe, it, expect } from 'vitest'
import { feeEstimateItemSchema } from '../fee-estimate'

const validItem = {
  description: 'Initial Consultation',
  fee_category: 'professional' as const,
  price_min: 500,
  price_max: 1000,
}

describe('feeEstimateItemSchema', () => {
  it('accepts valid item', () => {
    expect(feeEstimateItemSchema.safeParse(validItem).success).toBe(true)
  })

  it('accepts item with optional id as UUID', () => {
    expect(
      feeEstimateItemSchema.safeParse({
        ...validItem,
        id: '550e8400-e29b-41d4-a716-446655440000',
      }).success,
    ).toBe(true)
  })

  it('rejects invalid UUID for id', () => {
    expect(
      feeEstimateItemSchema.safeParse({ ...validItem, id: 'not-a-uuid' }).success,
    ).toBe(false)
  })

  it('accepts item without id', () => {
    expect(
      feeEstimateItemSchema.safeParse({ ...validItem }).success,
    ).toBe(true)
  })

  it('rejects empty description', () => {
    expect(
      feeEstimateItemSchema.safeParse({ ...validItem, description: '' }).success,
    ).toBe(false)
  })

  it('accepts professional fee_category', () => {
    expect(
      feeEstimateItemSchema.safeParse({ ...validItem, fee_category: 'professional' }).success,
    ).toBe(true)
  })

  it('accepts practice_center fee_category', () => {
    expect(
      feeEstimateItemSchema.safeParse({ ...validItem, fee_category: 'practice_center' }).success,
    ).toBe(true)
  })

  it('rejects invalid fee_category', () => {
    expect(
      feeEstimateItemSchema.safeParse({ ...validItem, fee_category: 'other' }).success,
    ).toBe(false)
  })

  it('rejects negative price_min', () => {
    expect(
      feeEstimateItemSchema.safeParse({ ...validItem, price_min: -1 }).success,
    ).toBe(false)
  })

  it('rejects negative price_max', () => {
    expect(
      feeEstimateItemSchema.safeParse({ ...validItem, price_max: -1 }).success,
    ).toBe(false)
  })

  it('accepts zero prices', () => {
    expect(
      feeEstimateItemSchema.safeParse({ ...validItem, price_min: 0, price_max: 0 }).success,
    ).toBe(true)
  })

  it('coerces string price_min to number', () => {
    const result = feeEstimateItemSchema.safeParse({ ...validItem, price_min: '500.50' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.price_min).toBe(500.5)
    }
  })

  it('coerces string price_max to number', () => {
    const result = feeEstimateItemSchema.safeParse({ ...validItem, price_max: '1000.00' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.price_max).toBe(1000)
    }
  })

  it('coerces string sort_order to int', () => {
    const result = feeEstimateItemSchema.safeParse({ ...validItem, sort_order: '3' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sort_order).toBe(3)
    }
  })
})
