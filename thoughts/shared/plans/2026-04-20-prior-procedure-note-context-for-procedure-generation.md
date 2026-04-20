# Prior Procedure Note Context for Procedure-Note Generation — Implementation Plan

## Overview

Pass narrative text from prior finalized `procedure_notes` rows (same case, chronologically earlier) into the procedure-note AI generation input, so Claude can maintain clinical continuity across a procedure series instead of re-deriving assessment from raw vitals alone. Currently `gatherProcedureNoteSourceData` reads only `{ procedure_date, procedure_number, pain_score_min, pain_score_max }` from prior procedures ([src/actions/procedure-notes.ts:89-95](src/actions/procedure-notes.ts#L89-L95)) — the generated note bodies are never read back into any subsequent call.

## Current State Analysis

- `procedure_notes` has 20 narrative text columns (see [thoughts/shared/research/2026-04-20-ai-chat-isolation-per-notes-session.md](../research/2026-04-20-ai-chat-isolation-per-notes-session.md) for the full list). After generation, status transitions `generating → draft → finalized`.
- `gatherProcedureNoteSourceData` currently assembles `ProcedureNoteInputData` from 9 parallel queries ([src/actions/procedure-notes.ts:30-266](src/actions/procedure-notes.ts#L30-L266)). The `priorProcedures` array carries only pain scores.
- `paintoneLabel` uses `priorProcedureRows[0]` as the series baseline ([src/actions/procedure-notes.ts:220-225](src/actions/procedure-notes.ts#L220-L225)). That aggregate label is the only signal Claude currently sees about prior sessions beyond pain numbers.
- Generator: [src/lib/claude/generate-procedure-note.ts:457](src/lib/claude/generate-procedure-note.ts#L457) — takes `ProcedureNoteInputData` and `toneHint`, serializes as JSON in user message.
- `ProcedureNoteInputData` shape declared at [src/lib/claude/generate-procedure-note.ts:16-103](src/lib/claude/generate-procedure-note.ts#L16-L103).
- System prompt at [src/lib/claude/generate-procedure-note.ts:105-403](src/lib/claude/generate-procedure-note.ts#L105-L403) is static.

### Key Discoveries

- `procedure_notes` table already has `status` enum with `'finalized'` state — filter for safety (only reference clinician-approved content).
- Prior `procedure_notes` rows can be joined to `procedures` rows via `procedure_id` to associate narrative with session number and date.
- Section regeneration path ([src/lib/claude/generate-procedure-note.ts:503](src/lib/claude/generate-procedure-note.ts#L503)) also accepts `inputData` — same field addition lights it up automatically.
- Procedure-note tests live at `src/lib/claude/__tests__/generate-procedure-note.test.ts` + `src/actions/__tests__/` (to confirm — filename may differ).

## Desired End State

After this plan:

1. `ProcedureNoteInputData` has a new `priorProcedureNotes` field: an array of `{ procedure_date, procedure_number, sections: { subjective, assessment_summary, procedure_injection, assessment_and_plan, prognosis } }`.
2. `gatherProcedureNoteSourceData` issues one additional Supabase query selecting these five fields from finalized `procedure_notes` rows for the same case, excluding the current procedure, ordered ascending.
3. The system prompt gains a "Prior Procedure Notes Context" block instructing Claude to: (a) maintain consistency with prior clinical reasoning (diagnoses, treatment plan trajectory), (b) not copy verbatim — describe evolution, (c) treat prior narrative as context only, never as source of truth for current-session facts.
4. Section regeneration sees the same field.
5. Zero impact on initial visit or discharge pathways.
6. Unit test covers the new gather query and the generator field passthrough.

**Verification**: In a manual test case with 3 finalized prior procedure notes, the 4th generation's `subjective` and `assessment_and_plan` sections reference trajectory (e.g., "since injection 2, patient reports …") rather than describing current session in isolation.

## What We're NOT Doing

- Not passing all 20 section columns — too noisy, most sections are procedural boilerplate. Picking the 5 that carry genuine clinical reasoning.
- Not changing the pain tone computation (separate plan).
- Not de-duplicating pain-score data between `priorProcedures` (numbers) and `priorProcedureNotes` (text) — they serve different purposes in prompt.
- Not filtering on `deleted_at` for `procedure_notes` beyond what the existing queries do (current pattern: `.is('deleted_at', null)`).
- Not changing discharge note, initial visit note, or case summary generation.
- Not adding a UI toggle to include/exclude prior context — always on.
- Not adding token-budget guards. Five sections × N prior procedures is bounded; typical case has 1–6 procedures.

## Implementation Approach

Three phases, sequential: AI generator type + prompt (Phase 1), server action gatherer (Phase 2), tests + manual verification (Phase 3). No DB migration needed — reading existing columns.

---

## Phase 1: Extend Generator Input Type and System Prompt

### Changes Required

#### 1. Add `priorProcedureNotes` field to input type

**File**: `src/lib/claude/generate-procedure-note.ts`
**Changes**: Extend `ProcedureNoteInputData` interface near line 16.

Add field:

```ts
priorProcedureNotes: Array<{
  procedure_date: string
  procedure_number: number
  sections: {
    subjective: string | null
    assessment_summary: string | null
    procedure_injection: string | null
    assessment_and_plan: string | null
    prognosis: string | null
  }
}>
```

#### 2. Add system-prompt block

**File**: `src/lib/claude/generate-procedure-note.ts`
**Changes**: Inside `SYSTEM_PROMPT` (around line 105-403), add a dedicated section:

```
## Prior Procedure Notes Context

You may be given a `priorProcedureNotes` array containing narrative excerpts from this patient's earlier finalized procedure notes (same case, chronological). Use this context to:

1. Maintain clinical continuity — diagnoses, treatment plan trajectory, and clinical reasoning should evolve coherently across the series, not restart each session.
2. Reference trajectory explicitly where appropriate (e.g., "Following the second PRP injection, patient reports …").
3. Never copy prior narrative verbatim. Paraphrase and advance the story.
4. Treat prior narrative as interpretive context only. Facts about THIS session (vitals, procedure record, PRP prep) always come from `vitalSigns` and `procedureRecord` — never from prior notes.
5. If `priorProcedureNotes` is empty, treat current session as first in the series.

Apply this context primarily to: `subjective`, `assessment_summary`, `assessment_and_plan`, `prognosis`. Procedural sections (`procedure_preparation` through `procedure_followup`) should remain session-specific.
```

### Success Criteria

#### Automated Verification
- [ ] Type check passes: `npx tsc --noEmit`
- [ ] Lint passes: `npm run lint`
- [ ] Unit tests pass: `npm test -- generate-procedure-note`

#### Manual Verification
- [ ] Generator accepts `priorProcedureNotes: []` without error.
- [ ] Generator accepts a populated array without error.

---

## Phase 2: Gatherer Query and Mapping

### Changes Required

#### 1. Add one Supabase query to `gatherProcedureNoteSourceData`

**File**: `src/actions/procedure-notes.ts`
**Changes**: Add a 10th query inside the `Promise.all` block at line 45:

```ts
supabase
  .from('procedure_notes')
  .select(`
    procedure_id,
    subjective,
    assessment_summary,
    procedure_injection,
    assessment_and_plan,
    prognosis,
    procedures!inner(procedure_date, procedure_number)
  `)
  .eq('case_id', caseId)
  .eq('status', 'finalized')
  .neq('procedure_id', procedureId)
  .is('deleted_at', null)
  .order('procedures(procedure_date)', { ascending: true }),
```

Capture in a new destructured name `priorNotesRes`.

#### 2. Map into `priorProcedureNotes`

**File**: `src/actions/procedure-notes.ts`
**Changes**: In the return block around line 168, add field to `data`:

```ts
priorProcedureNotes: (priorNotesRes.data ?? []).map((row) => ({
  procedure_date: row.procedures.procedure_date,
  procedure_number: row.procedures.procedure_number ?? 1,
  sections: {
    subjective: row.subjective,
    assessment_summary: row.assessment_summary,
    procedure_injection: row.procedure_injection,
    assessment_and_plan: row.assessment_and_plan,
    prognosis: row.prognosis,
  },
})),
```

Note: verify Supabase PostgREST `!inner` join syntax with the project's existing query patterns before committing — an alternative is a second query keyed on `procedure_id`, matching the existing `priorVitalsByProcedureId` map pattern at line 120-140.

#### 3. Update `computeSourceHash` call

**File**: `src/actions/procedure-notes.ts`, line 317
**Changes**: No code change, but verify the hash now captures `priorProcedureNotes` — it will automatically, because `computeSourceHash` hashes the full `inputData` object. Document in a one-line comment that adding a new finalized prior note will correctly invalidate the hash.

### Success Criteria

#### Automated Verification
- [ ] Type check passes.
- [ ] Unit test for `gatherProcedureNoteSourceData` covers: zero prior notes, one prior note, multiple prior notes in chronological order.

#### Manual Verification
- [ ] Generate procedure #2 on a case that already has procedure #1 finalized. Inspect `raw_ai_response` column — confirm Claude references trajectory in `subjective`.
- [ ] Generate procedure #1 on a fresh case (no prior notes). Confirm output does not hallucinate prior sessions.

---

## Phase 3: Tests and Acceptance

### Unit Tests

**File**: `src/lib/claude/__tests__/generate-procedure-note.test.ts`
- Add test: `priorProcedureNotes` is serialized into the user message.
- Add test: empty array is valid.

**File**: `src/actions/__tests__/procedure-notes.test.ts` (or equivalent location)
- Add test: `gatherProcedureNoteSourceData` returns empty `priorProcedureNotes` when no finalized prior notes exist.
- Add test: returns chronologically ordered entries with correct section fields.

### Manual Testing Steps

1. Seed a test case with patient, finalized initial visit note, 2 finalized procedure notes (dates T-30d and T-15d).
2. Generate a 3rd procedure note at T.
3. Inspect draft output. Confirm:
   - `subjective` references prior sessions.
   - `assessment_and_plan` describes trajectory.
   - `prognosis` is consistent with prior prognosis tone, not reset.
4. Regenerate the `assessment_and_plan` section alone. Confirm output still sees prior context.
5. On a separate fresh case, generate procedure #1. Confirm no hallucinated prior sessions.

## Performance Considerations

- One extra Supabase query per generation. Procedures per case typically 1–6. Query returns at most ~5 rows × 5 text fields. Negligible latency.
- Input token cost: per-row ~500 tokens × 5 prior rows = ~2500 extra input tokens per generation. Within `maxTokens: 16384` budget and well under context limit.

## Migration Notes

- No DB migration.
- No env changes.
- Rollback: revert generator type, prompt block, and gatherer query. Existing data unaffected.

## References

- Research: [thoughts/shared/research/2026-04-20-ai-chat-isolation-per-notes-session.md](../research/2026-04-20-ai-chat-isolation-per-notes-session.md)
- Gatherer: [src/actions/procedure-notes.ts:30-266](src/actions/procedure-notes.ts#L30-L266)
- Generator: [src/lib/claude/generate-procedure-note.ts](src/lib/claude/generate-procedure-note.ts)
- Procedure note schema: [supabase/migrations/015_procedure_notes.sql](supabase/migrations/015_procedure_notes.sql)
