# Follow-Up Recommend Procedure: Series Relationship Options and Persistence

## Research question

How does the finalized pain follow-up **Recommend Procedure** dialog populate its
**Series relationship** choices, why can the UI show only one choice, and when and
where is the selected relationship saved?

This document describes the current implementation only. It does not propose a
fix.

## Summary

The dialog is not editing a field on the follow-up note. It is preparing a new
procedure order. The relationship selector begins with the local value `new`, and
its choice is persisted only when the clinician clicks **Create Order**. Closing
the dialog, refreshing the page, or clicking the follow-up note's **Save Draft**
does not save the selector value.

The selector always includes **Start a separate treatment series**. Other choices
are derived from procedure series for the case and survive two filtering stages:

1. The series must satisfy relationship-specific eligibility rules.
2. Its `procedure_type` must exactly equal the structured recommendation's type.

Therefore, an expanded dropdown with exactly one item means that no series
survived both stages; the one remaining item is the always-present separate-series
choice. Separately, when the select is closed, its trigger displays only the
currently selected item even when the expanded list contains more choices.

After a successful **Create Order**, the relationship is stored indirectly in the
procedure-series/order records, not as a standalone `relationship` field. The
Procedures screen does not render those relationship identifiers, and revisiting
the dialog initializes the local selection to `new` again. Both behaviors can make
a successfully created relationship appear not to have been retained.

## Detailed findings

### 1. Where the choices come from

The follow-up visit page queries all non-deleted `procedure_series` rows for the
case whose status is `active` or `completed`. The query also loads the owning
episode number, performed-procedure numbers, and order statuses:

- `src/app/(dashboard)/patients/[caseId]/visits/[encounterId]/page.tsx:19-21`

The page converts those rows into typed candidates and calls
`buildProcedureSeriesOptions(candidates, encounter.episode_id)`:

- `src/app/(dashboard)/patients/[caseId]/visits/[encounterId]/page.tsx:22-32`
- `src/lib/clinical/procedure-series-labels.ts:14-35`

`buildProcedureSeriesOptions` includes a candidate only when it has at least one
non-deleted performed procedure and meets the applicable relationship rule:

- Current episode: the series must be `active` and must not have a non-deleted
  `ordered` or `scheduled` order.
- Prior episode: the series must be `completed`.
- Deleted and empty series are excluded.

The page passes the resulting options through `PainFollowUpEditor` to one
`ProcedureOrderDialog` per structured recommendation. The dialog exists only for
a finalized note:

- `src/components/visits/pain-follow-up-editor.tsx:317-343`

The dialog then performs an exact, case-sensitive procedure-type filter:

- `src/components/procedures/procedure-order-dialog.tsx:16`

It renders every remaining option and then always appends **Start a separate
treatment series**:

- `src/components/procedures/procedure-order-dialog.tsx:19`
- `src/lib/clinical/procedure-series-labels.ts:1,53-70`

The generated labels distinguish these cases:

- Current: `Add procedure #N to current active series — TYPE series N`
- Prior: `Continue from prior episode — Episode N · TYPE series N`
- Independent: `Start a separate treatment series`

### 2. Why only one expanded option can appear

Verified code behavior: the expanded list has exactly one item when
`matchingOptions` is empty, because the separate-series choice is unconditional.
Any of the following removes an expected series before rendering:

- it is deleted;
- it has no non-deleted performed procedure;
- it is in the current episode but is not active;
- it is in the current episode and already has an `ordered` or `scheduled` order;
- it is in a prior episode but is not completed;
- its procedure type does not exactly match the recommendation type.

The page also ignores the error result from the procedure-series query. If that
query fails, `seriesRows ?? []` becomes an empty candidate list, producing only
the separate-series choice:

- `src/app/(dashboard)/patients/[caseId]/visits/[encounterId]/page.tsx:19-22`

Case-specific inference: without the affected case's series, procedures, orders,
and recommendation values, source inspection cannot determine which eligibility
rule—or whether a query failure—caused the reported single item.

### 3. What “save” means for this selector

The relationship is initialized and held only in component state:

- `src/components/procedures/procedure-order-dialog.tsx:15`

Selecting an item calls `setContinuation`; there is no separate save operation.
The follow-up note's **Save Draft** uses `savePainFollowUpNote` and saves narrative
sections plus the existing `procedure_recommendations` array. Its schema contains
no series-relationship field:

- `src/components/visits/pain-follow-up-editor.tsx:194-209,258-266`
- `src/lib/validations/pain-follow-up-note.ts:35-78`
- `src/actions/pain-follow-up-notes.ts:115-135`

Only **Create Order** submits the relationship. The payload uses the selected
series UUID as `continued_from_series_id`, or `null` when the local value is
`new`:

