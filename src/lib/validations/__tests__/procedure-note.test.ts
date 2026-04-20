import { describe, it, expect } from 'vitest'
import {
  procedureNoteSections,
  procedureNoteSectionLabels,
  procedureNoteResultSchema,
  procedureNoteEditSchema,
} from '../procedure-note'

const validData: Record<string, string> = {}
for (const key of procedureNoteSections) {
  validData[key] = `Content for ${key}`
}

describe('procedureNoteSections', () => {
  it('has 20 entries', () => {
    expect(procedureNoteSections).toHaveLength(20)
  })

  it('includes clinician_disclaimer', () => {
    expect(procedureNoteSections).toContain('clinician_disclaimer')
  })
})

describe('procedureNoteSectionLabels', () => {
  it('has a label for every section', () => {
    for (const key of procedureNoteSections) {
      expect(procedureNoteSectionLabels[key]).toBeDefined()
      expect(typeof procedureNoteSectionLabels[key]).toBe('string')
    }
  })
})

describe('procedureNoteResultSchema', () => {
  it('accepts valid data with all sections populated', () => {
    expect(procedureNoteResultSchema.safeParse(validData).success).toBe(true)
  })

  it('accepts empty strings (AI may return empty sections)', () => {
    const emptyData: Record<string, string> = {}
    for (const key of procedureNoteSections) {
      emptyData[key] = ''
    }
    expect(procedureNoteResultSchema.safeParse(emptyData).success).toBe(true)
  })
})

describe('procedureNoteEditSchema', () => {
  it('accepts valid data with all sections populated', () => {
    expect(procedureNoteEditSchema.safeParse(validData).success).toBe(true)
  })

  it('rejects empty strings on all section keys', () => {
    for (const key of procedureNoteSections) {
      const data = { ...validData, [key]: '' }
      const result = procedureNoteEditSchema.safeParse(data)
      expect(result.success).toBe(false)
    }
  })
})
