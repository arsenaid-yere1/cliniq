export interface DischargeDocumentCorrectionRef {
  revision_number: number
  status: string
  original_document_id: string
  replacement_document_id: string | null
}

export interface DischargeDocumentRevisionState {
  revisionStatus: 'superseded_discharge' | 'current_corrected_discharge'
  revisionNumber: number
}

export function deriveDischargeDocumentRevisionStates(
  corrections: DischargeDocumentCorrectionRef[],
): Map<string, DischargeDocumentRevisionState> {
  const states = new Map<string, DischargeDocumentRevisionState>()
  const finalized = corrections
    .filter((correction) => correction.status === 'finalized' && correction.replacement_document_id)
    .sort((a, b) => a.revision_number - b.revision_number)

  for (const correction of finalized) {
    states.set(correction.original_document_id, {
      revisionStatus: 'superseded_discharge',
      revisionNumber: Math.max(1, correction.revision_number - 1),
    })
    states.set(correction.replacement_document_id!, {
      revisionStatus: 'current_corrected_discharge',
      revisionNumber: correction.revision_number,
    })
  }

  return states
}
