---
date: 2026-04-20T22:35:40Z
researcher: arsenaid
git_commit: 1cdcc3c03fadcccbf1a3bd5ba52be03d124926f6
branch: main
repository: cliniq
topic: "Why UI streaming doesn't refresh page immediately"
tags: [research, codebase, generating-progress, server-actions, router-refresh, polling]
status: complete
last_updated: 2026-04-20
last_updated_by: arsenaid
---

# Research: Why UI streaming doesn't refresh page immediately

**Date**: 2026-04-20T22:35:40Z
**Researcher**: arsenaid
**Git Commit**: 1cdcc3c03fadcccbf1a3bd5ba52be03d124926f6
**Branch**: main
**Repository**: cliniq

## Research Question

Check why UI streaming doesn't refresh page immediately.

## Summary

The app has **no true streaming**. Clinical note generation runs as a **synchronous Next.js Server Action** wrapped in a client `startTransition`. Inside the action, `status = 'generating'` is set, then the Claude call blocks until completion, then fields + `status = 'draft'` are written in one atomic UPDATE, then `revalidatePath` is called and the action returns.

The `GeneratingProgress` component is the only surface that "streams" — it polls `router.refresh()` every 3 seconds while `note.status === 'generating'`. The conditional that mounts it reads `note.status` from the server component tree — a value that is **frozen at page render time**.

Consequence: during the normal click-Generate flow, `GeneratingProgress` **never mounts**, because the client already holds a stale `note.status` (usually `'draft'` or `null`) and the server action does not return control — and therefore does not trigger a React re-render with fresh props — until Claude has finished. The polling loop only engages when the page is loaded (or externally refreshed) *while* a row already sits in `status = 'generating'` — e.g., a second browser tab, a hard refresh mid-generation, or a page revisit after a browser crash. For single-tab, click-then-wait usage, the "refresh" the user sees after generation is the single re-render triggered by the `startTransition` resolving — not by any polling.

Additionally, Supabase SDK queries bypass Next.js's fetch cache entirely (the SSR client does not go through `fetch()` with `cache`/`next.revalidate` options), so `revalidatePath` has no cached entry to invalidate for note queries. Fresh data is produced by each server component re-render regardless.

## Detailed Findings

### 1. `GeneratingProgress` component — the only polling surface

[src/components/clinical/generating-progress.tsx](src/components/clinical/generating-progress.tsx)

