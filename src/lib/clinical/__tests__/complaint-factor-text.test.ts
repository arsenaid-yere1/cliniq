import { describe, expect, it } from 'vitest'
import { hasFactorExample, isFactorStatus, toggleFactorExample } from '../complaint-factor-text'

describe('factor text edits', () => {
  it('adds to blank values and replaces only whole-field statuses', () => {
    expect(toggleFactorExample('', 'Rest')).toBe('Rest')
    expect(toggleFactorExample('  Not assessed\n', 'Rest')).toBe('Rest')
    expect(isFactorStatus(' none REPORTED ')).toBe(true)
    expect(isFactorStatus('None reported yesterday')).toBe(false)
  })
  it('preserves custom prose exactly when adding', () => {
    const text = 'Patient reports: ice, heat\n  rest did not help. '
    expect(toggleFactorExample(text, 'Rest')).toBe(text + '; Rest')
    expect(hasFactorExample(text, 'Rest')).toBe(false)
  })
  it.each([
    ['Rest; Ice; Heat', ' Ice; Heat'],
    ['Ice; Rest; Heat', 'Ice; Heat'],
    ['Ice; Rest', 'Ice'],
    ['  REST\n', ''],
  ])('removes only a standalone segment: %s', (text, expected) => {
    expect(toggleFactorExample(text, 'Rest')).toBe(expected)
  })
  it('does not rewrite neighboring whitespace, newlines, or punctuation', () => {
    expect(toggleFactorExample('Custom, text\n ; Rest;  Other\n prose ', 'Rest')).toBe('Custom, text\n ;  Other\n prose ')
    expect(toggleFactorExample('Custom;\n', 'Rest')).toBe('Custom;\n Rest')
  })
  it('removes legacy duplicates one at a time', () => {
    const first = toggleFactorExample('Rest; rest', 'Rest')
    expect(hasFactorExample(first, 'Rest')).toBe(true)
    expect(toggleFactorExample(first, 'Rest')).toBe('')
  })
  it('treats edited examples and comma-separated sentences as prose', () => {
    expect(hasFactorExample('Rest only on weekends', 'Rest')).toBe(false)
    expect(hasFactorExample('Rest, ice', 'Rest')).toBe(false)
    expect(toggleFactorExample('No rest; None reported yesterday', 'Rest')).toBe('No rest; None reported yesterday; Rest')
  })
})
