import { describe, it, expect } from 'vitest'
import { computePainToneLabel, computeSeriesVolatility, deriveChiroProgress } from '@/lib/claude/pain-tone'

describe('computePainToneLabel', () => {
  it('returns baseline when current is null', () => {
    expect(computePainToneLabel(null, 7)).toBe('baseline')
  })
  it('returns baseline when reference is null', () => {
    expect(computePainToneLabel(5, null)).toBe('baseline')
  })
  it('returns baseline when both null', () => {
    expect(computePainToneLabel(null, null)).toBe('baseline')
  })
  it('returns improved when current is 3+ less than reference', () => {
    expect(computePainToneLabel(4, 7)).toBe('improved')
    expect(computePainToneLabel(2, 8)).toBe('improved')
    expect(computePainToneLabel(0, 10)).toBe('improved')
  })
  it('returns improved for cumulative series progress (9 → 5 across 3 sessions)', () => {
    // Motivating case: callers pass the series baseline (first procedure) as
    // the reference, not the most-recent prior. A patient at 5/10 today whose
    // first injection started at 9/10 should read as "improved" regardless of
    // how modest the interval deltas were (9→7→5).
    expect(computePainToneLabel(5, 9)).toBe('improved')
    expect(computePainToneLabel(6, 9)).toBe('improved')
  })
  it('returns minimally_improved for exactly a 2-point drop (MCID on NRS)', () => {
    // Previously collapsed to 'stable'; v3 splits this out as MCID-tier
    // improvement so the narrative can credit real gains without overstating.
    expect(computePainToneLabel(7, 9)).toBe('minimally_improved')
    expect(computePainToneLabel(5, 7)).toBe('minimally_improved')
    expect(computePainToneLabel(3, 5)).toBe('minimally_improved')
    expect(computePainToneLabel(0, 2)).toBe('minimally_improved')
  })
  it('returns stable when delta is within [-1, +1]', () => {
    expect(computePainToneLabel(7, 7)).toBe('stable')
    expect(computePainToneLabel(6, 7)).toBe('stable')
    expect(computePainToneLabel(8, 7)).toBe('stable')
  })
  it('returns worsened when current is 2+ more than reference (unchanged threshold)', () => {
    expect(computePainToneLabel(9, 7)).toBe('worsened')
    expect(computePainToneLabel(8, 6)).toBe('worsened')
  })

  describe('context-aware behavior', () => {
    it('returns baseline when context is default/no_prior and reference is null', () => {
      expect(computePainToneLabel(5, null)).toBe('baseline')
      expect(computePainToneLabel(5, null, 'no_prior')).toBe('baseline')
    })

    it('returns missing_vitals when context is prior_missing_vitals regardless of numeric inputs', () => {
      expect(computePainToneLabel(5, null, 'prior_missing_vitals')).toBe('missing_vitals')
      expect(computePainToneLabel(null, null, 'prior_missing_vitals')).toBe('missing_vitals')
      expect(computePainToneLabel(5, 8, 'prior_missing_vitals')).toBe('missing_vitals')
    })

    it('applies delta math when context is prior_with_vitals', () => {
      expect(computePainToneLabel(5, 9, 'prior_with_vitals')).toBe('improved')
      expect(computePainToneLabel(7, 7, 'prior_with_vitals')).toBe('stable')
      expect(computePainToneLabel(9, 7, 'prior_with_vitals')).toBe('worsened')
    })

    it('falls back to baseline when prior_with_vitals but a numeric input is unexpectedly null', () => {
      expect(computePainToneLabel(5, null, 'prior_with_vitals')).toBe('baseline')
      expect(computePainToneLabel(null, 7, 'prior_with_vitals')).toBe('baseline')
    })
  })
})