- Client component. Mounts with `pollIntervalMs` (default 3000ms) and `startedAt` (ISO string of the note row's `updated_at` when status became `'generating'`).
- In a single `useEffect` ([generating-progress.tsx:47-65](src/components/clinical/generating-progress.tsx#L47-L65)):
  - `tick` `setInterval` every 1000ms updates displayed elapsed seconds.
  - `poll` `setInterval` every `pollIntervalMs` calls `router.refresh()`.
- In-file docstring ([generating-progress.tsx:17-28](src/components/clinical/generating-progress.tsx#L17-L28)) explicitly states the choice of polling over SSE/streaming: tool-use forcing means Claude's JSON only becomes parseable at `message_stop`, so streaming offers no mid-flight payload.
- No unmount logic other than `clearInterval` cleanup — the component keeps polling until its parent stops rendering it (i.e., until `note.status !== 'generating'`).

### 2. Mount conditionals in editors

All three editor components gate `GeneratingProgress` behind `note.status === 'generating'`:

- [initial-visit-editor.tsx:437-455](src/components/clinical/initial-visit-editor.tsx#L437-L455) — `<GeneratingProgress startedAt={note.updated_at ?? null} />`
- [procedure-note-editor.tsx:238-256](src/components/procedures/procedure-note-editor.tsx#L238-L256) — same shape
- [discharge-note-editor.tsx:243-261](src/components/discharge/discharge-note-editor.tsx#L243-L261) — same shape

`note` is a prop arriving from the server component page. Its value is whatever the server fetched on the most recent server render.

### 3. Server actions run synchronously; client is blocked by `startTransition`

Primary action: [src/actions/initial-visit-notes.ts:273](src/actions/initial-visit-notes.ts#L273) (`generateInitialVisitNote`).

Sequence inside action:
1. Auth + closed-case checks.
2. `acquireGenerationLock(supabase, 'initial_visit_notes', id, user.id)` ([initial-visit-notes.ts:312-315](src/actions/initial-visit-notes.ts#L312-L315)) — writes `status = 'generating'` via conditional UPDATE.
3. Stale narrative fields cleared ([initial-visit-notes.ts:320-344](src/actions/initial-visit-notes.ts#L320-L344)).
4. `await generateInitialVisitFromData(...)` ([initial-visit-notes.ts:385](src/actions/initial-visit-notes.ts#L385)) — Claude call blocks 30–90s.
5. On success: single UPDATE writes all fields + `status = 'draft'` atomically ([initial-visit-notes.ts:405-429](src/actions/initial-visit-notes.ts#L405-L429)).
6. `revalidatePath(`/patients/${caseId}`)` ([initial-visit-notes.ts:431](src/actions/initial-visit-notes.ts#L431)).
7. Action returns `{ data: { id } }` to client.

No `waitUntil`, no background worker, no streaming. There is **no `revalidatePath` call between the lock acquisition (step 2) and the Claude return (step 5)**. So during the window where the DB row is in `'generating'`, the server action has not issued any revalidation signal.

Procedure and discharge follow the same synchronous pattern:
- [src/actions/procedure-notes.ts:436](src/actions/procedure-notes.ts#L436) (lock at line 486, Claude call at line 566, success `revalidatePath` at line 617).
- [src/actions/discharge-notes.ts:420](src/actions/discharge-notes.ts#L420) — uses soft-delete + re-insert instead of `acquireGenerationLock` ([discharge-notes.ts:453-527](src/actions/discharge-notes.ts#L453-L527)); Claude call at line 538; success `revalidatePath` at line 581.

### 4. Why `GeneratingProgress` typically never mounts in the normal flow

The editor prop `note.status` is derived from a server component fetch. Between page load and the next server component re-render, the client only sees one value of `note.status`.

Normal single-tab flow:
- Page loads with `note.status === 'draft'` (or `null`).
- Provider clicks Generate. `startTransition` wraps the server action call ([initial-visit-editor.tsx:420](src/components/clinical/initial-visit-editor.tsx#L420)); `isPending` becomes `true`.
- Server action begins executing and sets `status = 'generating'` in the DB — **but the client has no mechanism here to observe that DB change**. No re-fetch, no realtime subscription.
- Server action blocks in Claude for 30–90s. Client is stuck in `isPending`, holding the old `note.status` prop.
- Server action completes, writes `status = 'draft'`, calls `revalidatePath`, returns.
- React unwinds the transition. Next.js, because `revalidatePath` was called, re-fetches the RSC payload as part of the transition resolution. The editor re-renders with fresh `note.status === 'draft'` and the finished note.
- `note.status` goes `draft` → (DB: generating) → `draft`. The `'generating'` branch of the editor is never rendered on the client, so `GeneratingProgress` never mounts.

Cases where `GeneratingProgress` **does** mount:
- Second tab loads page mid-generation — server fetch returns `status = 'generating'`, editor enters the generating branch, polling begins.
- Hard browser refresh mid-generation — same as above.
- User navigates away and back during generation.
- Programmatic `router.refresh()` from some other surface while the row is in flight.

In all mounting cases, `startedAt = note.updated_at` (the timestamp from the lock acquisition), and the `tick` counter picks up real elapsed seconds rather than restarting at 0 ([generating-progress.tsx:47-56](src/components/clinical/generating-progress.tsx#L47-L56)).

### 5. Page-level data fetching

All three generation pages are standard server components with no cache directives (no `force-dynamic`, no `revalidate = 0`, no `noStore`):

- [src/app/(dashboard)/patients/[caseId]/initial-visit/page.tsx](src/app/(dashboard)/patients/[caseId]/initial-visit/page.tsx) — calls `getInitialVisitNotes(caseId)` ([initial-visit-notes.ts:457-472](src/actions/initial-visit-notes.ts#L457-L472)) in a `Promise.all` at line 45; passes `notesByVisitType` to the editor at line 138.
- [src/app/(dashboard)/patients/[caseId]/discharge/page.tsx](src/app/(dashboard)/patients/[caseId]/discharge/page.tsx) — `getDischargeNote(caseId)` at line 32; passes `note` at line 144.
- [src/app/(dashboard)/patients/[caseId]/procedures/[procedureId]/note/page.tsx](src/app/(dashboard)/patients/[caseId]/procedures/[procedureId]/note/page.tsx) — `getProcedureNote(procedureId)` at line 36; passes `note` at line 122.

### 6. Supabase SSR client bypasses Next.js fetch cache

[src/lib/supabase/server.ts:4-28](src/lib/supabase/server.ts#L4-L28) constructs `createServerClient` from `@supabase/ssr`. The Supabase JS SDK uses its own HTTP layer — it does **not** wrap Next.js's `fetch()` with `cache: 'force-cache'` or `next: { revalidate }` options.

Implication: there is no Next.js fetch cache entry for note queries, so `revalidatePath` has no cache entry to invalidate. Each server component render (whether triggered by navigation, `router.refresh()`, or a transition resolution) issues a fresh HTTP request to Supabase. The `revalidatePath` calls in the server actions exist to mark the route tree stale for the Next.js router cache — which is what causes the client to accept new RSC payload on the next transition/navigation.

### 7. Generation lock transitions status only in one direction

[src/lib/supabase/generation-lock.ts](src/lib/supabase/generation-lock.ts) only writes `status = 'generating'`:
- Primary attempt: UPDATE … `status = 'generating'` WHERE `status IN ('draft','failed')` ([generation-lock.ts:51-57](src/lib/supabase/generation-lock.ts#L51-L57)).
- Stale recovery: UPDATE … `status = 'generating'` WHERE `status = 'generating' AND updated_at < now() - 5 min` ([generation-lock.ts:70-77](src/lib/supabase/generation-lock.ts#L70-L77)).

Transition back to `'draft'` or `'failed'` is performed by the calling action's own UPDATE, alongside the note fields, in one atomic write. There is no separate release call.

### 8. `router.refresh()` behavior

`router.refresh()` is called only from `GeneratingProgress` ([generating-progress.tsx:59](src/components/clinical/generating-progress.tsx#L59)). In App Router, `router.refresh()` re-fetches the current route's RSC payload and reconciles it into the existing client tree without a full browser navigation. Because note queries bypass Next.js's fetch cache, every refresh issues fresh Supabase HTTP requests regardless of the `revalidatePath` state.

### 9. No Supabase realtime, no SWR, no React Query

The codebase contains zero uses of `.channel()`, `.subscribe()`, or `postgres_changes`. No SWR or React Query. The only mechanism that can cause a cross-action DB change to appear in the UI is `router.refresh()` — which only runs inside `GeneratingProgress`.

## Code References

- [src/components/clinical/generating-progress.tsx:47-65](src/components/clinical/generating-progress.tsx#L47-L65) — polling `useEffect` (tick + poll intervals)
- [src/components/clinical/generating-progress.tsx:59](src/components/clinical/generating-progress.tsx#L59) — the single `router.refresh()` driving streaming UX
- [src/components/clinical/initial-visit-editor.tsx:437-455](src/components/clinical/initial-visit-editor.tsx#L437-L455) — mount gate for `GeneratingProgress`
- [src/components/clinical/initial-visit-editor.tsx:420](src/components/clinical/initial-visit-editor.tsx#L420) — `startTransition` wrapping the generate call
- [src/components/procedures/procedure-note-editor.tsx:238-256](src/components/procedures/procedure-note-editor.tsx#L238-L256) — mount gate (procedure)
- [src/components/discharge/discharge-note-editor.tsx:243-261](src/components/discharge/discharge-note-editor.tsx#L243-L261) — mount gate (discharge)
- [src/actions/initial-visit-notes.ts:273](src/actions/initial-visit-notes.ts#L273) — `generateInitialVisitNote` server action entry
- [src/actions/initial-visit-notes.ts:385](src/actions/initial-visit-notes.ts#L385) — blocking `await generateInitialVisitFromData(...)`
- [src/actions/initial-visit-notes.ts:405-431](src/actions/initial-visit-notes.ts#L405-L431) — success UPDATE (status=draft) + `revalidatePath`
- [src/actions/procedure-notes.ts:436](src/actions/procedure-notes.ts#L436), [:566](src/actions/procedure-notes.ts#L566), [:617](src/actions/procedure-notes.ts#L617) — procedure generate flow
- [src/actions/discharge-notes.ts:420](src/actions/discharge-notes.ts#L420), [:538](src/actions/discharge-notes.ts#L538), [:581](src/actions/discharge-notes.ts#L581) — discharge generate flow
- [src/lib/supabase/generation-lock.ts:42-92](src/lib/supabase/generation-lock.ts#L42-L92) — lock acquisition (primary + stale recovery)
- [src/lib/supabase/server.ts:4-28](src/lib/supabase/server.ts#L4-L28) — `@supabase/ssr` client (bypasses Next.js fetch cache)
- [src/app/(dashboard)/patients/[caseId]/initial-visit/page.tsx](src/app/(dashboard)/patients/[caseId]/initial-visit/page.tsx) — no cache directives
- [src/app/(dashboard)/patients/[caseId]/discharge/page.tsx](src/app/(dashboard)/patients/[caseId]/discharge/page.tsx) — no cache directives
- [src/app/(dashboard)/patients/[caseId]/procedures/[procedureId]/note/page.tsx](src/app/(dashboard)/patients/[caseId]/procedures/[procedureId]/note/page.tsx) — no cache directives

## Architecture Documentation

- Generation is synchronous server-action driven (not queued, not streamed, not websocketed).
- Lock acquisition is atomic via conditional UPDATE, with a 5-minute stale-recovery window.
- Status transitions (`draft`/`failed` → `generating`) happen in the lock util; reverse transitions happen in the calling action's own UPDATE, atomically with the note payload.
- Client awareness of in-flight generation relies on two independent mechanisms:
  1. **`startTransition` pending state** — covers the single-tab click-and-wait case; no poll needed because the transition resolution carries fresh RSC.
  2. **`GeneratingProgress` + `router.refresh()` poll** — covers the cross-tab / hard-refresh / navigation cases; engages only when a server render already observed `status = 'generating'`.
- Supabase queries bypass Next.js fetch cache; `revalidatePath` is effective for the router cache only, which is what makes transition-resolution re-renders pick up new RSC.
- No Supabase realtime, SWR, or React Query.

## Related Research

- [2026-04-14-generation-lock-design.md](thoughts/shared/research/2026-04-14-generation-lock-design.md) — if exists, prior art on the locking mechanism (check dir).
- Recent commits: `1cdcc3c` (GeneratingProgress with elapsed timer + status polling), `c88d7db` (concurrent generation lock with stale recovery).

## Open Questions

- None posed by the research prompt. The user asked "why doesn't it refresh immediately" — the mechanism is documented above. Any follow-up (e.g., whether to add realtime, SSE, or optimistic UI) would be a recommendation, which is out of scope for this document.
