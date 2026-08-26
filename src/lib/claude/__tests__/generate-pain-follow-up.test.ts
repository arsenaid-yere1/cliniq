import { describe, expect, it } from 'vitest'
import { PAIN_FOLLOW_UP_SYSTEM_PROMPT } from '../generate-pain-follow-up'

describe('pain follow-up prompt contract', () => {
  it('forbids unsupported hands-on findings and labels historical context', () => {
    expect(PAIN_FOLLOW_UP_SYSTEM_PROMPT).toContain('Never invent palpation')
    expect(PAIN_FOLLOW_UP_SYSTEM_PROMPT).toContain('historical comparisons')
    expect(PAIN_FOLLOW_UP_SYSTEM_PROMPT).toContain('modality explicitly')
  })
})
