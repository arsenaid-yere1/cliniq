import { describe, it, expect } from 'vitest'
import {
  PRP_NSAID_PROTOCOL,
  nsaidHeldPreProcedureClause,
  nsaidPostCareInstructionSentence,
  nsaidScreeningContraindicationLabel,
  nsaidAvoidanceTreatmentPlanFragment,
} from '../prp-protocol'

describe('PRP_NSAID_PROTOCOL', () => {
  it('exposes the canonical windows', () => {
    expect(PRP_NSAID_PROTOCOL.preProcedureHoldDays).toBe(7)
    expect(PRP_NSAID_PROTOCOL.protectiveWindowWeeks).toBe(2)
    expect(PRP_NSAID_PROTOCOL.screeningRecentDays).toBe(7)
  })
})

describe('sentence builders', () => {
  it('builds the pre-procedure held clause', () => {
    expect(nsaidHeldPreProcedureClause()).toBe(
      'held NSAIDs for 7 days prior to the procedure per protocol',
    )
  })
  it('builds the post-care instruction sentence', () => {
    expect(nsaidPostCareInstructionSentence()).toBe(
      'Avoid NSAIDs (ibuprofen, naproxen, aspirin, etc.) for 2 weeks before and after the procedure, as they may interfere with the healing response.',
    )
  })
  it('builds the screening contraindication label', () => {
    expect(nsaidScreeningContraindicationLabel()).toBe('NSAIDs in past 7 days')
  })
  it('builds the treatment-plan avoidance fragment', () => {
    expect(nsaidAvoidanceTreatmentPlanFragment()).toBe(
      'avoid NSAIDs for 2 weeks before and after each PRP injection',
    )
  })
})
