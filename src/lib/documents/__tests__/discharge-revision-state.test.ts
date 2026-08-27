import { describe, expect, it } from 'vitest'
import { deriveDischargeDocumentRevisionStates } from '../discharge-revision-state'

describe('deriveDischargeDocumentRevisionStates', () => {
  it('ignores open and cancelled correction attempts', () => {
    const states = deriveDischargeDocumentRevisionStates([
      { revision_number: 2, status: 'open', original_document_id: 'original', replacement_document_id: null },
      { revision_number: 3, status: 'cancelled', original_document_id: 'original', replacement_document_id: null },
    ])
    expect(states.size).toBe(0)
  })

  it('labels the original as superseded and replacement as current', () => {
    const states = deriveDischargeDocumentRevisionStates([
      { revision_number: 2, status: 'finalized', original_document_id: 'v1', replacement_document_id: 'v2' },
    ])
    expect(states.get('v1')).toEqual({ revisionStatus: 'superseded_discharge', revisionNumber: 1 })
    expect(states.get('v2')).toEqual({ revisionStatus: 'current_corrected_discharge', revisionNumber: 2 })
  })

  it('marks an earlier replacement superseded after a later correction', () => {
    const states = deriveDischargeDocumentRevisionStates([
      { revision_number: 2, status: 'finalized', original_document_id: 'v1', replacement_document_id: 'v2' },
      { revision_number: 3, status: 'finalized', original_document_id: 'v2', replacement_document_id: 'v3' },
    ])
    expect(states.get('v2')).toEqual({ revisionStatus: 'superseded_discharge', revisionNumber: 2 })
    expect(states.get('v3')).toEqual({ revisionStatus: 'current_corrected_discharge', revisionNumber: 3 })
  })
})
