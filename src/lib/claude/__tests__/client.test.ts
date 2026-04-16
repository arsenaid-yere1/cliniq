import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { z } from 'zod'
import { callClaudeTool } from '@/lib/claude/client'
import { createMockAnthropic, mockToolUseResponse, makeApiError } from '@/test-utils/anthropic-mock'
import type Anthropic from '@anthropic-ai/sdk'

const schema = z.object({ value: z.string() })
const okParse = (raw: Record<string, unknown>) => {
  const r = schema.safeParse(raw)
  return r.success
    ? { success: true as const, data: r.data }
    : { success: false as const, error: r.error }
}

const baseOpts = (overrides: Partial<Parameters<typeof callClaudeTool>[0]> = {}) => ({
  model: 'claude-sonnet-4-6' as const,
  maxTokens: 1024,
  system: 'You are a test system prompt.',
  tools: [
    { name: 't1', description: 'tool one', input_schema: { type: 'object' as const, properties: {} } },
    { name: 't2', description: 'tool two', input_schema: { type: 'object' as const, properties: {} } },
  ],
  toolName: 't2',
  messages: [{ role: 'user' as const, content: 'hi' }],
  parse: okParse,
  ...overrides,
})

describe('callClaudeTool', () => {
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    // Deterministic, fast backoff: jitter → 0
    vi.spyOn(Math, 'random').mockReturnValue(0)
  })

  afterEach(() => {
    consoleInfoSpy.mockRestore()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('applies cache_control to the last tool and to the system text block', async () => {
    const stub = createMockAnthropic()
    stub._create.mockResolvedValue(mockToolUseResponse({ toolName: 't2', input: { value: 'ok' } }))

    await callClaudeTool({ ...baseOpts(), _client: stub })

    const call = stub._create.mock.calls[0][0]
    expect(call.tools[0].cache_control).toBeUndefined()
    expect(call.tools[1].cache_control).toEqual({ type: 'ephemeral' })
    expect(Array.isArray(call.system)).toBe(true)
    expect(call.system[0]).toMatchObject({
      type: 'text',
      text: 'You are a test system prompt.',
      cache_control: { type: 'ephemeral' },
    })
  })

  it('returns {data} on success when parse succeeds first try', async () => {
    const stub = createMockAnthropic()
    stub._create.mockResolvedValue(mockToolUseResponse({ toolName: 't2', input: { value: 'hello' } }))

    const result = await callClaudeTool({ ...baseOpts(), _client: stub })
    expect(result.data).toEqual({ value: 'hello' })
    expect(result.error).toBeUndefined()
    expect(stub._create).toHaveBeenCalledTimes(1)
  })

  it('retries once on Zod failure and returns {data} on second attempt', async () => {
    const stub = createMockAnthropic()
    stub._create
      .mockResolvedValueOnce(mockToolUseResponse({ toolName: 't2', input: { wrong: 'field' } }))
      .mockResolvedValueOnce(mockToolUseResponse({ toolName: 't2', input: { value: 'ok' } }))

    const result = await callClaudeTool({ ...baseOpts(), _client: stub })
    expect(result.data).toEqual({ value: 'ok' })
    expect(stub._create).toHaveBeenCalledTimes(2)
  })

  it('returns {error} after Zod retries are exhausted', async () => {
    const stub = createMockAnthropic()
    stub._create.mockResolvedValue(mockToolUseResponse({ toolName: 't2', input: { wrong: 'field' } }))

    const result = await callClaudeTool({ ...baseOpts(), _client: stub })
    expect(result.error).toMatch(/failed Zod validation/)
    expect(result.rawResponse).toEqual({ wrong: 'field' })
    expect(stub._create).toHaveBeenCalledTimes(2)
  })

  it.each([429, 500, 502, 503, 504, 529])('retries on status %d', async (status) => {
    const stub = createMockAnthropic()
    stub._create
      .mockRejectedValueOnce(makeApiError(status))
      .mockResolvedValueOnce(mockToolUseResponse({ toolName: 't2', input: { value: 'ok' } }))

    const result = await callClaudeTool({ ...baseOpts(), _client: stub })
    expect(result.data).toEqual({ value: 'ok' })
    expect(stub._create).toHaveBeenCalledTimes(2)
  })

  it.each([400, 401, 403])('does not retry on non-retryable status %d', async (status) => {
    const stub = createMockAnthropic()
    stub._create.mockRejectedValue(makeApiError(status, `boom ${status}`))

    const result = await callClaudeTool({ ...baseOpts(), _client: stub })
    expect(result.error).toBeDefined()
    expect(stub._create).toHaveBeenCalledTimes(1)
  })

  it.each(['ECONNRESET', 'ETIMEDOUT', 'fetch failed', 'socket hang up'])(
    'retries on network error: %s',
    async (msg) => {
      const stub = createMockAnthropic()
      stub._create
        .mockRejectedValueOnce(new Error(msg))
        .mockResolvedValueOnce(mockToolUseResponse({ toolName: 't2', input: { value: 'ok' } }))

      const result = await callClaudeTool({ ...baseOpts(), _client: stub })
      expect(result.data).toEqual({ value: 'ok' })
      expect(stub._create).toHaveBeenCalledTimes(2)
    },
  )

  it('caps total API attempts at API_RETRY_ATTEMPTS + 1 (=3)', async () => {
    const stub = createMockAnthropic()
    stub._create.mockRejectedValue(makeApiError(529))

    const result = await callClaudeTool({ ...baseOpts(), _client: stub })
    expect(result.error).toBeDefined()
    expect(stub._create).toHaveBeenCalledTimes(3)
  })

  it('passes thinking through when provided', async () => {
    const stub = createMockAnthropic()
    stub._create.mockResolvedValue(mockToolUseResponse({ toolName: 't2', input: { value: 'ok' } }))

    await callClaudeTool({
      ...baseOpts({ thinking: { type: 'adaptive' } }),
      _client: stub,
    })

    expect(stub._create.mock.calls[0][0].thinking).toEqual({ type: 'adaptive' })
  })

  it('omits thinking when not provided', async () => {
    const stub = createMockAnthropic()
    stub._create.mockResolvedValue(mockToolUseResponse({ toolName: 't2', input: { value: 'ok' } }))

    await callClaudeTool({ ...baseOpts(), _client: stub })

    expect('thinking' in stub._create.mock.calls[0][0]).toBe(false)
  })

  it('uses provided toolChoice when set, otherwise defaults to {type:"tool", name}', async () => {
    const stubA = createMockAnthropic()
    stubA._create.mockResolvedValue(mockToolUseResponse({ toolName: 't2', input: { value: 'ok' } }))
    await callClaudeTool({ ...baseOpts(), _client: stubA })
    expect(stubA._create.mock.calls[0][0].tool_choice).toEqual({ type: 'tool', name: 't2' })

    const stubB = createMockAnthropic()
    stubB._create.mockResolvedValue(mockToolUseResponse({ toolName: 't2', input: { value: 'ok' } }))
    await callClaudeTool({ ...baseOpts({ toolChoice: { type: 'auto' } }), _client: stubB })
    expect(stubB._create.mock.calls[0][0].tool_choice).toEqual({ type: 'auto' })
  })

  it('logs usage on success', async () => {
    const stub = createMockAnthropic()
    stub._create.mockResolvedValue(mockToolUseResponse({
      toolName: 't2',
      input: { value: 'ok' },
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100 },
    }))

    await callClaudeTool({ ...baseOpts(), _client: stub })

    expect(consoleInfoSpy).toHaveBeenCalledWith('[claude]', expect.objectContaining({
      model: 'claude-sonnet-4-6',
      input_tokens: 10,
      output_tokens: 20,
      cache_read_input_tokens: 100,
    }))
  })

  it('returns error when response has no tool_use block', async () => {
    const stub = createMockAnthropic()
    const noToolResp: Anthropic.Message = {
      id: 'msg_x',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      stop_reason: 'end_turn',
      stop_sequence: null,
      content: [{ type: 'text', text: 'hi', citations: null }],
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    } as Anthropic.Message
    stub._create.mockResolvedValue(noToolResp)

    const result = await callClaudeTool({ ...baseOpts(), _client: stub })
    expect(result.error).toBe('No tool use response from Claude')
  })
})
