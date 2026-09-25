import { describe, expect, it } from 'vitest'
import { historyServiceDate, MAX_HISTORY_BYTES, projectPriorEpisodeHistory, type HistoricalEpisodeRows } from '../prior-episode-history'

import { historicalEpisode } from '@/test-utils/prior-episode-history'

const project = (batches: HistoricalEpisodeRows[]) => projectPriorEpisodeHistory('case', 5, '2026-01-05', batches)
describe('prior episode projection', () => {
  it('includes same-day discharge, latest detailed and older compact with gaps and provenance', () => {
    const value = project([historicalEpisode(1), historicalEpisode(3)]).history
    expect(value.episodes.map(e => [e.episode_number, e.detail])).toEqual([[3, 'detailed'], [1, 'compact']])
    expect(value.episodes[0].facts).toHaveLength(5)
    expect(value.episodes[1].facts).toHaveLength(4)
    expect(value.episodes[1].eligible_follow_up_count).toBe(1)
    expect(value.episodes[1].facts.find(f => f.source_table === 'initial_visit_notes')?.fields).toEqual({ diagnoses: 'Prior diagnosis' })
    expect(value.episodes[0].facts.find(f => f.source_table === 'procedures')?.fields.site_labels).toEqual(['Right Knee'])
    expect(value.episodes[0].facts.find(f => f.source_table === 'discharge_notes')).toMatchObject({ date: '2026-01-05', fields: { pain_score_max: 1, discharge_pain_estimated: false } })
    expect(value.coverage.limitations.join(' ')).toContain('Compact history')
  })
  it('is stable across database ordering and excludes future data from clinical and version state', () => {
    const a = historicalEpisode()
    const baseline = project([a])
    a.procedures.push({ case_id: 'case', episode_id: 'e1', id: 'future', procedure_date: '2026-02-01', updated_at: 'future' })
    a.procedure_notes.push({ case_id: 'case', procedure_id: 'future', id: 'future-pn', status: 'finalized', subjective: 'Future text' })
    a.initial_visit_notes.reverse(); a.clinical_encounters.reverse()
    expect(project([a])).toEqual(baseline)
    a.procedures[1].updated_at = 'changed'
    expect(project([a])).toEqual(baseline)
  })
  it.each(['draft', 'deleted', 'wrong-case', 'wrong-episode', 'wrong-type', 'undated', 'in-progress'])('never uses %s evaluation text', (mode) => {
    const a = historicalEpisode()
    const row = a.initial_visit_notes[0]
    if (mode === 'draft') row.status = 'draft'
    if (mode === 'deleted') row.deleted_at = 'yes'
    if (mode === 'wrong-case') row.case_id = 'other'
    if (mode === 'wrong-episode') row.episode_id = 'other'
    if (mode === 'wrong-type') a.clinical_encounters[0].encounter_type = 'discharge'
    if (mode === 'undated') a.clinical_encounters[0].encounter_date = null
    if (mode === 'in-progress') a.clinical_encounters[0].status = 'in_progress'
    expect(JSON.stringify(project([a]).history)).not.toContain('Prior pain')
  })
  it('excludes an episode with an open discharge correction and never uses snapshots', () => {
    const a = historicalEpisode()
    const baseline = project([a])
    a.discharge_notes[0].status = 'draft'
    a.discharge_notes[0].original_note_snapshot = { assessment: 'Old signed snapshot' }
    const result = project([a])
    expect(result.history.episodes).toEqual([])
    expect(result.history.coverage.complete).toBe(false)
    expect(JSON.stringify(result)).not.toContain('Old signed snapshot')
    expect(result.versionState).not.toEqual(baseline.versionState)
    a.discharge_notes[0].status = 'finalized'
    a.discharge_notes[0].assessment = 'Corrected discharge'
    expect(JSON.stringify(project([a]).history)).toContain('Corrected discharge')
  })
  it('excludes cancelled and future episodes without future coverage leakage', () => {
    const future = historicalEpisode(3)
    future.discharge_notes[0].visit_date = '2026-03-01'
    expect(project([future])).toEqual(project([]))
    const cancelled = historicalEpisode(1); cancelled.episode.status = 'cancelled'
    expect(project([cancelled]).history.episodes).toEqual([])
  })
  it('preserves performed facts but excludes draft procedure text', () => {
    const a = historicalEpisode(); a.procedure_notes[0].status = 'draft'
    const result = project([a]).history
    expect(result.episodes[0].facts.some(f => f.source_table === 'procedures')).toBe(true)
    expect(JSON.stringify(result)).not.toContain('Prior procedure narrative')
    expect(result.coverage.complete).toBe(false)
  })
  it('uses structured site labels when available without inventing outcomes', () => {
    const a = historicalEpisode()
    a.procedures[0].sites = [{ label: 'Knee', laterality: 'left', volume_ml: null, target_confirmed_imaging: null }]
    const proc = project([a]).history.episodes[0].facts.find(f => f.source_table === 'procedures')!
    expect(proc.fields.site_labels).toEqual(['Left Knee'])
    expect(proc.fields.complications).toBeNull()
  })
  it('changes version state for metadata while leaving clinical facts unchanged', () => {
    const a = historicalEpisode(), baseline = project([a])
    a.discharge_notes[0].updated_at = 'v2'
    const updated = project([a])
    expect(updated.history).toEqual(baseline.history)
    expect(updated.versionState).not.toEqual(baseline.versionState)
  })
  it('fails on oversized history without clipping source narrative', () => {
    const a = historicalEpisode(); a.initial_visit_notes[0].chief_complaint = 'x'.repeat(MAX_HISTORY_BYTES)
    expect(() => project([a])).toThrow('no records were truncated')
  })
  it('does not invent clinical dates', () => {
    expect(historyServiceDate(null, '2026-02-30', '2026-01-01T00:00:00Z')).toBeNull()
    expect(historyServiceDate(null, '2026-01-01')).toBe('2026-01-01')
  })
})
