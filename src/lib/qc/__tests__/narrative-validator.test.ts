import { describe, it, expect } from 'vitest'
import { validateNarrative } from '@/lib/qc/narrative-validator'

describe('validateNarrative', () => {
  it('returns no warnings for clean sections', () => {
    const result = validateNarrative({
      subjective: 'The patient reports pain rated 6/10 in the cervical region on 05/14/2026, consistent with the initial evaluation findings.',
      assessment: 'Cervical strain remains the primary clinical diagnosis. Pain has decreased meaningfully across the injection series.',
    })
    expect(result).toEqual([])
  })

  it('flags banned hedge words', () => {
    const result = validateNarrative({
      subjective: 'The patient reports pain that is quite severe and potentially related to the accident.',
    })
    const codes = result.map((w) => w.code)
    expect(codes).toContain('banned_hedge')
    expect(result.filter((w) => w.code === 'banned_hedge').length).toBeGreaterThanOrEqual(2)
  })

  it('flags forbidden phrases note-wide', () => {
    const result = validateNarrative({
      prognosis: 'Patient expected to achieve full recovery within weeks.',
      patient_education: 'PRP harnesses the body\'s own regenerative capacity to repair tissue.',
    })
    const codes = result.map((w) => w.code)
    expect(codes.filter((c) => c === 'forbidden_phrase').length).toBeGreaterThanOrEqual(2)
  })

  it('flags ISO date format', () => {
    const result = validateNarrative({
      subjective: 'The patient was evaluated on 2026-05-14 following the accident.',
    })
    expect(result.find((w) => w.code === 'bad_date_format')).toBeDefined()
  })

  it('flags long-form date', () => {
    const result = validateNarrative({
      assessment: 'On May 14, 2026 the patient presented for evaluation. The exam was unremarkable.',
    })
    expect(result.find((w) => w.code === 'bad_date_format')).toBeDefined()
  })

  it('flags cross-section duplicates over 70% overlap', () => {
    const sharedSentence = 'Pain decreased from 8/10 at the initial evaluation to 4/10 at todays visit, reflecting meaningful and sustained improvement.'
    const result = validateNarrative({
      subjective: sharedSentence,
      assessment: sharedSentence + ' Additional context follows.',
    })
    expect(result.find((w) => w.code === 'duplicate_across_sections')).toBeDefined()
  })

  it('does not flag short boilerplate sections when outside scope', () => {
    const result = validateNarrative(
      { allergies: 'NKDA' },
      { duplicateScope: ['subjective'] },
    )
    expect(result.filter((w) => w.code === 'section_too_short')).toEqual([])
  })

  it('flags very short sections when in scope', () => {
    const result = validateNarrative(
      { subjective: 'Short.' },
      { duplicateScope: ['subjective'] },
    )
    expect(result.find((w) => w.code === 'section_too_short')).toBeDefined()
  })

  it('ignores empty/null sections silently', () => {
    const result = validateNarrative({ subjective: '', assessment: null, plan: undefined })
    expect(result).toEqual([])
  })
})
