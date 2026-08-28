import { describe, expect, it } from 'vitest'
import {
  clinicalEncounterInputSchema,
  saveEncounterDiagnosesSchema,
  updatePainFollowUpEncounterSchema,
  visitDiagnosisListSchema,
} from '../clinical-encounter'

const baseEncounter = {
  case_id: '11111111-1111-4111-8111-111111111111',
  episode_id: '22222222-2222-4222-8222-222222222222',
  encounter_type: 'pain_follow_up' as const,
  modality: 'telehealth' as const,
  status: 'scheduled' as const,
  scheduled_start: '2026-08-26T12:00:00Z',
  scheduled_end: '2026-08-26T12:30:00Z',
  encounter_date: '2026-08-26',
  provider_intake: {},
  patient_reported_measurements: {},
}

describe('clinicalEncounterInputSchema', () => {
  it('accepts a scheduled telehealth encounter', () => {
    expect(clinicalEncounterInputSchema.safeParse(baseEncounter).success).toBe(true)
  })

  it('rejects a schedule whose end precedes its start', () => {
    expect(clinicalEncounterInputSchema.safeParse({
      ...baseEncounter,
      scheduled_end: '2026-08-26T11:59:00Z',
    }).success).toBe(false)
  })

  it('requires an encounter date when completed', () => {
    expect(clinicalEncounterInputSchema.safeParse({
      ...baseEncounter,
      status: 'completed',
      encounter_date: null,
    }).success).toBe(false)
  })

  it('rejects an inverted patient-reported pain range', () => {
    expect(clinicalEncounterInputSchema.safeParse({
      ...baseEncounter,
      patient_reported_pain_min: 8,
      patient_reported_pain_max: 4,
    }).success).toBe(false)
  })

  it('does not allow telehealth consent on an in-person encounter', () => {
    expect(clinicalEncounterInputSchema.safeParse({
      ...baseEncounter,
      modality: 'in_person',
      telehealth_consent_obtained: true,
    }).success).toBe(false)
  })
})

describe('updatePainFollowUpEncounterSchema', () => {
  it('accepts a consent-only partial update so stored modality can be checked', () => {
    expect(updatePainFollowUpEncounterSchema.safeParse({
      encounter_id: '33333333-3333-4333-8333-333333333333',
      telehealth_consent_obtained: true,
      telehealth_consent_at: '2026-08-26T12:00:00Z',
    }).success).toBe(true)
  })

  it('rejects consent when a non-telehealth modality is included explicitly', () => {
    expect(updatePainFollowUpEncounterSchema.safeParse({
      encounter_id: '33333333-3333-4333-8333-333333333333',
      modality: 'in_person',
      telehealth_consent_obtained: true,
    }).success).toBe(false)
  })
})

describe('visit diagnosis schemas', () => {
  it('accepts structured visit diagnoses', () => {
    expect(visitDiagnosisListSchema.safeParse([
      { icd10_code: 'M54.50', description: 'Low back pain, unspecified' },
    ]).success).toBe(true)
  })

  it('rejects empty fields and unexpected diagnosis keys', () => {
    expect(visitDiagnosisListSchema.safeParse([
      { icd10_code: '', description: 'Low back pain' },
    ]).success).toBe(false)
    expect(visitDiagnosisListSchema.safeParse([
      { icd10_code: 'M54.50', description: 'Low back pain', selected: true },
    ]).success).toBe(false)
  })

  it('does not accept client-owned confirmation metadata', () => {
    expect(saveEncounterDiagnosesSchema.safeParse({
      case_id: '11111111-1111-4111-8111-111111111111',
      encounter_id: '33333333-3333-4333-8333-333333333333',
      diagnoses: [],
      diagnoses_confirmed_at: '2026-08-28T12:00:00Z',
    }).success).toBe(false)
  })
})
