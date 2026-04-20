---
date: 2026-04-20T09:05:25-0700
researcher: arsenaid
git_commit: 6ee7541b2556481f27f3ee379befa9ec1c1ac854
branch: main
repository: arsenaid-yere1/cliniq
topic: "Is AI chat isolated per notes session?"
tags: [research, codebase, ai, claude, notes, isolation, stateless]
status: complete
last_updated: 2026-04-20
last_updated_by: arsenaid
---

# Research: Is AI chat isolated per notes session?

**Date**: 2026-04-20T09:05:25-0700
**Researcher**: arsenaid
**Git Commit**: 6ee7541b2556481f27f3ee379befa9ec1c1ac854
**Branch**: main
**Repository**: arsenaid-yere1/cliniq

## Research Question
Check if AI chat is isolated per notes session.

## Summary

**There is no interactive AI chat in this codebase.** The premise of the question — "AI chat isolated per notes session" — does not map to an existing feature. What exists instead:

1. **No chat UI, no chat API route, no chat threads, no chat database tables.** Zero files matching chat/conversation/thread/message patterns.
2. **No "notes session" entity.** There are three note types (Initial Visit, Procedure, Discharge) and a `prp_procedure_encounter` table, but no generic "session" concept. The word `session` in source code refers only to Supabase auth sessions.
3. **The AI layer** (`src/lib/claude/`) is a set of **stateless, one-shot tool-use calls** against the Anthropic Messages API. Each call builds a fresh single-element `messages` array, invokes `anthropic.messages.create`, extracts the tool-use output, Zod-validates it, and stores the result on the corresponding note row. No conversation state persists between calls.

So re-framed: **each note record has its own independent AI generation**. There is no shared conversation thread between notes, and no multi-turn memory within a single note — isolation is structural (no shared state ever exists) rather than enforced.

## Detailed Findings

### No Chat Feature Exists

A full-codebase search for chat components, `/api/chat`, `/api/ai`, message/thread/conversation tables, and chat state stores returned zero matches. The codebase is a clinical documentation app that uses Claude for document generation and extraction, not for conversational interaction.

### AI Invocation Layer (`src/lib/claude/`)

