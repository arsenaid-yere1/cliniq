import { describe, expect, it } from 'vitest'
import { defaultProviderIntake, type ChiefComplaintEntry } from '@/lib/validations/initial-visit-note'
import { populateExamFindings } from '../populate-exam-findings'

const empty = () => structuredClone(defaultProviderIntake.exam_findings)
const complaint = (body_region: string, severity_min: number | null = 4, severity_max: number | null = 7): ChiefComplaintEntry => ({
  ...defaultProviderIntake.chief_complaints.complaints[0], body_region, severity_min, severity_max,
})

describe('populateExamFindings', () => {
  it('places general, regional, and neurological examples in their fields without setting spasm assessments', () => {
    const result = populateExamFindings(empty(), [complaint('Bilateral neck'), complaint('Low back', 2, 3)])
    expect(result.general_appearance).toContain('guarding during position changes')
    expect(result.regions[0]).toEqual({
      region: 'Bilateral Cervical Spine',
      palpation_findings: 'Marked tenderness over the bilateral cervical paraspinal muscles, upper trapezius, and levator scapulae.',
      additional_findings: 'Pain and guarding with movement of the bilateral cervical spine, with marked limitation due to discomfort.',
      muscle_spasm: null,
    })
    expect(result.regions[1].palpation_findings).toBe('Mild tenderness over the lumbar paraspinal muscles.')
    expect(result.neurological_notes).toBe('Upper-extremity motor and sensory examination grossly intact. Lower-extremity motor and sensory examination grossly intact.')
  })

  it('deduplicates aliases and trailing pain, uses highest duplicate score, and preserves laterality', () => {
    const result = populateExamFindings(empty(), [complaint('Lt. knee pain', 1, 2), complaint('Left knee', 4, 5), complaint('Right knee')])
    expect(result.regions).toHaveLength(2)
    expect(result.regions[0].palpation_findings).toBe('Moderate tenderness over the left knee.')
    expect(result.regions[1].region).toBe('Right Knee')
    expect(populateExamFindings(result, [complaint('Left knee'), complaint('Right knee')])).toEqual(result)
  })

  it('preserves custom findings, assessment states, order, and input objects', () => {
    const current = empty()
    current.general_appearance = 'Existing general text'
    current.neurological_notes = 'Observed neuro findings'
    current.regions.push({ region: 'Lt. knee', palpation_findings: 'Custom palpation', muscle_spasm: false, additional_findings: 'Custom movement' })
    const original = structuredClone(current)
    const result = populateExamFindings(current, [complaint('Right knee'), complaint('Left knee')])
    expect(result.general_appearance).toBe(current.general_appearance)
    expect(result.neurological_notes).toBe(current.neurological_notes)
    expect(result.regions[0]).toEqual(current.regions[0])
    expect(result.regions[1].region).toBe('Right Knee')
    expect(current).toEqual(original)
  })

  it('fills empty fields of matching rows and preserves custom or composite region names', () => {
    const current = empty()
    current.regions.push({ region: 'Cervical', palpation_findings: '', muscle_spasm: true, additional_findings: 'Observed detail' })
    const result = populateExamFindings(current, [complaint('Neck'), complaint('Neck and shoulder')])
    expect(result.regions[0].region).toBe('Cervical')
    expect(result.regions[0].palpation_findings).toContain('cervical paraspinal')
    expect(result.regions[0].additional_findings).toBe('Observed detail')
    expect(result.regions[0].muscle_spasm).toBe(true)
    expect(result.regions[1].region).toBe('Neck and shoulder')
  })

  it.each([[null, null], [0, 0], [null, 0]] as const)('adds blank areas for missing or zero pain (%s, %s)', (min, max) => {
    const result = populateExamFindings(empty(), [complaint('Knee', min, max)])
    expect(result.general_appearance).toBeNull()
    expect(result.regions[0]).toEqual({ region: 'Knee', palpation_findings: '', additional_findings: null, muscle_spasm: null })
    expect(result.neurological_notes).toBe('Lower-extremity motor and sensory examination grossly intact.')
  })

  it.each([
    [['Left shoulder', 'Lt. wrist'], 'Left upper-extremity motor and sensory examination grossly intact.'],
    [['Right knee', 'Right ankle'], 'Right lower-extremity motor and sensory examination grossly intact.'],
    [['Left shoulder', 'Right wrist'], 'Upper-extremity motor and sensory examination grossly intact.'],
    [['Bilateral neck', 'Left wrist'], 'Upper-extremity motor and sensory examination grossly intact.'],
    [['Head'], 'Motor and sensory examination grossly intact.'],
    [['Custom area'], 'Motor and sensory examination grossly intact.'],
  ])('matches neurological example scope for %j', (names, expected) => {
    expect(populateExamFindings(empty(), names.map(name => complaint(name))).neurological_notes).toBe(expected)
  })

  it.each([[3, null, 'Mild'], [null, 6, 'Moderate'], [7, 10, 'Marked']] as const)('uses available pain bounds (%s, %s)', (min, max, degree) => {
    expect(populateExamFindings(empty(), [complaint('Knee', min, max)]).regions[0].palpation_findings).toContain(degree)
  })

  it.each([[8, 3], [-1, 4], [2, 11], [2.5, 4], [NaN, 4]])('rejects invalid pain (%s, %s) without mutating fields', (min, max) => {
    const current = empty()
    expect(() => populateExamFindings(current, [complaint('Neck'), complaint('Knee', min, max)])).toThrow('Check Chief Complaints pain levels')
    expect(current).toEqual(empty())
  })

  it('ignores blank rows and requires a named complaint', () => {
    expect(() => populateExamFindings(empty(), [complaint('  ')])).toThrow('Add a body region')
    expect(populateExamFindings(empty(), [complaint(''), complaint('Knee')]).regions).toHaveLength(1)
  })
})
