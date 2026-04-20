# Concurrent AI Generation Lock — Implementation Plan

## Overview

Prevent duplicate concurrent AI generation calls for the same note by guarding on `status = 'generating'` at transaction start. Currently, a provider who double-clicks "Generate" or whose network stutter triggers a retry can fire two parallel Anthropic API calls against the same note row, racing on DB update (last-write wins) and double-billing tokens. The fix is a conditional DB update that acts as a mutex, checked atomically via PostgREST's `.eq()` filter.

## Current State Analysis

All three note generators follow the same shape:
- Initial visit: [src/actions/initial-visit-notes.ts:244](src/actions/initial-visit-notes.ts#L244) `generateInitialVisitNote`
- Procedure: [src/actions/procedure-notes.ts:293](src/actions/procedure-notes.ts#L293) `generateProcedureNote`
- Discharge: [src/actions/discharge-notes.ts](src/actions/discharge-notes.ts) `generateDischargeNote`

Pattern:
1. Find-or-create row via unfiltered `update` or `insert` ([procedure-notes.ts:338-403](src/actions/procedure-notes.ts#L338-L403)).
2. Call Claude (~30-60s).
3. Write success/failure.

No check that the row is not already in `'generating'` state. Two parallel invocations both transition `draft` → `generating`, both call Claude, both try to write results. The second write overwrites the first. Anthropic billed twice.

Related: `autoAdvanceFromIntake` at [initial-visit-notes.ts:256](src/actions/initial-visit-notes.ts#L256) advances case status but does not lock the note.

### Key Discoveries

- `status` column on all four AI-generated tables (`initial_visit_notes`, `procedure_notes`, `discharge_notes`, `case_summaries`) has `'generating'` as an allowed value.
- PostgREST `.update().eq('id', X).eq('status', 'draft')` returns row-count 0 if the status does not match — this is our conditional lock. Atomic in Postgres.
- `generation_attempts integer` exists on all four tables — reuse for abandonment detection.
- `updated_at` column exists on all tables (standard audit pattern).

## Desired End State

1. Each generator wraps its pre-Claude DB update in a conditional: `UPDATE ... SET status = 'generating' WHERE id = X AND status IN ('draft', 'failed', NULL)`. If no row affected → another generation is in flight → return error `'Generation already in progress — please wait'`.
2. Insert path (no existing row): uses a unique constraint on `(case_id, visit_type)` / `(procedure_id)` / `(case_id)` (one per note type) to prevent concurrent inserts. Check whether constraints exist; add migration if missing.
3. Stale-generation recovery: if a row is stuck in `'generating'` for > 5 minutes (Claude call timeout is ~60s plus retries, cap ~3min), allow override. Field: check `updated_at < now() - interval '5 minutes'` AND `status = 'generating'` → treat as abandoned, take over.
4. UI shows "generation in progress" message when the guard rejects.
5. Tests: two concurrent `generateProcedureNote` invocations result in exactly one Anthropic call and one row update.

**Verification**: Load test (or manual double-click) produces one `[claude]` log line per note, not two. Failed/abandoned generations auto-recover after 5 minutes without manual intervention.

## What We're NOT Doing

- Not adding Redis or external lock manager — PostgreSQL row-level atomicity is sufficient.
- Not adding a UI-level double-click debounce as the primary guard. UI debounce is fine as a UX improvement but must not be the only defense (it doesn't cover network retries or multi-tab).
- Not introducing advisory locks (`pg_advisory_xact_lock`) — conditional update is simpler and already transactional.
- Not changing Claude retry behavior.
- Not adding a progress-polling endpoint. Status-column read is enough.
- Not adding per-user rate limiting (separate concern).
- Not changing case-summary generation scope. Case summaries follow the same pattern and get the same fix.

## Implementation Approach

Four phases. Phase 1 checks / adds DB uniqueness constraints. Phase 2 adds a shared helper. Phase 3 refactors each generator. Phase 4 tests.

---

## Phase 1: Verify / Add Unique Constraints

### Overview

Ensure the DB enforces at-most-one active (non-deleted) note per logical key. If a unique constraint already exists, Phase 1 is a no-op.

### Changes Required

#### 1. Inspect current constraints

Read and record: `010_initial_visit_notes.sql`, `015_procedure_notes.sql`, `016_discharge_notes.sql`, `006_case_summaries.sql`. For each, grep for `UNIQUE` or `CREATE UNIQUE INDEX` on the expected key:
- `initial_visit_notes`: `UNIQUE (case_id, visit_type) WHERE deleted_at IS NULL`
- `procedure_notes`: `UNIQUE (procedure_id) WHERE deleted_at IS NULL`
- `discharge_notes`: `UNIQUE (case_id) WHERE deleted_at IS NULL`
- `case_summaries`: check actual uniqueness semantics in codebase

#### 2. Migration for any missing constraints

**File**: `supabase/migrations/20260425_unique_active_note_per_logical_key.sql`
**Changes**: Only add constraints that don't exist. Example if missing on procedure_notes:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS procedure_notes_one_active_per_procedure
  ON procedure_notes (procedure_id)
  WHERE deleted_at IS NULL;
```

Apply with `npx supabase db push` (per memory: use CLI, not MCP).

### Success Criteria

#### Automated Verification
- [ ] `npx supabase db push` succeeds.
- [ ] A manual INSERT attempting a second active row fails with constraint violation.

---

## Phase 2: Shared Lock Helper

### Overview

Extract the conditional-update pattern into a shared helper to avoid duplication across four note types.

### Changes Required

#### 1. Create helper

**File**: `src/actions/_helpers/generation-lock.ts` (new)
**Changes**:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

const STALE_GENERATION_MINUTES = 5

/**
 * Atomically acquire the 'generating' lock on an AI-generated note row.
 * Returns { acquired: true, recordId } on success.
 * Returns { acquired: false, reason } if another generation is in flight and not stale.
 *
 * Pattern: conditional update matches on status ∈ {'draft', 'failed'} OR stale-generating.
 * Relies on PostgREST returning the updated row only when the .eq() filter matches.
 */
export async function acquireGenerationLock(
  supabase: SupabaseClient,
  table: 'initial_visit_notes' | 'procedure_notes' | 'discharge_notes' | 'case_summaries',
  recordId: string,
  updatedBy: string,
): Promise<{ acquired: true } | { acquired: false; reason: string }> {
  const staleBoundary = new Date(Date.now() - STALE_GENERATION_MINUTES * 60_000).toISOString()

  // Try to take the lock: either status is draft/failed, OR it's been stuck 'generating' past the stale window.
  const { data, error } = await supabase
    .from(table)
    .update({
      status: 'generating',
      updated_by_user_id: updatedBy,
    })
    .eq('id', recordId)
    .or(`status.in.(draft,failed),and(status.eq.generating,updated_at.lt.${staleBoundary})`)
    .select('id')
    .maybeSingle()

  if (error) return { acquired: false, reason: 'Database error acquiring lock' }
  if (!data) return { acquired: false, reason: 'Generation already in progress — please wait a moment and try again.' }
  return { acquired: true }
}
```

Note: Supabase PostgREST `.or()` with embedded `and()` is supported. Validate the exact filter string against the project's query conventions; if `.or()` is awkward, fall back to two sequential update attempts (first `status IN draft,failed`; if 0 rows, second `status=generating AND updated_at<stale`).

### Success Criteria

#### Automated Verification
- [ ] Unit test: lock acquired on `status = 'draft'` row.
- [ ] Unit test: lock rejected on `status = 'generating'` row with recent `updated_at`.
- [ ] Unit test: lock acquired on `status = 'generating'` row with `updated_at` > 5 minutes ago (stale recovery).
- [ ] Unit test: lock rejected on `status = 'finalized'` row.

---

## Phase 3: Wire into Generators

### Changes Required

For each of the four generators, replace the unconditional pre-Claude update with a two-step flow:

1. Resolve or create the row (existing find-or-create logic, but the create path now relies on the unique constraint from Phase 1).
2. Call `acquireGenerationLock(supabase, table, recordId, user.id)`.
3. If not acquired → return `{ error: reason }` with status 409 semantics.
4. Proceed with Claude call.
5. Write success/failure as today.

#### 1. `src/actions/procedure-notes.ts`

Around line 338-403 (the existing `if (existingNote) { update } else { insert }` block):

- Keep insert path (new row, first generation). The unique constraint at Phase 1 protects against concurrent inserts — second insert returns unique-violation → handle as "already in progress".
- Update path: replace the existing unconditional `.update({ status: 'generating', ... })` with: (a) first call `acquireGenerationLock`; (b) if acquired, then separately null out the narrative columns.

Consider splitting the lock acquisition (status transition) from the narrative-clearing update to keep the lock helper generic.

#### 2. `src/actions/initial-visit-notes.ts`

Same pattern around lines 261-342.

#### 3. `src/actions/discharge-notes.ts`

Same pattern.

#### 4. `src/actions/case-summaries.ts`

Same pattern.

### Success Criteria

#### Automated Verification
- [ ] Unit test: two parallel `generateProcedureNote` calls result in exactly one Anthropic API call (mock the Anthropic client, count invocations).
- [ ] The "rejected" call returns `{ error: ... }` without throwing.

#### Manual Verification
- [ ] Open two tabs of the same procedure. Click "Generate" in both within 1 second. Confirm: one tab shows loading + draft; the other shows "already in progress" toast.
- [ ] Trigger a generation, kill the server mid-call, restart. Wait 5 minutes. Click "Generate" again. Confirm: stale lock is taken over and generation proceeds.
- [ ] Normal (serial) generation still works unchanged.

---

## Phase 4: Tests and Observability

### Changes Required

#### 1. Log lock rejections

**File**: `src/actions/_helpers/generation-lock.ts`
**Changes**: On rejection, add `console.warn('[generation-lock] rejected', { table, recordId })` so operators can spot ABA-style bugs. Do NOT log on success (too noisy).

#### 2. Integration test

**File**: `src/actions/__tests__/generation-concurrency.test.ts` (new)
**Changes**: Mock Supabase + Anthropic. Fire two `generateProcedureNote` calls simultaneously. Assert: exactly one Anthropic call, exactly one DB status transition to `'draft'`.

### Success Criteria

#### Automated Verification
- [ ] `npm test -- generation-concurrency` passes.
- [ ] `npm run build` succeeds.
- [ ] No pre-existing tests regress.

#### Manual Verification
- [ ] Already covered under Phase 3.

---

## Testing Strategy

### Unit Tests

- `generation-lock.test.ts`: four acquisition scenarios (draft → OK, generating recent → reject, generating stale → OK, finalized → reject).
- Four existing test files updated to expect `acquireGenerationLock` call.

### Integration Tests

- `generation-concurrency.test.ts`: parallel invocation fan-in via `Promise.all`. Assert single Claude call.

### Manual Testing Steps

1. Double-click generate on procedure note. Verify only one Claude log line.
2. Kill server during generation, restart, verify recovery after 5 min.
3. Run through end-to-end: initial visit → procedure → discharge. Confirm no regression in normal flow.

## Performance Considerations

- Lock acquisition adds one round-trip to Supabase (~10-30ms local). Negligible compared to ~30-60s Claude call.
- Stale-recovery boundary is 5 minutes. If Claude calls take longer (extreme retry chains), consider raising to 10 minutes — but that widens the window where a genuinely-alive generation can be stolen.

## Migration Notes

- DB migration only if unique constraints missing (Phase 1 — verify first).
- No env changes.
- Rollback: revert the generator changes; lock helper becomes dead code (safe to leave or delete).
- Stale-generation detection uses `updated_at` — existing trigger-maintained column on all tables. No schema change needed.

## References

- Procedure action: [src/actions/procedure-notes.ts:293-459](src/actions/procedure-notes.ts#L293-L459)
- Initial visit action: [src/actions/initial-visit-notes.ts:244](src/actions/initial-visit-notes.ts#L244)
- Research: [thoughts/shared/research/2026-04-20-ai-chat-isolation-per-notes-session.md](../research/2026-04-20-ai-chat-isolation-per-notes-session.md)
- Migration convention + `npx supabase db push` (memory).
