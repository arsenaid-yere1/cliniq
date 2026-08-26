import { describe, it, expect } from 'vitest'
import { clinicInfoSchema, providerInfoSchema } from '../settings'

describe('clinicInfoSchema', () => {
  it('accepts valid minimal data', () => {
    const result = clinicInfoSchema.safeParse({
      clinic_name: 'ClinIQ Health',
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty clinic_name', () => {
    const result = clinicInfoSchema.safeParse({
      clinic_name: '',
    })
    expect(result.success).toBe(false)
  })

  it('accepts valid email', () => {
    const result = clinicInfoSchema.safeParse({
      clinic_name: 'ClinIQ',
      email: 'info@clinic.com',
    })
    expect(result.success).toBe(true)
  })

  it('accepts empty string for email', () => {
    const result = clinicInfoSchema.safeParse({
      clinic_name: 'ClinIQ',
      email: '',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid email', () => {
    const result = clinicInfoSchema.safeParse({
      clinic_name: 'ClinIQ',
      email: 'bad',
    })
    expect(result.success).toBe(false)
  })

  it('accepts valid URL for website', () => {
    const result = clinicInfoSchema.safeParse({
      clinic_name: 'ClinIQ',
      website: 'https://clinic.com',
    })
    expect(result.success).toBe(true)
  })

  it('accepts empty string for website', () => {
    const result = clinicInfoSchema.safeParse({
      clinic_name: 'ClinIQ',
      website: '',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid URL for website', () => {
    const result = clinicInfoSchema.safeParse({
      clinic_name: 'ClinIQ',
      website: 'not-a-url',
    })
    expect(result.success).toBe(false)
  })

  it('accepts a valid IANA timezone', () => {
    const result = clinicInfoSchema.safeParse({
      clinic_name: 'ClinIQ',
      timezone: 'America/New_York',
    })
    expect(result.success).toBe(true)
  })

  it('accepts legacy callers that do not yet send a timezone', () => {
    const result = clinicInfoSchema.safeParse({ clinic_name: 'ClinIQ' })
    expect(result.success).toBe(true)
  })

  it('rejects an unknown timezone', () => {
    const result = clinicInfoSchema.safeParse({
      clinic_name: 'ClinIQ',
      timezone: 'Pacific/Atlantis',
    })
    expect(result.success).toBe(false)
  })
})

describe('providerInfoSchema', () => {
  it('accepts valid minimal data', () => {
    const result = providerInfoSchema.safeParse({
      display_name: 'Dr. Smith',
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty display_name', () => {
    const result = providerInfoSchema.safeParse({
      display_name: '',
    })
    expect(result.success).toBe(false)
  })

  it('accepts all optional fields', () => {
    const result = providerInfoSchema.safeParse({
      display_name: 'Dr. Smith',
      credentials: 'MD',
      license_number: 'CA12345',
      npi_number: '1234567890',
    })
    expect(result.success).toBe(true)
  })
})
