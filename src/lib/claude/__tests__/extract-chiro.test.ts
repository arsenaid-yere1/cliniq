import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

vi.mock('@/lib/claude/client', () => ({
  callClaudeTool: vi.fn(),
}))

import { extractChiroFromPdf } from '@/lib/claude/extract-chiro'
import { callClaudeTool } from '@/lib/claude/client'

describe('extractChiroFromPdf', () => {
  beforeEach(() => vi.clearAllMocks())

  it('configures Sonnet 4.6 for compiled chiropractic charts', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await extractChiroFromPdf('base64-pdf')
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.model).toBe('claude-sonnet-4-6')
    expect(opts.toolName).toBe('extract_chiro_data')
    expect(opts.maxTokens).toBe(16384)
    expect(opts.messages[0].content).toContainEqual(expect.objectContaining({
      type: 'document',
      source: expect.objectContaining({ data: 'base64-pdf' }),
    }))
    expect(opts.system).toContain('Set report_type to "other" when more than one report type is present')
    expect(opts.system).toContain('set report_date to the latest explicit examination or report date')
    expect(opts.system).toContain('each unique explicit examination or visit date')
    expect(opts.system).toContain('total_visits to the list length')
    expect(opts.system).toContain('Deduplicate diagnoses by the exact (icd10_code, description, region) combination')
    expect(opts.system).toContain('Deduplicate treatment modalities by the exact (modality, cpt_code, regions_treated, frequency) combination')
    expect(opts.system).toContain('Preserve longitudinal pain observations when their date, score, or clinical context differs')
    expect(opts.system).toContain('state in extraction_notes that the source was aggregated')
  })

  it('propagates errors from the helper', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ error: 'boom' })
    const result = await extractChiroFromPdf('x')
    expect(result.error).toBe('boom')
  })
})
