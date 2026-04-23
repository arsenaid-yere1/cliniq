import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

// Single shared client for the whole app — reuses HTTP keep-alive, one
// place to wire beta headers later if needed.
export const anthropic = new Anthropic()

export type ClaudeMessage = Anthropic.Messages.MessageParam

export interface CallClaudeToolOptions<TOutput> {
  model: `claude-${string}`
  system: string
  tools: Anthropic.Tool[]
  toolName: string
  toolChoice?: Anthropic.Messages.ToolChoice
  messages: ClaudeMessage[]
  maxTokens: number
  thinking?: Anthropic.Messages.ThinkingConfigParam
  parse: (raw: Record<string, unknown>) =>
    | { success: true; data: TOutput }
    | { success: false; error: z.ZodError }
  _client?: { messages: { stream: Anthropic['messages']['stream'] } }
}

export interface CallClaudeToolSuccess<TOutput> {
  data: TOutput
  rawResponse: unknown
  error?: undefined
}
export interface CallClaudeToolFailure {
  data?: undefined
  rawResponse?: unknown
  error: string
}
export type CallClaudeToolResult<TOutput> =
  | CallClaudeToolSuccess<TOutput>
  | CallClaudeToolFailure

const ZOD_RETRY_ATTEMPTS = 1
const API_RETRY_ATTEMPTS = 2
const BASE_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 15000

export async function callClaudeTool<TOutput>(
  opts: CallClaudeToolOptions<TOutput>,
): Promise<CallClaudeToolResult<TOutput>> {
  const client = opts._client ?? anthropic

  let zodAttempt = 0
  let lastRaw: unknown

  while (zodAttempt <= ZOD_RETRY_ATTEMPTS) {
    let apiAttempt = 0
    let apiResponse: Anthropic.Message | null = null
    let lastApiError: unknown

    while (apiAttempt <= API_RETRY_ATTEMPTS) {
      try {
        apiResponse = await client.messages
          .stream({
            model: opts.model,
            max_tokens: opts.maxTokens,
            ...(opts.thinking ? { thinking: opts.thinking } : {}),
            system: opts.system,
            tools: opts.tools,
            tool_choice: opts.toolChoice ?? { type: 'tool', name: opts.toolName },
            messages: opts.messages,
          })
          .finalMessage()
        break
      } catch (err) {
        lastApiError = err
        if (!isRetryableApiError(err) || apiAttempt === API_RETRY_ATTEMPTS) {
          return { error: extractErrorMessage(err) }
        }
        await sleep(computeBackoffMs(apiAttempt))
        apiAttempt += 1
      }
    }

    if (!apiResponse) {
      return { error: extractErrorMessage(lastApiError) }
    }

    logUsage(opts.model, apiResponse.usage)

    if (apiResponse.stop_reason === 'max_tokens') {
      return {
        error: `Claude hit max_tokens (${opts.maxTokens}) before finishing tool output. Raise maxTokens or shorten input.`,
        rawResponse: apiResponse,
      }
    }

    const toolBlock = apiResponse.content.find((b) => b.type === 'tool_use')
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      return { error: 'No tool use response from Claude', rawResponse: apiResponse }
    }

    const raw = toolBlock.input as Record<string, unknown>
    lastRaw = raw
    const parsed = opts.parse(raw)
    if (parsed.success) {
      return { data: parsed.data, rawResponse: raw }
    }

    zodAttempt += 1
  }

  return {
    error: `Tool output failed Zod validation after ${ZOD_RETRY_ATTEMPTS + 1} attempts`,
    rawResponse: lastRaw,
  }
}

function isRetryableApiError(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) {
    const s = err.status
    return s === 429 || s === 529 || (s !== undefined && s >= 500 && s < 600)
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    return (
      msg.includes('econnreset') ||
      msg.includes('etimedout') ||
      msg.includes('fetch failed') ||
      msg.includes('socket hang up')
    )
  }
  return false
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Anthropic.APIError) return `${err.status ?? ''} ${err.message}`.trim()
  if (err instanceof Error) return err.message
  return 'Claude API call failed'
}

function computeBackoffMs(attempt: number): number {
  const exp = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS)
  return Math.floor(Math.random() * exp)
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// LOGGING: emits one `[claude]` line per API call with token usage.
// Format: `{ model, input_tokens, output_tokens }`. Consumed by Vercel
// logs. Replacement with structured Sentry/pino logging is tracked in the
// architecture-improvements plan §3 (observability).
function logUsage(model: string, usage: Anthropic.Messages.Usage) {
  // eslint-disable-next-line no-console
  console.info('[claude]', {
    model,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
  })
}
