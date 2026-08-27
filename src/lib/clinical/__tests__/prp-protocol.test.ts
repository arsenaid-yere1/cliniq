import { describe, it, expect } from 'vitest'
import {
  PRP_NSAID_PROTOCOL,
  nsaidHeldPreProcedureClause,
  nsaidPostCareInstructionSentence,
  nsaidScreeningContraindicationLabel,
  nsaidAvoidanceTreatmentPlanFragment,
} from '../prp-protocol'

describe('PRP_NSAID_PROTOCOL', () => {
  it('exposes one canonical avoidance window', () => {
    expect(PRP_NSAID_PROTOCOL.avoidanceWindowWeeks).toBe(2)
  })
})

describe('sentence builders', () => {
  it('builds the pre-procedure held clause', () => {
    expect(nsaidHeldPreProcedureClause()).toBe(
      'held NSAIDs for 2 weeks prior to the procedure per protocol',
    )
  })
  it('builds the post-care instruction sentence', () => {
    expect(nsaidPostCareInstructionSentence()).toBe(
      'Avoid NSAIDs (ibuprofen, naproxen, aspirin, etc.) for 2 weeks before and after the procedure, as they may interfere with the healing response.',
    )
  })
  it('builds the screening contraindication label', () => {
    expect(nsaidScreeningContraindicationLabel()).toBe('NSAIDs in past 2 weeks')
  })
  it('builds the treatment-plan avoidance fragment', () => {
    expect(nsaidAvoidanceTreatmentPlanFragment()).toBe(
      'avoid NSAIDs for 2 weeks before and after each PRP injection',
    )
  })

  it('uses the same two-week duration in every protocol phrase', () => {
    const phrases = [
      nsaidHeldPreProcedureClause(),
      nsaidPostCareInstructionSentence(),
      nsaidScreeningContraindicationLabel(),
      nsaidAvoidanceTreatmentPlanFragment(),
    ]

    for (const phrase of phrases) {
      expect(phrase).toContain('2 weeks')
      expect(phrase).not.toMatch(/\b7(?:-| )days?\b/i)
    }
  })
})
