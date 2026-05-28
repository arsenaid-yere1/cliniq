import { describe, it, expect } from 'vitest'
import {
  resolveProcedureNarrativeDirective,
  resolveDischargeNarrativeDirective,
} from '@/lib/claude/narrative-directive'

const noPlan = { status: 'no_plan_on_file' as const, planned: null, mismatches: [] }
const aligned = { status: 'aligned' as const, planned: null, mismatches: [] }
const deviation = { status: 'deviation' as const, planned: null, mismatches: [] }

describe('resolveProcedureNarrativeDirective', () => {
  it('returns baseline tone with no priors', () => {
    const d = resolveProcedureNarrativeDirective({
      paintoneSignals: { vsBaseline: 'baseline', vsPrevious: null },
      seriesVolatility: 'insufficient_data',
      planAlignment: noPlan,
    })
    expect(d.tone).toBe('baseline')
    expect(d.must_acknowledge).toEqual([])
  })

  it('detects mixed_with_final_uptick when improved overall but worsened final interval', () => {
    const d = resolveProcedureNarrativeDirective({
      paintoneSignals: { vsBaseline: 'improved', vsPrevious: 'worsened' },
      seriesVolatility: 'mixed_with_regression',
      planAlignment: aligned,
    })
    expect(d.tone).toBe('mixed_with_final_uptick')
    expect(d.must_acknowledge.join(' ')).toContain('uptick')
    expect(d.forbidden_phrases).toContain('linear improvement')
  })

  it('detects mixed_with_recovery when improved overall + improved final + regression somewhere mid', () => {
    const d = resolveProcedureNarrativeDirective({
      paintoneSignals: { vsBaseline: 'improved', vsPrevious: 'improved' },
      seriesVolatility: 'mixed_with_regression',
      planAlignment: noPlan,
    })
    expect(d.tone).toBe('mixed_with_recovery')
  })

  it('returns missing_vitals when either signal is missing_vitals', () => {
    const d = resolveProcedureNarrativeDirective({
      paintoneSignals: { vsBaseline: 'missing_vitals', vsPrevious: null },
      seriesVolatility: 'insufficient_data',
      planAlignment: noPlan,
    })
    expect(d.tone).toBe('missing_vitals')
  })

  it('emits plan_directive aligned when plan matches', () => {
    const d = resolveProcedureNarrativeDirective({
      paintoneSignals: { vsBaseline: 'stable', vsPrevious: 'stable' },
      seriesVolatility: 'monotone_stable',
      planAlignment: aligned,
    })
    expect(d.plan_directive?.status).toBe('aligned')
    expect(d.plan_directive?.required_sentence).toContain('aligns')
  })

  it('emits plan_directive deviation when planned ≠ performed', () => {
    const d = resolveProcedureNarrativeDirective({
      paintoneSignals: { vsBaseline: 'improved', vsPrevious: 'improved' },
      seriesVolatility: 'monotone_improved',
      planAlignment: deviation,
    })
    expect(d.plan_directive?.status).toBe('deviation')
    expect(d.plan_directive?.forbidden_phrases).toContain('as planned')
  })

  it('minimally_improved forbids substantial-gains language', () => {
    const d = resolveProcedureNarrativeDirective({
      paintoneSignals: { vsBaseline: 'minimally_improved', vsPrevious: 'minimally_improved' },
      seriesVolatility: 'monotone_improved',
      planAlignment: aligned,
    })
    expect(d.tone).toBe('minimally_improved')
    expect(d.forbidden_phrases).toContain('substantial gains')
    expect(d.must_acknowledge).toContain('modest reduction in pain intensity')
  })
})

describe('resolveDischargeNarrativeDirective', () => {
  it('does not set plan_directive', () => {
    const d = resolveDischargeNarrativeDirective({
      vsBaseline: 'improved',
      vsPrevious: 'improved',
      seriesVolatility: 'monotone_improved',
    })
    expect(d.plan_directive).toBeNull()
    expect(d.tone).toBe('improved')
  })

  it('returns worsened when vsBaseline is worsened', () => {
    const d = resolveDischargeNarrativeDirective({
      vsBaseline: 'worsened',
      vsPrevious: 'worsened',
      seriesVolatility: 'monotone_worsened',
    })
    expect(d.tone).toBe('worsened')
    expect(d.forbidden_phrases).toContain('continued improvement')
  })
})
