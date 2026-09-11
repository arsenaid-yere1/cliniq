import { describe, expect, it } from 'vitest'
import { visitDecisionDraft, visitDecisionClosing, visitTreatmentDecisionSchema } from '../visit-treatment-decision'

describe('visit decision contract', () => {
  it('defaults only the UI draft to Accepted', () => {
    expect(visitDecisionDraft(null)).toEqual({ decision: 'accepted', details: null })
    expect(visitTreatmentDecisionSchema.safeParse({}).success).toBe(false)
    expect(visitDecisionClosing(null)).toBe('')
  })
  it('rejects partial decisions without actual details and spoofed metadata', () => {
    expect(visitTreatmentDecisionSchema.safeParse({ decision: 'partially_accepted', details: '  ' }).success).toBe(false)
    expect(visitTreatmentDecisionSchema.safeParse({ decision: 'accepted', details: null, confirmed_by: 'someone' }).success).toBe(false)
  })
  it.each(['deferred', 'declined', 'partially_accepted'] as const)('keeps %s details without inventing a reason', (decision) => {
    expect(visitDecisionClosing({ decision, details: 'PRP deferred; exercises accepted.' })).toContain('PRP deferred; exercises accepted.')
    expect(visitDecisionClosing({ decision, details: null })).not.toContain('Reason')
  })
  it('does not infer understanding or procedure consent from acceptance', () => {
    expect(visitDecisionClosing({ decision: 'accepted', details: null })).toBe('The patient agreed to the treatment plan discussed at this visit, as outlined above.')
    expect(visitDecisionClosing({ decision: 'accepted', details: null })).not.toMatch(/understanding|consent|PRP|written/)
    expect(visitDecisionClosing({ decision: 'not_documented', details: 'old details' })).toBe('')
  })
})
