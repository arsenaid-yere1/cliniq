import { parseExamPhrase } from '../exam-finding-text'
import { describe, expect, it } from 'vitest'
import { completeExamExample, completionFields, examExamples, examRegions, getExamExamples, getExamRegion } from '../exam-finding-examples'
const expectedIds = Object.entries({ G: 8, P: 12, I: 16, M: 10, N: 18, F: 8, T: 30 }).flatMap(([prefix, count]) => Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`))
export function sampleValues(example: typeof examExamples[number], region = 'Knee') {
  return Object.fromEntries(completionFields(example, region).map(field => [field.key, field.options?.[0] ?? (field.numeric ? '3' : 'examined area')]))
}
describe('exam catalog', () => {
  it('implements exactly all 102 templates and 22 region groups', () => {
    expect(examExamples.map(e => e.id)).toEqual(expectedIds)
    expect(examRegions.map(r => r.key)).toEqual(['head', 'jaw', 'cervical', 'thoracic', 'lumbar', 'si', 'coccyx', 'shoulder', 'scapula', 'upper_arm', 'elbow', 'forearm', 'wrist', 'hand', 'hip', 'thigh', 'knee', 'lower_leg', 'ankle', 'heel', 'foot', 'chest_wall'])
    for (const region of examRegions) for (const id of region.exampleIds) expect(expectedIds).toContain(id)
  })
  it('resolves all aliases, full display names and anchored sides', () => {
    for (const region of examRegions) for (const alias of region.aliases) {
      for (const prefix of ['', 'Lt. ', 'Right ', 'Bilat ']) expect(getExamRegion(` ${prefix}${alias.toUpperCase()} `)?.key).toBe(region.key)
    }
    for (const raw of ['', 'Back', 'Arm', 'Leg', 'neck and shoulder', 'constructor', 'pain in knee']) expect(getExamRegion(raw)).toBeUndefined()
  })
  it('keeps anatomical mapping and initial priorities explicit', () => {
    expect(getExamExamples('palpation_findings', 'Cervical').slice(0, 3).map(e => e.label)).toEqual(['Paraspinal tenderness', 'No focal tenderness', 'Soft-tissue tenderness'])
    expect(getExamExamples('additional_findings', 'Elbow').map(e => e.id)).toContain('T18')
    expect(getExamExamples('additional_findings', 'Head').map(e => e.id)).not.toContain('M02')
    expect(getExamExamples('palpation_findings', 'Unknown')).toEqual([])
    expect(getExamExamples('palpation_findings', 'Unknown', true).length).toBeGreaterThan(0)
  })
  it.each(examExamples)('renders $id only with completed values', example => {
    const values = sampleValues(example)
    const result = completeExamExample(example, values, 'Knee')
    expect(result.errors).toEqual({})
    expect(result.text).toBeTruthy()
    expect(result.text).not.toMatch(/[{};]/)
    if (completionFields(example, 'Knee').some(f => !f.optional)) expect(completeExamExample(example, {}, 'Knee').text).toBeUndefined()
  })
  it('preserves independent reflex grades and rejects invalid measurements/placeholders', () => {
    const reflex = examExamples.find(e => e.id === 'N11')!
    expect(completeExamExample(reflex, { 'Named reflex': 'patellar', 'left grade': '1+', 'right grade': '2+' }).text).toBe('patellar asymmetric: left 1+, right 2+')
    const rom = examExamples.find(e => e.id === 'M03')!
    for (const value of ['-1', 'NaN', '10; normal', '{value}']) expect(completeExamExample(rom, { ...sampleValues(rom), value }, 'Knee').errors.value).toBeTruthy()
    expect(completeExamExample(rom, { ...sampleValues(rom), unit: 'millimeters' }, 'Knee').errors.unit).toBeTruthy()
  })
})

describe('unavailable test documentation', () => {
  it.each(examExamples.filter(example => example.id.startsWith('T')))('renders and classifies $id with an explicit unavailable result', example => {
    for (const result of ['Not performed', 'Unable to complete']) {
      const values = { ...sampleValues(example), result, response: 'positioning limited', angle: '' }
      const rendered = completeExamExample(example, values, 'Knee').text!
      expect(rendered).toBeTruthy()
      expect(parseExamPhrase(rendered, 'additional_findings')?.unavailable).toBe(true)
    }
  })
})
