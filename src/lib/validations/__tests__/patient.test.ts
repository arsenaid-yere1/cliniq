import { describe, it, expect } from 'vitest'
import {
  patientIdentitySchema,
  patientDetailsSchema,
  createPatientCaseSchema,
  editPatientSchema,
  editCaseSchema,
} from '../patient'

describe('patientIdentitySchema', () => {
  it('accepts valid identity data', () => {
    const result = patientIdentitySchema.safeParse({
      first_name: 'John',
      last_name: 'Doe',
      date_of_birth: '1990-01-15',
    })
    expect(result.success).toBe(true)
  })

  it('accepts all optional fields', () => {
    const result = patientIdentitySchema.safeParse({
      first_name: 'Jane',
      last_name: 'Smith',
      middle_name: 'Marie',
      date_of_birth: '1985-06-20',
      gender: 'female',
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty first_name', () => {
    const result = patientIdentitySchema.safeParse({
      first_name: '',
      last_name: 'Doe',
      date_of_birth: '1990-01-15',
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty last_name', () => {
    const result = patientIdentitySchema.safeParse({
      first_name: 'John',
      last_name: '',
      date_of_birth: '1990-01-15',
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty date_of_birth', () => {
    const result = patientIdentitySchema.safeParse({
      first_name: 'John',
      last_name: 'Doe',
      date_of_birth: '',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid gender enum value', () => {
    const result = patientIdentitySchema.safeParse({
      first_name: 'John',
      last_name: 'Doe',
      date_of_birth: '1990-01-15',
      gender: 'unknown',
    })
    expect(result.success).toBe(false)
  })

  it('accepts all valid gender values', () => {
    for (const gender of ['male', 'female', 'other', 'prefer_not_to_say']) {
      const result = patientIdentitySchema.safeParse({
        first_name: 'John',
        last_name: 'Doe',
        date_of_birth: '1990-01-15',
        gender,
      })
      expect(result.success).toBe(true)
    }
  })
})

describe('patientDetailsSchema', () => {
  const validAttorneyId = '550e8400-e29b-41d4-a716-446655440000'
  const validProviderId = '660e8400-e29b-41d4-a716-446655440000'

  it('accepts minimal valid data', () => {
    const result = patientDetailsSchema.safeParse({
      attorney_id: validAttorneyId,
      assigned_provider_id: validProviderId,
      lien_on_file: false,
    })
    expect(result.success).toBe(true)
  })

  it('accepts valid email', () => {
    const result = patientDetailsSchema.safeParse({
      email: 'test@example.com',
      attorney_id: validAttorneyId,
      assigned_provider_id: validProviderId,
      lien_on_file: true,
    })
    expect(result.success).toBe(true)
  })

  it('accepts empty string for email', () => {
    const result = patientDetailsSchema.safeParse({
      email: '',
      attorney_id: validAttorneyId,
      assigned_provider_id: validProviderId,
      lien_on_file: false,
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid email', () => {
    const result = patientDetailsSchema.safeParse({
      email: 'not-an-email',
      attorney_id: validAttorneyId,
      assigned_provider_id: validProviderId,
      lien_on_file: false,
    })
    expect(result.success).toBe(false)
  })

  it('requires attorney_id', () => {
    const result = patientDetailsSchema.safeParse({
      assigned_provider_id: validProviderId,
      lien_on_file: false,
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty string for attorney_id', () => {
    const result = patientDetailsSchema.safeParse({
      attorney_id: '',
      assigned_provider_id: validProviderId,
      lien_on_file: false,
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-UUID attorney_id', () => {
    const result = patientDetailsSchema.safeParse({
      attorney_id: 'not-a-uuid',
      assigned_provider_id: validProviderId,
      lien_on_file: false,
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing lien_on_file', () => {
    const result = patientDetailsSchema.safeParse({
      attorney_id: validAttorneyId,
      assigned_provider_id: validProviderId,
    })
    expect(result.success).toBe(false)
  })

  it('accepts all valid accident types', () => {
    for (const type of ['auto', 'slip_and_fall', 'workplace', 'other']) {
      const result = patientDetailsSchema.safeParse({
        accident_type: type,
        attorney_id: validAttorneyId,
        assigned_provider_id: validProviderId,
        lien_on_file: false,
      })
      expect(result.success).toBe(true)
    }
  })
})

describe('createPatientCaseSchema', () => {
  const validData = {
    first_name: 'John',
    last_name: 'Doe',
    date_of_birth: '1990-01-15',
    attorney_id: '550e8400-e29b-41d4-a716-446655440000',
    assigned_provider_id: '660e8400-e29b-41d4-a716-446655440000',
    lien_on_file: false,
  }

  it('accepts valid merged data', () => {
    const result = createPatientCaseSchema.safeParse(validData)
    expect(result.success).toBe(true)
  })

  it('rejects when identity fields are missing', () => {
    const result = createPatientCaseSchema.safeParse({
      lien_on_file: false,
    })
    expect(result.success).toBe(false)
  })

  it('rejects when details fields are missing', () => {
    const result = createPatientCaseSchema.safeParse({
      first_name: 'John',
      last_name: 'Doe',
      date_of_birth: '1990-01-15',
    })
    expect(result.success).toBe(false)
  })
})

describe('editPatientSchema', () => {
  it('accepts valid patient edit data', () => {
    const result = editPatientSchema.safeParse({
      first_name: 'John',
      last_name: 'Doe',
      date_of_birth: '1990-01-15',
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty first_name', () => {
    const result = editPatientSchema.safeParse({
      first_name: '',
      last_name: 'Doe',
      date_of_birth: '1990-01-15',
    })
    expect(result.success).toBe(false)
  })
})

describe('editCaseSchema', () => {
  const validAttorneyId = '550e8400-e29b-41d4-a716-446655440000'
  const validProviderId = '660e8400-e29b-41d4-a716-446655440000'

  it('accepts valid case edit data', () => {
    const result = editCaseSchema.safeParse({
      attorney_id: validAttorneyId,
      assigned_provider_id: validProviderId,
      lien_on_file: true,
      accident_type: 'auto',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing attorney_id', () => {
    const result = editCaseSchema.safeParse({
      assigned_provider_id: validProviderId,
      lien_on_file: true,
      accident_type: 'auto',
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing lien_on_file', () => {
    const result = editCaseSchema.safeParse({
      attorney_id: validAttorneyId,
      assigned_provider_id: validProviderId,
      accident_type: 'auto',
    })
    expect(result.success).toBe(false)
  })
})
