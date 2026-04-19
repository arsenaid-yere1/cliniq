# Remove Claude Prompt Caching Implementation Plan

## Overview

Strip the `cache_control: { type: 'ephemeral' }` breakpoints from the shared `callClaudeTool` helper so that every Claude request is sent uncached. The change is scoped to one source file and one test file. All 11 Claude modules and all 10 server-action call sites keep their current signatures and behavior — only the wire-level request shape changes.

## Current State Analysis

Prompt caching is centralized in `callClaudeTool` at [src/lib/claude/client.ts:45-116](src/lib/claude/client.ts#L45-L116). The helper transforms the caller's plain `system: string` + `tools: Anthropic.Tool[]` into cached shapes before issuing the request:

- Tools: `cache_control` attached to the last tool ([client.ts:52-56](src/lib/claude/client.ts#L52-L56)).
- System: promoted to a one-element `TextBlockParam` array with `cache_control` on the single block ([client.ts:57-59](src/lib/claude/client.ts#L57-L59)).
- Both `cachedTools` and `cachedSystem` are passed to `messages.create` at [client.ts:71-79](src/lib/claude/client.ts#L71-L79).
- `logUsage` at [client.ts:150-164](src/lib/claude/client.ts#L150-L164) reads `cache_creation_input_tokens` and `cache_read_input_tokens` off the response and includes them in the `[claude]` log line.

No caller sets `cache_control`; no feature flag or env var disables it. See [thoughts/shared/research/2026-04-19-prompt-caching-current-state.md](../research/2026-04-19-prompt-caching-current-state.md) for the full map.

The test at [src/lib/claude/__tests__/client.test.ts:44-59](src/lib/claude/__tests__/client.test.ts#L44-L59) asserts the two breakpoints are placed. A second test at [client.test.ts:168-184](src/lib/claude/__tests__/client.test.ts#L168-L184) asserts that `cache_read_input_tokens` flows into the `[claude]` log.

Motivating symptom (per the user): discharge-note and related note surfaces are producing a "copy-paste effect" — i.e. visibly repeated or overly similar content between successive generations — suspected to correlate with cached prefix reuse.

## Desired End State

`callClaudeTool` sends requests without any cache breakpoints. The SDK accepts the system prompt as a plain string; the tools array contains the caller's unmodified tool objects. No `cache_creation_input_tokens` or `cache_read_input_tokens` telemetry is recorded or logged — cost-bearing input tokens are all reported as `input_tokens`. Every call is a cold read.

**Verification that the end state is reached:**

- `rg "cache_control" src/lib/claude/` returns zero matches.
- `rg "cache_creation_input_tokens|cache_read_input_tokens" src/lib/claude/` returns zero matches.
- `rg "ephemeral" src/lib/claude/` returns zero matches.
- The `[claude]` log line contains only `{ model, input_tokens, output_tokens }`.
- After a cold user-visible generation (e.g. a discharge note on an unseen case), `response.usage.cache_read_input_tokens` is 0 (not just omitted from the log). After a second back-to-back generation on the same case, `input_tokens` on the second call is **not** substantially lower than on the first — confirming caching is off.
- The "copy-paste effect" on regenerated note sections diminishes or disappears in manual spot-checks.

### Key Discoveries:

- All caching logic is inside one helper — no caller touches it, so the public surface is untouched by this change ([research doc §2](../research/2026-04-19-prompt-caching-current-state.md)).
- The Anthropic SDK's `messages.create` accepts `system` as either `string` or `TextBlockParam[]` — reverting to a plain string is a supported, minimal shape ([client.ts:71-79](src/lib/claude/client.ts#L71-L79) currently passes the array form).
- The per-section regeneration paths (discharge / procedure / initial-visit) build system prompts via `${SYSTEM_PROMPT}\n\nYou are regenerating ONLY the "${sectionLabel}" section…` ([generate-discharge-note.ts:326](src/lib/claude/generate-discharge-note.ts#L326), [generate-procedure-note.ts:497](src/lib/claude/generate-procedure-note.ts#L497), [generate-initial-visit.ts:548](src/lib/claude/generate-initial-visit.ts#L548)). These are the most suspect surfaces for the copy-paste effect; they are covered by the single change in `callClaudeTool` with no per-module edits needed.
- Retry layering is independent of caching. The outer Zod-retry loop ([client.ts:64-110](src/lib/claude/client.ts#L64-L110)), the inner API-retry loop with full-jitter backoff ([client.ts:69-88](src/lib/claude/client.ts#L69-L88)), and `isRetryableApiError` ([client.ts:118-133](src/lib/claude/client.ts#L118-L133)) are preserved verbatim.
- One dedicated caching test exists and needs to be replaced with its inverse; one logging test needs its cache-token assertion dropped. No other tests reference caching.

## What We're NOT Doing

- **Not touching caller modules.** All 11 files in `src/lib/claude/` keep their exported signatures and bodies unchanged (except the automatic consequence of cache behavior going away on the wire).
- **Not touching server actions.** The 10 call sites in `src/actions/**` see the same `{ data, rawResponse, error }` return contract.
- **Not touching retry or Zod-retry logic.** Exactly the same classifier, counters, and backoff math.
- **Not adding a feature flag / env var / option to re-enable caching.** If caching needs to come back selectively in the future, that's a separate, measurement-driven plan.
- **Not changing models, `maxTokens`, `temperature`, `thinking`, or `toolChoice` defaults.** This plan isolates exactly one variable: caching on/off.
- **Not deleting the test-utils mock (`src/test-utils/anthropic-mock.ts`)** or modifying its shape.
- **Not changing the log tag string (`[claude]`).** Only the object keys shrink.
- **Not rewriting the research or old caching plan.** The [2026-04-16 caching + retry plan](./2026-04-16-claude-prompt-caching-and-retry-helper.md) is left in place as historical record.

## Implementation Approach

One phase, one PR. The change is mechanical and bounded: strip two transforms in `client.ts`, drop two fields from the log object, and adjust two test files. Run the full test suite, typecheck, lint, and build. Hand off for manual spot-checks on the note surfaces that motivated the change.

No phased rollout or feature flag because (a) the blast radius is small, (b) there's no backwards-compatibility concern — cached requests and uncached requests return the same shape of response, and (c) the risk of keeping caching partially enabled in some code paths is worse than flipping it cleanly.

---

## Phase 1: Strip cache breakpoints, cache-read telemetry, and the associated tests

### Overview

Remove the two `cache_control` injections and the two cache-token log fields from `src/lib/claude/client.ts`. Update `src/lib/claude/__tests__/client.test.ts` to replace the "applies cache_control" test with its inverse and to drop the `cache_read_input_tokens` assertion from the logging test.

### Changes Required:

#### 1. Remove cache_control injection and revert `system` to a plain string

**File**: `src/lib/claude/client.ts`
**Changes**: Delete the `cachedTools` / `cachedSystem` derivations. Pass `opts.tools` and `opts.system` straight through. Update the comment block that explained the caching strategy.

Current ([client.ts:50-59](src/lib/claude/client.ts#L50-L59)):

```ts
  // Render order is tools → system → messages. Two breakpoints (last tool +
  // system text block) cache the entire stable prefix.
  const cachedTools: Anthropic.Tool[] = opts.tools.map((t, i) =>
    i === opts.tools.length - 1
      ? { ...t, cache_control: { type: 'ephemeral' } }
      : t,
  )
  const cachedSystem: Anthropic.TextBlockParam[] = [
    { type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } },
  ]
```

Replace with: nothing. Delete the block entirely.

Current ([client.ts:71-79](src/lib/claude/client.ts#L71-L79)):

```ts
        apiResponse = await client.messages.create({
          model: opts.model,
          max_tokens: opts.maxTokens,
          ...(opts.thinking ? { thinking: opts.thinking } : {}),
          system: cachedSystem,
          tools: cachedTools,
          tool_choice: opts.toolChoice ?? { type: 'tool', name: opts.toolName },
          messages: opts.messages,
        })
```

Replace with:

```ts
        apiResponse = await client.messages.create({
          model: opts.model,
          max_tokens: opts.maxTokens,
          ...(opts.thinking ? { thinking: opts.thinking } : {}),
          system: opts.system,
          tools: opts.tools,
          tool_choice: opts.toolChoice ?? { type: 'tool', name: opts.toolName },
          messages: opts.messages,
        })
```

#### 2. Drop cache-token fields from `logUsage`

**File**: `src/lib/claude/client.ts`
**Changes**: Remove the two cache token fields from the emitted log object and update the leading comment that describes the log format.

Current ([client.ts:150-164](src/lib/claude/client.ts#L150-L164)):

```ts
// LOGGING: emits one `[claude]` line per API call with token usage.
// Format: `{ model, input_tokens, output_tokens, cache_creation_input_tokens,
// cache_read_input_tokens }`. Consumed by Vercel logs during the caching
// warm-up period. Replacement with structured Sentry/pino logging is tracked
// in the architecture-improvements plan §3 (observability).
function logUsage(model: string, usage: Anthropic.Messages.Usage) {
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

Replace with:

```ts
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
```

#### 3. Invert the cache-control placement test

**File**: `src/lib/claude/__tests__/client.test.ts`
**Changes**: Replace the existing `it('applies cache_control to the last tool and to the system text block', …)` test ([client.test.ts:44-59](src/lib/claude/__tests__/client.test.ts#L44-L59)) with a test that asserts caching is **not** applied. This guards the regression: a future accidental reintroduction of caching will fail CI.

Current ([client.test.ts:44-59](src/lib/claude/__tests__/client.test.ts#L44-L59)):

```ts
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
```

Replace with:

```ts
  it('does not apply cache_control and passes system as a plain string', async () => {
    const stub = createMockAnthropic()
    stub._create.mockResolvedValue(mockToolUseResponse({ toolName: 't2', input: { value: 'ok' } }))

    await callClaudeTool({ ...baseOpts(), _client: stub })

    const call = stub._create.mock.calls[0][0]
    expect(call.tools[0].cache_control).toBeUndefined()
    expect(call.tools[1].cache_control).toBeUndefined()
    expect(call.system).toBe('You are a test system prompt.')
  })
```

#### 4. Drop the cache-token assertion from the logging test

**File**: `src/lib/claude/__tests__/client.test.ts`
**Changes**: In the test at [client.test.ts:168-184](src/lib/claude/__tests__/client.test.ts#L168-L184), remove the `cache_read_input_tokens: 100` expectation and the `cache_read_input_tokens` usage override. The rest of the test (asserts the log is emitted with `model`, `input_tokens`, `output_tokens`) stays.

Current:

```ts
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
```

Replace with:

```ts
  it('logs usage on success', async () => {
    const stub = createMockAnthropic()
    stub._create.mockResolvedValue(mockToolUseResponse({
      toolName: 't2',
      input: { value: 'ok' },
      usage: { input_tokens: 10, output_tokens: 20 },
    }))

    await callClaudeTool({ ...baseOpts(), _client: stub })

    expect(consoleInfoSpy).toHaveBeenCalledWith('[claude]', {
      model: 'claude-sonnet-4-6',
      input_tokens: 10,
      output_tokens: 20,
    })
  })
```

Note the shift from `expect.objectContaining(...)` to an exact-match object — this pins the log shape to exactly the three intended fields. If somebody reintroduces `cache_*` fields later, this test fails.

### Success Criteria:

#### Automated Verification:
- [x] Type check passes: `npx tsc --noEmit`
- [x] Lint passes: `npm run lint` (no new errors; one pre-existing `prefer-const` error in `src/actions/__tests__/patients.test.ts:77` is unrelated)
- [x] Build succeeds: `npm run build`
- [x] All tests pass: `npm test` — client tests green; 9 pre-existing failures in `src/lib/validations/__tests__/{discharge,initial-visit,procedure}-note.test.ts` are from uncommitted vitals work on the branch and reproduce on HEAD without these changes
- [x] Caching is fully stripped from source: `rg "cache_control|ephemeral" src/lib/claude/client.ts` returns zero matches (the only remaining `cache_creation_input_tokens` / `cache_read_input_tokens` reference is inside the SDK-typed mock usage block at `__tests__/client.test.ts:190`, which shapes `Anthropic.Messages.Usage` and asserts nothing about our code)
- [x] No caller regressed to set caching themselves: confirmed by grep
- [x] The updated client tests pass in isolation: `npm test -- src/lib/claude/__tests__/client.test.ts` — 23/23 passed

#### Manual Verification:
- [x] Start the dev server (`npm run dev`), open a test case, and generate a discharge note end-to-end. Confirm the note saves and the UI shows the draft.
- [x] Regenerate one section of that discharge note twice in a row. Compare the two outputs — confirm the "copy-paste effect" has diminished (i.e. the second regeneration produces visibly different phrasing, not a near-verbatim repeat of the first).
- [x] Trigger an initial-visit note generation on a different case; confirm it works and the wording is not copy-paste-similar to a prior generation on the same patient data.
- [x] Trigger a case-summary generation (still uses `thinking: adaptive`); confirm it completes and the output is coherent.
- [x] Trigger one PDF extraction (e.g. MRI upload) and confirm it still extracts correctly.
- [x] Inspect Vercel logs (or local terminal if running `npm run dev`): confirm the `[claude]` log line shows **only** `{ model, input_tokens, output_tokens }` — no `cache_creation_input_tokens` or `cache_read_input_tokens` keys.
- [x] Spot-check: the second generation of the same note type on the same case shows an `input_tokens` count that is **not materially lower** than the first (within ~5%). If it is dramatically lower, caching is still in effect somewhere — investigate.

---

## Testing Strategy

### Unit Tests:
- Covered by the two edits in `src/lib/claude/__tests__/client.test.ts`:
  - Negative assertion that `cache_control` is absent from both the tools array and the system field, and that `system` is passed as a plain string (not a `TextBlockParam[]`).
  - Exact-match assertion on the `[claude]` log object — pins the shape to `{ model, input_tokens, output_tokens }` and will fail if cache fields are reintroduced.
- All other existing tests in `client.test.ts` (retry classification, Zod retry, backoff cap, thinking passthrough, toolChoice default, no-tool-use error) remain unchanged and must continue to pass.

### Integration Tests:
- None needed. The change is a wire-shape adjustment with no new behavior to integration-test; regressions would surface in the existing end-to-end generation flows exercised during manual verification.

### Manual Testing Steps:

1. Run `npm test` to confirm all unit tests pass after the edits.
2. `npm run build` to confirm the app compiles cleanly.
3. Run `npm run dev` locally with a valid `ANTHROPIC_API_KEY`.
4. On a test patient/case:
   - Generate a full discharge note; confirm draft saves.
   - Regenerate the `subjective` section twice. Compare outputs side-by-side. The two regenerations should read differently.
   - Repeat for one other section (e.g. `plan_and_recommendations`).
5. On another case: generate an initial-visit note. Confirm output quality and variation.
6. On another case: generate a case summary. Confirm it still streams through (`thinking: adaptive` unaffected).
7. Upload one MRI PDF; confirm extraction still completes.
8. Grep the dev-server terminal output for `[claude]` and confirm the three-field shape.
9. Sanity-check token economics: second generation of the same note on the same case should **not** show a dramatic `input_tokens` reduction vs the first (a 70–90% drop would mean caching is still on; a near-flat value confirms it's off).

## Performance Considerations

Removing caching increases input-token cost on the warm path. Per the originating plan's estimates ([2026-04-16 plan §"Performance Considerations"](./2026-04-16-claude-prompt-caching-and-retry-helper.md)), warm-path inputs were expected to drop 60–90% with caching; removing it restores full-price reads. Expected impact:

- **Latency**: time-to-first-token regresses by roughly the amount previously gained on cached warm reads. Not expected to be user-visible on the notes surface (already 10–60s happy-path); would matter if Claude calls were ever in an interactive request path (they are not today).
- **Cost**: input-token spend on notes generation and extraction goes up. Cost is accepted as the price of correcting the copy-paste effect. If it becomes a problem, the follow-up is measurement-driven: instrument diversity / repetition on outputs, then consider selective re-enablement with `thinking: adaptive` or explicit per-call sampling nudges rather than blanket caching.

The change is a no-op for retry behavior, error handling, and functional output shape.

## Migration Notes

- No DB migrations. Persisted columns (`generation_attempts`, `raw_ai_response`, etc.) keep their semantics.
- No env-var changes. `ANTHROPIC_API_KEY` is still the only required Claude env var.
- No user-visible API changes. Server actions and UI components see the same `{ data, rawResponse, error }` contract.
- **Rollback**: revert the single commit. The two source-level edits and the two test-level edits are contiguous and self-contained.

## References

- Research doc: [thoughts/shared/research/2026-04-19-prompt-caching-current-state.md](../research/2026-04-19-prompt-caching-current-state.md)
- Original caching plan (for context on what was previously built): [thoughts/shared/plans/2026-04-16-claude-prompt-caching-and-retry-helper.md](./2026-04-16-claude-prompt-caching-and-retry-helper.md)
- Helper being edited: [src/lib/claude/client.ts](src/lib/claude/client.ts)
- Test file being edited: [src/lib/claude/__tests__/client.test.ts](src/lib/claude/__tests__/client.test.ts)
- Mock utility (unchanged by this plan): [src/test-utils/anthropic-mock.ts](src/test-utils/anthropic-mock.ts)