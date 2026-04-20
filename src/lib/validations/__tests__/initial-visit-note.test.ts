import { describe, it, expect } from 'vitest'
import {
  initialVisitSections,
  sectionLabels,
  initialVisitNoteResultSchema,
  initialVisitNoteEditSchema,
  initialVisitVitalsSchema,
  romMovementSchema,
  romRegionSchema,
  initialVisitRomSchema,
  defaultRomData,
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

describe('romMovementSchema', () => {
  it('accepts valid movement', () => {
    expect(romMovementSchema.safeParse({
      movement: 'Flexion', normal: 60, actual: 45, pain: true,
    }).success).toBe(true)
  })

  it('rejects empty movement', () => {
    expect(romMovementSchema.safeParse({
      movement: '', normal: 60, actual: null, pain: false,
    }).success).toBe(false)
  })

  it('accepts null normal and actual', () => {
    expect(romMovementSchema.safeParse({
      movement: 'Flexion', normal: null, actual: null, pain: false,
    }).success).toBe(true)
  })

  it('accepts boundary values 0 and 360', () => {
    expect(romMovementSchema.safeParse({
      movement: 'Flexion', normal: 0, actual: 360, pain: false,
    }).success).toBe(true)
  })

  it('rejects out-of-range normal/actual', () => {
    expect(romMovementSchema.safeParse({
      movement: 'Flexion', normal: -1, actual: null, pain: false,
    }).success).toBe(false)
    expect(romMovementSchema.safeParse({
      movement: 'Flexion', normal: null, actual: 361, pain: false,
    }).success).toBe(false)
  })
})

describe('romRegionSchema', () => {
  it('accepts valid region with movements', () => {
    expect(romRegionSchema.safeParse({
      region: 'Cervical Spine',
      movements: [{ movement: 'Flexion', normal: 60, actual: null, pain: false }],
    }).success).toBe(true)
  })

  it('rejects empty region', () => {
    expect(romRegionSchema.safeParse({
      region: '',
      movements: [{ movement: 'Flexion', normal: 60, actual: null, pain: false }],
    }).success).toBe(false)
  })

  it('rejects empty movements array', () => {
    expect(romRegionSchema.safeParse({
      region: 'Cervical Spine',
      movements: [],
    }).success).toBe(false)
  })
})

describe('defaultRomData', () => {
  it('has 9 regions', () => {
    expect(defaultRomData).toHaveLength(9)
  })

  it('has correct number of movements per region', () => {
    const expected: Record<string, number> = {
      'Cervical Spine': 6,
      'Thoracic Spine': 4,
      'Lumbar Spine': 6,
      'Left Shoulder': 6,
      'Right Shoulder': 6,
      'Left Knee': 2,
      'Right Knee': 2,
      'Left Hip': 6,
      'Right Hip': 6,
    }
    for (const region of defaultRomData) {
      expect(region.movements).toHaveLength(expected[region.region])
    }
  })

  it('has all actual values as null', () => {
    for (const region of defaultRomData) {
      for (const m of region.movements) {
        expect(m.actual).toBeNull()
      }
    }
  })

  it('has all pain values as false', () => {
    for (const region of defaultRomData) {
      for (const m of region.movements) {
        expect(m.pain).toBe(false)
      }
    }
  })

  it('passes initialVisitRomSchema validation', () => {
    expect(initialVisitRomSchema.safeParse(defaultRomData).success).toBe(true)
  })
})
