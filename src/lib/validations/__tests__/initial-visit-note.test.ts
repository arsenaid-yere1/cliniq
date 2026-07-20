import { describe, it, expect } from 'vitest'
import {
  initialVisitSections,
  sectionLabels,
  initialVisitNoteResultSchema,
  initialVisitNoteEditSchema,
  initialVisitVitalsSchema,
} from '../initial-visit-note'

const validNoteData: Record<string, string> = {}
for (const key of initialVisitSections) {
  validNoteData[key] = `Content for ${key}`
}

describe('initialVisitSections', () => {
  it('has 16 entries', () => {
    expect(initialVisitSections).toHaveLength(16)
  })
})

describe('sectionLabels', () => {
  it('has a label for every section', () => {
    for (const key of initialVisitSections) {
      expect(sectionLabels[key]).toBeDefined()
      expect(typeof sectionLabels[key]).toBe('string')
    }
  })
})

describe('initialVisitNoteResultSchema', () => {
  it('accepts valid data', () => {
    expect(initialVisitNoteResultSchema.safeParse(validNoteData).success).toBe(true)
  })

  it('accepts empty strings', () => {
    const emptyData: Record<string, string> = {}
    for (const key of initialVisitSections) {
      emptyData[key] = ''
    }
    expect(initialVisitNoteResultSchema.safeParse(emptyData).success).toBe(true)
  })
})

describe('initialVisitNoteEditSchema', () => {
  const validEditData = { ...validNoteData, visit_date: '2026-04-20' }

  it('accepts valid data', () => {
    expect(initialVisitNoteEditSchema.safeParse(validEditData).success).toBe(true)
  })

  it('rejects empty strings on all section keys', () => {
    for (const key of initialVisitSections) {
      const data = { ...validEditData, [key]: '' }
      expect(initialVisitNoteEditSchema.safeParse(data).success).toBe(false)
    }
  })
})

describe('initialVisitVitalsSchema', () => {
  const validVitals = {
    bp_systolic: 120,
    bp_diastolic: 80,
    heart_rate: 72,
    respiratory_rate: 16,
    temperature_f: 98.6,
    spo2_percent: 98,
    pain_score_min: 3,
    pain_score_max: 6,
  }

  it('accepts valid vitals', () => {
    expect(initialVisitVitalsSchema.safeParse(validVitals).success).toBe(true)
  })

  it('accepts all fields as null', () => {
    const result = initialVisitVitalsSchema.safeParse({
      bp_systolic: null,
      bp_diastolic: null,
      heart_rate: null,
      respiratory_rate: null,
      temperature_f: null,
      spo2_percent: null,
      pain_score_min: null,
      pain_score_max: null,
    })
    expect(result.success).toBe(true)
  })

  it('accepts boundary min values', () => {
    const result = initialVisitVitalsSchema.safeParse({
      bp_systolic: 1,
      bp_diastolic: 1,
      heart_rate: 1,
      respiratory_rate: 1,
      temperature_f: 90,
      spo2_percent: 0,
      pain_score_min: 0,
      pain_score_max: 0,
    })
    expect(result.success).toBe(true)
  })

  it('accepts boundary max values', () => {
    const result = initialVisitVitalsSchema.safeParse({
      bp_systolic: 300,
      bp_diastolic: 200,
      heart_rate: 300,
      respiratory_rate: 60,
      temperature_f: 110,
      spo2_percent: 100,
      pain_score_min: 10,
      pain_score_max: 10,
    })
    expect(result.success).toBe(true)
  })

  it('rejects out-of-range values', () => {
    expect(initialVisitVitalsSchema.safeParse({ ...validVitals, bp_systolic: 301 }).success).toBe(false)
    expect(initialVisitVitalsSchema.safeParse({ ...validVitals, bp_systolic: 0 }).success).toBe(false)
    expect(initialVisitVitalsSchema.safeParse({ ...validVitals, bp_diastolic: 201 }).success).toBe(false)
    expect(initialVisitVitalsSchema.safeParse({ ...validVitals, heart_rate: 301 }).success).toBe(false)
    expect(initialVisitVitalsSchema.safeParse({ ...validVitals, respiratory_rate: 61 }).success).toBe(false)
    expect(initialVisitVitalsSchema.safeParse({ ...validVitals, temperature_f: 89 }).success).toBe(false)
    expect(initialVisitVitalsSchema.safeParse({ ...validVitals, temperature_f: 111 }).success).toBe(false)
    expect(initialVisitVitalsSchema.safeParse({ ...validVitals, spo2_percent: -1 }).success).toBe(false)
    expect(initialVisitVitalsSchema.safeParse({ ...validVitals, spo2_percent: 101 }).success).toBe(false)
  })
})
