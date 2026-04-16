import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

vi.mock('@/lib/claude/client', () => ({
  callClaudeTool: vi.fn(),
}))

import { generateCaseSummaryFromData, type SummaryInputData } from '@/lib/claude/generate-summary'
import { callClaudeTool } from '@/lib/claude/client'

const emptyInput: SummaryInputData = {
  caseDetails: { accident_type: null, accident_date: null, accident_description: null },
  mriExtractions: [],
  chiroExtractions: [],
  pmExtractions: [],
  ptExtractions: [],
  orthoExtractions: [],
  ctScanExtractions: [],
}

describe('generateCaseSummaryFromData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls callClaudeTool with Opus 4.6, adaptive thinking, and tool_choice auto', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateCaseSummaryFromData(emptyInput)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.model).toBe('claude-opus-4-6')
    expect(opts.maxTokens).toBe(16384)
    expect(opts.thinking).toEqual({ type: 'adaptive' })
    expect(opts.toolChoice).toEqual({ type: 'auto' })
    expect(opts.toolName).toBe('extract_case_summary')
  })

  it('propagates errors from the helper', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ error: 'boom' })
    const result = await generateCaseSummaryFromData(emptyInput)
    expect(result.error).toBe('boom')
  })
})
