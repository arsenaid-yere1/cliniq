import { describe, expect, it } from 'vitest'
import type { Tables } from '@/types/database'
import { buildIntakeHistory, initializeFollowUpIntake } from '../follow-up-intake-prefill'

const history = buildIntakeHistory({ id: 'note', date: '2026-09-01', label: 'Follow-up visit', complaint: 'Knee pain', plan: 'Continue therapy', painMin: 0, painMax: 4 }, [{ id: 'procedure', procedure_date: '2026-09-03', procedure_type: 'prp', sites: [{ label: 'Knee', laterality: 'right', volume_ml: null, target_confirmed_imaging: null }] }], { id: 'discharge', visit_date: '2026-08-01', assessment: 'Improved', plan_and_recommendations: 'Home exercise' })
const encounter = { status: 'scheduled', provider_intake: {}, patient_reported_measurements: {} } as Tables<'clinical_encounters'>

describe('follow-up history mapping', () => {
  it('labels complaints, plans, procedure sites and previous episode background', () => {
    expect(history.chiefComplaint).toContain('Previous complaint (2026-09-01): Knee pain')
    expect(history.intervalHistory).toContain('Prior plan (2026-09-01): Continue therapy')
    expect(history.intervalHistory).toContain('1 prior PRP procedure (2026-09-03): Right Knee')
    expect(history.intervalHistory).toContain('Previous episode (2026-08-01): Improved Home exercise')
    expect(history.previousPain).toEqual({ min: 0, max: 4, date: '2026-09-01' })
    expect(history.sources.map((source) => source.id)).toEqual(['note', 'procedure', 'discharge'])
  })
  it('groups repeated procedures into one dated summary without losing source references', () => {
    const result = buildIntakeHistory(null, Array.from({ length: 8 }, (_, index) => ({
      id: `procedure-${index}`, procedure_date: `2026-09-0${index + 1}`, procedure_type: 'prp',
      sites: [{ label: 'Knee', laterality: 'right', volume_ml: null, target_confirmed_imaging: null }],
    })), null)
    expect(result.intervalHistory).toBe('8 prior PRP procedures (2026-09-01–2026-09-08): Right Knee.')
    expect(result.sources).toHaveLength(8)
  })
  it('keeps different procedure types separate and labels omitted site names', () => {
    const result = buildIntakeHistory(null, [{ id: 'prp', procedure_date: '2026-09-01', procedure_type: 'prp', sites: ['A', 'B', 'C', 'D'].map((label) => ({ label, laterality: null, volume_ml: null, target_confirmed_imaging: null })) }, { id: 'botox', procedure_date: '2026-09-02', procedure_type: 'botox', sites: [] }], null)
    expect(result.intervalHistory).toContain('1 prior BOTOX procedure (2026-09-02).')
    expect(result.intervalHistory).toContain('A, B, C and 1 other site')
  })
  it('only prefills historical text, leaving current findings empty', () => {
    const result = initializeFollowUpIntake(encounter, history)
    expect(result.applied).toBe(true)
    expect(result.intake).toEqual({ chief_complaint: history.chiefComplaint, interval_history: history.intervalHistory, review_of_systems: '', video_observations: '' })
  })
  it.each([{ chief_complaint: '' }, { interval_history: 'My notes' }, { video_observations: null }, { history_prefill: {} }])('preserves saved/cleared intake %j', (provider_intake) => {
    const result = initializeFollowUpIntake({ ...encounter, provider_intake }, history)
    expect(result.applied).toBe(false)
    expect(result.intake.chief_complaint).toBe('')
  })
  it.each([{ patient_reported_pain_min: 0 }, { telehealth_consent_obtained: false }, { patient_location_state: 'CA' }])('does not prefill a partially documented encounter %j', (saved) => {
    expect(initializeFollowUpIntake({ ...encounter, ...saved }, history).applied).toBe(false)
  })
  it('allows status metadata and preserves it', () => {
    const result = initializeFollowUpIntake({ ...encounter, provider_intake: { status_reason: 'Rescheduled' } }, history)
    expect(result.applied).toBe(true)
    expect(result.intake.status_reason).toBe('Rescheduled')
  })
  it('does not prefill completed encounters or absent history', () => {
    expect(initializeFollowUpIntake({ ...encounter, status: 'completed' }, history).applied).toBe(false)
    expect(initializeFollowUpIntake(encounter, null).applied).toBe(false)
  })
  it('handles missing and malformed source text without fabricated values', () => {
    const result = buildIntakeHistory(null, [{ id: 'p', procedure_date: '2026-09-01', procedure_type: 'prp', sites: { bad: 'shape' } }], null)
    expect(result.chiefComplaint).toBe('')
    expect(result.previousPain).toBeNull()
    expect(result.intervalHistory).toBe('1 prior PRP procedure (2026-09-01).')
  })
})
