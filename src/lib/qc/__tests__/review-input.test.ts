import { describe, expect, it } from 'vitest'
import { consistencyFixtures, consistencySnapshot } from '../evaluation/consistency-fixtures'
import { serializeReviewInput } from '../review-input'

describe('lossless review prompt packaging', () => {
  it('keeps every source and section key while removing exactly duplicated groups', () => {
    const snapshot = consistencySnapshot(consistencyFixtures[0],true)
    snapshot.notes[0].sections.empty = ''
    snapshot.notes[0].sections.missing = null
    snapshot.notes[0].context = {vitals:{pain_score_max:4}}
    snapshot.sources[0].fields = {...snapshot.notes[0].sections,...snapshot.notes[0].context,decision:{...snapshot.notes[0].decision}}
    const original = structuredClone(snapshot)
    const input = JSON.parse(serializeReviewInput(snapshot))
    expect(input.sources).toEqual(snapshot.sources)
    expect(input.notes[0]).toMatchObject({id:snapshot.notes[0].id,source_id:snapshot.sources[0].id,section_keys:Object.keys(snapshot.notes[0].sections)})
    for (const group of ['sections','context','decision']) expect(input.notes[0]).not.toHaveProperty(group)
    expect(snapshot).toEqual(original)
    expect(input).not.toHaveProperty('versions')
    expect(serializeReviewInput(snapshot).length).toBeLessThan(JSON.stringify(snapshot).length)
  })
  it('preserves groups with missing or different evidence mirrors', () => {
    const snapshot = consistencySnapshot(consistencyFixtures[0],true)
    snapshot.sources[0].fields = {...snapshot.sources[0].fields}
    snapshot.notes[0].context = {extra:'Unique context'}
    snapshot.notes[0].sections.subjective = 'Unique saved section'
    const input = JSON.parse(serializeReviewInput(snapshot))
    expect(input.notes[0].sections).toEqual(snapshot.notes[0].sections)
    expect(input.notes[0].context).toEqual(snapshot.notes[0].context)
    expect(input.notes[0].decision).toEqual(snapshot.notes[0].decision)
    expect(input.sources).toEqual(snapshot.sources)
  })
  it('preserves the full note when its source is absent', () => {
    const snapshot = consistencySnapshot(consistencyFixtures[0],true)
    snapshot.sources = []
    expect(JSON.parse(serializeReviewInput(snapshot)).notes).toEqual(snapshot.notes)
  })
})
