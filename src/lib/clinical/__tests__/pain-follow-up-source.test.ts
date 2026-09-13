import { describe, expect, it } from 'vitest'
import { changedFollowUpSources, followUpPromptSource, followUpSourceSnapshotSchema, type FollowUpSourceSnapshot } from '../pain-follow-up-source'

const snapshot: FollowUpSourceSnapshot = {
  schema_version: 1, fingerprint: 'source-a',
  manifest: [{ kind: 'encounter', id: 'current', date: '2026-05-02', label: 'Current visit intake', fingerprint: 'a' }],
  data: { encounter: { encounter_date: '2026-05-02' }, patient: null, provider: null, latestCompletedEncounter: null, priorEpisodeDischarge: null, performedProcedures: [] },
}
describe('follow-up source contract', () => {
  it('rejects missing and incompatible source responses', () => {
    expect(followUpSourceSnapshotSchema.safeParse({}).success).toBe(false)
    expect(followUpSourceSnapshotSchema.safeParse({ ...snapshot, schema_version: 2 }).success).toBe(false)
    expect(followUpSourceSnapshotSchema.safeParse(snapshot).success).toBe(true)
  })
  it('passes precisely the authoritative data to generation', () => {
    expect(followUpPromptSource(snapshot)).toBe(snapshot.data)
  })
  it('identifies changed, removed and newly selected sources', () => {
    const next = { ...snapshot, manifest: [
      { ...snapshot.manifest[0], fingerprint: 'b' },
      { kind: 'procedure', id: 'p', date: '2026-04-01', label: 'Procedure on 2026-04-01', fingerprint: 'p' },
    ] }
    expect(changedFollowUpSources(snapshot, next)).toEqual(['Current visit intake', 'Procedure on 2026-04-01'])
    expect(changedFollowUpSources(next, snapshot)).toEqual(['Current visit intake', 'Procedure on 2026-04-01'])
    expect(changedFollowUpSources(snapshot, snapshot)).toEqual([])
    expect(changedFollowUpSources(null, snapshot)).toEqual([])
  })
})
