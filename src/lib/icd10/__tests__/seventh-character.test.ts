import { describe, expect, it } from 'vitest'
import {
  getSeventhCharacter,
  isInitialEncounterSuffix,
  isSubsequentEncounterSuffix,
  isSequelaSuffix,
  isM545Parent,
  rewriteASuffixToD,
  rewriteASuffixToS,
} from '../seventh-character'

describe('getSeventhCharacter', () => {
  it('extracts A/D/S suffix', () => {
    expect(getSeventhCharacter('S13.4XXA')).toBe('A')
    expect(getSeventhCharacter('S13.4XXD')).toBe('D')
    expect(getSeventhCharacter('S13.4XXS')).toBe('S')
  })

  it('returns null for codes without A/D/S 7th char', () => {
    expect(getSeventhCharacter('M54.50')).toBeNull()
    expect(getSeventhCharacter('M54.5')).toBeNull()
    expect(getSeventhCharacter('G44.309')).toBeNull()
  })

  it('returns null for null/undefined/empty', () => {
    expect(getSeventhCharacter(null)).toBeNull()
    expect(getSeventhCharacter(undefined)).toBeNull()
    expect(getSeventhCharacter('')).toBeNull()
  })

  it('handles mixed case', () => {
    expect(getSeventhCharacter('s13.4xxa')).toBe('A')
  })
})

describe('isInitialEncounterSuffix / D / S', () => {
  it('detects A suffix', () => {
    expect(isInitialEncounterSuffix('S33.5XXA')).toBe(true)
    expect(isInitialEncounterSuffix('S33.5XXD')).toBe(false)
  })

  it('detects D suffix', () => {
    expect(isSubsequentEncounterSuffix('S33.5XXD')).toBe(true)
    expect(isSubsequentEncounterSuffix('S33.5XXA')).toBe(false)
  })

  it('detects S suffix', () => {
    expect(isSequelaSuffix('S33.5XXS')).toBe(true)
    expect(isSequelaSuffix('S33.5XXA')).toBe(false)
  })
})

describe('isM545Parent', () => {
  it('matches the bare parent only', () => {
    expect(isM545Parent('M54.5')).toBe(true)
    expect(isM545Parent('m54.5')).toBe(true)
  })

  it('rejects 5th-character subcodes', () => {
    expect(isM545Parent('M54.50')).toBe(false)
    expect(isM545Parent('M54.51')).toBe(false)
    expect(isM545Parent('M54.59')).toBe(false)
  })

  it('rejects null/empty', () => {
    expect(isM545Parent(null)).toBe(false)
    expect(isM545Parent(undefined)).toBe(false)
    expect(isM545Parent('')).toBe(false)
  })
})

describe('rewriteASuffixToD', () => {
  it('rewrites A → D mechanically', () => {
    expect(rewriteASuffixToD('S13.4XXA')).toBe('S13.4XXD')
    expect(rewriteASuffixToD('S33.5XXA')).toBe('S33.5XXD')
    expect(rewriteASuffixToD('S39.012A')).toBe('S39.012D')
    expect(rewriteASuffixToD('S43.402A')).toBe('S43.402D')
  })

  it('leaves D and S suffix codes unchanged', () => {
    expect(rewriteASuffixToD('S13.4XXD')).toBe('S13.4XXD')
    expect(rewriteASuffixToD('S13.4XXS')).toBe('S13.4XXS')
  })

  it('leaves non-suffix codes unchanged', () => {
    expect(rewriteASuffixToD('M54.50')).toBe('M54.50')
    expect(rewriteASuffixToD('G44.309')).toBe('G44.309')
  })

  it('preserves external-cause codes verbatim', () => {
    expect(rewriteASuffixToD('V43.52XA')).toBe('V43.52XA')
    expect(rewriteASuffixToD('W01.0XXA')).toBe('W01.0XXA')
    expect(rewriteASuffixToD('W18.49XA')).toBe('W18.49XA')
  })

  it('handles whitespace + lowercase', () => {
    expect(rewriteASuffixToD(' s13.4xxa ')).toBe('S13.4XXD')
  })

  it('returns input on empty/null', () => {
    expect(rewriteASuffixToD('')).toBe('')
  })
})

describe('rewriteASuffixToS', () => {
  it('rewrites A → S mechanically', () => {
    expect(rewriteASuffixToS('S13.4XXA')).toBe('S13.4XXS')
  })

  it('preserves external-cause + non-suffix', () => {
    expect(rewriteASuffixToS('V43.52XA')).toBe('V43.52XA')
    expect(rewriteASuffixToS('M54.50')).toBe('M54.50')
  })
})
