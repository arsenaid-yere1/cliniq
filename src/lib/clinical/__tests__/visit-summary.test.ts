import { describe, expect, it } from 'vitest'
import { buildVisitOverview, type VisitOverviewInput, type EncounterInput, type NoteInput } from '../visit-summary'
import { isVisitsPath, visitHref } from '../visit-routes'
import { readCompleteVisitRows } from '../complete-visit-rows'
export const base: VisitOverviewInput = {
  caseId: 'case', caseStatus: 'active', episodes: [{ id: 'ep', case_id: 'case', episode_number: 1, status: 'active', requires_pain_evaluation: false, opened_at: '2026-09-01', ended_at: null, return_reason: null }],
  encounters: [], notes: [], corrections: [], orders: [], appointments: [], providers: [], providerError: false,
  returnVisitsEnabled: true, correctionAllowed: true, claimedEncounterIds: [],
}
const encounter = (changes: Partial<EncounterInput> = {}): EncounterInput => ({ id: 'visit', case_id: 'case', episode_id: 'ep', encounter_type: 'initial_evaluation', status: 'in_progress', encounter_date: '2026-09-01', scheduled_start: null, provider_id: null, modality: 'in_person', ...changes })
const note = (changes: Partial<NoteInput> = {}): NoteInput => ({ id: 'note', case_id: 'case', episode_id: 'ep', encounter_id: 'visit', kind: 'initial_evaluation', status: 'draft', hasContent: true, visit_date: '2026-09-01', document_id: null, ...changes })
describe('unified overview', () => {
  it('offers both initial evaluation types without creating records', () => {
    const result = buildVisitOverview(base).episodes[0]
    expect(result.rows).toEqual([])
    expect(result.primary?.label).toBe('Start Initial Visit')
    expect(result.painAction?.href).toContain('visitType=pain_evaluation_visit')
    expect(result.dischargeReason).toMatch(/Complete a clinical visit/)
  })
  it.each([
    ['draft', false, 'Intake in progress'], ['draft', true, 'Draft'], ['generating', false, 'Generating'], ['failed', false, 'Generation failed'], ['finalized', true, 'Finalized'],
  ] as const)('maps %s content=%s to %s independently of encounter state', (status, hasContent, expected) => {
    const result = buildVisitOverview({ ...base, encounters: [encounter()], notes: [note({ status, hasContent })] })
    expect(result.episodes[0].rows[0]).toMatchObject({ noteState: expected, encounterStatus: 'in_progress' })
  })
  it('keeps a required return evaluation first and requires both completion and signature', () => {
    const input = { ...base, episodes: [{ ...base.episodes[0], episode_number: 2, requires_pain_evaluation: true }], encounters: [encounter({ encounter_type: 'pain_evaluation', status: 'completed' })], notes: [note({ kind: 'pain_evaluation' })] }
    const pending = buildVisitOverview(input).episodes[0]
    expect(pending.initialAction).toBeNull()
    expect(pending.primary?.label).toBe('Complete Pain Evaluation')
    expect(pending.canSchedule).toBe(false)
    expect(buildVisitOverview({ ...input, notes: [note({ kind: 'pain_evaluation', status: 'finalized' })] }).episodes[0].canSchedule).toBe(true)
  })
  it('retains legacy scheduling without adding a pain-evaluation prerequisite', () => {
    expect(buildVisitOverview(base).episodes[0].canSchedule).toBe(true)
  })
  it('supports note-only rows but does not invent encounter status', () => {
    const row = buildVisitOverview({ ...base, notes: [note({ encounter_id: null })] }).episodes[0].rows[0]
    expect(row.encounterStatus).toBeNull()
    expect(row.href).toContain('episode=ep')
  })
  it.each([
    [note({ episode_id: null })], [note({ case_id: 'other' })], [note(), note({ id: 'duplicate' })], [note({ encounter_id: 'foreign' })],
  ])('fails closed on ambiguous ownership', (...notes) => {
    const result = buildVisitOverview({ ...base, encounters: [encounter()], notes })
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.episodes[0].writable).toBe(false)
    expect(result.episodes[0].primary).toBeNull()
  })
  it('does not choose arbitrarily between unfinished visits', () => {
    const result = buildVisitOverview({ ...base, encounters: [encounter(), encounter({ id: 'discharge', encounter_type: 'discharge' })] }).episodes[0]
    expect(result.multipleUnfinished).toBe(true)
    expect(result.primary).toBeNull()
  })
  it('preserves correction discovery in a discharged episode on a locked case', () => {
    const result = buildVisitOverview({ ...base, caseStatus: 'closed', episodes: [{ ...base.episodes[0], status: 'discharged' }], encounters: [encounter({ encounter_type: 'discharge', status: 'completed' })], notes: [note({ kind: 'discharge' })], corrections: [{ id: 'correction', case_id: 'case', episode_id: 'ep', discharge_note_id: 'note', status: 'open', revision_number: 2 }] })
    expect(result.episodes[0].rows[0]).toMatchObject({ noteState: 'Correction in progress', encounterStatus: 'completed', actionLabel: 'Continue correction', group: 'work' })
    expect(result.canStartReturn).toBe(false)
  })
  it.each([false, null])('uses neutral correction access when permission is %s', correctionAllowed => {
    const result = buildVisitOverview({ ...base, correctionAllowed, episodes: [{ ...base.episodes[0], status: 'discharged' }], encounters: [encounter({ encounter_type: 'discharge' })], notes: [note({ kind: 'discharge' })], corrections: [{ id: 'c', case_id: 'case', episode_id: 'ep', discharge_note_id: 'note', status: 'open', revision_number: 2 }] })
    expect(result.episodes[0].rows[0].actionLabel).toBe('View correction')
  })
  it('shows unavailable correction access when billing claims fail to load', () => {
    const result = buildVisitOverview({ ...base, claimedEncounterIds: null, episodes: [{ ...base.episodes[0], status: 'discharged' }], encounters: [encounter({ encounter_type: 'discharge' })], notes: [note({ kind: 'discharge' })], corrections: [{ id: 'c', case_id: 'case', episode_id: 'ep', discharge_note_id: 'note', status: 'open', revision_number: 2 }] })
    expect(result.episodes[0].rows[0]).toMatchObject({ actionLabel: 'View correction', editable: false, unavailableReason: expect.stringContaining('could not be checked') })
  })
  it('keeps evaluations and discharge available when returns are disabled', () => {
    const rows = buildVisitOverview({ ...base, returnVisitsEnabled: false, encounters: [encounter(), encounter({ id: 'f', encounter_type: 'pain_follow_up' }), encounter({ id: 'd', encounter_type: 'discharge' })] }).episodes[0].rows
    expect(rows.find(r => r.kind === 'initial_evaluation')?.href).toContain('initial-visit')
    expect(rows.find(r => r.kind === 'discharge')?.href).toContain('discharge')
    expect(rows.find(r => r.kind === 'pain_follow_up')).toMatchObject({ href: null, editable: false })
  })
  it('requires a completed, signed, dated discharge before a return and preserves closed-case eligibility', () => {
    const input = { ...base, caseStatus: 'closed', episodes: [{ ...base.episodes[0], status: 'discharged' }], encounters: [encounter({ encounter_type: 'discharge', status: 'completed' })], notes: [note({ kind: 'discharge', status: 'finalized' })] }
    expect(buildVisitOverview(input).canStartReturn).toBe(true)
    expect(buildVisitOverview({ ...input, notes: [] }).canStartReturn).toBe(false)
    expect(buildVisitOverview({ ...input, caseStatus: 'archived' }).canStartReturn).toBe(false)
  })
  it('retains cancelled/no-show rows and exposes exact unresolved work', () => {
    const result = buildVisitOverview({ ...base, encounters: [encounter({ status: 'cancelled' }), encounter({ id: 'no-show', status: 'no_show' }), encounter({ id: 'scheduled', status: 'scheduled' })], orders: [{ id: 'order', episode_id: 'ep', status: 'ordered' }], appointments: [{ id: 'appointment', episode_id: 'ep', status: 'scheduled' }] }).episodes[0]
    expect(result.rows.filter(r => r.group === 'history')).toHaveLength(2)
    expect(result.blockers.map(b => b.id)).toEqual(['scheduled', 'order', 'appointment'])
  })
})
it('matches route segments and keeps episode identity in links', () => {
  expect(isVisitsPath('/patients/case/initial-visit', 'case')).toBe(true)
  expect(isVisitsPath('/patients/case2/visits', 'case')).toBe(false)
  expect(isVisitsPath('/patients/case/visits-extra', 'case')).toBe(false)
  expect(visitHref('case', 'ep', 'discharge')).toBe('/patients/case/discharge?episode=ep')
})
describe('complete history pagination', () => {
  it('loads histories above the API cap', async () => {
    const rows = Array.from({ length: 1201 }, (_, i) => ({ id: String(i) }))
    expect(await readCompleteVisitRows(async (from, to) => ({ data: rows.slice(from, to + 1), count: rows.length, error: null }))).toHaveLength(1201)
  })
  it('rejects capped, failed, duplicate or changing pages', async () => {
    await expect(readCompleteVisitRows(async () => ({ data: [{ id: '1' }], count: 1001, error: null }))).rejects.toThrow(/incomplete/)
    await expect(readCompleteVisitRows(async () => ({ data: [], count: 0, error: 'failed' }))).rejects.toThrow()
    await expect(readCompleteVisitRows(async () => ({ data: [{ id: '1' }, { id: '1' }], count: 2, error: null }))).rejects.toThrow(/changed/)
  })
})
