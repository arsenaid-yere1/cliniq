import { describe, it, expect } from 'vitest'
import { parseIvnDiagnoses } from '../parse-ivn-diagnoses'

describe('parseIvnDiagnoses', () => {
  it('returns empty for null/undefined/empty', () => {
    expect(parseIvnDiagnoses(null)).toEqual([])
    expect(parseIvnDiagnoses(undefined)).toEqual([])
    expect(parseIvnDiagnoses('')).toEqual([])
  })

  it('parses bullet-prefixed em-dash format', () => {
    expect(parseIvnDiagnoses('• M54.50 — Low back pain')).toEqual([
      { icd10_code: 'M54.50', description: 'Low back pain' },
    ])
  })

  it('parses hyphen separator', () => {
    expect(parseIvnDiagnoses('M54.50 - Low back pain')).toEqual([
      { icd10_code: 'M54.50', description: 'Low back pain' },
    ])
  })

  it('parses en-dash separator', () => {
    expect(parseIvnDiagnoses('M54.50 – Low back pain')).toEqual([
      { icd10_code: 'M54.50', description: 'Low back pain' },
    ])
  })

  it('parses multiple lines', () => {
    const text = '• M54.50 — Low back pain\n• G47.9 — Sleep disorder'
    expect(parseIvnDiagnoses(text)).toEqual([
      { icd10_code: 'M54.50', description: 'Low back pain' },
      { icd10_code: 'G47.9', description: 'Sleep disorder' },
    ])
  })

  it('normalizes non-billable parent to billable child', () => {
    // M54.5 is non-billable parent → auto-upgraded to M54.50
    expect(parseIvnDiagnoses('M54.5 — Low back pain')).toEqual([
      { icd10_code: 'M54.50', description: 'Low back pain' },
    ])
  })

  it('skips lines without ICD-10 match', () => {
    const text = 'Assessment:\n• M54.50 — Low back pain\nSome free text'
    expect(parseIvnDiagnoses(text)).toEqual([
      { icd10_code: 'M54.50', description: 'Low back pain' },
    ])
  })

  it('skips structurally invalid codes', () => {
    // "XX.YY" fails ICD-10 regex in the helper (letter + 2 digits prefix)
    expect(parseIvnDiagnoses('• 123.45 — Not a code')).toEqual([])
  })

  it('trims description whitespace', () => {
    expect(parseIvnDiagnoses('M54.50 —   Low back pain   ')).toEqual([
      { icd10_code: 'M54.50', description: 'Low back pain' },
    ])
  })

  it('handles numbered list prefix', () => {
    expect(parseIvnDiagnoses('1. M54.50 — Low back pain')).toEqual([
      { icd10_code: 'M54.50', description: 'Low back pain' },
    ])
  })

  it('parses injury codes with 3+ trailing letters (XXA pattern)', () => {
    const text = [
      '• S13.4XXA — Sprain of ligaments of cervical spine, initial encounter',
      '• S16.1XXA — Strain of muscle, fascia and tendon at neck level, initial encounter',
      '• S33.5XXA — Sprain of ligaments of lumbar spine, initial encounter',
      '• S23.3XXA — Sprain of ligaments of thoracic spine, initial encounter',
    ].join('\n')
    expect(parseIvnDiagnoses(text)).toEqual([
      { icd10_code: 'S13.4XXA', description: 'Sprain of ligaments of cervical spine, initial encounter' },
      { icd10_code: 'S16.1XXA', description: 'Strain of muscle, fascia and tendon at neck level, initial encounter' },
      { icd10_code: 'S33.5XXA', description: 'Sprain of ligaments of lumbar spine, initial encounter' },
      { icd10_code: 'S23.3XXA', description: 'Sprain of ligaments of thoracic spine, initial encounter' },
    ])
  })

  it('parses 2-letter suffix codes (XA pattern)', () => {
    expect(parseIvnDiagnoses('• V43.52XA — Car occupant injured, initial encounter')).toEqual([
      { icd10_code: 'V43.52XA', description: 'Car occupant injured, initial encounter' },
    ])
  })
})
