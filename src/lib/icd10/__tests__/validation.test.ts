import { describe, it, expect } from 'vitest'
import {
  validateIcd10Code,
  normalizeIcd10Code,
  NON_BILLABLE_PARENT_CODES,
  classifyIcd10Code,
  MYELOPATHY_CODE_PATTERN,
  RADICULOPATHY_CODE_PATTERN,
} from '@/lib/icd10/validation'

describe('validateIcd10Code', () => {
  it.each([
    'M54.50',
    'M54.51',
    'M54.59',
    'M54.2',
    'M54.6',
    'M50.20',
    'M50.121',
    'M51.16',
    'M51.17',
    'M51.36',
    'M51.37',
    'S13.4XXA',
    'S39.012A',
    'V43.52XA',
    'W18.49XA',
    'G44.309',
    'G47.9',
    'R51.9',
    'M79.1',
  ])('accepts valid code %s', (code) => {
    const result = validateIcd10Code(code)
    expect(result.ok).toBe(true)
  })

  it('uppercases lowercased input', () => {
    const result = validateIcd10Code('m54.50')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.code).toBe('M54.50')
  })

  it('trims whitespace', () => {
    const result = validateIcd10Code('  M54.50  ')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.code).toBe('M54.50')
  })

  it.each(['', '54.5', 'MM54.5', 'M54..5', 'random text', '!!!'])(
    'rejects structurally invalid input %s',
    (input) => {
      const result = validateIcd10Code(input)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toBe('structure')
    },
  )

  it('flags M54.5 as non-billable parent and suggests M54.50', () => {
    const result = validateIcd10Code('M54.5')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('non_billable_parent')
      expect(result.suggestion).toBe('M54.50')
    }
  })

  it('preserves the user-entered code in the failure payload', () => {
    const result = validateIcd10Code('m54.5')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('M54.5')
  })
})

describe('normalizeIcd10Code', () => {
  it('returns the valid code unchanged (uppercased)', () => {
    expect(normalizeIcd10Code('M54.50')).toBe('M54.50')
    expect(normalizeIcd10Code('m54.50')).toBe('M54.50')
  })

  it('replaces non-billable parent M54.5 with M54.50', () => {
    expect(normalizeIcd10Code('M54.5')).toBe('M54.50')
  })

  it('returns the raw uppercased code when structurally invalid (caller handles rejection)', () => {
    expect(normalizeIcd10Code('garbage')).toBe('GARBAGE')
  })
})

describe('NON_BILLABLE_PARENT_CODES map', () => {
  it('maps M54.5 → M54.50', () => {
    expect(NON_BILLABLE_PARENT_CODES['M54.5']).toBe('M54.50')
  })
})

describe('classifyIcd10Code', () => {
  it.each(['M50.00', 'M50.01', 'M50.02', 'M47.1', 'M47.11', 'M48.0', 'M48.06', 'M54.18'])(
    'classifies %s as myelopathy',
    (code) => {
      expect(classifyIcd10Code(code)).toBe('myelopathy')
    },
  )

  it.each(['M50.12', 'M50.121', 'M51.16', 'M51.17', 'M54.12', 'M54.17'])(
    'classifies %s as radiculopathy',
    (code) => {
      expect(classifyIcd10Code(code)).toBe('radiculopathy')
    },
  )

  it.each(['M54.2', 'M54.50', 'M50.20', 'M51.36', 'M51.37', 'G47.9', 'G44.309'])(
    'classifies %s as other',
    (code) => {
      expect(classifyIcd10Code(code)).toBe('other')
    },
  )

  it('is case-insensitive and trims whitespace', () => {
    expect(classifyIcd10Code('  m50.00  ')).toBe('myelopathy')
  })

  it('returns other for null/undefined/empty', () => {
    expect(classifyIcd10Code(null)).toBe('other')
    expect(classifyIcd10Code(undefined)).toBe('other')
    expect(classifyIcd10Code('')).toBe('other')
  })

  it('exported patterns match expected families', () => {
    expect(MYELOPATHY_CODE_PATTERN.test('M50.00')).toBe(true)
    expect(RADICULOPATHY_CODE_PATTERN.test('M51.17')).toBe(true)
  })
})
