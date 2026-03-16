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
  it('has 13 entries', () => {
    expect(dischargeNoteSections).toHaveLength(13)
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
  it('accepts valid data with all sections populated', () => {
    expect(dischargeNoteEditSchema.safeParse(validData).success).toBe(true)
  })

  it('rejects empty strings on all 13 section keys', () => {
    for (const key of dischargeNoteSections) {
      const data = { ...validData, [key]: '' }
      expect(dischargeNoteEditSchema.safeParse(data).success).toBe(false)
    }
  })
})
