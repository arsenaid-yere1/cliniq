import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/lib/claude/client', () => ({ callClaudeTool: vi.fn() }))

import { callClaudeTool } from '@/lib/claude/client'
import {
  CURRENT_VISIT_DIAGNOSIS_SYSTEM_PROMPT,
  suggestVisitDiagnoses,
} from '@/lib/claude/suggest-visit-diagnoses'

const source = {
  source_kind: 'pain_follow_up' as const,
  current_visit: {
    reason_for_visit: null,
    chief_complaint: 'Neck pain',
    interval_history: null,
    review_of_systems: null,
    video_observations: null,
    patient_reported_pain_min: 3,
    patient_reported_pain_max: 6,
  },
}

describe('suggestVisitDiagnoses', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses a narrow Sonnet tool call with current-visit-only rules', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: [], rawResponse: {} })
    await suggestVisitDiagnoses(source)

    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.model).toBe('claude-sonnet-4-6')
    expect(opts.toolName).toBe('suggest_current_visit_diagnoses')
    expect(opts.messages[0].content).toContain('Neck pain')
    expect(CURRENT_VISIT_DIAGNOSIS_SYSTEM_PROMPT).toContain('prior visit')
    expect(CURRENT_VISIT_DIAGNOSIS_SYSTEM_PROMPT).toContain('empty diagnoses array')
  })

  it('normalizes, de-duplicates, and rejects structurally invalid output in the parser', async () => {
    ;(callClaudeTool as unknown as Mock).mockImplementation(async (opts) => {
      const normalized = opts.parse({ diagnoses: [
        { icd10_code: 'm54.5', description: ' Low back pain ' },
        { icd10_code: 'M54.50', description: 'Duplicate' },
      ] })
      expect(normalized).toEqual({
        success: true,
        data: [{ icd10_code: 'M54.50', description: 'Low back pain' }],
      })

      const invalid = opts.parse({ diagnoses: [{ icd10_code: 'not-a-code', description: 'Bad' }] })
      expect(invalid.success).toBe(false)
      return { data: normalized.data, rawResponse: {} }
    })

    await expect(suggestVisitDiagnoses(source)).resolves.toMatchObject({
      data: [{ icd10_code: 'M54.50', description: 'Low back pain' }],
    })
  })
})
