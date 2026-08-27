# Add Next Procedure to the Current Active Series

## Overview

Allow a finalized pain follow-up recommendation to create the next procedure order on an existing active procedure series in the current care episode. Preserve the existing choices to start a separate series or continue treatment history from a completed series in a prior episode.

The implementation should keep procedure numbering, procedure-note context, billing, and discharge behavior aligned with the existing data model. It must also prevent two open orders from being created for the same active series.

## Current State

- `src/components/procedures/procedure-order-dialog.tsx` offers only:
  - start a separate series; or
  - link a newly created series to a series from an earlier episode.
- `src/app/(dashboard)/patients/[caseId]/visits/[encounterId]/page.tsx` loads only prior-episode series and sends them to `PainFollowUpEditor` as `priorSeries`.
- `src/components/visits/pain-follow-up-editor.tsx` forwards those options to the order dialog.
- `src/actions/procedure-orders.ts` passes the selected ID to `public.create_procedure_order_from_recommendation` as `p_continued_from_series_id`.
- `supabase/migrations/20260826212447_procedure_scheduling_and_completion_rpcs.sql` always inserts a new `procedure_series` before inserting the order. A selected series is treated only as lineage through `continued_from_series_id`.
- Procedure completion already locks the series and assigns `max(procedure_number) + 1`, so completing another order on the same series naturally creates the next numbered procedure.
- `src/actions/procedure-notes.ts` loads prior procedure-note context from the same `procedure_series_id`, so reusing the active series naturally preserves series-specific clinical history.
- Billing is tied to the performed procedure rather than creation of the series, so reusing a series does not combine or suppress procedure charges.

## Desired End State

For each finalized structured procedure recommendation, the clinician can select one of three explicit relationships:

1. **Add procedure #N to current active series** — reuse a qualifying active series in the current episode.
2. **Continue from prior episode** — create a new series in the current episode linked to a qualifying completed series in an earlier episode.
3. **Start a separate treatment series** — create an independent new series.

When the current-series option is chosen:

- the new order references the existing current-episode `procedure_series.id`;
- the series remains active;
- completing the procedure assigns the next sequential `procedure_number`;
- existing procedure-note trajectory behavior continues to use prior notes from that series;
- a second open order for the same series is rejected both transactionally and by a database constraint.

## Key Discoveries

- The existing RPC parameter can remain named `p_continued_from_series_id` for zero-downtime compatibility with the deployed client and generated types. The function can distinguish current-series reuse from prior-series continuation by comparing the selected series episode with `p_episode_id`.
- `complete_procedure_appointment` already serializes numbering by locking the series row before calculating the next number.
- One recommendation currently produces one order. This plan retains that relationship.
- Discharge finalization completes all active series in the episode. This remains correct and unchanged.
- A current-series option is only truthful after at least one non-deleted procedure has been performed in that series.
- The database, rather than the UI alone, must prevent concurrent open orders for the same series.

## What We Are Not Doing

- No planned total number of treatments is added to a series.
- No automatic ordering of multiple future procedures is introduced.
- No changes are made to procedure fees, claims, or billing events.
- No change is made to the procedure completion numbering algorithm unless regression testing exposes a defect.
- No active series from another episode is reused directly; cross-episode treatment creates a new episode-local series linked to the completed prior series.
- No discharged or deleted series is reopened.

## Implementation Approach

Keep the public RPC signature stable and reinterpret a non-null selected series ID according to its episode:

- `null`: create an independent series in the current episode;
- selected series belongs to the current episode: validate and reuse that series;
- selected series belongs to an earlier episode in the same case: validate it and create a new current-episode series with `continued_from_series_id` set to the selected series.

Use the same structured option model in the page, editor, and dialog so the UI can label the relationship accurately and show the next expected procedure number.

## Phase 1: Database Ordering Contract

### Files

- New CLI-generated migration under `supabase/migrations/`
- New or extended pgTAP tests under `supabase/tests/database/`

### Changes

1. Add a partial unique index on `procedure_orders(procedure_series_id)` for non-deleted rows whose status is `ordered` or `scheduled`.
2. Before creating the index, add an explicit migration preflight that fails with a clear message if existing data contains duplicate open orders for a series. Do not silently delete or rewrite clinical records.
3. Replace `public.create_procedure_order_from_recommendation` without changing its argument signature or grants.
4. Lock a selected series row before deciding how it is used.
5. For a selected current-episode series, require all of the following:
   - same case and episode as the recommendation;
   - `status = 'active'` and `deleted_at is null`;
   - `procedure_type` matches the finalized recommendation;
   - at least one non-deleted performed procedure exists in the series;
   - no non-deleted order in `ordered` or `scheduled` status already exists for it.
6. Reuse the qualifying current series ID instead of inserting a new series.
7. For a selected prior-episode series, require:
   - same case and a different episode;
   - `status = 'completed'` and `deleted_at is null`;
   - matching `procedure_type`;
   - at least one non-deleted performed procedure.
8. Create a new current-episode series linked through `continued_from_series_id` only for the prior-episode path.
9. Preserve authentication, source encounter/recommendation validation, duplicate-recommendation protection, `security invoker`, explicit search path, and existing execution grants.
10. Return an actionable domain error if the selected series is no longer eligible or already has an open order.

### Automated Verification

- Current active series is reused and no new series row is inserted.
- Independent option creates a new unlinked series.
- Prior completed series creates a new current-episode series with lineage.
- Mismatched procedure type is rejected for both current and prior choices.
- Current series without a performed procedure is rejected.
- Current completed/deleted series is rejected.
- Prior active/deleted series is rejected.
- A second open order for a current series is rejected.
- Concurrent inserts are protected by the partial unique index.
- Submitting the same recommendation twice is rejected without leaving an orphaned series.

