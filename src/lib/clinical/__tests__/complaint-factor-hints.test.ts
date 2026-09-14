import { describe, expect, it } from 'vitest'
import { complaintFactorHints, complaintRegionOptions, getComplaintRegion, setComplaintSide } from '../complaint-factor-hints'

describe('complaint region hints', () => {
  it.each(['Neck', 'CERVICAL', ' cervical  spine ', 'Lt. Neck', 'R c-spine'])('recognizes %s without mutating it', raw => {
    expect(getComplaintRegion(raw).key).toBe('neck')
  })
  it.each(['Low back', 'lumbar', 'lumbosacral', 'L. lumbar spine', 'lower back', 'l-spine'])('recognizes %s', raw => {
    expect(getComplaintRegion(raw).key).toBe('back')
  })
  it.each(['', ' ', 'Neck and shoulder', 'pain in knee', 'kneecap', 'midline neck', 'no neck pain', 'neck pain radiating to shoulder', 'neck and shoulder pain', '__proto__', 'constructor', 'toString'])('uses general examples for %s', raw => {
    expect(getComplaintRegion(raw).key).toBe('general')
    expect(setComplaintSide(raw, 'left')).toBe(raw)
  })
  it.each(['Both knees', 'Bilateral knee', 'Bilat. shoulders'])('recognizes plurals and sides: %s', raw => {
    expect(getComplaintRegion(raw).side).toBe('bilateral')
  })
  it('changes only a recognized prefix and keeps original spelling and whitespace', () => {
    expect(setComplaintSide('  Lt. cervical  spine  ', 'right')).toBe('  Right cervical  spine  ')
    expect(setComplaintSide('  Lt. cervical  spine  ', '')).toBe('  cervical  spine  ')
    expect(setComplaintSide('kNee', 'bilateral')).toBe('Bilateral kNee')
    expect(getComplaintRegion('Rt. shoulder').side).toBe('right')
    expect(getComplaintRegion('L Knee').side).toBe('left')
  })
  it('carries side into suggestions, with searchable alias values', () => {
    expect(complaintRegionOptions('Left knee')).toContain('Left Cervical spine')
    expect(complaintRegionOptions('knee')).toContain('Lumbar spine')
  })
  it.each([
    ['Neck pain', 'neck'], ['Right shoulder pain', 'shoulder'],
    ['Lower back pain', 'back'], ['Both knees pain', 'knee'],
    ['Upper back', 'upper_back'], ['Mid back pain', 'upper_back'], ['Thoracic spine', 'upper_back'],
    ['Left hip pain', 'hip'], ['Both elbows', 'elbow'], ['Rt. wrist pain', 'wrist'],
    ['Hand / fingers', 'hand'], ['Left thumb pain', 'hand'], ['Fingers', 'hand'],
    ['Bilateral ankles', 'ankle'], ['Foot / toes', 'foot'], ['Right foot pain', 'foot'], ['Both feet', 'foot'],
  ])('selects expanded hints for %s', (raw, key) => {
    expect(getComplaintRegion(raw).key).toBe(key)
  })
  it('preserves pain wording when changing sides', () => {
    expect(getComplaintRegion('Right shoulder pain').side).toBe('right')
    expect(setComplaintSide('  Right shoulder pain  ', 'left')).toBe('  Left shoulder pain  ')
    expect(setComplaintSide('Left thumb pain', '')).toBe('thumb pain')
  })
  it('offers every specific region with working aliases and laterality', () => {
    const options = complaintRegionOptions('Left wrist pain')
    expect(new Set(options).size).toBe(options.length)
    const keys = new Set(options.map(raw => {
      expect(getComplaintRegion(raw).side).toBe('left')
      return getComplaintRegion(raw).key
    }))
    expect([...keys].sort()).toEqual(Object.keys(complaintFactorHints).filter(key => key !== 'general').sort())
  })
  it('provides six aggravating and four alleviating examples per specific region', () => {
    for (const [key, hints] of Object.entries(complaintFactorHints)) {
      if (key === 'general') continue
      expect(hints.worse, key).toHaveLength(6)
      expect(hints.better, key).toHaveLength(4)
    }
  })
  it('has unique examples in each group', () => {
    for (const hints of Object.values(complaintFactorHints)) {
      for (const values of [hints.worse, hints.better]) expect(new Set(values).size).toBe(values.length)
    }
  })
})
