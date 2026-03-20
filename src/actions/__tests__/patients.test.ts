import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { createMockSupabase, createMockQueryBuilder, mockTableResults, type MockSupabaseClient } from '@/test-utils/supabase-mock'
import { TEST_CASE_ID, TEST_PATIENT_ID, TEST_ATTORNEY_ID, TEST_PROVIDER_ID, TEST_USER_ID, validPatientCaseData } from '@/test-utils/fixtures'

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
  checkDuplicatePatient,
  createPatientCase,
  getPatientCase,
  listPatientCases,
  updatePatient,
  updateCase,
} from '../patients'

// ---- Tests ----

describe('checkDuplicatePatient', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('returns empty array when no duplicates found', async () => {
    mockTableResults(mockSupabase, {
      patients: { data: [], error: null },
    })
    const result = await checkDuplicatePatient('John', 'Doe', '1990-01-15')
    expect(result.duplicates).toEqual([])
  })

  it('returns matching patients', async () => {
    const dupes = [{ id: TEST_PATIENT_ID, first_name: 'John', last_name: 'Doe', date_of_birth: '1990-01-15' }]
    mockTableResults(mockSupabase, {
      patients: { data: dupes, error: null },
    })
    const result = await checkDuplicatePatient('John', 'Doe', '1990-01-15')
    expect(result.duplicates).toEqual(dupes)
  })

  it('returns error on DB failure', async () => {
    mockTableResults(mockSupabase, {
      patients: { data: null, error: { message: 'connection error' } },
    })
    const result = await checkDuplicatePatient('John', 'Doe', '1990-01-15')
    expect(result.error).toBe('connection error')
    expect(result.duplicates).toEqual([])
  })
})

describe('createPatientCase', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('returns validation errors for missing required fields', async () => {
    const result = await createPatientCase({ first_name: '', last_name: '', date_of_birth: '' } as never)
    expect(result.error).toBeDefined()
  })

  it('creates patient and case on valid data', async () => {
    const patient = { id: TEST_PATIENT_ID }
    const caseRecord = { id: TEST_CASE_ID, patient_id: TEST_PATIENT_ID, case_number: 'PI-2026-0001' }

    // patients insert, then cases insert, then case_status_history insert
    let callIndex = 0
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'patients') {
        return createMockQueryBuilder({ data: patient, error: null })
      }
      if (table === 'cases') {
        return createMockQueryBuilder({ data: caseRecord, error: null })
      }
      if (table === 'case_status_history') {
        return createMockQueryBuilder({ data: null, error: null })
      }
      return createMockQueryBuilder()
    })

    const result = await createPatientCase(validPatientCaseData as never)
    expect(result.data).toEqual(caseRecord)
  })

  it('returns error when patient insert fails', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'patients') {
        return createMockQueryBuilder({ data: null, error: { message: 'patient insert failed' } })
      }
      return createMockQueryBuilder()
    })

    const result = await createPatientCase(validPatientCaseData as never)
    expect(result.error).toBe('patient insert failed')
  })

  it('returns error when case insert fails', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'patients') {
        return createMockQueryBuilder({ data: { id: TEST_PATIENT_ID }, error: null })
      }
      if (table === 'cases') {
        return createMockQueryBuilder({ data: null, error: { message: 'case insert failed' } })
      }
      return createMockQueryBuilder()
    })

    const result = await createPatientCase(validPatientCaseData as never)
    expect(result.error).toBe('case insert failed')
  })
})

describe('getPatientCase', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('returns case with patient and attorney', async () => {
    const caseData = { id: TEST_CASE_ID, patient: { id: TEST_PATIENT_ID }, attorney: null }
    mockTableResults(mockSupabase, {
      cases: { data: caseData, error: null },
    })

    const result = await getPatientCase(TEST_CASE_ID)
    expect(result.data).toEqual(caseData)
  })

  it('returns error when case not found', async () => {
    mockTableResults(mockSupabase, {
      cases: { data: null, error: { message: 'not found' } },
    })

    const result = await getPatientCase(TEST_CASE_ID)
    expect(result.error).toBe('not found')
  })
})

describe('listPatientCases', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('returns normalized list with patient as single object', async () => {
    const rawData = [
      { id: TEST_CASE_ID, case_number: 'PI-2026-0001', case_status: 'active', patient: [{ id: TEST_PATIENT_ID, first_name: 'John', last_name: 'Doe' }] },
    ]
    mockTableResults(mockSupabase, {
      cases: { data: rawData, error: null },
    })

    const result = await listPatientCases()
    expect(result.data[0].patient).toEqual({ id: TEST_PATIENT_ID, first_name: 'John', last_name: 'Doe' })
  })

  it('returns empty array on error', async () => {
    mockTableResults(mockSupabase, {
      cases: { data: null, error: { message: 'timeout' } },
    })

    const result = await listPatientCases()
    expect(result.data).toEqual([])
  })

  it('applies search filter', async () => {
    const builder = createMockQueryBuilder({ data: [], error: null })
    mockSupabase.from.mockReturnValue(builder)

    await listPatientCases('John')
    expect(builder.or).toHaveBeenCalled()
  })
})

describe('updatePatient', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  it('returns error when not authenticated', async () => {
    ;(mockSupabase.auth.getUser as Mock).mockResolvedValue({
      data: { user: null },
      error: null,
    })
    const result = await updatePatient(TEST_PATIENT_ID, {
      first_name: 'Jane',
      last_name: 'Doe',
      date_of_birth: '1990-01-15',
    })
    expect(result.error).toBe('Not authenticated')
  })

  it('returns validation errors for bad data', async () => {
    const result = await updatePatient(TEST_PATIENT_ID, { first_name: '', last_name: '', date_of_birth: '' } as never)
    expect(result.error).toBeDefined()
  })

  it('updates patient successfully', async () => {
    mockTableResults(mockSupabase, {
      patients: { data: null, error: null },
    })

    const result = await updatePatient(TEST_PATIENT_ID, {
      first_name: 'Jane',
      last_name: 'Doe',
      date_of_birth: '1990-01-15',
    })
    expect(result.data).toEqual({ success: true })
  })

  it('returns error on DB failure', async () => {
    mockTableResults(mockSupabase, {
      patients: { data: null, error: { message: 'update failed' } },
    })

    const result = await updatePatient(TEST_PATIENT_ID, {
      first_name: 'Jane',
      last_name: 'Doe',
      date_of_birth: '1990-01-15',
    })
    expect(result.error).toBe('update failed')
  })
})

describe('updateCase', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
  })

  const validCaseEdit = {
    attorney_id: TEST_ATTORNEY_ID,
    assigned_provider_id: TEST_PROVIDER_ID,
    lien_on_file: true,
  }

  it('returns error when not authenticated', async () => {
    ;(mockSupabase.auth.getUser as Mock).mockResolvedValue({
      data: { user: null },
      error: null,
    })
    const result = await updateCase(TEST_CASE_ID, validCaseEdit)
    expect(result.error).toBe('Not authenticated')
  })

  it('updates case successfully', async () => {
    mockTableResults(mockSupabase, {
      cases: { data: null, error: null },
    })

    const result = await updateCase(TEST_CASE_ID, validCaseEdit)
    expect(result.data).toEqual({ success: true })
  })

  it('returns error on DB failure', async () => {
    mockTableResults(mockSupabase, {
      cases: { data: null, error: { message: 'case update failed' } },
    })

    const result = await updateCase(TEST_CASE_ID, { ...validCaseEdit, lien_on_file: false })
    expect(result.error).toBe('case update failed')
  })
})
