import { describe, it, expect } from 'vitest'
import { sitesFromPlan } from './sites-from-plan'
import type { PlannedProcedure } from './compute-plan-alignment'

const pm = (overrides: Partial<PlannedProcedure> = {}): PlannedProcedure => ({
  source: 'pm_extraction',
  body_region: null,
  laterality: null,
  guidance_hint: null,
  target_levels: [],
  raw_description: '',
  ...overrides,
})
const iv = (overrides: Partial<PlannedProcedure> = {}): PlannedProcedure => ({
  ...pm(overrides),
  source: 'initial_visit_note',
})

describe('sitesFromPlan', () => {
  it('returns [] when both inputs are empty', () => {
    expect(sitesFromPlan([], [])).toEqual([])
  })

  it('expands target_levels into one site per level', () => {
    const result = sitesFromPlan(
      [pm({ body_region: 'lumbar', target_levels: ['L4-L5', 'L5-S1'], laterality: 'bilateral' })],
      [],
    )
    expect(result).toEqual([
      { label: 'L4-L5', laterality: 'bilateral', volume_ml: null, target_confirmed_imaging: null },
      { label: 'L5-S1', laterality: 'bilateral', volume_ml: null, target_confirmed_imaging: null },
    ])
  })

  it('falls back to title-cased body_region when target_levels is empty', () => {
    const result = sitesFromPlan(
      [pm({ body_region: 'knee', laterality: 'right' })],
      [],
    )
    expect(result).toEqual([
      { label: 'Knee', laterality: 'right', volume_ml: null, target_confirmed_imaging: null },
    ])
  })

  it('skips candidates with no levels and no body_region', () => {
    const result = sitesFromPlan(
      [pm({ body_region: null, target_levels: [] })],
      [],
    )
    expect(result).toEqual([])
  })

  it('preserves PM-first order across union', () => {
    const result = sitesFromPlan(
      [pm({ body_region: 'lumbar', target_levels: ['L4-L5'] })],
      [iv({ body_region: 'cervical', target_levels: ['C5-C6'] })],
    )
    expect(result.map((s) => s.label)).toEqual(['L4-L5', 'C5-C6'])
  })

  it('dedupes by (label, laterality) case-insensitively, preserving first occurrence', () => {
    const result = sitesFromPlan(
      [pm({ body_region: 'lumbar', target_levels: ['L4-L5'], laterality: 'left' })],
      [
        iv({ body_region: 'lumbar', target_levels: ['l4-l5'], laterality: 'left' }),
        iv({ body_region: 'lumbar', target_levels: ['L4-L5'], laterality: 'right' }),
      ],
    )
    expect(result).toEqual([
      { label: 'L4-L5', laterality: 'left', volume_ml: null, target_confirmed_imaging: null },
      { label: 'L4-L5', laterality: 'right', volume_ml: null, target_confirmed_imaging: null },
    ])
  })

  it('treats null laterality as a distinct dedupe key from explicit values', () => {
    const result = sitesFromPlan(
      [
        pm({ body_region: 'knee' }),
        pm({ body_region: 'knee', laterality: 'right' }),
      ],
      [],
    )
    expect(result).toHaveLength(2)
  })

  it('handles a multi-region plan: cervical levels + lumbar levels in one PM item set', () => {
    const result = sitesFromPlan(
      [
        pm({ body_region: 'cervical', target_levels: ['C5-C6'], laterality: 'bilateral' }),
        pm({ body_region: 'lumbar', target_levels: ['L5-S1'], laterality: 'bilateral' }),
      ],
      [],
    )
    expect(result.map((s) => s.label)).toEqual(['C5-C6', 'L5-S1'])
  })

  it('combines PM injection candidate with IV non-overlapping site', () => {
    const result = sitesFromPlan(
      [pm({ body_region: 'lumbar', target_levels: ['L4-L5'] })],
      [iv({ body_region: 'shoulder', laterality: 'right' })],
    )
    expect(result).toEqual([
      { label: 'L4-L5', laterality: null, volume_ml: null, target_confirmed_imaging: null },
      { label: 'Shoulder', laterality: 'right', volume_ml: null, target_confirmed_imaging: null },
    ])
  })

  it('title-cases multi-word body_region', () => {
    const result = sitesFromPlan(
      [pm({ body_region: 'sacroiliac joint' })],
      [],
    )
    expect(result[0].label).toBe('Sacroiliac Joint')
  })
})
