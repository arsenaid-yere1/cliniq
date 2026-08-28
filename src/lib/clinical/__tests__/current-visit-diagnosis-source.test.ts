import { describe, expect, it } from 'vitest'
import {
  buildEvaluationDiagnosisSource,
  buildPainFollowUpDiagnosisSource,
} from '@/lib/clinical/current-visit-diagnosis-source'
import { defaultProviderIntake } from '@/lib/validations/initial-visit-note'

describe('current visit diagnosis sources', () => {
  it('rejects default evaluation intake as insufficient', () => {
    expect(buildEvaluationDiagnosisSource(defaultProviderIntake)).toBeNull()
  })

  it('allowlists current evaluation symptoms and exam without medical or social history', () => {
    const source = buildEvaluationDiagnosisSource({
      ...defaultProviderIntake,
      chief_complaints: {
        ...defaultProviderIntake.chief_complaints,
        complaints: [{
          ...defaultProviderIntake.chief_complaints.complaints[0],
          body_region: 'Neck',
          pain_character: 'aching',
          severity_min: 4,
          severity_max: 7,
        }],
      },
      past_medical_history: {
        medical_conditions: 'Historical migraine',
        prior_surgeries: 'Historical surgery',
        current_medications: 'Medication',
        allergies: 'Allergy',
      },
      social_history: {
        smoking_status: 'current',
        alcohol_use: 'regular',
        drug_use: 'other',
        occupation: 'Driver',
      },
    })

    expect(source?.current_visit.chief_complaints[0]).toMatchObject({ body_region: 'Neck', severity_max: 7 })
    expect(JSON.stringify(source)).not.toContain('Historical migraine')
    expect(JSON.stringify(source)).not.toContain('Driver')
  })

  it('requires narrative evidence for a pain follow-up instead of pain scores alone', () => {
    expect(buildPainFollowUpDiagnosisSource({
      reason_for_visit: null,
      provider_intake: {},
      patient_reported_pain_min: 4,
      patient_reported_pain_max: 8,
    })).toBeNull()

    expect(buildPainFollowUpDiagnosisSource({
      reason_for_visit: null,
      provider_intake: { chief_complaint: 'Persistent low back pain' },
      patient_reported_pain_min: 4,
      patient_reported_pain_max: 8,
    })?.current_visit).toEqual({
      reason_for_visit: null,
      chief_complaint: 'Persistent low back pain',
      interval_history: null,
      review_of_systems: null,
      video_observations: null,
      patient_reported_pain_min: 4,
      patient_reported_pain_max: 8,
    })
  })
})
