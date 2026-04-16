# Claude Prompt Caching + Unified Retry Helper Implementation Plan

## Overview

Introduce a single `callClaudeTool()` helper that owns every Claude API call made by the app. The helper enables prompt caching on the stable prefix (tools + system), handles retries with full-jitter exponential backoff + proper error classification, and collapses ~250 lines of duplicated ceremony per Claude module into one place. Migrate all 11 modules in `src/lib/claude/` to call the helper. Remove the dead-weight action-level `if (result.error) { retry = await … }` blocks across 10 server-action call sites. Convert the case-summary generator from deprecated `budget_tokens` to `thinking: {type: 'adaptive'}`.

Addresses §4 of [2026-04-16-architecture-improvement-recommendations.md](../research/2026-04-16-architecture-improvement-recommendations.md).

## Current State Analysis

**11 Claude modules in [src/lib/claude/](src/lib/claude/).** Each file instantiates `new Anthropic()` at module top-level (fine) and repeats the same SDK-call pattern inline:

```ts
// This shape appears 11 times, with per-module variations
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 4096,
  system: SYSTEM_PROMPT,            // plain string — NOT cached
  tools: [EXTRACTION_TOOL],          // no cache_control — NOT cached
  tool_choice: { type: 'tool', name: '…' },
  messages: [{ role: 'user', content: [...] }],
})
const toolBlock = response.content.find((b) => b.type === 'tool_use')
if (!toolBlock || toolBlock.type !== 'tool_use') return { error: 'No tool use response from Claude' }
const raw = toolBlock.input as Record<string, unknown>
const validated = SOME_ZOD_SCHEMA.safeParse(normalize(raw))
if (!validated.success) return { error: 'Output failed validation', rawResponse: raw }
return { data: validated.data, rawResponse: raw }
```

**No prompt caching anywhere.** Grep for `cache_control` across `src/lib/claude/**` and `src/actions/**` returns zero matches. Every call sends the full multi-KB system prompt + tool schema uncached, paying full input-token cost on every request.

