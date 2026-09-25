import { describe, expect, it, vi } from 'vitest'
import { historyDatabase } from '@/test-utils/prior-episode-history'
import { collectReviewSnapshot, collectStableReviewSnapshot, reviewSourceHash, reviewVersionHash } from '../review-source'
import { validateGroundedFinding, type GroundedFinding } from '../review-findings'
import { serializeReviewInput } from '../review-input'
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

describe('historical QC evidence and freshness', () => {
  it('shares exact historical facts as sources, never targets or current procedures', async () => {
    const { client } = historyDatabase()
    const snapshot = await collectReviewSnapshot(client as never, 'case', 'current')
    expect(snapshot.notes.map(note => note.id)).toEqual(['current-note'])
    expect(snapshot.sources.filter(source => source.type === 'procedures')).toEqual([])
    expect(snapshot.sources.find(source => source.id === 'historical:discharge_notes:dis1')).toMatchObject({ scope: 'historical_episode', date: '2026-01-05', fields: { assessment: 'Recovered; discharged', episode_number: 1 } })
    expect(snapshot.versions.some(version => version.fingerprint)).toBe(true)
    expect(serializeReviewInput(snapshot)).not.toContain('fingerprint')
  })
  it('included corrections change clinical hash, metadata changes only version hash', async () => {
    const { client, tables } = historyDatabase()
    const baseline = await collectReviewSnapshot(client as never, 'case', 'current')
    tables.discharge_notes[0].updated_at = 'v2'
    const metadata = await collectReviewSnapshot(client as never, 'case', 'current')
    expect(reviewSourceHash(metadata)).toBe(reviewSourceHash(baseline))
    expect(reviewVersionHash(metadata)).not.toBe(reviewVersionHash(baseline))
    tables.discharge_notes[0].assessment = 'Corrected prior outcome'
    expect(reviewSourceHash(await collectReviewSnapshot(client as never, 'case', 'current'))).not.toBe(reviewSourceHash(baseline))
  })
  it('future and wrong-case records do not affect either hash', async () => {
    const { client, tables } = historyDatabase()
    const baseline = await collectReviewSnapshot(client as never, 'case', 'current')
    tables.procedures.push({ id: 'future', case_id: 'case', episode_id: 'e1', procedure_date: '2027-01-01' })
    tables.discharge_notes.push({ ...tables.discharge_notes[0], id: 'wrong', case_id: 'other' })
    const after = await collectReviewSnapshot(client as never, 'case', 'current')
    expect(reviewSourceHash(after)).toBe(reviewSourceHash(baseline))
    expect(reviewVersionHash(after)).toBe(reviewVersionHash(baseline))
  })
  it.each(['reopen', 'delete', 'add'])('%s changes selection freshness', async mode => {
    const { client, tables } = historyDatabase()
    const baseline = await collectReviewSnapshot(client as never, 'case', 'current')
    if (mode === 'reopen') tables.discharge_notes[0].status = 'draft'
    if (mode === 'delete') tables.discharge_notes[0].deleted_at = 'deleted'
    if (mode === 'add') tables.procedures.push({ id: 'new', case_id: 'case', episode_id: 'e1', procedure_date: '2026-01-04' })
    expect(reviewVersionHash(await collectReviewSnapshot(client as never, 'case', 'current'))).not.toBe(reviewVersionHash(baseline))
  })
  it('rechecks historical selection during stable reads', async () => {
    const { client, tables } = historyDatabase()
    const from = client.from.getMockImplementation()!
    let version = 0
    client.from.mockImplementation(table => {
      if (table === 'discharge_notes') tables.discharge_notes[0].updated_at = String(version++)
      return from(table)
    })
    await expect(collectStableReviewSnapshot(client as never, 'case', 'current')).rejects.toThrow('changed')
  })
  it('validates exact historical evidence and rejects future evidence or historical targets', async () => {
    const { client } = historyDatabase()
    const snapshot = await collectReviewSnapshot(client as never, 'case', 'current')
    const finding: GroundedFinding = { rule_id: 'clinical_consistency', entity_key: '', severity: 'warning', score: 5, step: 'pain_evaluation', note_id: 'current-note', procedure_id: null, encounter_id: 'current-enc', section_key: 'chief_complaint', message: 'Check history', rationale: null, suggested_tone_hint: null, evidence: [
      { source_id: 'historical:discharge_notes:dis1', field: 'assessment', quote: 'Recovered; discharged', missing: false },
      { source_id: 'initial_visit_notes:current-note', field: 'chief_complaint', quote: 'Pain returned', missing: false },
    ] }
    // Use an existing supported AI rule; identity is validated separately.
    finding.rule_id = 'symptom_diagnosis_consistency'
    const { AI_REVIEW_RULES } = await import('../review-rules')
    finding.rule_id = Object.keys(AI_REVIEW_RULES)[0]
    expect(validateGroundedFinding(finding, snapshot, 'ai')).toBeNull()
    expect(validateGroundedFinding({ ...finding, note_id: 'dis1' }, snapshot, 'ai')).toContain('target')
    const source = snapshot.sources.find(s => s.id === finding.evidence[0].source_id)!
    source.date = '2026-02-01'
    expect(validateGroundedFinding(finding, snapshot, 'ai')).toContain('Later evidence')
    source.date = null
    expect(validateGroundedFinding(finding, snapshot, 'ai')).toContain('Undated historical')
  })
  it('keeps date-unknown history unavailable without using today', async () => {
    const { client, tables } = historyDatabase()
    tables.initial_visit_notes.find(row => row.id === 'current-note')!.visit_date = null
    tables.clinical_encounters.find(row => row.id === 'current-enc')!.encounter_date = null
    const snapshot = await collectReviewSnapshot(client as never, 'case', 'current')
    expect(snapshot.sources.filter(s => s.scope === 'historical_episode').map(s => s.type)).toEqual(['prior_episode_coverage'])
    expect(snapshot.coverage.limitations.join(' ')).toContain('service date is unknown')
  })
})
