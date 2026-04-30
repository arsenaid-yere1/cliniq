import { describe, expect, it } from 'vitest'
import {
  isExternalCauseCode,
  findExternalCauseCodes,
  ACCIDENT_TYPE_EXPECTATIONS,
} from '../external-cause'

describe('isExternalCauseCode', () => {
  it('returns true for V codes', () => {
    expect(isExternalCauseCode('V43.52XA')).toBe(true)
    expect(isExternalCauseCode('V49.40XA')).toBe(true)
  })

  it('returns true for W codes', () => {
    expect(isExternalCauseCode('W01.0XXA')).toBe(true)
    expect(isExternalCauseCode('W18.49XA')).toBe(true)
  })

  it('returns true for X and Y codes', () => {
    expect(isExternalCauseCode('X99.0XXA')).toBe(true)
    expect(isExternalCauseCode('Y04.0XXA')).toBe(true)
  })

  it('returns false for non-external codes', () => {
    expect(isExternalCauseCode('M54.5')).toBe(false)
    expect(isExternalCauseCode('M54.50')).toBe(false)
    expect(isExternalCauseCode('S13.4XXA')).toBe(false)
    expect(isExternalCauseCode('G44.309')).toBe(false)
  })

  it('returns false for null/undefined/empty', () => {
    expect(isExternalCauseCode(null)).toBe(false)
    expect(isExternalCauseCode(undefined)).toBe(false)
    expect(isExternalCauseCode('')).toBe(false)
  })

  it('handles whitespace + lowercase', () => {
    expect(isExternalCauseCode(' v43.52xa ')).toBe(true)
  })
})

describe('findExternalCauseCodes', () => {
  it('extracts external-cause codes preserving order, uppercased', () => {
    expect(
      findExternalCauseCodes(['V43.52XA', 'M54.5', 'W18.49XA', null, 'M50.20']),
    ).toEqual(['V43.52XA', 'W18.49XA'])
  })

  it('returns empty array when no external-cause codes present', () => {
    expect(findExternalCauseCodes(['M54.50', 'S13.4XXD'])).toEqual([])
  })

  it('returns empty array on empty input', () => {
    expect(findExternalCauseCodes([])).toEqual([])
  })
})

describe('ACCIDENT_TYPE_EXPECTATIONS', () => {
  it('maps the three known accident types', () => {
    expect(ACCIDENT_TYPE_EXPECTATIONS.auto.example).toBe('V43.52XA')
    expect(ACCIDENT_TYPE_EXPECTATIONS.slip_and_fall.example).toBe('W01.0XXA')
    expect(ACCIDENT_TYPE_EXPECTATIONS.workplace.example).toBe('W18.49XA')
  })
})
