import { describe, it, expect } from 'vitest'
import { classifyAnatomy, singleAnatomyFromSites } from './anatomy-classifier'

describe('classifyAnatomy', () => {
  it('classifies lumbar levels', () => {
    expect(classifyAnatomy('L4-L5')).toBe('lumbar_facet')
    expect(classifyAnatomy('L5-S1')).toBe('lumbar_facet')
    expect(classifyAnatomy('Lumbar facet')).toBe('lumbar_facet')
  })
  it('classifies cervical', () => {
    expect(classifyAnatomy('C5-C6')).toBe('cervical_facet')
    expect(classifyAnatomy('Cervical Facet')).toBe('cervical_facet')
  })
  it('classifies thoracic', () => {
    expect(classifyAnatomy('T8-T9')).toBe('thoracic_facet')
  })
  it('classifies joints', () => {
    expect(classifyAnatomy('Knee')).toBe('knee')
    expect(classifyAnatomy('Right shoulder')).toBe('shoulder')
    expect(classifyAnatomy('Hip')).toBe('hip')
    expect(classifyAnatomy('Ankle')).toBe('ankle')
  })
  it('classifies sacroiliac before generic patterns', () => {
    expect(classifyAnatomy('Sacroiliac Joint')).toBe('sacroiliac')
    expect(classifyAnatomy('SI joint')).toBe('sacroiliac')
  })
  it('returns null for unrecognized', () => {
    expect(classifyAnatomy('something else')).toBeNull()
  })
})

describe('singleAnatomyFromSites', () => {
  it('returns single anatomy when all sites match', () => {
    expect(singleAnatomyFromSites([{ label: 'L4-L5' }, { label: 'L5-S1' }])).toBe('lumbar_facet')
  })
  it('returns null when sites span anatomies', () => {
    expect(singleAnatomyFromSites([{ label: 'Knee' }, { label: 'Shoulder' }])).toBeNull()
  })
  it('returns null when any site fails to classify', () => {
    expect(singleAnatomyFromSites([{ label: 'Knee' }, { label: 'Unknown' }])).toBeNull()
  })
  it('returns null on empty array', () => {
    expect(singleAnatomyFromSites([])).toBeNull()
  })
  it('returns matching anatomy on single site', () => {
    expect(singleAnatomyFromSites([{ label: 'Right Knee' }])).toBe('knee')
  })
})
