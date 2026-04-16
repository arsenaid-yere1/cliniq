import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

vi.mock('@/lib/claude/client', () => ({
  callClaudeTool: vi.fn(),
}))

import { extractPainManagementFromPdf } from '@/lib/claude/extract-pain-management'
import { callClaudeTool } from '@/lib/claude/client'

describe('extractPainManagementFromPdf', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls callClaudeTool with the pain-management tool schema and Sonnet 4.6', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await extractPainManagementFromPdf('base64-pdf')
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    expect(opts.model).toBe('claude-sonnet-4-6')
    expect(opts.toolName).toBe('extract_pain_management_data')
    expect(opts.maxTokens).toBe(4096)
    expect(opts.messages[0].content).toContainEqual(expect.objectContaining({
      type: 'document',
      source: expect.objectContaining({ data: 'base64-pdf' }),
    }))
  })

  it('propagates errors from the helper', async () => {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ error: 'boom' })
    const result = await extractPainManagementFromPdf('x')
    expect(result.error).toBe('boom')
  })
})