- `src/components/procedures/procedure-order-dialog.tsx:18`
- `src/lib/validations/procedure-order.ts:28-30`
- `src/actions/procedure-orders.ts:16-39`

Closing/remounting the dialog before submission reconstructs its state as `new`.
There is no draft relationship value to reload.

### 4. Database persistence after Create Order

The server action forwards the selected value to
`create_procedure_order_from_recommendation` as
`p_continued_from_series_id`. The database function interprets it according to the
selected series' episode:

- Selected current-episode series: validate it, reuse that series ID, and insert
  the order with that `procedure_series_id`.
- Selected prior-episode series: create a new current-episode series whose
  `continued_from_series_id` points to the prior series, then insert the order
  against the new series.
- `null`: create a new independent current-episode series and insert the order
  against it.

Source references:

- `supabase/migrations/20260827185012_add_next_procedure_current_active_series.sql:50-97`
- `supabase/migrations/20260826161632_care_episodes_and_encounters.sql:96-125`
- `supabase/migrations/20260826161643_procedure_orders_and_appointments.sql:1-40`

There is no `relationship` or `continued_from_series_id` column on
`procedure_orders`. The order stores the resolved `procedure_series_id`; lineage
belongs to `procedure_series`.

The active recommendation uniqueness index prevents creating a second live order
from the same encounter/recommendation pair:

- `supabase/migrations/20260826161643_procedure_orders_and_appointments.sql:37-39`

### 5. Why persistence is not visible after success

After success, the dialog closes and navigates to the Procedures page. The order
list receives full order rows but renders procedure type, order status, sites,
and appointment details. It does not display `procedure_series_id` or the
selected series' lineage:

- `src/components/procedures/procedure-appointment-table.tsx:112-127`

If the clinician returns to the finalized follow-up, the recommendation card and
**Recommend Procedure** button are still rendered from the note, while a newly
mounted dialog again initializes `continuation` to `new`. Attempting to submit the
same recommendation again is rejected and mapped to **This recommendation already
has an order**:

- `src/components/visits/pain-follow-up-editor.tsx:317-343`
- `src/components/procedures/procedure-order-dialog.tsx:15`
- `src/actions/procedure-orders.ts:29-36`

This verifies that successful persistence and visible selector state are two
different things in the current UI.

## Execution and data flow

1. `VisitPage` loads the finalized follow-up note and case procedure-series rows.
2. `buildProcedureSeriesOptions` classifies and removes ineligible series.
3. `PainFollowUpEditor` renders each structured recommendation.
4. `ProcedureOrderDialog` filters options to the recommendation's exact type and
   adds the independent-series choice.
5. The clinician's selection changes only local `continuation` state.
6. **Create Order** validates the payload and calls the database RPC.
7. The RPC revalidates eligibility and either reuses a current series or creates
   a linked/independent series, then inserts the procedure order.
8. The UI navigates to the Procedures page, which does not display the saved
   relationship metadata.

## Existing tests

- `src/lib/clinical/__tests__/procedure-series-labels.test.ts` covers labels,
  current/prior classification, eligibility exclusions, and next-procedure
  numbering.
- `src/lib/validations/__tests__/procedure-order.test.ts` covers a selected UUID,
  `null` for a separate series, and invalid UUID rejection.
- `supabase/tests/database/procedure_order_series_reuse_test.sql` covers current
  series reuse, open-order rejection, mismatched/empty-series rejection,
  independent-series creation, and prior-series lineage.

There is no component-level test for `ProcedureOrderDialog`, so the repository
does not directly test selector interaction, selected-value submission, reset on
remount, or post-navigation visibility. The implementation plan itself leaves
“selected current option submits its series ID” and “separate series submits
`null`” unchecked even though schema and database behavior are covered at lower
levels.

Automated verification performed during this research:

```text
npm test -- src/lib/clinical/__tests__/procedure-series-labels.test.ts \
  src/lib/validations/__tests__/procedure-order.test.ts

2 test files passed; 14 tests passed.
```

The database test was inspected but not executed during this research.

## Historical context

Commit `945c4bd` (`feat(procedures): continue active treatment series`) introduced
the current structured options, eligibility helper, dialog filtering, action error
mapping, RPC behavior, and associated tests.

The implementation plan records the intended three relationships and explicitly
states that the selector is an order-creation choice carried through the existing
`continued_from_series_id` wire field:

- `thoughts/shared/plans/2026-08-27-add-next-procedure-current-active-series.md`

## Open questions

1. In the reported case, is the single item the closed select's displayed value,
   or is the expanded dropdown actually limited to one item?
2. If the expanded dropdown has one item, which expected series is missing, and
   what are its episode, status, procedure count, open-order status, and procedure
   type?
3. Did the apparent non-save occur before **Create Order**, after a successful
   order creation, or after an error toast?
4. Did the page's procedure-series query return an error? The current page loader
  does not surface that error.
