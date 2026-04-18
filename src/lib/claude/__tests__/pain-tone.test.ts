import { describe, it, expect } from 'vitest'
import { computePainToneLabel, deriveChiroProgress } from '@/lib/claude/pain-tone'

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
  it('returns stable for a 2-point drop (threshold case — was improved in pre-threshold-bump v1)', () => {
    // 9→7 baseline-to-current is still stable under the v2 threshold because
    // at 7/10 residual pain the physical exam reads persistence-leaning.
    expect(computePainToneLabel(7, 9)).toBe('stable')
    expect(computePainToneLabel(5, 7)).toBe('stable')
    expect(computePainToneLabel(3, 5)).toBe('stable')
  })
  it('returns stable when delta is within [-2, +1]', () => {
    expect(computePainToneLabel(7, 7)).toBe('stable')
    expect(computePainToneLabel(6, 7)).toBe('stable')
    expect(computePainToneLabel(8, 7)).toBe('stable')
  })
  it('returns worsened when current is 2+ more than reference (unchanged threshold)', () => {
    expect(computePainToneLabel(9, 7)).toBe('worsened')
    expect(computePainToneLabel(8, 6)).toBe('worsened')
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
