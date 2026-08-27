import { describe, expect, it } from 'vitest'
import {
  normalizePainFollowUpToolOutput,
  PAIN_FOLLOW_UP_SYSTEM_PROMPT,
} from '../generate-pain-follow-up'

describe('pain follow-up prompt contract', () => {
  it('forbids unsupported hands-on findings and labels historical context', () => {
    expect(PAIN_FOLLOW_UP_SYSTEM_PROMPT).toContain('Never invent palpation')
    expect(PAIN_FOLLOW_UP_SYSTEM_PROMPT).toContain('historical comparisons')
    expect(PAIN_FOLLOW_UP_SYSTEM_PROMPT).toContain('modality explicitly')
    expect(PAIN_FOLLOW_UP_SYSTEM_PROMPT).toContain('only findings directly visible or audible by video')
    expect(PAIN_FOLLOW_UP_SYSTEM_PROMPT).toContain('Palpation was not performed')
  })
})

describe('pain follow-up tool output normalization', () => {
  it('replaces a non-UUID recommendation ID deterministically', () => {
    const raw = {
      procedure_recommendations: [{
        recommendation_id: 'recommendation-1',
        procedure_type: 'prp',
        sites: ['lumbar'],
        diagnoses: [],
        rationale: 'Persistent symptoms',
      }],
    }
    const first = normalizePainFollowUpToolOutput(raw)
    const second = normalizePainFollowUpToolOutput(raw)
    const firstId = (first.procedure_recommendations as Array<{ recommendation_id: string }>)[0].recommendation_id
    const secondId = (second.procedure_recommendations as Array<{ recommendation_id: string }>)[0].recommendation_id
    expect(firstId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(firstId).toBe(secondId)
  })
})
