import { describe, it, expect } from 'vitest'
import { parseBodyRegion } from '../procedures'

describe('parseBodyRegion', () => {
  it('parses full "Left" prefix', () => {
    expect(parseBodyRegion('Left Knee')).toEqual({
      injection_site: 'Knee',
      laterality: 'left',
    })
  })

  it('parses single-letter "L" prefix', () => {
    expect(parseBodyRegion('L Knee')).toEqual({
      injection_site: 'Knee',
      laterality: 'left',
    })
  })

  it('parses "Lt." with trailing period', () => {
    expect(parseBodyRegion('Lt. Shoulder')).toEqual({
      injection_site: 'Shoulder',
      laterality: 'left',
    })
  })

  it('parses "R" prefix with multi-word site', () => {
    expect(parseBodyRegion('R lower back')).toEqual({
      injection_site: 'Lower Back',
      laterality: 'right',
    })
  })

  it('parses uppercase "RT" prefix', () => {
    expect(parseBodyRegion('RT hip')).toEqual({
      injection_site: 'Hip',
      laterality: 'right',
    })
  })

  it('parses "Bilateral" and de-pluralizes site', () => {
    expect(parseBodyRegion('Bilateral Knees')).toEqual({
      injection_site: 'Knee',
      laterality: 'bilateral',
    })
  })

  it('parses "both" as bilateral', () => {
    expect(parseBodyRegion('both wrists')).toEqual({
      injection_site: 'Wrist',
      laterality: 'bilateral',
    })
  })

  it('returns null laterality for unprefixed single word', () => {
    expect(parseBodyRegion('Neck')).toEqual({
      injection_site: 'Neck',
      laterality: null,
    })
  })

  it('title-cases unprefixed multi-word region', () => {
    expect(parseBodyRegion('lower back')).toEqual({
      injection_site: 'Lower Back',
      laterality: null,
    })
  })

  it('trims surrounding whitespace', () => {
    expect(parseBodyRegion('  Lower Back  ')).toEqual({
      injection_site: 'Lower Back',
      laterality: null,
    })
  })

  it('handles empty string', () => {
    expect(parseBodyRegion('')).toEqual({
      injection_site: '',
      laterality: null,
    })
  })
})
