import { describe, expect, it } from 'vitest'
import { buildPainFollowUpEditorKey } from '../pain-follow-up-editor-key'

const note = { id: 'note', status: 'draft', subjective: 'Draft', procedure_recommendations: [], updated_at: 'v1' }
const key = (row: typeof note | null = note, encounter = 'visit', caseId = 'case') => buildPainFollowUpEditorKey(caseId, encounter, row)
describe('follow-up lifecycle identity', () => {
  it('stays stable for ordinary draft writes', () => {
    expect(key({ ...note, updated_at: 'v2', subjective: 'Regenerated' })).toBe(key())
  })
  it('changes for a created note and navigation, including empty encounters', () => {
    expect(key(null)).not.toBe(key())
    expect(key(null, 'other')).not.toBe(key(null))
    expect(key(null, 'visit', 'other')).not.toBe(key(null))
    expect(key({ ...note, id: 'other' })).not.toBe(key())
  })
  it.each(['generating', 'failed', 'finalized'])('changes when %s becomes draft', (status) => {
    expect(key({ ...note, status })).not.toBe(key())
  })
  it('changes for populated draft to reset empty draft', () => {
    expect(key({ ...note, subjective: '' })).not.toBe(key())
  })
})
