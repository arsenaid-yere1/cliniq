import { describe, it, expect } from 'vitest'
import {
  dischargeNoteSections,
  dischargeNoteSectionLabels,
  dischargeNoteResultSchema,
  dischargeNoteEditSchema,
} from '../discharge-note'

const validData: Record<string, string> = {}
for (const key of dischargeNoteSections) {
  validData[key] = `Content for ${key}`
}

describe('dischargeNoteSections', () => {
  it('has 12 entries', () => {
    expect(dischargeNoteSections).toHaveLength(12)
  })
})

describe('dischargeNoteSectionLabels', () => {
  it('has a label for every section', () => {
    for (const key of dischargeNoteSections) {
      expect(dischargeNoteSectionLabels[key]).toBeDefined()
      expect(typeof dischargeNoteSectionLabels[key]).toBe('string')
    }
  })
})

describe('dischargeNoteResultSchema', () => {
  it('accepts valid data with all sections populated', () => {
    expect(dischargeNoteResultSchema.safeParse(validData).success).toBe(true)
  })

  it('accepts empty strings', () => {
    const emptyData: Record<string, string> = {}
    for (const key of dischargeNoteSections) {
      emptyData[key] = ''
    }
    expect(dischargeNoteResultSchema.safeParse(emptyData).success).toBe(true)
  })
})

describe('dischargeNoteEditSchema', () => {
  const validEditData = { ...validData, visit_date: '2026-04-20' }

  it('accepts valid data with all sections populated', () => {
    expect(dischargeNoteEditSchema.safeParse(validEditData).success).toBe(true)
  })

  it('rejects empty strings on all 12 section keys', () => {
    for (const key of dischargeNoteSections) {
      const data = { ...validEditData, [key]: '' }
      expect(dischargeNoteEditSchema.safeParse(data).success).toBe(false)
    }
  })
})