**Action-level retry is dead-weight today.** 10 server-action call sites do a one-shot retry immediately after the module returns an error. Files (all with the same shape — see [mri-extractions.ts:85-99](src/actions/mri-extractions.ts#L85-L99)):
- 6 extractions: [mri](src/actions/mri-extractions.ts#L87), [chiro](src/actions/chiro-extractions.ts#L87), [ct-scan](src/actions/ct-scan-extractions.ts#L87), [orthopedic](src/actions/orthopedic-extractions.ts#L87), [pain-management](src/actions/pain-management-extractions.ts#L87), [pt](src/actions/pt-extractions.ts#L87)
- 4 generations: [case-summaries.ts:143](src/actions/case-summaries.ts#L143), [discharge-notes.ts:338](src/actions/discharge-notes.ts#L338), [initial-visit-notes.ts:340](src/actions/initial-visit-notes.ts#L340), [procedure-notes.ts:350](src/actions/procedure-notes.ts#L350)

No distinction between retryable (429, 529, 5xx, network) and non-retryable (400, schema violation). No backoff, no jitter. The immediate back-to-back retry on a 529 is exactly how you turn a transient hiccup into a hard failure.

**Extended thinking uses deprecated API.** [generate-summary.ts:266-269](src/lib/claude/generate-summary.ts#L266-L269) passes `thinking: {type: 'enabled', budget_tokens: 10000}`. `budget_tokens` is deprecated on Opus 4.6 and Sonnet 4.6; the current API is `thinking: {type: 'adaptive'}` (Claude decides the budget itself, automatically interleaved between tool calls).

**Models in use:** `claude-sonnet-4-6` for 10 of 11 modules. `claude-opus-4-6` for [generate-summary.ts:264](src/lib/claude/generate-summary.ts#L264).

**Approximate prompt sizes (file bytes ≈ 3.3× tokens, conservative lower bound):**

| Module | File bytes | Est. system+tool tokens | Cache threshold |
|---|---|---|---|
| extract-mri | 5.5KB | ~1.6K | Borderline Sonnet 4.6 (2K min) |
| extract-ct-scan | 5.7KB | ~1.7K | Borderline Sonnet 4.6 |
| extract-pain-management | 9.3KB | ~2.8K | Caches on Sonnet 4.6 |
| extract-chiro | 10.8KB | ~3.3K | Caches on Sonnet 4.6 |
| extract-orthopedic | 12.6KB | ~3.8K | Caches on Sonnet 4.6 |
| generate-clinical-orders | 8.5KB | ~2.6K | Caches on Sonnet 4.6 |
| generate-summary | 13.7KB | ~4.2K | Caches (Opus 4.6 needs ≥4K — verify in Phase 2) |
| generate-discharge-note | 16.5KB | ~5K | Caches cleanly |
| extract-pt | 16.3KB | ~5K | Caches cleanly |
| generate-procedure-note | 18.8KB | ~5.7K | Caches cleanly |
| generate-initial-visit | 42KB | ~12.7K | Biggest win |

**Zero tests for Claude modules today.** `src/lib/validations/__tests__/` covers the Zod schemas; `src/actions/__tests__/` covers 6 actions; none mock `@anthropic-ai/sdk`. The existing [src/test-utils/supabase-mock.ts](src/test-utils/supabase-mock.ts) is the pattern to mirror.

## Desired End State

One shared helper at `src/lib/claude/client.ts` exports:
- `anthropic` — module singleton of the SDK client.
- `callClaudeTool<TInput, TOutput>({ model, system, tools, toolName, messages, maxTokens, thinking, parse, retry? })` — the single entry point for every tool-use call. Handles caching, retry, tool-block extraction, and Zod validation.

Each Claude module shrinks to: system prompt + tool definition + input-normalizer + Zod schema + one `callClaudeTool` call. The 11 modules retain their current public signatures — callers in `src/actions/**` don't change shape (still `{ data, rawResponse, error }`).

**Observable behavior:**
- `response.usage.cache_read_input_tokens` is non-zero on the warm path for all modules whose prefix clears the model's minimum-cacheable-prefix (≥2048 tokens on Sonnet 4.6, ≥4096 on Opus 4.6 and Haiku 4.5).
- Transient 429/529/5xx errors no longer surface to users on the first retryable failure — they're retried 2 more times with exponential backoff + full jitter.
- Zod-validation-failure inside a tool response triggers one automatic retry (common pattern: Claude's first try emits a slightly malformed JSON; the retry usually succeeds).
- Action-level retry blocks removed from all 10 sites. Extraction/generation actions call the module once and treat the result as final.
- Case summary generator uses `thinking: {type: 'adaptive'}` — no deprecation warnings, same-or-better quality.

**Verification:**
- `npm run build` succeeds with no new warnings.
- `npm test` passes — includes new unit tests for the retry helper and a smoke test per migrated module.
- Manual trigger: upload a fresh MRI PDF, check logs for `[claude] cache_read_input_tokens=…` ≥ 70% of system-prompt tokens on the second extraction of the same document type within 5 minutes.

### Key Discoveries

- **Cache rendering order is `tools → system → messages`** ([shared/prompt-caching.md:13-17](shared/prompt-caching.md)). One `cache_control` marker on the **last tool** caches `tools`; one on the **last system block** caches `tools + system`. That's all we need — two breakpoints, well under the 4-breakpoint limit.
- **The invariant that matters is byte-level prefix stability.** System prompts today are const strings with no interpolation — good. Tools are module-level constants — good. Models are hard-coded per module — good. `new Anthropic()` is instantiated once — good. No silent invalidators to chase except for one issue (see below).
- **`generate-summary.ts` serializes the input with `JSON.stringify(inputData, null, 2)`** at [line 276](src/lib/claude/generate-summary.ts#L276). Object key order in JSON.stringify is insertion order, which is stable across `inputData` shapes here since it's built from a typed interface — fine.
- **Every extraction module instantiates its own `new Anthropic()`** — we'll replace with a shared singleton so all modules share one HTTP keep-alive pool.
- **The SDK retries 429/5xx twice by default** (`max_retries: 2`). The problem is not that the SDK doesn't retry — it's that the SDK retry is silent and bounded, and the *actions* add a sync retry on top that defeats backoff. We keep the SDK default behavior and layer our own policy for Zod-validation retry (which the SDK can't know about).
- **Tests today import `@/lib/supabase/server` and mock via `vi.mock()`** — same pattern applies to `@anthropic-ai/sdk`. The existing `supabase-mock.ts` style (chainable builder + helper to override per-table) is the model for `anthropic-mock.ts`.

## What We're NOT Doing

- **Not changing models.** `claude-sonnet-4-6` / `claude-opus-4-6` stay as-is. `claude-haiku-4-5` substitution is a future measurement-driven decision, not this plan.
- **Not moving extractions/generation to background jobs.** That's §5 of the research doc, a separate plan.
- **Not adding Sentry / pino / structured logging.** That's §3 of the research doc. We add one `console.info('[claude] …', { model, usage })` line so cache hits are observable in Vercel logs for the warm-up week — that's it.
- **Not touching RLS, server-action wrappers, DAO layer, forms, or CI.** Separate research items.
- **Not exposing the retry policy to callers via options.** One policy applies uniformly.
- **Not adding `output_config.format` / strict JSON mode.** Current tool-use + Zod already gives structured output. Don't destabilize what works.
- **Not reorganizing `src/lib/claude/` into subfolders.** 11 flat files is fine.

## Implementation Approach

Four phases, each independently landable. Phase 1 ships the helper with tests but no callers. Phase 2 converts extractions. Phase 3 converts generations and removes action-level retry. Phase 4 adds observability + a follow-up ticket for measurement. Ordering matters: Phase 1 must ship before Phase 2, because Phase 2 is where we'd notice any helper bugs.

**Risk strategy:** the helper preserves each module's `{ data, rawResponse, error }` return contract. Action-layer code does not change in Phase 1/2. The action-level retry removal in Phase 3 is mechanical and testable. If anything regresses, each phase is revertible in isolation.

---

## Phase 1: Helper + shared singleton

### Overview

Build the one helper that every Claude call will use. Ship it with unit tests and an Anthropic mock utility. Wire no callers yet.

### Changes Required

#### 1. Environment + singleton client

**File**: `src/lib/claude/client.ts` (NEW)
**Changes**: Export a module-level Anthropic singleton and the `callClaudeTool` helper.

```ts
import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

// Single shared client for the whole app — reuses HTTP keep-alive, one
// place to wire beta headers later if needed.
export const anthropic = new Anthropic()

export type ClaudeMessage = Anthropic.Messages.MessageParam

export interface CallClaudeToolOptions<TOutput> {
  // REQUIRED — the stable prefix
  model: `claude-${string}`
  system: string            // plain string, converted to cached text block internally
  tools: Anthropic.Tool[]   // cache_control applied to the last one internally
  toolName: string          // forced via tool_choice
  // REQUIRED — the volatile suffix
  messages: ClaudeMessage[]
  maxTokens: number
  // OPTIONAL
  thinking?: Anthropic.Messages.ThinkingConfigParam
  // Zod parse fn — receives the tool_use.input, returns validated output or null.
  // We use a function (not a raw schema) so per-module normalization can run.
  parse: (raw: Record<string, unknown>) =>
    | { success: true; data: TOutput }
    | { success: false; error: z.ZodError }
  // Testing hook — let unit tests inject a stub client.
  // Do not use from production code.
  _client?: Pick<Anthropic, 'messages'>
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

const ZOD_RETRY_ATTEMPTS = 1            // retry once on Zod failure
const API_RETRY_ATTEMPTS = 2            // on top of SDK's default 2 — total 4
const BASE_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 15000

export async function callClaudeTool<TOutput>(
  opts: CallClaudeToolOptions<TOutput>,
): Promise<CallClaudeToolResult<TOutput>> {
  const client = opts._client ?? anthropic

  // Apply cache_control to the last tool and to the system block.
  // Render order is tools → system → messages, so these two breakpoints
  // cache the entire stable prefix.
  const cachedTools: Anthropic.Tool[] = opts.tools.map((t, i) =>
    i === opts.tools.length - 1
      ? { ...t, cache_control: { type: 'ephemeral' } }
      : t,
  )
  const cachedSystem: Anthropic.TextBlockParam[] = [
    { type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } },
  ]

  let zodAttempt = 0
  let lastZodError: z.ZodError | undefined
  let lastRaw: unknown

  // Outer loop: Zod validation retries
  while (zodAttempt <= ZOD_RETRY_ATTEMPTS) {
    // Inner loop: API-level retries with full-jitter backoff.
    // The SDK already retries 429/5xx twice internally; this is the outer
    // layer that adds jitter and total attempt cap.
    let apiAttempt = 0
    let apiResponse: Anthropic.Message | null = null
    let lastApiError: unknown

    while (apiAttempt <= API_RETRY_ATTEMPTS) {
      try {
        apiResponse = await client.messages.create({
          model: opts.model,
          max_tokens: opts.maxTokens,
          ...(opts.thinking ? { thinking: opts.thinking } : {}),
          system: cachedSystem,
          tools: cachedTools,
          tool_choice: { type: 'tool', name: opts.toolName },
          messages: opts.messages,
        })
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

    // Log usage for observability (cache hits, token spend)
    logUsage(opts.model, apiResponse.usage)

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

    lastZodError = parsed.error
    zodAttempt += 1
    // fall through — outer loop retries with a fresh API call
  }

  return {
    error: `Tool output failed Zod validation after ${ZOD_RETRY_ATTEMPTS + 1} attempts`,
    rawResponse: lastRaw,
  }
  void lastZodError  // kept for future structured logging
}

function isRetryableApiError(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) {
    const s = err.status
    return s === 429 || s === 529 || (s !== undefined && s >= 500 && s < 600)
  }
  // Network-level errors bubble up as generic Error with code on .cause or message
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

// Full-jitter exponential backoff
function computeBackoffMs(attempt: number): number {
  const exp = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS)
  return Math.floor(Math.random() * exp)
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function logUsage(model: string, usage: Anthropic.Usage) {
  // Intentionally console-only. Sentry/structured logging is a separate plan.
  // eslint-disable-next-line no-console
  console.info('[claude]', {
    model,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
  })
}
```

#### 2. Anthropic mock test utility

**File**: `src/test-utils/anthropic-mock.ts` (NEW)
**Changes**: Mirror the pattern of [supabase-mock.ts](src/test-utils/supabase-mock.ts). Provide a stub `messages.create` that returns configurable tool-use responses and a factory for canned API errors.

```ts
import { vi, type Mock } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'

interface ToolUseResponseSpec {
  toolName: string
  input: Record<string, unknown>
  usage?: Partial<Anthropic.Usage>
}

export function mockToolUseResponse(spec: ToolUseResponseSpec): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    stop_reason: 'tool_use',
    stop_sequence: null,
    content: [
      {
        type: 'tool_use',
        id: 'toolu_test',
        name: spec.toolName,
        input: spec.input,
      },
    ],
    usage: {
      input_tokens: 100,
      output_tokens: 200,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      ...spec.usage,
    },
  } as Anthropic.Message
}

export function createMockAnthropic() {
  const create = vi.fn() as Mock
  return {
    _create: create,
    messages: { create },
  }
}

export function makeApiError(status: number, message = 'api error'): Anthropic.APIError {
  // Anthropic.APIError is the base; subclasses pick the right status
  const Cls =
    status === 429 ? Anthropic.RateLimitError
    : status === 401 ? Anthropic.AuthenticationError
    : status === 400 ? Anthropic.BadRequestError
    : status >= 500 ? Anthropic.InternalServerError
    : Anthropic.APIError
  // @ts-expect-error — APIError constructor signature varies; tests only care about status/message
  return new Cls(status, { message }, message, {})
}
```

#### 3. Unit tests for the helper

**File**: `src/lib/claude/__tests__/client.test.ts` (NEW)
**Changes**: Cover (a) cache_control placement, (b) retry classification, (c) Zod retry, (d) success path, (e) non-retryable error path.

Test cases:
- `callClaudeTool` applies `cache_control: {type:'ephemeral'}` to the last tool and to the system text block in the outbound request
- returns `{data}` on success when `parse()` succeeds first try
- retries once on Zod failure and returns `{data}` on second attempt
- returns `{error}` after Zod retries are exhausted
- retries on 429, 529, 500, 502, 503, 504 with increasing (jittered) delay
- returns `{error}` immediately on 400, 401, 403 (non-retryable)
- retries on network errors (`ECONNRESET`, `ETIMEDOUT`, `fetch failed`)
- caps total API attempts at `API_RETRY_ATTEMPTS + 1`
- passes `thinking` through unchanged when provided, omits when undefined
- tests inject a stub client via `_client` option — no real network I/O

Use `vi.useFakeTimers()` + `vi.advanceTimersByTime()` to validate backoff without waiting.

#### 4. Vitest setup

**File**: `vitest.config.ts`
**Changes**: No changes needed — `node` env and `@` alias are already set.

#### 5. Verify `server-only` protects the bundle

**File**: `package.json`
**Changes**: Confirm `server-only` is in dependencies. If not, add it: `npm install server-only`. (It may already be transitively present via Next.js — verify.)

### Success Criteria

#### Automated Verification:
- [x] Type check passes: `npx tsc --noEmit`
- [x] Build succeeds: `npm run build`
- [x] Lint passes: `npm run lint`
- [x] New tests pass: `npm test -- src/lib/claude/__tests__/client.test.ts`
- [x] All existing tests still pass: `npm test`
- [x] Search confirms no production import of `_client`: `rg "_client:" src --glob '!**/__tests__/**' --glob '!**/*.test.ts'` returns empty

#### Manual Verification:
- [ ] Import the helper into a Node REPL (or a throwaway script) with a real `ANTHROPIC_API_KEY`, issue two back-to-back identical calls, and verify `cache_read_input_tokens > 0` on the second — this is the real contract and is worth confirming once before migrating callers.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the REPL smoke test succeeded before proceeding to Phase 2.

---

## Phase 2: Migrate extraction modules

### Overview

Convert the 6 document-extraction modules to use `callClaudeTool`. Each module retains its exported signature and its `{data, rawResponse, error}` return contract. Start with `extract-mri.ts` as the reference migration; batch the other 5 once the pattern is validated.

### Changes Required

#### 1. Reference migration: extract-mri.ts

**File**: `src/lib/claude/extract-mri.ts`
**Changes**: Replace the `anthropic.messages.create` call + tool-block extraction + Zod parse with one `callClaudeTool` call. Keep `SYSTEM_PROMPT`, `EXTRACTION_TOOL`, and `normalizeNullString` unchanged. The public `extractMriFromPdf(pdfBase64)` signature is unchanged.

```ts
import { callClaudeTool } from '@/lib/claude/client'
import { mriExtractionResponseSchema, type MriExtractionResult } from '@/lib/validations/mri-extraction'

const SYSTEM_PROMPT = `...` // unchanged
const EXTRACTION_TOOL: Anthropic.Tool = { ... } // unchanged
function normalizeNullString(...) { ... } // unchanged

export async function extractMriFromPdf(pdfBase64: string): Promise<{
  data?: MriExtractionResult[]
  rawResponse?: unknown
  error?: string
}> {
  const result = await callClaudeTool<MriExtractionResult[]>({
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [EXTRACTION_TOOL],
    toolName: 'extract_mri_data',
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: 'Extract the structured data from this MRI report now. If the document contains multiple body regions, return a separate report for each.' },
      ],
    }],
    parse: (raw) => {
      const rawReports = Array.isArray(raw.reports) ? raw.reports : []
      const normalizedReports = rawReports.map((r: Record<string, unknown>) => ({
        body_region: r.body_region,
        mri_date: normalizeNullString(r.mri_date),
        findings: Array.isArray(r.findings)
          ? r.findings.map((f: Record<string, unknown>) => ({ ...f, severity: f.severity === 'null' ? null : f.severity }))
          : [],
        impression_summary: normalizeNullString(r.impression_summary),
        confidence: r.confidence,
        extraction_notes: normalizeNullString(r.extraction_notes),
      }))
      const validated = mriExtractionResponseSchema.safeParse({ reports: normalizedReports })
      return validated.success
        ? { success: true, data: validated.data.reports }
        : { success: false, error: validated.error }
    },
  })
  return result
}
```

The module drops from ~140 lines to ~55. The `new Anthropic()` instantiation is removed — it now lives in `client.ts`.

#### 2. Apply the same transform to the other 5 extraction modules

**Files**:
- `src/lib/claude/extract-chiro.ts`
- `src/lib/claude/extract-ct-scan.ts`
- `src/lib/claude/extract-orthopedic.ts`
- `src/lib/claude/extract-pain-management.ts`
- `src/lib/claude/extract-pt.ts`

**Changes**: Mechanical — same shape as extract-mri.ts. Keep SYSTEM_PROMPT, the tool definition, normalizer helpers, and the public function signature. Move the `messages.create` call into a `callClaudeTool` call; move the normalize-then-safeParse block into the `parse` callback.

#### 3. Smoke tests per extraction module

**File**: `src/lib/claude/__tests__/extract-mri.test.ts` (NEW), repeat pattern for each extraction module
**Changes**: Verify that `extractMriFromPdf` calls `callClaudeTool` with the correct model, toolName, maxTokens, and that it wires the PDF through correctly. Mock `callClaudeTool` directly (simpler than mocking the SDK).

```ts
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/claude/client', () => ({
  callClaudeTool: vi.fn(),
}))

import { extractMriFromPdf } from '@/lib/claude/extract-mri'
import { callClaudeTool } from '@/lib/claude/client'

describe('extractMriFromPdf', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls callClaudeTool with the MRI tool schema and Sonnet 4.6', async () => {
    (callClaudeTool as Mock).mockResolvedValue({ data: [], rawResponse: {} })
    await extractMriFromPdf('base64-pdf')
    const opts = (callClaudeTool as Mock).mock.calls[0][0]
    expect(opts.model).toBe('claude-sonnet-4-6')
    expect(opts.toolName).toBe('extract_mri_data')
    expect(opts.maxTokens).toBe(4096)
    expect(opts.messages[0].content).toContainEqual(expect.objectContaining({
      type: 'document',
      source: expect.objectContaining({ data: 'base64-pdf' }),
    }))
  })

  it('propagates errors from the helper', async () => {
    (callClaudeTool as Mock).mockResolvedValue({ error: 'boom' })
    const result = await extractMriFromPdf('x')
    expect(result.error).toBe('boom')
  })
})
```

Write one such test per migrated module. They're short — ~30 lines each.

### Success Criteria

#### Automated Verification:
- [x] Type check passes: `npx tsc --noEmit`
- [x] Build succeeds: `npm run build`
- [x] Lint passes: `npm run lint`
- [x] New per-module tests pass: `npm test -- src/lib/claude/__tests__/`
- [x] All existing tests still pass: `npm test`
- [x] Grep confirms no module still calls `anthropic.messages.create` directly: `rg "anthropic.messages.create" src/lib/claude/ --glob '!client.ts'` returns empty (for the 6 extraction files)
- [x] Grep confirms no extraction module still instantiates the client: `rg "new Anthropic\(" src/lib/claude/ --glob '!client.ts'` returns empty for the 6 extraction files

#### Manual Verification:
- [ ] Upload a real MRI PDF via the app, confirm extraction completes and approves as before
- [ ] Upload the **same** PDF a second time (delete and re-upload to force a new extraction) within 5 minutes — check server logs for a `[claude]` line with `cache_read_input_tokens > 0` on the second call. For the borderline-size modules (mri, ct-scan), if cache_read is 0, that's expected and documented — the prompt is under the Sonnet 4.6 minimum prefix.
- [ ] Force a retryable failure (temporarily pass an invalid `ANTHROPIC_API_KEY` to cause 401 → immediate fail; restore key → confirm a fresh attempt succeeds). Then test a Zod-failure path by temporarily adding a strict `.transform(() => { throw … })` to one schema, confirm retry kicks in, then revert.
- [ ] Do a representative spot-check of each extraction type (chiro, ct-scan, orthopedic, pt, pain-management) via the clinical tab — verify the UI shows the same extracted fields as before the migration.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that extraction UX is unchanged and cache hits are visible in logs before proceeding to Phase 3.

---

## Phase 3: Migrate generation modules + remove action-level retry + switch to adaptive thinking

### Overview

Convert the 5 generation modules (including their `regenerate_section` variants where present). Convert the case-summary generator from deprecated `budget_tokens` to `thinking: {type: 'adaptive'}`. Remove the dead-weight `const retry = await …` block from all 10 server-action call sites.

### Changes Required

#### 1. Migrate generate-summary.ts and switch to adaptive thinking

**File**: `src/lib/claude/generate-summary.ts`
**Changes**:
- Replace `anthropic.messages.create` with `callClaudeTool`.
- Replace `thinking: {type: 'enabled', budget_tokens: 10000}` with `thinking: {type: 'adaptive'}`.
- Model stays `claude-opus-4-6`.
- The `console.error('[generate-summary] Zod validation errors', …)` at [line 337](src/lib/claude/generate-summary.ts#L337) becomes unnecessary — the helper handles Zod retry and returns a single error; if we want per-module debug logging later, we'll pass an `onZodFailure?` callback in the options. For now, remove it.

```ts
export async function generateCaseSummaryFromData(
  inputData: SummaryInputData,
): Promise<{ data?: CaseSummaryResult; rawResponse?: unknown; error?: string }> {
  return callClaudeTool<CaseSummaryResult>({
    model: 'claude-opus-4-6',
    maxTokens: 16384,
    thinking: { type: 'adaptive' },      // was: { type: 'enabled', budget_tokens: 10000 }
    system: SYSTEM_PROMPT,
    tools: [SUMMARY_TOOL],
    toolName: 'extract_case_summary',
    messages: [{
      role: 'user',
      content: `Synthesize the following clinical data into a comprehensive case summary.\n\n${JSON.stringify(inputData, null, 2)}`,
    }],
    parse: (raw) => {
      // ... existing normalization block (lines 289-333) unchanged ...
      const validated = caseSummaryResultSchema.safeParse(normalized)
      return validated.success
        ? { success: true, data: validated.data }
        : { success: false, error: validated.error }
    },
  })
}
```

Note: `tool_choice` was `{type: 'auto'}` at [line 272](src/lib/claude/generate-summary.ts#L272), not `{type: 'tool', name: …}`. This is the one outlier. We'll support it by adding an optional `toolChoice?: Anthropic.ToolChoice` field to `CallClaudeToolOptions` — if not provided, default to `{type: 'tool', name: opts.toolName}`. Update the helper signature accordingly.

**Helper update required in `src/lib/claude/client.ts`:**

```ts
export interface CallClaudeToolOptions<TOutput> {
  // ... existing fields ...
  toolName: string
  toolChoice?: Anthropic.ToolChoice   // defaults to { type: 'tool', name: toolName }
  // ...
}

// in the API call:
tool_choice: opts.toolChoice ?? { type: 'tool', name: opts.toolName },
```

`generate-summary.ts` passes `toolChoice: { type: 'auto' }`.

#### 2. Migrate generate-clinical-orders.ts

**File**: `src/lib/claude/generate-clinical-orders.ts`
**Changes**: Two exports (`generateImagingOrders`, `generateChiropracticOrder`), same pattern as extract-mri.ts. Each function becomes a `callClaudeTool` invocation.

#### 3. Migrate generate-discharge-note.ts (including `regenerateDischargeNoteSection`)

**File**: `src/lib/claude/generate-discharge-note.ts`
**Changes**: Two exports, both migrate to `callClaudeTool`. The regenerate variant uses a different `SECTION_REGEN_TOOL`; that's fine — each call passes its own tools array. Section-regen calls will have lower cache-hit rates because the system prompt is constructed per-call as ``${SYSTEM_PROMPT}\n\nYou are regenerating ONLY the "${sectionLabel}" section…`` — that suffix changes per section. We keep the current behavior; future optimization would hoist the base SYSTEM_PROMPT and pass the section-specific suffix in the user message, but that's out of scope.

#### 4. Migrate generate-initial-visit.ts (including `regenerateSection`)

**File**: `src/lib/claude/generate-initial-visit.ts`
**Changes**: Two exports, both migrate. Note [buildSystemPrompt](src/lib/claude/generate-initial-visit.ts#L258-L261) composes the prompt from three module-level const chunks based on `visitType`. Each visit type gets its own stable system prompt (good — `initial_visit` vs `pain_evaluation_visit` each cache independently). Pass the result of `buildSystemPrompt(visitType)` into `callClaudeTool`.

#### 5. Migrate generate-procedure-note.ts (including `regenerateProcedureNoteSection`)

**File**: `src/lib/claude/generate-procedure-note.ts`
**Changes**: Two exports, same pattern.

#### 6. Remove action-level retry from all 10 call sites

**Files**:
- `src/actions/mri-extractions.ts` — remove [lines 85-107](src/actions/mri-extractions.ts#L85-L107) (the retry block + the retry-succeeded branch), keep only the success path.
- `src/actions/chiro-extractions.ts` — analogous block
- `src/actions/ct-scan-extractions.ts` — analogous
- `src/actions/orthopedic-extractions.ts` — analogous
- `src/actions/pain-management-extractions.ts` — analogous
- `src/actions/pt-extractions.ts` — analogous
- `src/actions/case-summaries.ts` — around [line 143](src/actions/case-summaries.ts#L143)
- `src/actions/discharge-notes.ts` — around [line 338](src/actions/discharge-notes.ts#L338)
- `src/actions/initial-visit-notes.ts` — around [line 340](src/actions/initial-visit-notes.ts#L340)
- `src/actions/procedure-notes.ts` — around [line 350](src/actions/procedure-notes.ts#L350)

For each: replace the `if (result.error) { const retry = await …; if (retry.error) { /* update row failed */ } else { /* update row success */ } }` with a single check:

```ts
// BEFORE (mri-extractions.ts:85-115, pattern-matches the other 5 extractions):
const result = await extractMriFromPdf(pdfBase64)
if (result.error || !result.data?.length) {
  const retry = await extractMriFromPdf(pdfBase64)
  if (retry.error || !retry.data?.length) {
    await supabase.from('mri_extractions').update({
      extraction_status: 'failed',
      extraction_error: retry.error ?? result.error ?? 'Extraction failed',
      extraction_attempts: 2,
      raw_ai_response: retry.rawResponse ?? result.rawResponse ?? null,
      updated_by_user_id: user.id,
    }).eq('id', extraction.id)
    revalidatePath(`/patients/${doc.case_id}/clinical`)
    return { error: retry.error ?? result.error }
  }
  const ids = await insertMultiRegionExtractions(supabase, extraction.id, documentId, doc.case_id, retry, user.id, 2)
  revalidatePath(`/patients/${doc.case_id}/clinical`)
  return { data: { extractionIds: ids } }
}
const ids = await insertMultiRegionExtractions(supabase, extraction.id, documentId, doc.case_id, result, user.id, 1)
revalidatePath(`/patients/${doc.case_id}/clinical`)
revalidatePath(`/patients/${doc.case_id}/documents`)
return { data: { extractionIds: ids } }

// AFTER:
const result = await extractMriFromPdf(pdfBase64)
if (result.error || !result.data?.length) {
  await supabase.from('mri_extractions').update({
    extraction_status: 'failed',
    extraction_error: result.error ?? 'Extraction failed',
    extraction_attempts: 1,
    raw_ai_response: result.rawResponse ?? null,
    updated_by_user_id: user.id,
  }).eq('id', extraction.id)
  revalidatePath(`/patients/${doc.case_id}/clinical`)
  return { error: result.error }
}
const ids = await insertMultiRegionExtractions(supabase, extraction.id, documentId, doc.case_id, result, user.id, 1)
revalidatePath(`/patients/${doc.case_id}/clinical`)
revalidatePath(`/patients/${doc.case_id}/documents`)
return { data: { extractionIds: ids } }
```

The `extraction_attempts` DB field stays as-is semantically — it's still "number of attempts to call Claude from this action" (now always 1, because the helper's retries are invisible to the action). If we want to surface the helper's attempt count later, we can extend the helper's return to include `{ attempts }` — out of scope for now; note as a follow-up.

#### 7. Update smoke tests for generation modules

**File**: `src/lib/claude/__tests__/generate-summary.test.ts` (NEW) + siblings for the other 4 generation modules
**Changes**: Same shape as Phase 2's extraction tests. Assert:
- `callClaudeTool` is called with the correct model (`claude-opus-4-6` for summary, `claude-sonnet-4-6` for the rest)
- Summary passes `thinking: {type: 'adaptive'}`
- Summary passes `toolChoice: {type: 'auto'}`
- Regenerate variants wire through `currentContent` into the user message

### Success Criteria

#### Automated Verification:
- [ ] Type check passes: `npx tsc --noEmit`
- [ ] Build succeeds: `npm run build`
- [ ] Lint passes: `npm run lint`
- [ ] All tests pass: `npm test`
- [ ] Grep confirms no module still calls `anthropic.messages.create`: `rg "anthropic.messages.create" src/lib/claude/ --glob '!client.ts'` returns empty for all 11 modules
- [ ] Grep confirms no `new Anthropic(` outside `client.ts`: `rg "new Anthropic\(" src/lib/claude/ --glob '!client.ts'` returns empty
- [ ] Grep confirms action-level retry blocks are gone: `rg "Retry once on failure" src/actions/` returns empty
- [ ] Grep confirms no more `const retry = await (extract|generate)`: `rg "const retry = await (extract|generate)" src/actions/` returns empty
- [ ] Grep confirms no `budget_tokens:` anywhere in `src/lib/claude/`: `rg "budget_tokens" src/lib/claude/` returns empty

#### Manual Verification:
- [ ] End-to-end: create a patient → upload MRI → approve extraction → upload chiro/PT/ortho → generate case summary → generate initial visit note → generate procedure note → generate discharge note. Verify each step works and produces output visually equivalent to pre-migration.
- [ ] Regenerate-section UI works: open a generated note, click regenerate on one section, confirm fresh content appears.
- [ ] Adaptive thinking smoke test: generate a case summary, check Vercel logs for a `[claude] model=claude-opus-4-6` line with non-zero `output_tokens` — confirm summary quality is at least as good as before (spot-check wording vs a pre-migration summary on a test case).
- [ ] Cache hit check: generate two case summaries back-to-back on different cases within 5 minutes — second should show `cache_read_input_tokens` ≥ 3000 (the system + tool prefix).
- [ ] Error path: kill the network mid-extraction (disconnect Wi-Fi during upload→extract trigger), confirm the action returns an error string cleanly instead of throwing, confirm the UI shows the error in the extraction status.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that full end-to-end flows are intact and cache hits are visible before proceeding to Phase 4.

---

## Phase 4: Observability warm-up

### Overview

Keep the `console.info('[claude]', …)` line (already added in Phase 1) in place for one week in production. Collect real cache hit rates. File a follow-up ticket for full observability (part of §3 of the research doc) and for measurement-driven model selection (part of §4, point 4).

### Changes Required

#### 1. Docstring in `client.ts` noting the log format

**File**: `src/lib/claude/client.ts`
**Changes**: Add a `// LOGGING: ...` block above `logUsage()` documenting the log format and noting that Sentry/pino integration is tracked separately.

```ts
// LOGGING: emits one `[claude]` line per API call with token usage.
// Format: `{ model, input_tokens, output_tokens, cache_creation_input_tokens,
// cache_read_input_tokens }`. Consumed by Vercel logs during the caching
// warm-up period. Replacement with structured Sentry/pino logging is tracked
// in the architecture-improvements plan §3 (observability).
```

#### 2. Follow-up ticket placeholder

**File**: `thoughts/shared/plans/2026-04-16-claude-prompt-caching-and-retry-helper.md` (this file)
**Changes**: Add a Follow-Up section listing:
- Measure cache hit rate after 7 days of production traffic. Target: ≥70% cache reads on warm prefixes for all modules whose system+tool prefix clears the model's minimum cacheable threshold. Extract-mri and extract-ct-scan are expected to be lower — OK.
- If extract-mri / extract-ct-scan show 0% cache hits, either accept (prompts are small so uncached cost is also small) or pad the system prompt with extra frozen context to cross the 2K-token Sonnet 4.6 threshold.
- Evaluate `claude-haiku-4-5` substitution for extract-mri and extract-ct-scan once cost data is in hand (separate follow-up, part of research doc §4 point 4).

### Success Criteria

#### Automated Verification:
- [ ] Grep confirms the docstring is in place: `rg "LOGGING:" src/lib/claude/client.ts` returns one match
- [ ] This plan document includes a Follow-Up section

#### Manual Verification:
- [ ] After 7 days of production traffic, review Vercel logs (or query via `vercel logs` CLI) for `[claude]` lines. Compute the ratio of `cache_read_input_tokens` to `(cache_read_input_tokens + input_tokens)` across all calls. Record the measurement in a follow-up research doc.

---

## Testing Strategy

### Unit Tests

Target coverage from Phase 1 tests:
- **Cache control placement** — assert that the outbound `messages.create` call receives `tools` with `cache_control` on the last element only, and `system` as a single `TextBlockParam` array with `cache_control` on the one block.
- **Retry classification** — table-driven test covering each of 400/401/403/404/413 (non-retryable), 429/500/502/503/504/529 (retryable), and network errors (ECONNRESET/ETIMEDOUT/fetch failed).
- **Backoff math** — use `vi.useFakeTimers()`; assert that the second retry delay is larger than the first (expected value given the `Math.random() * (base * 2^attempt)` formula) and never exceeds `MAX_BACKOFF_MS`.
- **Zod retry path** — inject a `parse` that fails once then succeeds; assert two `messages.create` calls and `{data}` return.
- **API retry exhaustion** — inject a stub that always throws 529; assert `API_RETRY_ATTEMPTS + 1` calls and `{error}` return.
- **Test hook isolation** — `_client` override bypasses the real singleton; no env var required.

Phase 2 per-module tests:
- Each module has one test file with 2-3 assertions: correct model passed, correct toolName, PDF bytes wired through, error propagates.

Phase 3 per-module tests: same pattern. Summary adds assertions for `thinking: {type: 'adaptive'}` and `toolChoice: {type: 'auto'}`.

### Manual Testing Steps

See the Manual Verification checklist in each Phase. The critical ones:

1. Upload an MRI PDF twice within 5 minutes, confirm second call logs `cache_read_input_tokens > 0`.
2. Generate an initial visit note and a procedure note on the same case within 5 minutes — confirm the **third** call (any subsequent generation) logs cache reads for the shared system prefix.
3. End-to-end smoke: create case → upload every document type → generate every note type → verify UI, PDFs, and attorney-bound downloads are equivalent to pre-migration outputs on a reference case.

## Performance Considerations

**Expected wins** (per Anthropic's published rates — cache reads are ~10% of base input price):
- Extractions: ~60–80% cost reduction on input tokens for the warm path (system + tool schemas are the bulk of input).
- Generations: ~70–90% cost reduction on input tokens — prompts are larger, input_data is the only volatile suffix.
- Summary (Opus 4.6): biggest per-call savings because Opus input is $5/1M vs cache reads at $0.50/1M.

**Expected latency improvements:** Claude's caching system also reduces TTFT (time to first token) on warm reads by ~30-50% for large prefixes. Not measured here; confirmed in prod by comparing `logUsage` timings pre/post migration during the Phase 4 warm-up.

**Retry latency:** Worst-case user-visible latency now = `(1 + API_RETRY_ATTEMPTS) × max_request_latency + Σ backoff`. With `API_RETRY_ATTEMPTS=2`, `BASE_BACKOFF_MS=1000`, `MAX_BACKOFF_MS=15000`, expected worst-case retry window ≈ 15s. This is acceptable for document extractions (already 10-60s happy-path) but is explicitly *not* for cases where the user is actively waiting — fine today because all Claude calls are already post-upload or post-click. If Claude calls ever enter the interactive request path, we'd want to revisit.

## Migration Notes

**No DB migrations needed.** The `extraction_attempts` column stays. The `raw_ai_response` column continues to receive the raw tool-use input when errors occur (the helper returns it in `rawResponse` on Zod failure).

**No user-facing behavior change** during any phase except Phase 3, where transient 429/529/5xx errors that previously showed as a red "Extraction failed" toast may now quietly resolve in 1-15s of backoff. This is an improvement — no migration concern.

**Rollback:** each phase is revertible in isolation:
- Phase 1 is inert until callers migrate.
- Phase 2 reverts by restoring each `src/lib/claude/extract-*.ts` file (`git revert` the per-file commit).
- Phase 3 reverts by restoring the 5 generation modules + the 10 action files. The action-level retry was doing nothing useful, so reverting just adds dead code back.

## Follow-Up (tracked, not part of this plan)

1. Measure cache hit rate after 7 days of production traffic (target ≥70% on warm prefixes). If extract-mri / extract-ct-scan sit at 0%, decide between accepting (small prompts, small absolute cost) and padding to cross the 2K threshold.
2. Evaluate `claude-haiku-4-5` for the two small extractors once cost data is in hand.
3. Replace `console.info('[claude]', …)` with structured logging + Sentry breadcrumbs when §3 of the architecture research lands.
4. Consider hoisting section-regeneration prompts so the stable base is cacheable (currently the per-section suffix invalidates the cache for `regenerateSection` / `regenerateDischargeNoteSection` / `regenerateProcedureNoteSection` calls). Candidate optimization — move the section-label to the user message, keep the system prompt fully stable.
5. If the helper's attempt count becomes interesting for ops (e.g., debugging why extractions sometimes take 15s), extend `CallClaudeToolResult` to include `{ attempts }` and persist it to the extraction row.

## References

- Original research: [thoughts/shared/research/2026-04-16-architecture-improvement-recommendations.md](../research/2026-04-16-architecture-improvement-recommendations.md) §4
- Current Claude modules: [src/lib/claude/](src/lib/claude/) — 11 files
- Current action call sites with retry to remove: 10 files listed in Phase 3 §6
- Similar implementation pattern for shared test utility: [src/test-utils/supabase-mock.ts](src/test-utils/supabase-mock.ts)
- Anthropic SDK prompt caching reference (cached 2026-02-17): see `claude-api` skill → `shared/prompt-caching.md`
