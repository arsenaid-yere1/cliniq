# Procedure numbering after deletion implementation plan

## Overview
Correct the reported procedure from #3 to #2 and align stored next numbers with the existing order-dialog preview.

## Current State
`public.complete_procedure_appointment` and `public.create_direct_episode_procedure` in `supabase/migrations/20260826212447_procedure_scheduling_and_completion_rpcs.sql` allocate max(procedure_number)+1 including deleted rows. The visit page excludes deleted procedures before `buildProcedureSeriesChoices` in `src/lib/clinical/procedure-series-labels.ts` computes the preview. The active-only unique index `procedures_series_number_active_idx` allows reuse of a deleted number.

## Desired End State
Both creation functions allocate one greater than the highest nondeleted procedure number in the selected series. Existing nondeleted numbers remain unchanged, including gaps below the highest number. Empty series begin at 1. Deleted records remain retained.

## Key Discoveries
Both functions already lock the series before allocation. Their authentication, idempotency, insert payloads, and return types need no change. The reported new procedure had no notes, invoice lines, or billing claims; its number was corrected in an audited, guarded transaction without changing clinical details.

## What We Are Not Doing
No bulk renumbering, restoring deleted procedures, changing signed documents, or modifying unrelated follow-up intake work.

## Implementation Approach
Copy the two existing function definitions into an additive migration, changing only each number-allocation predicate to require deleted_at IS NULL. Preserve execution privileges and security invoker mode.

## Phase 1: Database fix
### Files and changes
Create a migration named procedure_numbering_ignore_deleted containing the two corrected functions.
### Automated verification
Compare both definitions against their previous versions; only the allocation predicates differ. Run a dedicated database regression covering scheduled and direct creation, deleted highest numbers, per-series isolation, empty series, retained gaps, and idempotent retries.
### Manual verification
Inspect the migration and confirm the repaired case retains its series and now has nondeleted procedures 1 and 2.

## Phase 2: Rollout
### Files and changes
Apply only the new migration to the linked production database after the isolated regression passes. Keep this plan and regression in the repository.
### Automated verification
Check the production function definitions include the nondeleted filter and re-read the corrected numbering. Run existing series-choice UI tests and TypeScript checks; report environmental limitations.
### Manual verification
User refreshes the procedure page to see #2. Do not create clinical records in production for testing.

## Risks and rollback considerations
The existing active-only unique index and series lock protect number allocation. Deleted-number reuse is intentional and matches the existing preview. Restoring a deleted row whose number is now occupied will remain blocked by the unique index. No other historical procedures are renumbered. Rollback restores the previous two function definitions without altering stored procedures.

## Completion criteria
Case correction verified; both allocation paths tested; migration deployed and verified; unrelated changes untouched.

## Verification Summary
Ready. Reviewed both functions, active-only unique index, series-choice calculation, existing SQL fixture patterns, and linked records for the targeted correction. No new API, grants, schema fields, or unresolved design choices. Regression must demonstrate failure against the old definitions before passing with the fix.

## Verification and rollout results
- Case correction succeeded with an audit entry. Only procedure_number and update attribution/timestamp changed; no linked notes or billing records existed at correction time.
- `NUMBERING_BASELINE=1 node /tmp/cliniq-reset-db/numbering.mjs`: expected regression failure with old scheduled-completion numbering.
- `node /tmp/cliniq-reset-db/numbering.mjs`: all 10 numbering assertions and 14 existing series-reuse assertions passed in isolated PGlite PostgreSQL. The temporary harness provides Supabase auth/storage fixtures and equivalent assertion helpers; native Docker/pgTAP was not run.
- `npm test -- src/lib/clinical/__tests__/procedure-series-labels.test.ts src/components/procedures/__tests__/procedure-order-dialog.test.tsx`: 11 tests passed.
- `npx tsc --noEmit`: passed.
- Compared both replacement function definitions: exactly two nondeleted predicate additions; no other function-body changes.
- `git diff --check`: passed. SQL follows the existing function formatting; no TypeScript source was changed, so no application build or lint run was needed.
- Isolated `supabase db push --linked --skip-vault --dry-run` showed only `20260912170410_procedure_numbering_ignore_deleted.sql`; the actual push applied only that migration.
- Browser UI was not exercised; refresh the procedure page to see the corrected number.
