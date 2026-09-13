import { describe, expect, it } from 'vitest'
import { defaultProviderIntake, providerIntakeSchema, initialVisitSections } from '../initial-visit-note'
import { defaultPsychologicalAssessment as empty, psychologicalAssessmentSchema as schema, psychologicalFinalizationError } from '../psychological-assessment'

describe('psychological intake contract', () => {
  it('preserves the legacy intake and 16-section note contract', () => {
    expect(providerIntakeSchema.parse(defaultProviderIntake).psychological_assessment).toBeUndefined()
    expect(initialVisitSections).toHaveLength(16)
    expect(schema.parse(empty)).toMatchObject({ symptom_status: 'not_assessed', assessment_status: 'not_assessed', safety_status: 'not_assessed', symptoms: [] })
  })
  it('allows no reported symptoms without claiming the clinician assessed the patient', () => {
    expect(schema.parse({ ...empty, symptom_status: 'none_reported' }).assessment_status).toBe('not_assessed')
  })
  it('requires a description for unspecified or other reported symptoms', () => {
    expect(schema.safeParse({ ...empty, symptom_status: 'reported' }).success).toBe(false)
    expect(schema.safeParse({ ...empty, symptom_status: 'reported', symptoms: ['Other'] }).success).toBe(false)
    expect(schema.safeParse({ ...empty, symptom_status: 'reported', symptoms: ['Flashbacks'] }).success).toBe(true)
  })
  it('rejects hidden positive symptom details under a negative or declined status', () => {
    for (const symptom_status of ['not_assessed', 'none_reported', 'declined']) {
      expect(schema.safeParse({ ...empty, symptom_status, symptoms: ['Nightmares'] }).success).toBe(false)
      expect(schema.safeParse({ ...empty, symptom_status, sleep_details: 'Wakes with nightmares' }).success).toBe(false)
    }
  })
  it('requires an impression only when explicitly marking the assessment completed', () => {
    expect(schema.safeParse({ ...empty, assessment_status: 'partial', observations: 'Anxious affect' }).success).toBe(true)
    expect(schema.safeParse({ ...empty, assessment_status: 'assessed' }).success).toBe(false)
    expect(schema.safeParse({ ...empty, assessment_status: 'assessed', clinical_impression: 'Further evaluation needed' }).success).toBe(true)
  })
  it('allows saving partial safety documentation but prevents finalization', () => {
    const partial = { ...empty, safety_status: 'concerns' as const, safety_details: 'Concern documented' }
    expect(schema.safeParse(partial).success).toBe(true)
    expect(psychologicalFinalizationError(partial)).toContain('actions taken')
    expect(psychologicalFinalizationError({ ...partial, safety_actions: 'Actions documented', safety_disposition: 'Disposition documented' })).toBeNull()
  })
  it('requires note review after the saved source changes, without penalizing legacy notes', () => {
    expect(psychologicalFinalizationError(undefined)).toBeNull()
    expect(psychologicalFinalizationError(empty)).toBeNull()
    expect(psychologicalFinalizationError({ ...empty, note_review_required: true })).toContain('Review the affected note sections')
  })
  it('does not accept safety details hidden by a no-concern answer', () => {
    expect(schema.safeParse({ ...empty, safety_status: 'no_concerns', safety_details: 'Concern remains' }).success).toBe(false)
  })
  it('does not accept a referral narrative under an undocumented follow-up plan', () => {
    expect(schema.safeParse({ ...empty, referral_reason: 'Referral recommendation' }).success).toBe(false)
    expect(schema.safeParse({ ...empty, follow_up: 'referral_recommended', referral_reason: 'Referral recommendation' }).success).toBe(true)
  })
})
