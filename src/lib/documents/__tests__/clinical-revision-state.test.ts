import { describe, expect, it } from 'vitest'
import { deriveClinicalRevisionStates } from '../clinical-revision-state'
describe('clinical revision history', () => {
  it('marks prior versions superseded and the latest reset as replacement pending', () => {
    const states = deriveClinicalRevisionStates([
      { original_document_id: 'v1', replacement_document_id: 'v2' },
      { original_document_id: 'v2', replacement_document_id: null },
    ])
    expect(states.get('v1')).toBe('superseded_note')
    expect(states.get('v2')).toBe('reset_pending')
  })
})
