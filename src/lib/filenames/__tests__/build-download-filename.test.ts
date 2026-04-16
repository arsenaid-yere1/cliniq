import { describe, it, expect } from 'vitest'
import {
  buildDownloadFilename,
  formatFilenameDate,
  slugifyLastName,
} from '../build-download-filename'

describe('slugifyLastName', () => {
  it('strips apostrophes', () => {
    expect(slugifyLastName("O'Brien")).toBe('OBrien')
  })

  it('strips accents and diacritics', () => {
    expect(slugifyLastName('Núñez')).toBe('Nunez')
    expect(slugifyLastName('Çelik')).toBe('Celik')
    expect(slugifyLastName('Müller')).toBe('Muller')
  })

  it('removes spaces from multi-word names', () => {
    expect(slugifyLastName('Van Der Berg')).toBe('VanDerBerg')
    expect(slugifyLastName('de la Cruz')).toBe('delaCruz')
  })

  it('preserves hyphens between segments', () => {
    expect(slugifyLastName('Smith-Jones')).toBe('Smith-Jones')
  })

  it('collapses consecutive hyphens and trims them', () => {
    expect(slugifyLastName('--Smith--Jones--')).toBe('Smith-Jones')
  })

  it('returns Unknown for empty, whitespace-only, or null input', () => {
    expect(slugifyLastName('')).toBe('Unknown')
    expect(slugifyLastName('   ')).toBe('Unknown')
    expect(slugifyLastName(null)).toBe('Unknown')
    expect(slugifyLastName(undefined)).toBe('Unknown')
  })

  it('returns Unknown when only unsupported characters remain', () => {
    expect(slugifyLastName('!!!')).toBe('Unknown')
    expect(slugifyLastName('你好')).toBe('Unknown')
  })
})

describe('formatFilenameDate', () => {
  it('passes through YYYY-MM-DD strings', () => {
    expect(formatFilenameDate('2026-04-10')).toBe('2026-04-10')
  })

  it('truncates ISO timestamp strings to the date portion', () => {
    expect(formatFilenameDate('2026-04-10T12:34:56Z')).toBe('2026-04-10')
  })

  it('formats Date objects as YYYY-MM-DD', () => {
    expect(formatFilenameDate(new Date('2026-04-10T00:00:00Z'))).toBe('2026-04-10')
  })

  it('falls back to today for null or undefined', () => {
    const today = new Date().toISOString().slice(0, 10)
    expect(formatFilenameDate(null)).toBe(today)
    expect(formatFilenameDate(undefined)).toBe(today)
  })
})

describe('buildDownloadFilename', () => {
  it('produces LastName_DocType_Date.pdf', () => {
    expect(
      buildDownloadFilename({
        lastName: 'Smith',
        docType: 'DischargeSummary',
        date: '2026-04-10',
      })
    ).toBe('Smith_DischargeSummary_2026-04-10.pdf')
  })

  it('strips accents in the last name', () => {
    expect(
      buildDownloadFilename({
        lastName: 'Núñez',
        docType: 'ProcedureNote',
        date: '2026-04-10',
      })
    ).toBe('Nunez_ProcedureNote_2026-04-10.pdf')
  })

  it('includes extra identifier before the date', () => {
    expect(
      buildDownloadFilename({
        lastName: 'Smith',
        docType: 'Invoice',
        extra: 'INV-2026-0042',
        date: '2026-04-10',
      })
    ).toBe('Smith_Invoice_INV-2026-0042_2026-04-10.pdf')
  })

  it('honours a custom extension', () => {
    expect(
      buildDownloadFilename({
        lastName: 'Smith',
        docType: 'Report',
        date: '2026-04-10',
        extension: 'docx',
      })
    ).toBe('Smith_Report_2026-04-10.docx')
  })

  it('uses Unknown when last name is missing', () => {
    expect(
      buildDownloadFilename({
        lastName: null,
        docType: 'DischargeSummary',
        date: '2026-04-10',
      })
    ).toBe('Unknown_DischargeSummary_2026-04-10.pdf')
  })

  it('falls back to today when date is missing', () => {
    const today = new Date().toISOString().slice(0, 10)
    expect(
      buildDownloadFilename({
        lastName: 'Smith',
        docType: 'ProcedureConsent',
      })
    ).toBe(`Smith_ProcedureConsent_${today}.pdf`)
  })
})
