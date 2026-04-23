---
date: 2026-04-23T21:40:31Z
researcher: arsenaid
git_commit: 1088afc5e056853743cf45083d840640161c215f
branch: main
repository: cliniq
topic: "Best option to implement SSE with UI for streaming responses for note generation"
tags: [research, streaming, sse, claude, note-generation, ui, recommendation]
status: complete
last_updated: 2026-04-23
last_updated_by: arsenaid
---

# Research: SSE Streaming UI for Note Generation

**Date**: 2026-04-23T21:40:31Z
**Researcher**: arsenaid
**Git Commit**: 1088afc5e056853743cf45083d840640161c215f
**Branch**: main
**Repository**: cliniq

## Research Question

Recommend best option to implement SSE with UI for streaming responses for note generation.

## Summary

**Short version**: don't do generic token-level SSE for current note generators — architecture blocks it. Do **section-level progress SSE** instead (or stick with current polling, which the code already justifies).

**Why**: every note generator uses **forced tool_use** (`tool_choice: { type: 'tool', name: ... }`) to get Zod-validatable structured JSON. Tool-use input JSON only becomes parseable at `message_stop` — there is no mid-flight parseable payload to render. The Anthropic stream events (`input_json_delta`) emit partial JSON fragments that cannot be safely rendered to clinicians mid-flight (malformed, reorderable, no section boundaries). The codebase already calls `client.messages.stream(...).finalMessage()` server-side (commit `1088afc`) — streaming transport exists, but for timeout avoidance, not UX.

**Three viable options**, ranked:

1. **Keep polling + enrich it** (cheapest, ~0 new infra). Write section-level progress into the `procedure_notes` row as Claude emits `content_block_stop` events. UI polls → shows "6/20 sections done". **Recommended if goal is "provider sees progress".**
2. **SSE with progress events (no content)**. New `app/api/notes/[id]/stream/route.ts` returning `text/event-stream` with `{type: 'progress', sectionsDone: 6, total: 20}` frames. Frontend `EventSource`. Server relays `content_block_stop` events from the Anthropic stream. **Recommended if goal is "real-time feel, sub-second latency".**
3. **Full token streaming** — only viable for case summary (drop tool_use, use thinking + free-form text) or by fundamentally restructuring note generators (emit each section as a separate Claude call). High cost, clinical-safety regression risk (lose Zod validation on schema). **Not recommended.**

## Detailed Findings

### Current State: Note Generation Architecture

