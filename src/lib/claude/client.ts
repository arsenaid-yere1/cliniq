import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

// Single shared client for the whole app — reuses HTTP keep-alive, one
// place to wire beta headers later if needed.
//
// timeout: hard per-request wall-clock cap (ms). Without it, a stalled stream
// (connection stays open, completion event never arrives) leaves
// `stream.finalMessage()` awaiting indefinitely — the request appears to hang
// (e.g. generating a pain-evaluation note, the largest payload). A finite
// timeout converts that into a thrown error that flows into the existing
// retryable-error path (retry + backoff, then fallback model). 4 minutes is
// generous for a 16k-token tool generation while still bounding the hang.
// maxRetries: 0 — retries are handled explicitly in callClaudeToolForModel;
// leaving the SDK's own retries on would multiply the wall-clock (timeout ×
// (maxRetries + 1)) on a stall.
export const anthropic = new Anthropic({
  timeout: 4 * 60 * 1000,
  maxRetries: 0,
})

export type ClaudeMessage = Anthropic.Messages.MessageParam

export interface CallClaudeToolOptions<TOutput> {
  model: `claude-${string}`
  // Optional fallback model invoked once if `model` exhausts API retries
  // with a retryable error (overloaded_error / 529, 5xx, network reset).
  // Used for soft degradation under Anthropic capacity pressure: caller
  // typically passes a Sonnet model when primary is Opus.
  fallbackModel?: `claude-${string}`
  system: string
  // When true, the system prompt is sent as a cache-controlled block so
  // repeated calls within the 5-minute TTL hit the prompt cache. Saves ~80%
  // input tokens and ~40% TTFB on warm cache. Safe to enable whenever the
  // system prompt is a stable module constant.
  cacheSystem?: boolean
  tools: Anthropic.Tool[]
  toolName: string
  toolChoice?: Anthropic.Messages.ToolChoice
  messages: ClaudeMessage[]
  maxTokens: number
  thinking?: Anthropic.Messages.ThinkingConfigParam
  parse: (raw: Record<string, unknown>) =>
    | { success: true; data: TOutput }
    | { success: false; error: z.ZodError }
  /**
   * Optional callback fired whenever Claude completes a new top-level key in
   * the tool's input JSON during streaming. Receives the full list of keys
   * observed so far. The wrapper invokes this after each `inputJson` SDK
   * event, but only when the key count has increased — callers get one call
   * per new section, not per fragment. Throttling/persistence is the caller's
   * responsibility.
   */
  onProgress?: (completedKeys: string[]) => void | Promise<void>
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
  const primary = await callClaudeToolForModel(opts, opts.model)
  if (
    primary.error &&
    opts.fallbackModel &&
    primary._retryableExhaust
  ) {
    console.warn(
      `[claude] primary model ${opts.model} exhausted retries (${primary.error}); falling back to ${opts.fallbackModel}`,
    )
    const fallback = await callClaudeToolForModel(opts, opts.fallbackModel)
    return stripInternal(fallback)
  }
  return stripInternal(primary)
}

type InternalResult<TOutput> = CallClaudeToolResult<TOutput> & {
  _retryableExhaust?: boolean
}

function stripInternal<TOutput>(
  r: InternalResult<TOutput>,
): CallClaudeToolResult<TOutput> {
  // Drop the internal flag before returning to callers.
  const { _retryableExhaust: _drop, ...rest } = r
  void _drop
  return rest as CallClaudeToolResult<TOutput>
}

async function callClaudeToolForModel<TOutput>(
  opts: CallClaudeToolOptions<TOutput>,
  model: `claude-${string}`,
): Promise<InternalResult<TOutput>> {
  const client = opts._client ?? anthropic

  let zodAttempt = 0
  let lastRaw: unknown

  while (zodAttempt <= ZOD_RETRY_ATTEMPTS) {
    let apiAttempt = 0
    let apiResponse: Anthropic.Message | null = null
    let lastApiError: unknown

    while (apiAttempt <= API_RETRY_ATTEMPTS) {
      try {
        const systemParam: Anthropic.Messages.MessageCreateParams['system'] =
          opts.cacheSystem
            ? [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }]
            : opts.system
        const stream = client.messages.stream({
          model,
          max_tokens: opts.maxTokens,
          ...(opts.thinking ? { thinking: opts.thinking } : {}),
          system: systemParam,
          tools: opts.tools,
          tool_choice: opts.toolChoice ?? { type: 'tool', name: opts.toolName },
          messages: opts.messages,
        })
        if (opts.onProgress) {
          const onProgress = opts.onProgress
          let lastCount = 0
          stream.on('inputJson', (_partialJson, jsonSnapshot) => {
            if (!jsonSnapshot || typeof jsonSnapshot !== 'object') return
            const keys = Object.keys(jsonSnapshot as Record<string, unknown>)
            if (keys.length <= lastCount) return
            lastCount = keys.length
            // Fire-and-forget — callers throttle persistence, stream
            // iteration must not await on DB writes.
            Promise.resolve(onProgress(keys)).catch(() => {})
          })
        }
        apiResponse = await stream.finalMessage()
        break
      } catch (err) {
        lastApiError = err
        const retryable = isRetryableApiError(err)
        if (!retryable) {
          return { error: extractErrorMessage(err) }
        }
        if (apiAttempt === API_RETRY_ATTEMPTS) {
          // Signal retryable exhaustion so the caller can swap to the
          // fallback model. Non-retryable errors return without the flag.
          return { error: extractErrorMessage(err), _retryableExhaust: true }
        }
        await sleep(computeBackoffMs(apiAttempt))
        apiAttempt += 1
      }
    }

    if (!apiResponse) {
      return {
        error: extractErrorMessage(lastApiError),
        _retryableExhaust: isRetryableApiError(lastApiError),
      }
    }

    logUsage(model, apiResponse.usage)

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
  // Request timeout (APIConnectionTimeoutError) and connection failures are
  // APIError subclasses with an undefined status — treat them as retryable so
  // a stalled stream retries and then falls back rather than failing outright.
  if (err instanceof Anthropic.APIConnectionError) return true
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
      msg.includes('socket hang up') ||
      msg.includes('timed out')
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
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
  })
}
