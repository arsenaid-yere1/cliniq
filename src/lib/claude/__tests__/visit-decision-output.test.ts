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
    'Home exercises were reviewed. The patient verbalized understanding.',
    'The patient could not verbalize understanding; further education is needed.',
  ])('allows correctly attributed or prospective prose: %s', (text) => {
    expect(validateVisitDecisionOutput({ patient_education: text }).success).toBe(true)
  })
  it('checks other narrative sections too', () => {
    expect(validateVisitDecisionOutput({ assessment: 'The patient consented to a future series.' }).success).toBe(false)
  })
})

describe('telehealth consent and symptom trends', () => {
  const consentStatements = [
    'Verbal consent for telehealth was obtained.',
    'The patient consented to the telehealth visit.',
    'Consent for the telehealth visit was obtained.',
    'Telehealth consent was obtained.',
    'The patient agreed to participate in the video visit.',
    'Consent for telemedicine was obtained.',
    'Consent for the remote visit was obtained.',
    '  CONSENT  for the TELEHEALTH visit was obtained.  ',
  ]
  it.each(consentStatements)('allows documented consent: %s', (subjective) => {
    expect(validateVisitDecisionOutput({ subjective }, { telehealthConsentDocumented: true }).success).toBe(true)
  })
  it.each(consentStatements)('requires current documentation: %s', (subjective) => {
    for (const context of [undefined, { telehealthConsentDocumented: false }]) {
      const result = validateVisitDecisionOutput({ subjective }, context)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['subjective'])
        expect(result.error.issues[0].message).toContain('telehealth consent')
      }
    }
  })
  it.each([
    'The patient reports that pain has declined since the last visit.',
    'The patient reports that symptoms declined.',
    'The patient reports that his pain score declines with rest.',
    'Pain has declined since the last visit.',
    'The patient reports symptom severity has declined.',
    'Consent for telehealth was obtained, and the patient reports that pain has declined.',
  ])('allows symptom history: %s', (subjective) => {
    expect(validateVisitDecisionOutput({ subjective }, { telehealthConsentDocumented: true }).success).toBe(true)
  })
  it.each([
    'Written consent was obtained.',
    'Procedure consent was obtained.',
    'Consent for telehealth and PRP was obtained.',
    'Consent for telehealth & PRP was obtained.',
    'Consent for PRP and telehealth was obtained.',
    'The patient consented to telehealth and PRP.',
    'The patient consented to PRP and telehealth.',
    'The patient consented to telehealth and agreed to PRP.',
    'The patient consented to telehealth; the treatment plan was accepted.',
    'Consent for telehealth was obtained. Procedure consent was obtained.',
    'Consent for telehealth was obtained\nThe patient is agreeable to PRP.',
    'The patient declined PRP.',
    'The patient reports that he declined PRP.',
    'Pain has declined, but the patient declined treatment.',
    'The patient reports that pain has declined, the patient accepted PRP.',
    'The patient reports that pain has declined and has agreed to proceed.',
  ])('still rejects treatment decisions: %s', (subjective) => {
    expect(validateVisitDecisionOutput({ subjective }, { telehealthConsentDocumented: true }).success).toBe(false)
  })
  it('does not exempt other sections', () => {
    expect(validateVisitDecisionOutput({
      subjective: 'Consent for telehealth was obtained.',
      assessment: 'The patient accepted PRP.',
    }, { telehealthConsentDocumented: true }).success).toBe(false)
  })
})


describe('coordinated consent qualifications', () => {
  it.each([
    'Consent for telehealth and PRP will be obtained.',
    'Consent for telehealth and PRP was not obtained.',
    'At the prior visit, consent for telehealth was obtained.',
  ])('retains prospective, negative and historical statements: %s', (subjective) => {
    expect(validateVisitDecisionOutput({ subjective }).success).toBe(true)
  })
})
