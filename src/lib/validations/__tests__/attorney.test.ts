import { describe, it, expect } from 'vitest'
import { attorneySchema } from '../attorney'

describe('attorneySchema', () => {
  it('accepts valid minimal data', () => {
    const result = attorneySchema.safeParse({
      first_name: 'Sarah',
      last_name: 'Connor',
    })
    expect(result.success).toBe(true)
  })

  it('accepts all optional fields', () => {
    const result = attorneySchema.safeParse({
      first_name: 'Sarah',
      last_name: 'Connor',
      firm_name: 'Connor & Associates',
      phone: '555-0100',
      email: 'sarah@firm.com',
      fax: '555-0101',
      address_line1: '123 Main St',
      address_line2: 'Suite 200',
      city: 'Los Angeles',
      state: 'CA',
      zip_code: '90001',
      notes: 'Specializes in PI',
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty first_name', () => {
    const result = attorneySchema.safeParse({
      first_name: '',
      last_name: 'Connor',
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty last_name', () => {
    const result = attorneySchema.safeParse({
      first_name: 'Sarah',
      last_name: '',
    })
    expect(result.success).toBe(false)
  })

  it('accepts empty string for email', () => {
    const result = attorneySchema.safeParse({
      first_name: 'Sarah',
      last_name: 'Connor',
      email: '',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid email', () => {
    const result = attorneySchema.safeParse({
      first_name: 'Sarah',
      last_name: 'Connor',
      email: 'not-valid',
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing required fields', () => {
    const result = attorneySchema.safeParse({})
    expect(result.success).toBe(false)
  })
})
