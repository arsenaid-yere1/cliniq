import { describe, expect, it } from 'vitest'
import {
  extractLaterality, extractSpinalLevels, lateralityCompatible,
  normalizeRegion, normalizeSpinalLevel,
} from './anatomic-normalization'

describe('anatomic normalization', () => {
  it.each([
    ['Cervical Spine: PRP injections at these levels.', 'cervical'],
    ['basis', 'basis'], ['persistence', 'persistence'], ['sessions', 'sessions'],
    ['false', 'false'], ['LS2', 'ls2'], ['SI_joint', 'si_joint'],
    ['LS', 'lumbar'], ['LS spine', 'lumbar'], ['(LS)', 'lumbar'],
    ['SI', 'sacroiliac'], ['sI joint', 'sacroiliac'], ['SI-guided', 'sacroiliac'],
    ['Left SI joint', 'sacroiliac'], ['Bilateral Knees', 'knee'],
    ['Cervical Facet', 'cervical'], ['low back', 'lumbar'],
    ['lumbosacral', 'lumbar'], ['C5-C6', 'cervical'], ['L5-S1', 'lumbar'],
    [null, null], ['   ', null],
  ])('normalizes %s without matching embedded abbreviations', (input, expected) => {
    expect(normalizeRegion(input)).toBe(expected)
  })

  it('normalizes region synonyms and level-only labels', () => {
    expect(normalizeRegion('Left low back')).toBe('lumbar')
    expect(normalizeRegion('C5-C6')).toBe('cervical')
  })

  it('normalizes exact and transitional spinal levels', () => {
    expect(normalizeSpinalLevel('C5/6')).toBe('C5-C6')
    expect(normalizeSpinalLevel('L5–S1')).toBe('L5-S1')
    expect(extractSpinalLevels('C4-5 and C5—C6')).toEqual(['C4-C5', 'C5-C6'])
  })

  it('handles laterality conservatively', () => {
    expect(extractLaterality('right knee')).toBe('right')
    expect(lateralityCompatible('left', 'right')).toBe(false)
    expect(lateralityCompatible(null, 'right')).toBe(true)
    expect(lateralityCompatible('bilateral', 'left')).toBe(true)
  })
})
