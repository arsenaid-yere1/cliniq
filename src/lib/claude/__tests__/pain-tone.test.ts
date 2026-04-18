import { describe, it, expect } from 'vitest'
import { computePainToneLabel, deriveChiroProgress } from '@/lib/claude/pain-tone'

describe('computePainToneLabel', () => {
  it('returns baseline when current is null', () => {
    expect(computePainToneLabel(null, 7)).toBe('baseline')
  })
  it('returns baseline when prior is null', () => {
    expect(computePainToneLabel(5, null)).toBe('baseline')
  })
  it('returns baseline when both null', () => {
    expect(computePainToneLabel(null, null)).toBe('baseline')
  })
  it('returns improved when current is 2+ less than prior', () => {
    expect(computePainToneLabel(5, 7)).toBe('improved')
    expect(computePainToneLabel(2, 8)).toBe('improved')
  })
  it('returns stable when delta is within ±1', () => {
    expect(computePainToneLabel(7, 7)).toBe('stable')
    expect(computePainToneLabel(6, 7)).toBe('stable')
    expect(computePainToneLabel(8, 7)).toBe('stable')
  })
  it('returns worsened when current is 2+ more than prior', () => {
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
