import { describe, expect, it } from 'vitest'
import { appendExamPhrase, conflictingExamSegments, hasCompletedExamText, parseExamPhrase, removeExamPhrase, replaceConflictingExamPhrases } from '../exam-finding-text'
describe('exam phrase editing', () => {
  it('preserves custom bytes through append/remove and ignores substrings', () => {
    const text = 'Custom note\n  spacing preserved.'
    const added = appendExamPhrase(text, 'No acute distress')
    expect(added).toBe(text + '; No acute distress')
    expect(removeExamPhrase(added, 'No acute distress')).toBe(text)
    expect(appendExamPhrase(' No acute distress ', 'no acute distress')).toBe(' No acute distress ')
    expect(removeExamPhrase('No acute distress except when standing', 'No acute distress')).toBe('No acute distress except when standing')
    expect(removeExamPhrase('A; B; C', 'B')).toBe('A; C')
    expect(removeExamPhrase('A; B; C', 'A')).toBe(' B; C')
    expect(appendExamPhrase('A;  ', 'B')).toBe('A;   B')
  })
  it('replaces only recognized conflicting sites and preserves the rest', () => {
    const text = 'Custom prose; No focal tenderness in Left knee; No focal tenderness in Right ankle'
    const next = 'Tenderness at Left knee'
    expect(conflictingExamSegments(text, next)).toHaveLength(1)
    expect(replaceConflictingExamPhrases(text, next)).toBe('Custom prose; No focal tenderness in Right ankle; Tenderness at Left knee')
    expect(conflictingExamSegments('No focal tenderness in Bilateral knee', next)).toHaveLength(1)
    expect(conflictingExamSegments('No focal tenderness in Right knee', next)).toHaveLength(0)
  })
  it('keeps movement scopes/modes and compatible observations separate', () => {
    expect(conflictingExamSegments('Active flexion at Left knee: 30 degrees', 'Active flexion at Left knee: 50 degrees')).toHaveLength(1)
    expect(conflictingExamSegments('Passive flexion at Left knee: 30 degrees', 'Active flexion at Left knee: 50 degrees')).toHaveLength(0)
    expect(conflictingExamSegments('No acute distress', 'Appears uncomfortable')).toHaveLength(0)
  })
  it('preserves test identity and result without treating unperformed tests as findings', () => {
    const absent = 'Lachman test, Left: Not performed — limited positioning'
    expect(parseExamPhrase(absent)?.unavailable).toBe(true)
    expect(hasCompletedExamText(absent)).toBe(false)
    expect(hasCompletedExamText('Palpation of Left knee limited by pain; ' + absent)).toBe(false)
    expect(hasCompletedExamText(absent + '; Tenderness at Left knee')).toBe(true)
    expect(hasCompletedExamText('Lachman test, Left: Negative — no laxity')).toBe(true)
    expect(hasCompletedExamText('Custom wording: unable to finish but tenderness observed')).toBe(true)
    expect(conflictingExamSegments(absent, 'Lachman test, Left: Negative — no laxity')).toHaveLength(1)
  })
})

describe('catalog conflict families', () => {
  it.each([
    ['Increased warmth at Left knee', 'No increased warmth at Left knee', 'palpation_findings'],
    ['Palpable swelling at Left knee', 'No palpable swelling at Left knee', 'palpation_findings'],
    ['Visible swelling at Left knee: mild', 'No visible swelling at Left knee', 'additional_findings'],
    ['Erythema at Left knee: patchy', 'No erythema at Left knee', 'additional_findings'],
    ['Effusion observed at Left knee: ballotable', 'No effusion appreciated at Left knee on palpation', 'additional_findings'],
    ['Varus deformity at Left knee', 'No visible deformity at Left knee', 'additional_findings'],
    ['Reduced muscle bulk at Left quadriceps compared with right', 'Muscle bulk symmetric in quadriceps', 'additional_findings'],
    ['Active flexion at Left knee preserved on examination', 'Active flexion at Left knee limited: pain', 'additional_findings'],
    ['Pain with Active flexion at Left knee: local', 'No pain elicited with Active flexion at Left knee', 'additional_findings'],
    ['Pain with resisted flexion at Left knee: local', 'No pain elicited with resisted flexion at Left knee', 'additional_findings'],
    ['Sensation intact to light touch in Left thumb', 'Reduced light-touch sensation in Left thumb', 'neurological_notes'],
    ['Sensation intact to light touch in Left thumb', 'Sensation to light touch absent in Left thumb', 'neurological_notes'],
    ['Quadriceps, Left: strength 3/5', 'Quadriceps, Left: strength 4/5', 'neurological_notes'],
    ['Patellar, Left: 2+', 'Patellar, Left: 3+', 'neurological_notes'],
    ['Strength of Left quadriceps not assessed: pain', 'Quadriceps, Left: strength 4/5', 'neurological_notes'],
    ['Sensation in Left thumb not assessed: declined', 'Reduced light-touch sensation in Left thumb', 'neurological_notes'],
    ['Left patellar not assessed: declined', 'Patellar, Left: 3+', 'neurological_notes'],
    ['Squatting observed: limited at knee', 'Squatting not assessed: declined', 'additional_findings'],
    ['Active flexion at Left knee not assessed: pain', 'Active flexion at Left knee preserved on examination', 'additional_findings'],
  ] as const)('recognizes scoped conflicts: %s', (previous, next, field) => {
    expect(conflictingExamSegments(previous, next, field)).toHaveLength(1)
    expect(conflictingExamSegments(next, previous, field)).toHaveLength(1)
  })
  it('does not cross visible/palpable swelling or sensory modalities', () => {
    expect(conflictingExamSegments('Palpable swelling at Left knee', 'No visible swelling at Left knee')).toHaveLength(0)
    expect(conflictingExamSegments('Sensation to pinprick absent in Left thumb', 'Sensation intact to light touch in Left thumb')).toHaveLength(0)
  })
})

describe('conservative canonical recognition', () => {
  it('does not call custom pain text a deformity or pulse text a reflex', () => {
    expect(conflictingExamSegments('Pain at Left knee', 'No visible deformity at Left knee', 'additional_findings')).toEqual([])
    expect(conflictingExamSegments('Radial, Left: strong', 'Radial, Left: 2+', 'neurological_notes')).toEqual([])
  })
  it('compares overlapping recorded reflex grades without replacing an agreeing result', () => {
    expect(conflictingExamSegments('Patellar asymmetric: left 1+, right 2+', 'Patellar, Left: 1+', 'neurological_notes')).toEqual([])
    expect(conflictingExamSegments('Patellar asymmetric: left 1+, right 2+', 'Patellar, Left: 2+', 'neurological_notes')).toHaveLength(1)
    expect(conflictingExamSegments('Patellar symmetric at 2+', 'Patellar, Right: 2+', 'neurological_notes')).toEqual([])
    expect(conflictingExamSegments('Patellar symmetric at 2+', 'Patellar, Right: 3+', 'neurological_notes')).toHaveLength(1)
    expect(conflictingExamSegments('Active flexion at Left knee: 30 degrees', 'Active flexion at Left knee: 30.0 degrees')).toEqual([])
  })
})

 it('keeps a parenthetical percussion site in canonical unavailable test text', () => {
   expect(parseExamPhrase('Tinel percussion, Left: Not performed — declined (site: median nerve (wrist))', 'additional_findings')?.unavailable).toBe(true)
 })
