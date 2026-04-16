import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

vi.mock('@/lib/claude/client', () => ({
  callClaudeTool: vi.fn(),
}))

import { extractPtFromPdf } from '@/lib/claude/extract-pt'
import { callClaudeTool } from '@/lib/claude/client'

describe('extractPtFromPdf', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls callClaudeTool with the PT tool schema and Sonnet 4.6', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await extractPtFromPdf('base64-pdf')
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.model).toBe('claude-sonnet-4-6')
    expect(opts.toolName).toBe('extract_pt_data')
    expect(opts.maxTokens).toBe(4096)
    expect(opts.messages[0].content).toContainEqual(expect.objectContaining({
      type: 'document',
      source: expect.objectContaining({ data: 'base64-pdf' }),
    }))
  })

  it('propagates errors from the helper', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ error: 'boom' })
    const result = await extractPtFromPdf('x')
    expect(result.error).toBe('boom')
  })
})
