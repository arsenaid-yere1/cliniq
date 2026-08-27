import { describe, expect, it } from 'vitest'
import {
  deriveDischargePrpCounts,
  resolveDischargeProcedureSites,
} from '@/lib/claude/discharge-prp-counts'

function procedure(procedureType: string, sites: Array<{ label: string }>) {
  return { procedure_type: procedureType, sites }
}

describe('deriveDischargePrpCounts', () => {
  it('distinguishes one session from multiple target-area injections', () => {
    expect(deriveDischargePrpCounts([
      procedure('prp', [{ label: 'Cervical' }, { label: 'Thoracic' }, { label: 'Lumbar' }]),
    ])).toEqual({ prpSessionCount: 1, prpTargetAreaCount: 3 })
  })

  it('sums target-area occurrences across PRP sessions', () => {
    expect(deriveDischargePrpCounts([
      procedure('prp', [{ label: 'Cervical' }, { label: 'Lumbar' }]),
      procedure('prp', [{ label: 'Cervical' }, { label: 'Lumbar' }]),
    ])).toEqual({ prpSessionCount: 2, prpTargetAreaCount: 4 })
  })

  it('excludes non-PRP procedures from both counts', () => {
    expect(deriveDischargePrpCounts([
      procedure('prp', [{ label: 'Lumbar' }]),
      procedure('botox', [{ label: 'Trapezius' }, { label: 'Temporalis' }]),
    ])).toEqual({ prpSessionCount: 1, prpTargetAreaCount: 1 })
  })

  it('counts repeated and bilateral site entries once per stored occurrence', () => {
    expect(deriveDischargePrpCounts([
      procedure('prp', [{ label: 'Bilateral knee' }]),
      procedure('prp', [{ label: 'Bilateral knee' }]),
    ])).toEqual({ prpSessionCount: 2, prpTargetAreaCount: 2 })
  })

  it('returns zero counts when there are no PRP procedures', () => {
    expect(deriveDischargePrpCounts([
      procedure('botox', [{ label: 'Trapezius' }]),
    ])).toEqual({ prpSessionCount: 0, prpTargetAreaCount: 0 })
  })

  it('returns an unknown target count when any PRP session has no sites', () => {
    expect(deriveDischargePrpCounts([
      procedure('prp', [{ label: 'Cervical' }]),
      procedure('prp', []),
    ])).toEqual({ prpSessionCount: 2, prpTargetAreaCount: null })
  })
})

describe('resolveDischargeProcedureSites', () => {
  it('uses valid structured sites without consulting legacy text', () => {
    const sites = resolveDischargeProcedureSites([
      { label: 'Lumbar', laterality: 'bilateral', volume_ml: 2, target_confirmed_imaging: true },
    ], 'Cervical, Thoracic')

    expect(sites).toHaveLength(1)
    expect(sites[0]).toMatchObject({ label: 'Lumbar', laterality: 'bilateral' })
  })

  it('falls back to legacy target text when structured sites are unavailable', () => {
    const sites = resolveDischargeProcedureSites([], 'Cervical, Thoracic and Lumbar')

    expect(sites.map((site) => site.label)).toEqual(['Cervical', 'Thoracic', 'Lumbar'])
  })

  it('leaves the target list empty when neither source is usable', () => {
    expect(resolveDischargeProcedureSites(null, null)).toEqual([])
  })
})
