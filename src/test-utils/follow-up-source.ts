import type { FollowUpReviewState } from '@/lib/clinical/pain-follow-up-source'
export function followUpReviewFixture(version: string, encounterId = 'encounter'): FollowUpReviewState {
  return {
    snapshot: { schema_version: 1, fingerprint: 'current-source', manifest: [], data: {
      encounter: { id: encounterId, encounter_date: '2026-05-02', modality: 'telehealth' },
      patient: { first_name: 'Synthetic', last_name: 'Patient' }, provider: null,
      latestCompletedEncounter: null, priorEpisodeDischarge: null, performedProcedures: [],
    } }, baseline: null, freshness: 'current', reviewed: true, note_version: version, proposal: null,
  }
}
