# Reopen and continue procedure series implementation plan

## Overview
Support an explicit reopening choice when ordering another procedure in a completed current-episode series. Prevent disagreement between displayed eligibility and saving.

## Current State
The visit page builds series choices from local TypeScript rules. The private v2 order RPC separately validates active current series and completed prior series. Case reactivation preserves completed series. The immutable procedure_order_series_selections table records current/prior/separate choices. Reset blockers already include invoice links but order links only open the procedure list.

## Desired End State
Completed current series can be explicitly reopened while creating a recommendation order. One transaction verifies a writable episode, finalized recommendation, retained procedures, matching type, and absence of open orders; reopens the selected series; creates the order; and audits both the relationship and status change. Failures roll back all writes. Cancelled/deleted/empty series remain unavailable. Prior-episode continuation keeps its existing new-series behavior.

## Key Discoveries
Number allocation is already fixed by 20260912170410_procedure_numbering_ignore_deleted.sql. Existing series locks and a unique open-order index protect concurrent orders. The follow-up visit page has unrelated intake edits which must be preserved. Existing reset blockers already identify their order/invoice IDs.

## What We Are Not Doing
No automatic reopening of all series, bulk patient repair, historical renumbering, note-text changes, or unrelated intake edits. This implementation request does not require another production deployment.

## Implementation Approach
Add one database eligibility helper used by a read-only preview RPC and the locked order mutation. Extend the existing relationship vocabulary with reopen. Preserve the v2 signature and old relationships. Use current user attribution in audit_logs, plus the immutable saved relationship. Render the action as “Reopen and continue this series” and require explicit selection. Keep refreshed server data authoritative. Link blocked orders directly to their cards.

## Phase 1: Database
### Files and changes
New reopen_procedure_series migration: shared private invoker eligibility helper; public invoker preview; extend relationship constraints/validator; replace private v2 mutation to call helper after locking and reopen atomically.
### Automated verification
Database regression for preview/save agreement, completed current eligibility, rollback on failed order, duplicate/stale requests, deleted/cancelled/empty/wrong-type/prior series, status audit, same series ID, and next number after deletion. Run existing reset, numbering and series-reuse SQL suites.
### Manual verification
Review private function privileges, user attribution, lock scope, and migration diff.

## Phase 2: Application
### Files and changes
Update procedure-order validation, procedure-series-labels, order action/preview loader, database RPC types, visit page, order dialog, reset blocker links, and order card anchors. Preserve unrelated page changes.
### Automated verification
Unit/component/action tests for explicit reopen selection and RPC payload, eligibility load failure, labels and safe errors. Run scoped lint, TypeScript and build. Provide a repeatable clinical workflow test command.
### Manual verification
Reactivated case → order dialog → explicit reopen → same series active with order and next number; link directly to blocking order. Do not create patient records for testing.

## Risks and rollback considerations
Apply migration before deploying UI; existing clients continue using old relationships and cannot silently reopen. Preview can become stale, so save rechecks under locks. A second request must fail without duplicate audit/order. Reverting UI is safe; preserve stored reopen relationships and audit data. Existing signed records remain untouched.

## Completion criteria
Database and application phases verified; workflow regressions pass; touched diff reviewed; manual/live verification explicitly distinguished.

## Verification Summary
Ready. Verified the v2 function signature, relationship constraints/trigger, order dialog, validation, series labels, reset links and existing SQL fixtures. No new user permission level is introduced: reopening is authorized through the same recommendation-order permission, requires an active episode and explicit choice, and records the authenticated actor. Existing episode reactivation continues to require its existing administrator checks.

## Implementation results
- Database phase complete: `20260912172701_reopen_procedure_series.sql` adds the shared eligibility helper/read preview and atomic, audited reopen relationship. The v2 API signature and existing relationships are preserved.
- Application phase complete: server-generated choices replace the duplicated TypeScript eligibility builder; the explicit reopen action preserves the selected series; reset blockers link to anchored order cards.
- `npm run test:clinical-workflow`: 39 tests passed across six suites.
- `node /tmp/cliniq-reset-db/reopen.mjs`: new 25-assertion reopen workflow and existing numbering, series-reuse, clinical-reset and follow-up-reset SQL suites passed in isolated PGlite PostgreSQL. The temporary harness supplies Supabase auth/storage fixtures, test assertion equivalents, and baseline duplicate-column compatibility. It does not replace native migration/pgTAP validation.
- `npx tsc --noEmit`: passed.
- Scoped ESLint over all changed application/test files: passed.
- `git diff --check`: passed.
- `npm run db:test`: unavailable; no local Supabase PostgreSQL listener at 127.0.0.1:54322. No production patient data was used for these tests.
- Added `npm run check:clinical-workflow` as the pre-release check: application workflow tests, TypeScript, and native database tests. It requires a running, migrated local Supabase database and intentionally fails if database tests cannot run. No existing CI/deployment pipeline was present to attach this command to.

## Release and manual verification
Before release, run `npm run check:clinical-workflow` against a running local Supabase instance, then the production build. Apply the additive database migration before releasing the UI. Verify the explicit reopen choice, same-series order, next number, history retention and blocker navigation in the browser. Native pgTAP and browser verification remain pending; the implementation is not deployed by this task.
- `npm run build`: passed after granting network access for existing Google Fonts. The initial sandboxed build could not fetch those fonts.
