import { describe, expect, it } from 'vitest'
import { validateVisitDecisionOutput } from '../visit-decision-output'

describe('model visit decision boundary', () => {
  it.each([
    'The patient agreed to PRP and will discuss scheduling next week.',
    'After reviewing the prior note, the patient agreed to the full injection series.',
    'At the prior visit the patient agreed, but today the patient declined.',
    'Written consent was obtained.',
    'At the prior visit the patient agreed, but declined today.',
    'The patient accepted the plan.',
    'The treatment plan was accepted by the patient.',
    'The patient is agreeable to the proposed treatment plan.',
    'The patient reviewed the options and has agreed to proceed.',

  ])('rejects unsupported current assertions: %s', (text) => {
    expect(validateVisitDecisionOutput({ patient_education: text }).success).toBe(false)
  })
  it.each([
    'At the prior visit, the patient agreed to home exercise.',
    'The patient will discuss treatment options at follow-up.',
    'Obtain procedure consent before any injection.',
    'No procedure consent was obtained.',
    'Procedure consent will be obtained before injection.',
    'At the previous encounter, the treatment plan was accepted by the patient.',
    'The plan will be accepted only after the patient reviews it.',
    'Procedure consent was not obtained.',
  ])('allows correctly attributed or prospective prose: %s', (text) => {
    expect(validateVisitDecisionOutput({ patient_education: text }).success).toBe(true)
  })
  it('checks other narrative sections too', () => {
    expect(validateVisitDecisionOutput({ assessment: 'The patient consented to a future series.' }).success).toBe(false)
  })
})
