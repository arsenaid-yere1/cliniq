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

describe('OBJECTIVE-SUPPORT RUBRIC (rule 8a)', () => {
  beforeEach(() => vi.clearAllMocks())

  async function capturePrompt(input: SummaryInputData): Promise<string> {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateCaseSummaryFromData(input)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    return opts.system as string
  }

  it('system prompt contains rule 8a OBJECTIVE-SUPPORT RUBRIC', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('8a. OBJECTIVE-SUPPORT RUBRIC for ICD-10 confidence')
  })

  it('rubric defines radiculopathy high/medium/low tiers', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('Radiculopathy codes (M54.12, M54.17, M50.1X, M51.1X)')
    expect(system).toContain('"high" requires BOTH (i) imaging showing nerve-root compromise')
    expect(system).toContain('at least one region-matched objective finding')
    expect(system).toContain('"medium" requires imaging evidence plus subjective radiation')
    expect(system).toContain('"low" when only subjective radiation is present')
  })

  it('rubric defines myelopathy gate with UMN signs', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('Myelopathy codes (M50.00/.01/.02, M47.1X, M54.18)')
    expect(system).toContain('hyperreflexia, clonus, Hoffmann, Babinski, spastic gait, or bowel/bladder dysfunction')
  })

  it('rubric flags M79.1 redundancy', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('M79.1 Myalgia')
    expect(system).toContain('M79.1 is redundant and should be tagged "low"')
  })

  it('rubric forbids parent M54.5 in suggested_diagnoses', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('NEVER emit the parent M54.5 in suggested_diagnoses')
    expect(system).toContain('M54.50 default')
  })

  it('rubric tightens supporting_evidence requirement', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('Vague or empty supporting_evidence is not acceptable for any code tagged "high" or "medium"')
  })

  it('rubric does NOT instruct dropping diagnoses — tagging only', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('Do not drop diagnoses based on this rubric — tag them with the correct confidence')
  })

  it('rule 8b pre-computes downgrade_to for failed myelopathy/radiculopathy codes', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('8b. DOWNGRADE PRECOMPUTE for myelopathy/radiculopathy')
    expect(system).toContain('downgrade_to="M50.20"')
    expect(system).toContain('downgrade_to="M51.37"')
    expect(system).toContain('downgrade_to="M51.36"')
    expect(system).toContain('downgrade_to=null')
  })

  it('tool schema requires downgrade_to on each suggested diagnosis', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateCaseSummaryFromData(emptyInput)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    const dxSchema = opts.tools[0].input_schema.properties.suggested_diagnoses.items
    expect(dxSchema.required).toContain('downgrade_to')
    expect(dxSchema.properties.downgrade_to).toBeDefined()
  })
})
