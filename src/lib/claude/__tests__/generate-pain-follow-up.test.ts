import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/lib/claude/client', () => ({
  callClaudeTool: vi.fn(),
}))

import {
  generatePainFollowUp,
  normalizePainFollowUpToolOutput,
  PAIN_FOLLOW_UP_SYSTEM_PROMPT,
  type PainFollowUpSourceData,
} from '../generate-pain-follow-up'
import { callClaudeTool } from '@/lib/claude/client'

const source: PainFollowUpSourceData = {
  encounter: { id: 'encounter-1', modality: 'telehealth' },
  patient: { id: 'patient-1' },
  provider: { id: 'provider-1' },
  latestCompletedEncounter: null,
  priorEpisodeDischarge: null,
  performedProcedures: [],
  visitDiagnosisPool: [{ icd10_code: 'M54.50', description: 'Low back pain' }],
  visitDiagnosisConfirmedAt: '2026-08-28T12:00:00Z',
}

describe('pain follow-up model routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
  })

  it('uses Opus 4.6 with Sonnet 4.6 fallback for full generation', async () => {
    await generatePainFollowUp(source)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]

    expect(opts.model).toBe('claude-opus-4-6')
    expect(opts.fallbackModel).toBe('claude-sonnet-4-6')
    expect(opts.maxTokens).toBe(6000)
    expect(opts.toolName).toBe('generate_pain_follow_up')
  })

  it('uses the same model pair for regeneration and preserves its instruction', async () => {
    await generatePainFollowUp(source, {
      section: 'assessment',
      message: 'Clarify the historical comparison',
      rationale: 'The prior pain score needs a date label',
    })
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]

    expect(opts.model).toBe('claude-opus-4-6')
    expect(opts.fallbackModel).toBe('claude-sonnet-4-6')
    expect(opts.messages[0].content).toContain('Regenerate the assessment section')
    expect(opts.messages[0].content).toContain('The prior pain score needs a date label')
  })
})

describe('pain follow-up prompt contract', () => {
  it('forbids unsupported hands-on findings and labels historical context', () => {
    expect(PAIN_FOLLOW_UP_SYSTEM_PROMPT).toContain('Never invent palpation')
    expect(PAIN_FOLLOW_UP_SYSTEM_PROMPT).toContain('historical comparisons')
    expect(PAIN_FOLLOW_UP_SYSTEM_PROMPT).toContain('modality explicitly')
    expect(PAIN_FOLLOW_UP_SYSTEM_PROMPT).toContain('only findings directly visible or audible by video')
    expect(PAIN_FOLLOW_UP_SYSTEM_PROMPT).toContain('Palpation was not performed')
  })

  it('uses only the current encounter pool as diagnosis authority', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generatePainFollowUp({
      ...source,
      latestCompletedEncounter: { assessment: 'History only' },
      performedProcedures: [{ procedure_type: 'prp', procedure_date: '2026-08-01' }],
    })
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(PAIN_FOLLOW_UP_SYSTEM_PROMPT).toContain('complete clinician-confirmed diagnosis authority')
    expect(PAIN_FOLLOW_UP_SYSTEM_PROMPT).toContain('Every procedure_recommendations[].diagnoses item')
    expect(opts.messages[0].content).toContain('"visitDiagnosisPool"')
    expect(opts.messages[0].content).not.toContain('"diagnoses":')
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