## Phase 2: Load Structured Series Options

### Files

- `src/app/(dashboard)/patients/[caseId]/visits/[encounterId]/page.tsx`
- A shared type/helper near `src/lib/clinical/procedure-series-labels.ts`, if needed
- Corresponding unit tests

### Changes

1. Replace the `priorSeries` page model with structured `seriesOptions` containing:
   - series ID;
   - relationship kind: `current` or `prior`;
   - episode ID and episode number;
   - series number and procedure type;
   - latest/max performed procedure number;
   - whether an open order already exists.
2. Query current-episode and prior-episode candidates for the same case, together with performed procedure numbers and open-order state.
3. Produce only candidates that can be eligible:
   - current episode: active, non-deleted, has a performed procedure, no open order;
   - prior episode: completed, non-deleted, has a performed procedure.
4. Preserve defense in depth: the RPC remains authoritative because eligibility can change after page load.
5. Keep options typed without exposing raw database rows to the client component.

### Automated Verification

- The page/helper classifies current and prior options correctly.
- Deleted, empty, inactive current, active prior, and current series with open orders are excluded.
- Next procedure number is derived from completed procedures, not appointments or orders.

## Phase 3: Improve the Order Dialog Labels and Behavior

### Files

- `src/components/visits/pain-follow-up-editor.tsx`
- `src/components/procedures/procedure-order-dialog.tsx`
- `src/actions/procedure-orders.ts`
- `src/lib/clinical/procedure-series-labels.ts`
- `src/lib/clinical/__tests__/procedure-series-labels.test.ts` or the existing equivalent test file
- `src/lib/validations/procedure-order.ts`
- `src/lib/validations/__tests__/procedure-order.test.ts`

### Changes

1. Pass structured `seriesOptions` through the follow-up editor to the dialog.
2. Filter options to the recommendation's normalized `procedure_type` before rendering.
3. Use explicit labels:
   - `Add procedure #3 to current active series — PRP series 1`
   - `Continue from prior episode — Episode 1 · PRP series 1`
   - `Start a separate treatment series`
4. Change the explanatory copy according to the selected relationship:
   - current: keeps the existing series history and uses the next procedure number;
   - prior: begins a new episode-local series while retaining lineage to the prior course;
   - separate: begins an independent series.
5. Keep the submitted payload backward compatible by sending the selected series ID through `continued_from_series_id`, with `null` for separate series.
6. Update the server action's error mapping so stale-series, type-mismatch, and existing-open-order failures are returned as actionable clinician-facing messages.
7. Surface those errors in the dialog and leave it open so the clinician can refresh or choose another option.

### Automated Verification

- Label helpers produce the three relationship labels with correct episode, series, and next-procedure values.
- Current and prior options are filtered by recommendation type.
- The selected current option submits its series ID.
- Separate series submits `null`.
- Validation accepts the existing wire shape and rejects invalid IDs.

## Phase 4: End-to-End Workflow Regression

### Files

- Existing procedure scheduling/completion tests, extended as appropriate
- Database integration tests under `supabase/tests/database/`

### Changes and Verification

1. Create and finalize a pain follow-up recommendation after procedure #1.
2. Order the next procedure using the current active series.
3. Schedule and complete the order.
4. Assert the completed procedure uses the same `procedure_series_id` and receives `procedure_number = 2`.
5. Assert the procedure note can load same-series prior procedure context.
6. Assert a later follow-up can add procedure #3 after #2 is completed.
7. Assert a new order cannot be added while #2 is still ordered or scheduled.
8. Assert prior-episode continuation still creates a new linked series rather than reusing a series across episodes.
9. Assert independent series behavior remains unchanged.
10. Assert discharge continues to complete active series and block unresolved open procedure work.

## Phase 5: Deployment and Manual Acceptance

1. Generate the migration with the Supabase CLI and review the SQL before applying it.
2. Run database tests locally when Docker is available; otherwise run the transaction-rolled-back pgTAP fixture against the linked environment before applying the migration.
3. Run unit tests, TypeScript checks, formatting/linting, and `git diff --check`.
4. Dry-run the linked database push and verify that only the intended migration is pending.
5. Apply the migration, then deploy the application code using the repository's existing production workflow.
6. Manually verify in the UI:
   - after completing procedure #1, a finalized matching follow-up shows `Add procedure #2 to current active series`;
   - after creating that order, the current-series option is unavailable until it is completed or otherwise resolved;
   - completion produces procedure #2 in the same series;
   - a later follow-up offers procedure #3;
   - prior-episode and separate-series labels behave as described;
   - each performed procedure remains independently billable.

## Risks and Rollback

- **Existing duplicate open orders:** the migration must stop and report them before adding the unique index. Resolve those records through an explicit clinical/operational decision, not an automated migration rewrite.
- **Stale UI eligibility:** the RPC revalidates and locks the selected series; the UI must show the returned error rather than assuming the page data is current.
- **Zero-downtime compatibility:** retain the existing RPC signature and request field so old and new application versions can coexist during deployment.
- **Prior continuation regression:** cover existing prior-episode behavior in database tests before changing the RPC.
- **Rollback:** application code can be rolled back because the wire shape is unchanged. If the database function must be rolled back, restore the prior function definition; retain the unique index unless it conflicts with an explicitly approved workflow that permits multiple open orders per series.

## Completion Criteria

- Clinicians can explicitly add the next procedure to a qualifying current active series.
- The order reuses the series ID and the completed procedure receives the next sequential number.
- Two open orders cannot exist for one procedure series.
- Prior-episode continuation and independent series creation still work.
- Labels clearly distinguish current-series, prior-episode, and separate-series choices.
- Procedure-note history, discharge rules, and per-procedure billing remain correct.
- Database, unit, type, lint/format, and manual workflow checks pass.
