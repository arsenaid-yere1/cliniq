---
date: 2026-04-19T23:27:07+0000
researcher: arsenaid
git_commit: 104a43725578eee1895284aff3ed7469083d60f4
branch: main
repository: cliniq
topic: "Current state of Claude prompt caching (in support of removing it due to copy-paste effect in notes)"
tags: [research, codebase, claude, prompt-caching, client, discharge-notes, initial-visit, procedure-notes]
status: complete
last_updated: 2026-04-19
last_updated_by: arsenaid
---

# Research: Current state of Claude prompt caching

**Date**: 2026-04-19T23:27:07+0000
**Researcher**: arsenaid
**Git Commit**: 104a43725578eee1895284aff3ed7469083d60f4
**Branch**: main
**Repository**: cliniq

## Research Question

"Remove prompt caching since it's giving copy-paste effect for notes." — document where prompt caching currently lives in the codebase, how it is applied, which callers it affects, and how it is observed. This is a map of the existing system; no changes are proposed here.

## Summary

Prompt caching is implemented in exactly **one place**: the shared Claude client wrapper at [src/lib/claude/client.ts:45-116](src/lib/claude/client.ts#L45-L116). It is applied **unconditionally** to every Claude API call the app makes. The mechanism is:

1. `callClaudeTool` wraps the caller's plain `system: string` into a single-element `TextBlockParam` array and attaches `cache_control: { type: 'ephemeral' }` to that block ([client.ts:57-59](src/lib/claude/client.ts#L57-L59)).
2. It maps the caller's `tools: Anthropic.Tool[]` and attaches `cache_control: { type: 'ephemeral' }` to **only the last tool** in the array ([client.ts:52-56](src/lib/claude/client.ts#L52-L56)).
3. No caller anywhere in the codebase sets `cache_control` itself — all caching behavior flows from this one helper.

**11 Claude modules** in `src/lib/claude/` call `callClaudeTool`. All of them inherit caching automatically. That includes every note generator (discharge, initial visit, procedure, case summary, clinical orders) and every PDF extraction module (MRI, PT, pain management, chiro, orthopedic, CT scan).

Cache hits are observed by reading `cache_creation_input_tokens` and `cache_read_input_tokens` off the SDK response and logging them to `console.info('[claude]', …)` ([client.ts:155-164](src/lib/claude/client.ts#L155-L164)). There are no feature flags, env vars, or call-site overrides that disable caching today.

The caching system was introduced as part of a single plan: [thoughts/shared/plans/2026-04-16-claude-prompt-caching-and-retry-helper.md](../plans/2026-04-16-claude-prompt-caching-and-retry-helper.md), which also unified retries and removed action-level retry blocks.

## Detailed Findings

### 1. Where cache_control is set

Two breakpoints, both inside `callClaudeTool`:

- **Tools breakpoint** ([src/lib/claude/client.ts:52-56](src/lib/claude/client.ts#L52-L56))
  ```ts
  const cachedTools: Anthropic.Tool[] = opts.tools.map((t, i) =>
    i === opts.tools.length - 1
      ? { ...t, cache_control: { type: 'ephemeral' } }
      : t,
  )
  ```
  Applied to the *last* tool in the array. When only one tool is passed (the common case), that single tool carries the breakpoint.

- **System-prompt breakpoint** ([src/lib/claude/client.ts:57-59](src/lib/claude/client.ts#L57-L59))
  ```ts
  const cachedSystem: Anthropic.TextBlockParam[] = [
    { type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } },
  ]
  ```
  The caller's `system: string` is promoted to a one-element `TextBlockParam` array with the breakpoint on its single block.

Both `cachedTools` and `cachedSystem` are then passed to `client.messages.create({ ..., system: cachedSystem, tools: cachedTools, ... })` ([client.ts:71-79](src/lib/claude/client.ts#L71-L79)).

The render order exploited is `tools → system → messages` (Anthropic caching documentation). With one breakpoint on the last tool and one on the system block, the entire stable prefix (tools + system) is cached; only `messages` (the volatile per-call user payload) is uncached.

### 2. Who calls `callClaudeTool`

All 11 files under `src/lib/claude/` that exist aside from the client itself. Every one inherits caching via the helper. Signatures and invocation parameters (no caller passes `cache_control` directly; none sets caching options):

| Module | Exported function | Model | maxTokens | thinking | toolChoice |
|---|---|---|---|---|---|
| [generate-discharge-note.ts:271](src/lib/claude/generate-discharge-note.ts#L271) | `generateDischargeNoteFromData` | `claude-opus-4-7` | 16384 | — | default |
| [generate-discharge-note.ts:316](src/lib/claude/generate-discharge-note.ts#L316) | `regenerateDischargeNoteSection` | `claude-opus-4-7` | 4096 | — | default |
| [generate-initial-visit.ts:481](src/lib/claude/generate-initial-visit.ts#L481) | `generateInitialVisitFromData` | `claude-opus-4-7` | 16384 | — | default |
| [generate-initial-visit.ts:533](src/lib/claude/generate-initial-visit.ts#L533) | `regenerateSection` | `claude-opus-4-7` | 4096 | — | default |
| [generate-procedure-note.ts:442](src/lib/claude/generate-procedure-note.ts#L442) | `generateProcedureNoteFromData` | `claude-opus-4-7` | 16384 | — | default |
| [generate-procedure-note.ts:487](src/lib/claude/generate-procedure-note.ts#L487) | `regenerateProcedureNoteSection` | `claude-opus-4-7` | 4096 | — | default |
| [generate-summary.ts:254](src/lib/claude/generate-summary.ts#L254) | `generateCaseSummaryFromData` | `claude-opus-4-6` | 16384 | `{ type: 'adaptive' }` | `{ type: 'auto' }` |
| [generate-clinical-orders.ts:90](src/lib/claude/generate-clinical-orders.ts#L90) | `generateImagingOrders` | `claude-sonnet-4-6` | 4096 | — | default |
| [generate-clinical-orders.ts:155](src/lib/claude/generate-clinical-orders.ts#L155) | `generateChiropracticOrder` | `claude-sonnet-4-6` | 4096 | — | default |
| [extract-mri.ts:82](src/lib/claude/extract-mri.ts#L82) | `extractMriFromPdf` | `claude-sonnet-4-6` | 4096 | — | default |
| [extract-pt.ts:296](src/lib/claude/extract-pt.ts#L296) | `extractPtFromPdf` | `claude-sonnet-4-6` | 4096 | — | default |
| [extract-pain-management.ts:161](src/lib/claude/extract-pain-management.ts#L161) | `extractPainManagementFromPdf` | `claude-sonnet-4-6` | 4096 | — | default |
| [extract-chiro.ts:175](src/lib/claude/extract-chiro.ts#L175) | `extractChiroFromPdf` | `claude-sonnet-4-6` | 4096 | — | default |
| [extract-orthopedic.ts:224](src/lib/claude/extract-orthopedic.ts#L224) | `extractOrthopedicFromPdf` | `claude-sonnet-4-6` | 4096 | — | default |
| [extract-ct-scan.ts:67](src/lib/claude/extract-ct-scan.ts#L67) | `extractCtScanFromPdf` | `claude-sonnet-4-6` | 4096 | — | default |

`default` in the `toolChoice` column means `callClaudeTool` defaults to `{ type: 'tool', name: opts.toolName }` ([client.ts:77](src/lib/claude/client.ts#L77)) when the caller omits it.

### 3. System-prompt and tools stability per module

Because caching on the ephemeral breakpoint is byte-exact prefix matching, the shape of each module's system prompt and tool definition determines whether the cache can be reused across calls. What exists today:

- **Module-level `const SYSTEM_PROMPT = '...'` strings**, identical across every call (no template interpolation):
  - [generate-discharge-note.ts:128](src/lib/claude/generate-discharge-note.ts#L128) — one ~5KB string.
  - [generate-procedure-note.ts:105](src/lib/claude/generate-procedure-note.ts#L105) — ~5.7KB.
  - [generate-summary.ts](src/lib/claude/generate-summary.ts) — ~4.2KB.
  - [extract-mri.ts](src/lib/claude/extract-mri.ts), [extract-pt.ts](src/lib/claude/extract-pt.ts), [extract-pain-management.ts](src/lib/claude/extract-pain-management.ts), [extract-chiro.ts](src/lib/claude/extract-chiro.ts), [extract-orthopedic.ts](src/lib/claude/extract-orthopedic.ts), [extract-ct-scan.ts](src/lib/claude/extract-ct-scan.ts), [generate-clinical-orders.ts](src/lib/claude/generate-clinical-orders.ts) — each has a module-level constant system prompt.

- **Per-call suffix appended** to the SYSTEM_PROMPT constant inside the `regenerate*Section` functions:
  - [generate-discharge-note.ts:326](src/lib/claude/generate-discharge-note.ts#L326) — `` `${SYSTEM_PROMPT}\n\nYou are regenerating ONLY the "${sectionLabel}" section of an existing Discharge Note. …` ``. Each of the 12 possible section labels produces a different full string, so the byte-exact prefix on `regenerateDischargeNoteSection` differs from `generateDischargeNoteFromData` and differs section-to-section.
  - [generate-initial-visit.ts:548](src/lib/claude/generate-initial-visit.ts#L548) and [generate-procedure-note.ts:497](src/lib/claude/generate-procedure-note.ts#L497) follow the same suffix pattern.

- **Dynamically built system prompt**:
  - [generate-initial-visit.ts:290-293](src/lib/claude/generate-initial-visit.ts#L290-L293) builds the prompt via `buildSystemPrompt(visitType)`, concatenating `buildPreamble(visitType) + buildCommonSections(visitType) + (INITIAL_VISIT_SECTIONS | PAIN_EVALUATION_VISIT_SECTIONS)`. Since `visitType` is one of two enum values, the output is one of two stable strings.

- **Tool schemas** are module-level `Anthropic.Tool` constants in every module. The `regenerate*Section` functions use a **different** tool object (`SECTION_REGEN_TOOL` with a single `content: string` field — [generate-discharge-note.ts:301-314](src/lib/claude/generate-discharge-note.ts#L301-L314), [generate-procedure-note.ts:472-485](src/lib/claude/generate-procedure-note.ts#L472-L485), [generate-initial-visit.ts:518-531](src/lib/claude/generate-initial-visit.ts#L518-L531)) than the full-generation tool, so the last-tool cache breakpoint content differs between the two call types.

### 4. How the shared client is structured

Full file: [src/lib/claude/client.ts](src/lib/claude/client.ts).

Key symbols:

- `anthropic` ([client.ts:7](src/lib/claude/client.ts#L7)) — single module-level `new Anthropic()` instance. The SDK reads `ANTHROPIC_API_KEY` from the environment. The SDK's own 429/5xx retry (`max_retries: 2`) is in play underneath this layer.
- `CallClaudeToolOptions<TOutput>` ([client.ts:11-24](src/lib/claude/client.ts#L11-L24)) — the options shape. Note `_client?` is a test-only hook to inject a stub.
- `callClaudeTool<TOutput>` ([client.ts:45-116](src/lib/claude/client.ts#L45-L116)) — the single entry point. It:
  1. Builds `cachedTools` and `cachedSystem` (the caching step, described above).
  2. Runs an outer Zod-retry loop (1 retry on Zod-failure — [client.ts:40](src/lib/claude/client.ts#L40)) and an inner API-retry loop (2 retries on retryable errors — [client.ts:41](src/lib/claude/client.ts#L41)) with full-jitter exponential backoff capped at 15s ([client.ts:42-43](src/lib/claude/client.ts#L42-L43), [client.ts:141-144](src/lib/claude/client.ts#L141-L144)).
  3. Extracts the first `tool_use` content block and runs the caller's `parse` function.
- `isRetryableApiError` ([client.ts:118-133](src/lib/claude/client.ts#L118-L133)) — classifies 429, 529, 5xx, and network errors (ECONNRESET/ETIMEDOUT/fetch failed/socket hang up) as retryable.
- `logUsage` ([client.ts:155-164](src/lib/claude/client.ts#L155-L164)) — emits one `[claude]` line per call with `{ model, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens }`. Documented comment at [client.ts:150-154](src/lib/claude/client.ts#L150-L154) notes this is the caching warm-up observability hook.

### 5. Test coverage of caching

One dedicated unit test at [src/lib/claude/__tests__/client.test.ts:44-59](src/lib/claude/__tests__/client.test.ts#L44-L59):

```ts
it('applies cache_control to the last tool and to the system text block', async () => {
  // ...
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

This is the only test that asserts on caching behavior. It uses the stub `_client` injection point and the `createMockAnthropic` helper from [src/test-utils/anthropic-mock.ts](src/test-utils/anthropic-mock.ts). The adjacent test at [client.test.ts:168-184](src/lib/claude/__tests__/client.test.ts#L168-L184) asserts that `cache_read_input_tokens` is read off the usage block and logged.

### 6. How discharge-note generation and per-section regeneration use the cached helper

The discharge-notes surface is the one the question is framed around. Its two server actions are in [src/actions/discharge-notes.ts](src/actions/discharge-notes.ts):

- **Full generation** — `generateDischargeNote(caseId)` at [discharge-notes.ts:340](src/actions/discharge-notes.ts#L340). After gathering source data and inserting a `status: 'generating'` row, it calls `generateDischargeNoteFromData(inputData)` once ([discharge-notes.ts:427](src/actions/discharge-notes.ts#L427)). The return value is treated as final; on `result.error` the row is flipped to `status: 'failed'` and the action returns. There is **no action-level retry** — the plan doc's Phase 3 removed it, and the current file shows a single call.

- **Per-section regeneration** — `regenerateDischargeNoteSectionAction(caseId, section)` at [discharge-notes.ts:655](src/actions/discharge-notes.ts#L655). Fetches the draft note, re-gathers source data with the note's existing `visit_date`, reads the current section content, and calls `regenerateDischargeNoteSection(inputData, section, currentContent)` once ([discharge-notes.ts:684](src/actions/discharge-notes.ts#L684)). On success, only the targeted section column is updated.

The UI trigger is in [src/components/discharge/discharge-note-editor.tsx](src/components/discharge/discharge-note-editor.tsx), which calls these actions via its imports at [discharge-note-editor.tsx:36-44](src/components/discharge/discharge-note-editor.tsx#L36-L44).

### 7. No alternate caching or feature flags

- Grepping for `cache_control|cacheControl|ephemeral` in the source returns three kinds of matches:
  - The three lines in [src/lib/claude/client.ts](src/lib/claude/client.ts) and their tests at [src/lib/claude/__tests__/client.test.ts](src/lib/claude/__tests__/client.test.ts).
  - `cacheControl: '3600'` in [src/lib/tus-upload.ts:31](src/lib/tus-upload.ts#L31) — this is **HTTP Cache-Control** for TUS file uploads to Supabase Storage and is unrelated to Claude prompt caching.
  - Planning/research documents under `thoughts/shared/` referencing the design.
- No `anthropic-beta` header, no `betas` option, no env var other than `ANTHROPIC_API_KEY` relates to caching.
- No caller passes an option to disable caching.

### 8. Origin of the current design

The caching design was introduced by [thoughts/shared/plans/2026-04-16-claude-prompt-caching-and-retry-helper.md](../plans/2026-04-16-claude-prompt-caching-and-retry-helper.md). Relevant excerpts that document intent (not critique):

- §1 "Current State" (pre-implementation) noted: "No prompt caching anywhere. Grep for `cache_control` across `src/lib/claude/**` and `src/actions/**` returns zero matches."
- §"Key Discoveries" noted: "Cache rendering order is `tools → system → messages`. One `cache_control` marker on the **last tool** caches `tools`; one on the **last system block** caches `tools + system`. That's all we need — two breakpoints, well under the 4-breakpoint limit."
- §"Follow-Up" point 4 noted the limitation of the per-section path: "Consider hoisting section-regeneration prompts so the stable base is cacheable (currently the per-section suffix invalidates the cache for `regenerateSection` / `regenerateDischargeNoteSection` / `regenerateProcedureNoteSection` calls)."

## Code References

- `src/lib/claude/client.ts:7` — shared `anthropic = new Anthropic()` singleton
- `src/lib/claude/client.ts:40-43` — retry/backoff constants
- `src/lib/claude/client.ts:45-116` — `callClaudeTool` body
- `src/lib/claude/client.ts:52-56` — cache_control on last tool
- `src/lib/claude/client.ts:57-59` — cache_control on system text block
- `src/lib/claude/client.ts:71-79` — `messages.create` call that receives `cachedSystem` / `cachedTools`
- `src/lib/claude/client.ts:150-164` — logging block reading `cache_creation_input_tokens` / `cache_read_input_tokens`
- `src/lib/claude/__tests__/client.test.ts:44-59` — the cache_control placement test
- `src/lib/claude/__tests__/client.test.ts:168-184` — logging test asserting `cache_read_input_tokens` is captured
- `src/lib/claude/generate-discharge-note.ts:128` — discharge `SYSTEM_PROMPT` constant
- `src/lib/claude/generate-discharge-note.ts:235-269` — `DISCHARGE_NOTE_TOOL` definition
- `src/lib/claude/generate-discharge-note.ts:278-296` — `generateDischargeNoteFromData` → `callClaudeTool`
- `src/lib/claude/generate-discharge-note.ts:301-314` — `SECTION_REGEN_TOOL` definition
- `src/lib/claude/generate-discharge-note.ts:322-341` — `regenerateDischargeNoteSection` → `callClaudeTool` with per-section system-prompt suffix
- `src/lib/claude/generate-initial-visit.ts:290-293` — `buildSystemPrompt(visitType)`
- `src/lib/claude/generate-procedure-note.ts:105` — procedure `SYSTEM_PROMPT` constant
- `src/lib/claude/generate-summary.ts:254-326` — summary generator, uses `thinking: adaptive` + `toolChoice: auto`
- `src/actions/discharge-notes.ts:427` — the single call site for full discharge-note generation
- `src/actions/discharge-notes.ts:684` — the single call site for per-section regeneration
- `src/test-utils/anthropic-mock.ts` — the mock factory used by `client.test.ts`

## Architecture Documentation

**Pattern**: one helper, `callClaudeTool`, owns every Claude tool-use request. Callers supply a plain `system: string` and a plain `Anthropic.Tool[]`; the helper transforms both into cacheable shapes before issuing the request. Callers are oblivious to caching.

**Breakpoint policy**: exactly two `cache_control: { type: 'ephemeral' }` markers per request — one on the last tool in the array, one on the system text block. No breakpoint is placed on any `messages` block, so the volatile per-call payload never enters the cache.

**Cache key stability**: cache matching is byte-exact over the rendered prefix (tools → system → messages render order). Module-level `const` system prompts and tool definitions give stable prefixes across calls with the same module + model. Per-section regeneration paths mix the stable base prompt with a per-section suffix, which produces a different prefix per section label.

**Observability**: every call emits one `console.info('[claude]', { model, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens })` line. The intended consumer is Vercel logs during the caching warm-up; structured logging is explicitly out of scope.

**Retry layering**:
- The Anthropic SDK's built-in retry (default 2 attempts on 429/5xx) runs under the helper.
- The helper adds an API-level retry loop (2 more attempts on retryable errors) with full-jitter exponential backoff (1s base, 15s cap).
- The helper adds an outer Zod-validation retry loop (1 retry when `parse()` returns `success: false`).
- Per the same plan, action-level retries were removed from all 10 previous call sites; the discharge-notes action now calls `generateDischargeNoteFromData` exactly once.

## Related Research

- [thoughts/shared/plans/2026-04-16-claude-prompt-caching-and-retry-helper.md](../plans/2026-04-16-claude-prompt-caching-and-retry-helper.md) — original design plan that introduced `callClaudeTool`, caching, and unified retries.
- [thoughts/shared/research/2026-04-16-architecture-improvement-recommendations.md](./2026-04-16-architecture-improvement-recommendations.md) §4 — the research doc that motivated the caching plan.
- [thoughts/shared/research/2026-03-06-epic-2-story-2.1-mri-report-extraction.md](./2026-03-06-epic-2-story-2.1-mri-report-extraction.md) — early reference to ephemeral caching for repeated PDF extractions.
- [thoughts/shared/plans/2026-04-18-procedure-note-medico-legal-editor-pass.md](../plans/2026-04-18-procedure-note-medico-legal-editor-pass.md) and [thoughts/shared/plans/2026-04-18-procedure-note-physical-exam-improvement-tone.md](../plans/2026-04-18-procedure-note-physical-exam-improvement-tone.md) — downstream plans touching `callClaudeTool` call sites.

## Open Questions

- **Scope of the observed "copy-paste effect"**: this research documents the current caching wiring but does not diagnose which note surfaces (discharge, initial visit, procedure, summary, per-section regenerate) exhibit the effect, or how it correlates with cache reads vs cache creations. A separate diagnostic pass would need to read Vercel `[claude]` log lines per surface against sample outputs.
- **Interaction with temperature/sampling**: none of the modules pass a `temperature` explicitly; the SDK default applies. Whether caching interacts with sampling determinism in the way experienced on the notes side is not documented anywhere in the codebase.
- **Section-regen cache behavior**: the per-section suffix in `regenerateDischargeNoteSection` (and the procedure/initial-visit equivalents) means each section label has its own cache key. Whether the effect is localized to section regens or also appears in fresh full-note generation is not documented here.