Singleton Anthropic client, server-only:
- [src/lib/claude/client.ts:2](src/lib/claude/client.ts#L2) — `import Anthropic from '@anthropic-ai/sdk'`
- [src/lib/claude/client.ts:7](src/lib/claude/client.ts#L7) — `export const anthropic = new Anthropic()` (singleton, reads `ANTHROPIC_API_KEY` from env)
- [src/lib/claude/client.ts:45](src/lib/claude/client.ts#L45) — shared `callClaudeTool<TOutput>()` helper used by every generator. Retry logic: up to 2 Zod-validation attempts, up to 3 API attempts with exponential backoff (cap 15s). Token usage logged to console on success.

### Generator Functions (All Stateless, Single-Turn)

Every generator passes a single-element `messages` array — `[{ role: 'user', content: ... }]` — to `callClaudeTool`. No prior turns, no thread id, no history.

Initial visit:
- [src/lib/claude/generate-initial-visit.ts:481](src/lib/claude/generate-initial-visit.ts#L481) — `generateInitialVisitFromData()`: builds system prompt + one user message containing `JSON.stringify(inputData)`, forced tool use `generate_initial_visit_note`, model `claude-opus-4-7`, `maxTokens: 16384`.
- [src/lib/claude/generate-initial-visit.ts:506](src/lib/claude/generate-initial-visit.ts#L506) — single-element messages array.
- [src/lib/claude/generate-initial-visit.ts:533](src/lib/claude/generate-initial-visit.ts#L533) — `regenerateSection()`: also one-shot, `maxTokens: 4096`.

Procedure note:
- [src/lib/claude/generate-procedure-note.ts:457](src/lib/claude/generate-procedure-note.ts#L457) — `generateProcedureNoteFromData()`: same pattern.
- [src/lib/claude/generate-procedure-note.ts:476](src/lib/claude/generate-procedure-note.ts#L476) — single-element messages array.
- [src/lib/claude/generate-procedure-note.ts:503](src/lib/claude/generate-procedure-note.ts#L503) — `regenerateProcedureNoteSection()`: one-shot section regeneration.

Discharge note, clinical orders, summaries, pain-tone, and all extraction functions (`extract-mri`, `extract-chiro`, `extract-ct-scan`, `extract-orthopedic`, `extract-pain-management`, `extract-pt`) follow the same single-turn pattern via `callClaudeTool`.

### Server Action Call Flow

Example: initial visit generation ([src/actions/initial-visit-notes.ts:244](src/actions/initial-visit-notes.ts#L244) — `generateInitialVisitNote`):

1. Auth check, case-closed guard, auto-advance status.
2. Find or create `initial_visit_notes` row keyed by `(case_id, visit_type)`.
3. `gatherSourceData()` at [src/actions/initial-visit-notes.ts:59](src/actions/initial-visit-notes.ts#L59) fires ~9 parallel Supabase queries to assemble `InitialVisitInputData` (patient, case, summary, settings, vitals, fees, provider intake, prior finalized visit for `pain_evaluation_visit`, MRI/CT counts). **No AI history is fetched.**
4. SHA-256 hash of `inputData` stored on row for drift detection.
5. Call `generateInitialVisitFromData(inputData, visitType, toneHint)` — one HTTP request.
6. On success, 16 generated section fields + `ai_model = 'claude-opus-4-7'` + `raw_ai_response` written back. Status → `'draft'`.

`raw_ai_response` is stored for auditing ([src/actions/initial-visit-notes.ts:387](src/actions/initial-visit-notes.ts#L387)) but is **never read back and fed into a subsequent API call**.

### How "Context" Flows Between Notes

Prior-visit context for follow-up visits is passed as **structured data embedded in the user message**, not as replayed conversation turns ([src/actions/initial-visit-notes.ts:169-184](src/actions/initial-visit-notes.ts#L169-L184)). The finalized prior note's section text fields (e.g., `treatment_plan`, `physical_exam`) are serialized into the `priorVisitData` key inside `inputData` for the next one-shot call.

### Note Storage Model

Three separate tables, each holding one note per case (or per procedure encounter):
- `initial_visit_notes` ([supabase/migrations/010_initial_visit_notes.sql](supabase/migrations/010_initial_visit_notes.sql))
- `procedure_notes` ([supabase/migrations/015_procedure_notes.sql](supabase/migrations/015_procedure_notes.sql))
- `discharge_notes` ([supabase/migrations/016_discharge_notes.sql](supabase/migrations/016_discharge_notes.sql))

Procedure encounter (closest thing to a "session") lives in:
- [supabase/migrations/013_prp_procedure_encounter.sql](supabase/migrations/013_prp_procedure_encounter.sql)

No `conversations`, `threads`, `chat_messages`, `thread_id`, `session_id`, or `conversation_id` columns exist anywhere.

## Code References

- `src/lib/claude/client.ts:7` — singleton Anthropic client
- `src/lib/claude/client.ts:45` — `callClaudeTool` helper with retry logic
- `src/lib/claude/generate-initial-visit.ts:481` — initial visit generator entrypoint
- `src/lib/claude/generate-initial-visit.ts:506` — single-element `messages` array
- `src/lib/claude/generate-procedure-note.ts:457` — procedure note generator entrypoint
- `src/lib/claude/generate-procedure-note.ts:476` — single-element `messages` array
- `src/actions/initial-visit-notes.ts:59` — `gatherSourceData` (assembles input data)
- `src/actions/initial-visit-notes.ts:244` — `generateInitialVisitNote` server action
- `src/actions/initial-visit-notes.ts:387` — `raw_ai_response` write (audit-only, not replayed)

## Architecture Documentation

Current AI pattern in the codebase:

```
Server Action
  → gatherSourceData()          reads ~9 Supabase tables, assembles InputData object
  → generator(inputData)        src/lib/claude/generate-*.ts
      → buildSystemPrompt()     static string construction
      → messages: [{ role: 'user', content: JSON.stringify(inputData) }]
      → callClaudeTool()        src/lib/claude/client.ts
          → anthropic.messages.create(...)   single HTTP call, tool_choice forced
          → extract tool_use block
          → Zod validate
      → returns { data, raw }
  → supabase.update(...)        stores generated sections + raw_ai_response on note row
```

Properties:
- **Stateless per call.** No conversation persisted.
- **Tool-use forced.** Every call uses `tool_choice: { type: 'tool', name: '...' }` with a Zod-validated schema.
- **Auditable.** `raw_ai_response` column stores the tool input for review, but is never re-sent.
- **Context is data, not dialogue.** Prior notes influence new notes by being serialized into the next one-shot user message via structured fields like `priorVisitData`.

## Related Research

- [thoughts/shared/research/2026-03-09-epic-3-story-3.1-initial-visit-note-design.md](thoughts/shared/research/2026-03-09-epic-3-story-3.1-initial-visit-note-design.md)
- [thoughts/shared/research/2026-04-18-procedure-note-pain-persistence-tone.md](thoughts/shared/research/2026-04-18-procedure-note-pain-persistence-tone.md)
- [thoughts/shared/research/2026-04-19-tone-direction-for-procedure-and-discharge-notes.md](thoughts/shared/research/2026-04-19-tone-direction-for-procedure-and-discharge-notes.md)

## Open Questions

- If the user meant a *planned* (not yet built) AI chat feature: no design document was found in `thoughts/` for it. Would need clarification on the intended scope.
- If the user meant the existing note generators: isolation is structural — each note row holds its own independent generation result, and generators receive only the data explicitly gathered for that note. There is no cross-contamination vector because there is no shared AI state to contaminate.
