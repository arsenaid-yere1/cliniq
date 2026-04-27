import { describe, it, expect } from 'vitest'
import {
  lateralityFromSites,
  labelWithLaterality,
  injectionSiteFromSites,
  totalVolumeFromSites,
  sitesFromLegacyString,
  parseSitesJsonb,
  type ProcedureSite,
} from './sites-helpers'

const site = (overrides: Partial<ProcedureSite> = {}): ProcedureSite => ({
  label: 'Knee',
  laterality: null,
  volume_ml: null,
  target_confirmed_imaging: null,
  ...overrides,
})

describe('lateralityFromSites', () => {
  it('returns single value when all sites match', () => {
    expect(lateralityFromSites([
      site({ label: 'L4-L5', laterality: 'left' }),
      site({ label: 'L5-S1', laterality: 'left' }),
    ])).toBe('left')
  })
  it("returns 'mixed' for divergent lateralities", () => {
    expect(lateralityFromSites([
      site({ label: 'Knee', laterality: 'right' }),
      site({ label: 'Shoulder', laterality: 'left' }),
    ])).toBe('mixed')
  })
  it('returns null when all lateralities are null', () => {
    expect(lateralityFromSites([site({ label: 'Hip' })])).toBeNull()
  })
  it('ignores null lateralities when one site has a value', () => {
    expect(lateralityFromSites([
      site({ label: 'Knee', laterality: 'right' }),
      site({ label: 'Shoulder', laterality: null }),
    ])).toBe('right')
  })
})

describe('labelWithLaterality', () => {
  it('prepends Left/Right/Bilateral', () => {
    expect(labelWithLaterality(site({ label: 'Knee', laterality: 'right' }))).toBe('Right Knee')
    expect(labelWithLaterality(site({ label: 'Knee', laterality: 'bilateral' }))).toBe('Bilateral Knee')
  })
  it('returns label as-is when laterality is null', () => {
    expect(labelWithLaterality(site({ label: 'L5-S1' }))).toBe('L5-S1')
  })
})

describe('injectionSiteFromSites', () => {
  it('comma-joins with laterality prefixes', () => {
    expect(injectionSiteFromSites([
      site({ label: 'Knee', laterality: 'right' }),
      site({ label: 'Shoulder', laterality: 'left' }),
    ])).toBe('Right Knee, Left Shoulder')
  })
  it('returns empty string for empty array', () => {
    expect(injectionSiteFromSites([])).toBe('')
  })
})

describe('totalVolumeFromSites', () => {
  it('sums per-site volumes when all entered', () => {
    expect(totalVolumeFromSites([
      site({ label: 'A', volume_ml: 3 }),
      site({ label: 'B', volume_ml: 4 }),
    ], null)).toBe(7)
  })
  it('returns fallback when any site has null volume', () => {
    expect(totalVolumeFromSites([
      site({ label: 'A', volume_ml: 3 }),
      site({ label: 'B', volume_ml: null }),
    ], 6)).toBe(6)
  })
  it('returns fallback for empty sites', () => {
    expect(totalVolumeFromSites([], 5)).toBe(5)
  })
})

describe('sitesFromLegacyString', () => {
  it('splits comma-joined sites and inherits laterality', () => {
    const sites = sitesFromLegacyString('L4-L5, L5-S1', 'bilateral')
    expect(sites).toHaveLength(2)
    expect(sites[0]).toMatchObject({ label: 'L4-L5', laterality: 'bilateral', volume_ml: null })
    expect(sites[1]).toMatchObject({ label: 'L5-S1', laterality: 'bilateral', volume_ml: null })
  })
  it('handles slash separator', () => {
    expect(sitesFromLegacyString('L4-L5/L5-S1', null)).toHaveLength(2)
  })
  it('returns empty array for null/empty input', () => {
    expect(sitesFromLegacyString(null, null)).toEqual([])
    expect(sitesFromLegacyString('', null)).toEqual([])
  })
  it('handles "and" conjunction', () => {
    expect(sitesFromLegacyString('Knee and Shoulder', null)).toHaveLength(2)
  })
})

describe('parseSitesJsonb', () => {
  it('parses valid jsonb shape', () => {
    const raw = [{ label: 'Knee', laterality: 'right', volume_ml: 5, target_confirmed_imaging: true }]
    expect(parseSitesJsonb(raw)).toHaveLength(1)
    expect(parseSitesJsonb(raw)[0]).toMatchObject({ label: 'Knee', laterality: 'right', volume_ml: 5 })
  })
  it('returns empty array for non-array input', () => {
    expect(parseSitesJsonb(null)).toEqual([])
    expect(parseSitesJsonb({})).toEqual([])
  })
  it('skips invalid entries', () => {
    const raw = [
      { label: 'Knee', laterality: null, volume_ml: null, target_confirmed_imaging: null },
      { invalid: 'shape' },
    ]
    expect(parseSitesJsonb(raw)).toHaveLength(1)
  })
})