**No HTTP API routes.** Note generation runs entirely through Next.js Server Actions in `src/actions/`:
- `generateProcedureNote` — [src/actions/procedure-notes.ts:516](src/actions/procedure-notes.ts#L516)
- `generateInitialVisitNote` — [src/actions/initial-visit-notes.ts:444](src/actions/initial-visit-notes.ts#L444)
- `generateDischargeNote` — [src/actions/discharge-notes.ts](src/actions/discharge-notes.ts)
- `generateCaseSummary` — [src/actions/case-summaries.ts:155](src/actions/case-summaries.ts#L155)

**Server Action flow** (representative — procedure note):
1. Auth + prerequisite checks
2. ~12 parallel Supabase reads (`gatherProcedureNoteSourceData`)
3. Upsert `procedure_notes` row with `status = 'generating'` (via `acquireGenerationLock`)
4. Call `callClaudeTool` → `anthropic.messages.stream(...).finalMessage()`
5. On success: bulk-UPDATE all 20 section columns + `status = 'draft'`
6. On failure: `status = 'failed'` + `generation_error`
7. `revalidatePath(...)` → client-side `router.refresh()` sees new state

**Return value is `{ data: { id } }` or `{ error }`** — generated content is NOT in the return value. Client reads content from DB via polling.

### Shared Claude Wrapper

`callClaudeTool` at [src/lib/claude/client.ts:45](src/lib/claude/client.ts#L45):

```ts
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
```

- `.stream(...)` opens SSE to Anthropic. `.finalMessage()` awaits completion, returns reconstructed `Anthropic.Message`.
- Stream is **consumed server-side only**. Browser sees nothing until Server Action returns.
- Commit `1088afc` switched from `messages.create` to `.stream().finalMessage()` to avoid 10-minute server-timeout SDK rejection on large-max_tokens calls (case summary: `max_tokens: 24000` + `thinking.budget_tokens: 8000`).

### All Call Sites Use Forced Tool Use (Critical Constraint)

| Generator | max_tokens | thinking | tool_choice |
|---|---|---|---|
| Case Summary — [generate-summary.ts:297](src/lib/claude/generate-summary.ts#L297) | 24000 | `enabled, budget=8000` | `{ type: 'auto' }` |
| Procedure Note — [generate-procedure-note.ts:721](src/lib/claude/generate-procedure-note.ts#L721) | 16384 | none | forced: `generate_procedure_note` |
| Initial Visit — [generate-initial-visit.ts:586](src/lib/claude/generate-initial-visit.ts#L586) | 16384 | none | forced: `generate_initial_visit_note` |
| Discharge — [generate-discharge-note.ts:497](src/lib/claude/generate-discharge-note.ts#L497) | 16384 | none | forced: `generate_discharge_note` |
| Section regens | 4096 | none | forced tool |

**Why this matters for streaming**: forced tool_use means Claude's output is a single `tool_use` block whose `input` is a JSON object matching an Anthropic `input_schema`. When streamed, this emits `input_json_delta` events carrying **raw JSON fragment strings** — `"{\"chief_complaint\": \"Low back"` then `" pain, radiating"`, etc. These fragments:
- Cannot be JSON.parse'd until `message_stop` (last closing brace lands with the final delta).
- Arrive in the order Claude chose to emit fields, not the schema order.
- Section boundaries are visible only when a new top-level key starts — fragile to detect without a streaming JSON parser.

Anthropic SDK's `.stream()` provides `message.on('contentBlock', cb)` and `message.on('text', cb)` helpers, and the final reconstructed `input` is only reliable after `.finalMessage()`.

### Current UI Progress Surface

`<GeneratingProgress>` at [src/components/clinical/generating-progress.tsx:33](src/components/clinical/generating-progress.tsx#L33):
- Spinner + elapsed-seconds counter (capped at 180s)
- Four-phase text message based on elapsed time ("Starting generation…" → "Working through sections…" → "Still generating…" → "Taking longer than usual…")
- **Polls `router.refresh()` every 3000ms** — re-fetches server component tree, catches DB `status` transition

The component's docstring ([generating-progress.tsx:17-28](src/components/clinical/generating-progress.tsx#L17-L28)) explicitly documents the current team decision:

> **Why polling over SSE/streaming:**
> - Current generators use tool-use forcing for clinical-safety Zod validation. Tool-use output is inherently all-or-nothing at the model level — the `tool_use.input` JSON only becomes parseable at `message_stop`. Streaming offers no mid-flight payload to render.
> - Next.js server actions don't natively stream to client. True streaming requires route handlers + SSE/ReadableStream + partial-write durability — multi-session refactor with low net clinical benefit.

All three note editors use this same component (procedure/initial-visit/discharge). Case summary uses skeleton-only (no elapsed counter).

### Existing UI Branches in Editor Components

`ProcedureNoteEditor` at [src/components/procedures/procedure-note-editor.tsx:180](src/components/procedures/procedure-note-editor.tsx#L180) branches on `note.status`:
- `optimisticGenerating && status !== 'generating'` → optimistic skeleton (click → before DB write)
- `status === 'generating'` → DB-persisted generating (survives refresh via `startedAt = note.updated_at`)
- `status === 'draft'` + content → `<DraftEditor>` with 20 `<Textarea>` fields + react-hook-form
- `status === 'failed'` → error + retry
- `status === 'finalized'` → read-only `<FinalizedView>`

Display is **plain `<Textarea>`** — no rich text, no markdown render. `whitespace-pre-wrap` in finalized view.

### Dependency Landscape

`package.json`:
- `@anthropic-ai/sdk` — present. `.stream()` API supported.
- `react: 19.2.3`, `next: 16.1.6` — both support route handler streaming + RSC.
- **Not present**: `ai` (Vercel AI SDK), `@ai-sdk/react`, `@ai-sdk/anthropic`, `eventsource-parser`.
- `sonner` (toasts), `react-hook-form`, `zod`, `shadcn/ui` + Radix.

### What Streaming Transport Already Exists

- `src/lib/claude/client.ts` — server-side Anthropic stream consumption (for timeout avoidance).
- No `app/api/` routes using `ReadableStream`/`TransformStream`/`text/event-stream` for note generation. The earlier locator hit on `app/api/case-summary/route.ts` is **not present in current tree** (directory structure has no `app/api/*` for these flows — see locator output caveat below).
- No frontend `EventSource` or Vercel AI SDK hooks anywhere.

## Recommendation

Three options ordered cheapest → most invasive. Each with concrete design, files to touch, and tradeoffs.

### Option A — Section-Level Progress via Polling (Recommended default)

**Idea**: Claude emits `content_block_stop` events during streaming for each JSON key completion. Server-side, hook into the stream iterator and write progress into the `procedure_notes` row (new column `sections_done INT`, `sections_total INT`). UI keeps polling, shows `6 / 20 sections`.

**Why this is the right first move**:
- Zero new transport. Re-uses existing polling, DB, `router.refresh()` UI.
- Delivers the real UX win (provider sees progress, not just a spinner).
- No clinical-safety regression — Zod validation still runs on final assembled output.
- Works identically for all four note types.

**Implementation sketch**:
1. Migration: add `sections_done INT` + `sections_total INT` to `procedure_notes`, `initial_visit_notes`, `discharge_notes`. (`case_summaries` unchanged — single blob.)
2. In `callClaudeTool`, add optional `onSectionDone?: (keyName: string) => Promise<void>` callback. Instead of `.finalMessage()`, iterate:
   ```ts
   const stream = client.messages.stream({...})
   for await (const ev of stream) {
     if (ev.type === 'content_block_stop') opts.onSectionDone?.(/* extract key */)
   }
   const final = await stream.finalMessage()
   ```
   Note: `content_block_stop` fires once per top-level content block (usually one tool_use block total). For per-section progress, listen to `input_json_delta` events and count completed top-level JSON keys via a small streaming key-boundary detector, OR use the SDK's `partial_json` accumulator and diff keys between events.
3. Server action passes `onSectionDone` that updates a counter in Supabase. Throttle writes to ≥500ms to avoid DB thrash.
4. UI: show `{sectionsDone}/{sectionsTotal} sections drafted` in `<GeneratingProgress>`. Poll interval can stay at 3s — counter ticks up every ~3s is fine.

**Cost**: ~1 migration, ~30 LOC in `callClaudeTool`, ~10 LOC in each server action, ~5 LOC in `GeneratingProgress`. One PR.

**Risks**: JSON key-boundary detection across `input_json_delta` fragments is non-trivial. Safest: use the SDK's built-in `currentMessageSnapshot` / `partial_json` if available (check `@anthropic-ai/sdk` version) — it maintains the partial object for you.

### Option B — True SSE Endpoint (Progress Events Only)

**Idea**: New route handler `app/api/notes/[type]/[id]/generate-stream/route.ts` returns `text/event-stream`. Server action kicks off generation as today; UI opens `EventSource` to the stream endpoint, receives `progress` events, final `done` event triggers `router.refresh()`.

**When to pick this over A**: if polling latency (up to 3s) feels sluggish and you want sub-second "section just finished" updates. Also useful if you later want to pipe other signals (cost tokens consumed, thinking steps, retry notifications).

**Implementation sketch**:
1. Route handler returns `new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } })`.
2. Route handler subscribes to a server-side pub/sub keyed by `noteId`. Candidates:
   - **Postgres LISTEN/NOTIFY** via Supabase — cleanest on this stack. Server action publishes via `NOTIFY note_progress, '{id,sectionsDone}'` after each content_block_stop.
   - **In-process EventEmitter** — simplest but breaks across serverless regions/instances. Fine for Vercel if single region, not safe across cold starts.
   - **Supabase Realtime on the progress column** — subscribes UI directly, skipping your own SSE endpoint entirely. See Option B-prime below.
3. Frontend: replace `router.refresh()` poll in `<GeneratingProgress>` with `new EventSource('/api/notes/procedure/' + id + '/generate-stream')`. On `done` event, call `router.refresh()` once.

**Cost**: 1 new route, connection plumbing (Postgres LISTEN client), ~50 LOC UI changes, careful teardown on unmount/stale navigation. ~2-3 PRs.

**Risks**: Vercel function timeouts apply to the SSE route too (10 min max on Pro). Connection lifecycle bugs (stuck EventSource → leaks). Single-region assumption for in-process pub/sub.

#### Option B-prime — Use Supabase Realtime, skip your own SSE entirely

Since Supabase is already the DB and Option A already adds `sections_done`, **subscribe to it via Supabase Realtime in `<GeneratingProgress>`**:

```ts
supabase.channel('note-progress')
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'procedure_notes', filter: `id=eq.${noteId}` },
    (payload) => { setProgress(payload.new.sections_done) })
  .subscribe()
```

**This is arguably the best overall option**: no new API routes, no EventSource plumbing, real-time (sub-second), works across regions, and the server action remains plain. Upgrades Option A from polling to push with ~15 extra LOC.

### Option C — Full Token Streaming (Not recommended)

**Idea**: Render the note text token-by-token as it arrives (like ChatGPT UI).

**Blocked by current architecture**:
- Forced tool_use = no mid-flight renderable payload.
- To unblock: drop forced tool_use → use free-form text + post-hoc parsing. That loses the clinical-safety guarantee Zod provides on field-level structure (especially the 20-section procedure note). Regression risk on clinical data integrity is real — this is the reason tool_use was chosen.
- Alternative: restructure generators to make **N separate Claude calls, one per section**, each small and streamable. Roughly 20× cost, 20× latency serialized, or complex concurrency. Prompts lose cross-section coherence (the whole note as one model pass is why sections read consistently).

**Where it might fit**: the case summary (`tool_choice: auto` + thinking) could be re-architected to emit plain markdown and stream it. Low clinical-validation needs on that surface (it's a narrative summary). Small payoff though — it's the one generator whose UI currently has NO `GeneratingProgress` at all.

**Skip unless**: there's a product requirement for ChatGPT-style typewriter UX specifically.

## Final Recommendation

**Do Option A + Option B-prime together**:
1. Add `sections_done` / `sections_total` columns.
2. Wire the streaming iterator in `callClaudeTool` to update `sections_done` on each completed JSON key.
3. In `<GeneratingProgress>`, swap `router.refresh()` polling for a Supabase Realtime subscription on the note row; keep a 10-second fallback poll for safety (Realtime reconnection gaps).
4. Render `{sectionsDone}/{sectionsTotal}` inside the existing component.

One medium PR. Zero new API routes. No clinical-safety regression. Real-time progress. Provider sees actual work happening, not a timer.

If later you want token-level streaming on case summary specifically, it can be added as a separate opt-in flow (new route handler, restricted to that one generator, uses `@ai-sdk/anthropic` + `useChat` — isolated scope).

## Code References

- `src/lib/claude/client.ts:45-114` — `callClaudeTool` wrapper, uses `.stream().finalMessage()` at line 60
- `src/lib/claude/generate-procedure-note.ts:721` — procedure note Claude call (forced tool_use, max_tokens 16384)
- `src/lib/claude/generate-initial-visit.ts:586` — initial visit Claude call
- `src/lib/claude/generate-discharge-note.ts:497` — discharge Claude call
- `src/lib/claude/generate-summary.ts:297` — case summary (thinking + auto tool_choice)
- `src/actions/procedure-notes.ts:516-705` — `generateProcedureNote` server action end-to-end
- `src/components/clinical/generating-progress.tsx:1-92` — polling UI, has explicit "why not SSE" docstring
- `src/components/procedures/procedure-note-editor.tsx:180-386` — status-branching editor
- `src/lib/supabase/generation-lock.ts:23` — `STALE_GENERATION_MINUTES = 5` row-lock recovery
- `package.json` — `@anthropic-ai/sdk` present; no Vercel AI SDK

## Architecture Documentation

- **Server Actions only** — all mutations run in `'use server'` files under `src/actions/`. No `fetch`/tRPC/React Query. Re-render triggered by `revalidatePath`.
- **Streaming already used server-side** — commit `1088afc` replaced `messages.create` with `messages.stream().finalMessage()` for timeout avoidance, not UX.
- **Status column + polling** — notes carry `status ∈ {'generating','draft','failed','finalized'}`. UI polls every 3s via `router.refresh()`.
- **Forced tool_use for clinical safety** — four of five generators force a specific tool. Zod validates the tool input with one retry. `stop_reason === 'max_tokens'` returns a descriptive error early.
- **Row-level generation lock** — `acquireGenerationLock` prevents concurrent duplicate generation; 5-minute staleness threshold.
- **Shared tone hint** — `ToneDirectionCard` passes free-form directive to procedure/initial-visit/discharge generators (see `feedback_plan_commit_split` memory).

## Related Research

- `thoughts/shared/research/2026-04-16-architecture-improvement-recommendations.md` — broader architecture review (referenced by `client.ts` comment at line 151)
- `thoughts/shared/research/2026-04-19-prompt-caching-current-state.md` — companion Claude-integration research
- `thoughts/shared/research/2026-03-14-opus-vs-sonnet-report-generation.md` — model selection for generators

## Open Questions

1. What does `@anthropic-ai/sdk` version in use expose as the partial-JSON accumulator? (Affects Option A's key-boundary detection implementation ease.) Check `node_modules/@anthropic-ai/sdk/package.json`.
2. Is Supabase Realtime enabled on the `procedure_notes`/`initial_visit_notes`/`discharge_notes` tables? If not, needs a `ALTER PUBLICATION supabase_realtime ADD TABLE ...` migration for Option B-prime.
3. Vercel deployment region — single or multi? Determines whether in-process pub/sub is viable if someone prefers a raw SSE route over Realtime.
4. Product question: is there an explicit ask for ChatGPT-style typewriter UX, or is "see progress happening" sufficient? Answer determines whether Option C is ever on the table.