describe('computeSeriesVolatility', () => {
  it('returns insufficient_data for empty and single-element series', () => {
    expect(computeSeriesVolatility([])).toBe('insufficient_data')
    expect(computeSeriesVolatility([5])).toBe('insufficient_data')
  })

  it('returns insufficient_data only when fewer than 2 non-null readings exist', () => {
    expect(computeSeriesVolatility([null, null])).toBe('insufficient_data')
    expect(computeSeriesVolatility([null, 5])).toBe('insufficient_data')
    expect(computeSeriesVolatility([null, null, 3])).toBe('insufficient_data')
  })

  it('skips null entries and classifies based on surviving non-null deltas', () => {
    // One missing vitals row in the middle should not collapse the series.
    expect(computeSeriesVolatility([9, null, 5, 3])).toBe('monotone_improved')
    expect(computeSeriesVolatility([3, null, 5, 7])).toBe('monotone_worsened')
    expect(computeSeriesVolatility([5, null, 5, 5])).toBe('monotone_stable')
    // Leading/trailing nulls also skipped.
    expect(computeSeriesVolatility([null, 9, 7, null, 5])).toBe('monotone_improved')
  })

  it('detects mid-series regression across a null gap', () => {
    // 9 -> [skip] -> 5 -> 7 -> 3: effective deltas -4, +2, -4 → regression present + drop present
    expect(computeSeriesVolatility([9, null, 5, 7, 3])).toBe('mixed_with_regression')
  })

  it('returns monotone_improved for strictly non-increasing series with at least one drop', () => {
    expect(computeSeriesVolatility([9, 7, 5, 3])).toBe('monotone_improved')
    expect(computeSeriesVolatility([8, 8, 6])).toBe('monotone_improved')
  })

  it('returns monotone_worsened for strictly non-decreasing series with at least one rise', () => {
    expect(computeSeriesVolatility([3, 5, 7, 9])).toBe('monotone_worsened')
    expect(computeSeriesVolatility([4, 4, 6])).toBe('monotone_worsened')
  })

  it('returns monotone_stable for a flat series', () => {
    expect(computeSeriesVolatility([5, 5, 5])).toBe('monotone_stable')
    expect(computeSeriesVolatility([7, 7])).toBe('monotone_stable')
  })

  it('returns mixed_with_regression when any intermediate delta is ≥ +2', () => {
    expect(computeSeriesVolatility([9, 5, 7, 3])).toBe('mixed_with_regression')
    expect(computeSeriesVolatility([9, 7, 5, 3, 5])).toBe('mixed_with_regression')
    // Single +2 rise from non-zero delta pattern should trip it
    expect(computeSeriesVolatility([3, 5])).toBe('monotone_worsened') // only single delta, +2
    expect(computeSeriesVolatility([3, 5, 3])).toBe('mixed_with_regression') // rise then drop
  })

  it('sub-threshold rise (+1) with mixed directions falls through to monotone_stable', () => {
    // +1 rise doesn't hit the ≥2 regression threshold, and the series has both
    // a drop and a rise so it's neither strictly non-increasing nor strictly
    // non-decreasing. Implementation falls through to monotone_stable. This
    // is a known edge case — the volatility label is coarse by design.
    expect(computeSeriesVolatility([5, 6, 4])).toBe('monotone_stable')
  })
})

describe('deriveChiroProgress', () => {
  it('returns null for null/undefined/non-object input', () => {
    expect(deriveChiroProgress(null)).toBeNull()
    expect(deriveChiroProgress(undefined)).toBeNull()
    expect(deriveChiroProgress('improving')).toBeNull()
  })
  it('returns null when progress_status is missing', () => {
    expect(deriveChiroProgress({})).toBeNull()
    expect(deriveChiroProgress({ other: 'value' })).toBeNull()
  })
  it('returns null when progress_status is not a known enum', () => {
    expect(deriveChiroProgress({ progress_status: 'mystery' })).toBeNull()
    expect(deriveChiroProgress({ progress_status: null })).toBeNull()
  })
  it('passes through all four known enum values', () => {
    expect(deriveChiroProgress({ progress_status: 'improving' })).toBe('improving')
    expect(deriveChiroProgress({ progress_status: 'stable' })).toBe('stable')
    expect(deriveChiroProgress({ progress_status: 'plateauing' })).toBe('plateauing')
    expect(deriveChiroProgress({ progress_status: 'worsening' })).toBe('worsening')
  })
})
