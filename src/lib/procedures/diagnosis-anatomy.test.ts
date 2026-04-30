import { describe, it, expect } from 'vitest'
import {
  classifyAnatomyFromIcd10,
  singleAnatomyFromDiagnoses,
} from './diagnosis-anatomy'

describe('classifyAnatomyFromIcd10', () => {
  it('classifies knee codes', () => {
    expect(classifyAnatomyFromIcd10('M17.11')).toBe('knee')
    expect(classifyAnatomyFromIcd10('M17.0')).toBe('knee')
    expect(classifyAnatomyFromIcd10('S83.501A')).toBe('knee')
  })
  it('classifies shoulder codes', () => {
    expect(classifyAnatomyFromIcd10('M75.51')).toBe('shoulder')
    expect(classifyAnatomyFromIcd10('M19.011')).toBe('shoulder')
  })
  it('classifies hip codes', () => {
    expect(classifyAnatomyFromIcd10('M16.11')).toBe('hip')
    expect(classifyAnatomyFromIcd10('M25.551')).toBe('hip')
  })
  it('classifies lumbar spine codes', () => {
    expect(classifyAnatomyFromIcd10('M51.16')).toBe('lumbar_facet')
    expect(classifyAnatomyFromIcd10('M51.26')).toBe('lumbar_facet')
    expect(classifyAnatomyFromIcd10('M54.5')).toBe('lumbar_facet')
    expect(classifyAnatomyFromIcd10('M54.16')).toBe('lumbar_facet')
  })
  it('classifies cervical spine codes', () => {
    expect(classifyAnatomyFromIcd10('M50.20')).toBe('cervical_facet')
    expect(classifyAnatomyFromIcd10('M50.121')).toBe('cervical_facet')
    expect(classifyAnatomyFromIcd10('M54.2')).toBe('cervical_facet')
  })
  it('classifies sacroiliac codes', () => {
    expect(classifyAnatomyFromIcd10('M53.3')).toBe('sacroiliac')
    expect(classifyAnatomyFromIcd10('M53.2X8')).toBe('sacroiliac')
  })
  it('classifies ankle codes', () => {
    expect(classifyAnatomyFromIcd10('S93.401A')).toBe('ankle')
    expect(classifyAnatomyFromIcd10('M19.071')).toBe('ankle')
  })
  it('returns null for unrecognized', () => {
    expect(classifyAnatomyFromIcd10('Z00.00')).toBeNull()
    expect(classifyAnatomyFromIcd10(null)).toBeNull()
    expect(classifyAnatomyFromIcd10('')).toBeNull()
  })
  it('ignores case', () => {
    expect(classifyAnatomyFromIcd10('m17.11')).toBe('knee')
  })
})

describe('singleAnatomyFromDiagnoses', () => {
  it('returns single anatomy when all diagnoses agree', () => {
    expect(
      singleAnatomyFromDiagnoses([
        { icd10_code: 'M51.16' },
        { icd10_code: 'M54.5' },
      ]),
    ).toBe('lumbar_facet')
  })
  it('returns null when diagnoses span anatomies', () => {
    expect(
      singleAnatomyFromDiagnoses([
        { icd10_code: 'M17.11' },
        { icd10_code: 'M75.51' },
      ]),
    ).toBeNull()
  })
  it('ignores unclassifiable codes when remainder agrees', () => {
    expect(
      singleAnatomyFromDiagnoses([
        { icd10_code: 'M17.11' },
        { icd10_code: 'V43.52XA' }, // external-cause, not a body region
      ]),
    ).toBe('knee')
  })
  it('returns null when no code classifies', () => {
    expect(
      singleAnatomyFromDiagnoses([{ icd10_code: 'V43.52XA' }]),
    ).toBeNull()
  })
  it('returns null on empty array', () => {
    expect(singleAnatomyFromDiagnoses([])).toBeNull()
  })
})
