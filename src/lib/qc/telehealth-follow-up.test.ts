import { describe, expect, it } from 'vitest'
import { validateTelehealthFollowUpOutput } from './telehealth-follow-up'
import type { PainFollowUpNoteResult } from '@/lib/validations/pain-follow-up-note'

const base: PainFollowUpNoteResult = {
  subjective: 'Patient reports improving pain.', interval_history: 'No new injury.',
  review_of_systems: 'No red flags reported.', telehealth_observations: 'Alert on video.',
  imaging_review: 'Prior MRI reviewed.', assessment: 'Improving by patient report.',
  diagnoses: 'Cervicalgia', treatment_plan: 'Continue home exercise.',
  patient_education: 'Return precautions reviewed.', follow_up: 'Follow up as needed.',
  clinician_disclaimer: 'Telehealth limits reviewed.', procedure_recommendations: [],
}

describe('validateTelehealthFollowUpOutput', () => {
  it('allows video observations and patient-reported history', () => {
    expect(validateTelehealthFollowUpOutput(base).data).toEqual(base)
  })
  it('rejects hands-on findings', () => {
    expect(validateTelehealthFollowUpOutput({ ...base, telehealth_observations: 'Strength 5/5.' }).error).toMatch(/hands-on/)
  })
  it('rejects unsupported current vital signs', () => {
    expect(validateTelehealthFollowUpOutput({ ...base, assessment: 'Blood pressure 120/80.' }).error).toMatch(/vital signs/)
  })
  it('allows documentation that a hands-on examination was not performed', () => {
    expect(validateTelehealthFollowUpOutput({
      ...base,
      telehealth_observations: 'Palpation was not performed because this was a telehealth encounter.',
    }).data).toBeDefined()
  })
  it('allows clearly labeled historical findings and patient-reported home vitals', () => {
    expect(validateTelehealthFollowUpOutput({
      ...base,
      assessment: 'Prior examination documented strength 5/5. Patient reports a home blood pressure reading of 120/80.',
    }).data).toBeDefined()
  })
})
