import { describe, expect, it } from 'vitest'
import { isEarlierEncounter } from '@/lib/clinical/visit-diagnosis-history'
import { buildCurrentEncounterDiagnosisSource } from '@/lib/clinical/current-visit-diagnosis-source'
import { defaultProviderIntake } from '@/lib/validations/initial-visit-note'

const current = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  completed_at: null,
  encounter_date: '2026-08-20',
  scheduled_start: '2026-08-20T16:00:00Z',
  created_at: '2026-08-19T16:00:00Z',
  provider_id: null,
}

describe('visit diagnosis history ordering', () => {
  it('uses completed time before encounter date and schedule', () => {
    expect(isEarlierEncounter({
      ...current,
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      completed_at: '2026-08-19T23:59:00Z',
      encounter_date: '2026-08-30',
    }, current)).toBe(true)
  })

  it('uses the id as a stable tie-breaker', () => {
    expect(isEarlierEncounter({
      ...current,
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }, current)).toBe(true)
    expect(isEarlierEncounter({
      ...current,
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    }, current)).toBe(false)
  })
})

describe('current encounter diagnosis source routing', () => {
  it('uses only the linked evaluation intake for evaluation encounters', () => {
    const source = buildCurrentEncounterDiagnosisSource({
      encounter_type: 'initial_evaluation',
      reason_for_visit: 'Must not replace linked intake',
      provider_intake: { chief_complaint: 'Must not be used' },
      patient_reported_pain_min: 1,
      patient_reported_pain_max: 9,
    }, {
      ...defaultProviderIntake,
      chief_complaints: {
        ...defaultProviderIntake.chief_complaints,
        additional_notes: 'Current evaluation neck pain',
      },
    })

    expect(JSON.stringify(source)).toContain('Current evaluation neck pain')
    expect(JSON.stringify(source)).not.toContain('Must not be used')
    expect(JSON.stringify(source)).not.toContain('Must not replace')
  })

  it('uses only the current encounter row for pain follow-ups', () => {
    const source = buildCurrentEncounterDiagnosisSource({
      encounter_type: 'pain_follow_up',
      reason_for_visit: null,
      provider_intake: { interval_history: 'Current visit low back pain' },
      patient_reported_pain_min: 3,
      patient_reported_pain_max: 7,
    }, {
      ...defaultProviderIntake,
      chief_complaints: {
        ...defaultProviderIntake.chief_complaints,
        additional_notes: 'Unrelated evaluation intake',
      },
    })

    expect(JSON.stringify(source)).toContain('Current visit low back pain')
    expect(JSON.stringify(source)).not.toContain('Unrelated evaluation intake')
  })
})
