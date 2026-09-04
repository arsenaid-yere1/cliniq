# Follow-Up Procedure Order Relationship Workflow Implementation Plan

## Overview

Improve the finalized pain follow-up **Recommend Procedure** workflow so the
clinician must explicitly choose a treatment-series relationship, can understand
why an expected series is unavailable, and can see the saved relationship after
the procedure order is created.

The change will replace the collapsed, defaulted select with visible radio-card
choices; surface option-loading failures instead of silently treating them as an
empty result; persist the exact clinician choice on the procedure order; replace
the repeatable recommendation action with a durable ordered state; and display
the relationship on the Procedures page.

This plan follows the findings in
`thoughts/shared/research/2026-09-04-follow-up-procedure-series-relationship.md`.

## Current State

- `src/app/(dashboard)/patients/[caseId]/visits/[encounterId]/page.tsx` loads
  active/completed series for the case, ignores the series-query error, and turns
  the returned rows into eligible `seriesOptions`.
- `src/lib/clinical/procedure-series-labels.ts` drops ineligible candidates. A
  caller cannot distinguish “there are no related series” from “a related series
  exists but has an open order, no performed procedure, or an incompatible
  lifecycle state.”
- `src/components/procedures/procedure-order-dialog.tsx` initializes
  `continuation` to `new`, so **Start a separate treatment series** is selected
  without an affirmative clinician choice. The select shows only one value while
  closed.
- The dialog's selection is local component state. It is submitted only through
  **Create Order**; the follow-up note's **Save Draft** action is unrelated.
- `public.create_procedure_order_from_recommendation` uses the overloaded
  `p_continued_from_series_id` argument to choose current-series reuse,
  prior-series continuation, or a separate series. The resulting
  `procedure_orders` row stores only the resolved `procedure_series_id`.
- The exact choice cannot be reconstructed reliably later. In particular, an
  order on a series that already has procedures may represent current-series
  reuse, while the same series may originally have been created as a separate or
  prior-linked series.
- Returning to the finalized follow-up always renders **Recommend Procedure**
  again. The duplicate-order constraint rejects a second submission only after
  the user tries it.
- `src/components/procedures/procedure-appointment-table.tsx` displays the order's
  type, status, sites, and appointment information, but no series relationship.
- Helper/schema/database tests exist, but there is no browser-like component test
  for selector behavior or durable post-create state.

## Desired End State

For every finalized structured procedure recommendation that does not already
have an order:

1. The entry action is labeled **Create Procedure Order**.
2. The dialog presents every matching series relationship as a visible radio
   card, plus **Start a separate treatment series**.
3. No option is selected initially. **Create Order** remains disabled until the
   clinician makes an explicit selection.
4. Ineligible matching series that are useful to explain are displayed as
   disabled cards with a concise reason, such as an existing open order or no
   performed procedure.
5. A series/order loading failure is visible and prevents order creation until
   the page can be refreshed successfully.
6. The dialog states that the relationship is saved when the order is created and
   is not part of **Save Draft**.
7. After creation, the user remains on the follow-up page and sees an **Ordered**
   status, the exact saved relationship, order status, and a link to Procedures.
8. Returning to the follow-up page continues to show that durable ordered state;
   it does not show another create action for the same recommendation.
9. The Procedures page displays the same relationship using persisted order
   metadata.

Existing current-series reuse, prior-series lineage, independent-series creation,
procedure numbering, duplicate prevention, scheduling, completion, billing, and
discharge behavior remain unchanged.

## Key Discoveries

- The installed `radix-ui` package already exports `RadioGroup`; a local
  `src/components/ui/radio-group.tsx` wrapper can follow the existing shadcn-style
  wrappers without adding a runtime dependency.
- `procedure_orders_recommendation_active_idx` guarantees at most one non-deleted
  order for a source encounter/recommendation pair, so the follow-up page can use
  `source_recommendation_id` as a stable map key.
- The existing RPC argument must remain named `p_continued_from_series_id` for
  compatibility, but the function already knows which of the three paths it
  selected and can record that decision during the same transaction.
- A single relationship-kind value is insufficient for an audit-quality label:
  prior/current choices also need the exact series the clinician selected.
- The resolved `procedure_series_id` is not equivalent to the selected series ID
  for prior-episode continuation because that path creates a new current-episode
  series.
- Historical current-versus-separate choices cannot always be inferred safely.
  The migration must not invent clinical lineage for legacy orders.
- Vitest currently uses the Node environment and the repository does not directly
  depend on Testing Library or jsdom. Component interaction coverage therefore
  requires explicit test-only dependencies and per-file jsdom configuration (or
  an equivalent isolated browser environment).

## What We Are Not Doing

- No changes to the clinical eligibility rules enforced by the RPC.
- No automatic choice, even when only one enabled option exists.
- No automatic creation of multiple procedure orders.
- No editing or changing the series relationship after an order has been created.
- No new ability to reuse a recommendation after its order is cancelled; the
  existing one-order-per-recommendation contract remains in force.
- No changes to follow-up note generation, structured recommendation generation,
  procedure completion/numbering, billing, discharge, or document generation.
- No speculative backfill of relationship metadata for legacy orders.
- No deep-linking to an individual order until the Procedures page has an
  individual order route; the durable state links to the existing case Procedures
  page.

## Implementation Approach

Persist the exact selection in a new, immutable one-to-one audit table rather
than adding clinician-intent fields to the broadly writable `procedure_orders`
table. `procedure_order_series_selections` will contain:

- `procedure_order_id` as its primary key;
- `case_id` for composite ownership constraints;
- `relationship`: `current`, `prior`, or `separate`;
- `selected_series_id`: the exact existing series selected for `current` or
  `prior`, and null for `separate`;
- actor and creation metadata.

Existing orders have no audit row and are therefore legacy/unknown. This avoids
inventing historical intent and cleanly distinguishes unknown from an explicit
separate-series choice.

Keep the existing RPC unchanged during a bounded zero-downtime compatibility
window; orders created by an older client during that window have no audit row.
Add a versioned RPC with an explicit relationship argument and selected series
ID. The new RPC will perform the existing eligibility/order transaction and
insert the immutable audit row in the same transaction. The application action
will switch to the versioned RPC only after the migration is deployed. After the
application rollback/cached-client window closes and v2 usage is verified, apply
a separate retirement migration that revokes authenticated execution of v1.

Because authenticated users currently have broad insert/update grants on
`procedure_orders`, do not rely on order-table check constraints to establish
clinician intent. The audit table will grant authenticated users `select` only;
its write path will be the tightly scoped, authenticated versioned function. The
function and database constraints will both validate the relationship topology.

On the read side, introduce typed view models for:

- selectable and unavailable series choices;
- the persisted order state for a recommendation; and
- the relationship label shown on visit and Procedures screens.

Keep label/availability computation in pure helpers under `src/lib/clinical/` so
it can be unit tested without coupling domain rules to React components.

## Phase 1: Add an Immutable Relationship Audit Contract

### Files and changes

- Add a Supabase CLI-generated migration under `supabase/migrations/`.
  - Create `public.procedure_order_series_selections` with one immutable row per
    audited procedure order.
  - Add composite ownership foreign keys from
    `(procedure_order_id, case_id)` to `procedure_orders(id, case_id)` and from
    `(selected_series_id, case_id)` to `procedure_series(id, case_id)`.
  - Add a relationship check for `current`, `prior`, and `separate`, plus a pair
    check requiring a selected series for current/prior and null for separate.
  - Add an insert-validation trigger that reads the referenced order and series
    rows and rejects contradictory topology: current must select the resolved
    series; prior must select the different-episode series referenced by the
    resolved series' `continued_from_series_id`; separate must have no selected
    series and an unlinked resolved series.
  - Enable RLS; grant authenticated users `select` only; add a case-consistent
    authenticated select policy. Do not grant client insert, update, or delete.
  - Add a database immutability guard that rejects audit-row update/delete; normal
    order cancellation or soft deletion must not rewrite the recorded choice.
  - Do not create audit rows for legacy orders.
  - Add a versioned function such as
    `public.create_procedure_order_from_recommendation_v2` with explicit
    `p_series_relationship` and `p_selected_series_id` arguments rather than
    overloading null to mean both old-client default and explicit separate intent.
  - Follow the established audited-correction boundary in
    `supabase/migrations/20260827211412_audited_discharge_corrections.sql`: expose
    a public `security invoker` v2 wrapper and put the protected transactional
    implementation in a fully qualified private `security definer` function.
    Use fixed search paths, explicit execute grants/revocations, and validate
    `auth.uid()` and every case/episode/encounter/recommendation boundary before
    any write.
  - Preserve the existing row locks, eligibility checks, open-order protection,
    current-series reuse, prior-series creation/lineage, separate-series creation,
    and returned `procedure_orders` row.
  - Validate semantic topology before insert:
    - `separate`: selected series must be null and the new resolved series must be
      unlinked;
    - `current`: selected series must be in the order episode and must equal the
      resolved `procedure_series_id`;
    - `prior`: selected series must be in another episode, the resolved series
      must be newly created in the order episode, and its
      `continued_from_series_id` must equal the selected series.
  - Insert the order and audit row atomically. Reject inconsistent explicit
    arguments rather than coercing them.
  - Leave `public.create_procedure_order_from_recommendation` unchanged for old
    clients; its orders intentionally remain legacy/unknown.
- Update `supabase/tests/database/procedure_order_series_reuse_test.sql`.
  - Call the versioned RPC and assert current reuse writes an immutable `current`
    audit row with the selected current series ID and reused resolved series ID.
  - Assert prior continuation writes `prior`, the selected prior series ID, and a
    different newly created resolved series ID whose lineage points to the prior
    series.
  - Assert separate creation writes `separate`, a null selected series ID, and a
    new unlinked resolved series.
  - Retain and explicitly assert mismatched procedure type, current series with no
    performed procedure, inactive/deleted current series, active/deleted prior
    series, a selected series from another case, an existing open order, and a
    duplicate recommendation submission.
  - For every rejected creation path, assert that neither an orphaned destination
    series nor an audit row remains.
  - Assert mismatched explicit relationship/series arguments fail.
  - Assert direct contradictory same-case audit inserts fail for current, prior,
    and separate topology, even when all foreign keys are otherwise valid.
  - Assert authenticated direct insert/update/delete of audit rows fails while
    select succeeds.
  - Assert the old RPC still creates a valid order without an audit row, proving
    compatibility and honest legacy/unknown handling.
  - Assert the audit insert rolls back if order creation fails and the order rolls
    back if audit insertion fails.
- Update `supabase/tests/database/pain_follow_up_reset_test.sql` only as required
  to keep its intentional direct legacy order fixture valid; it should continue
  to create no audit row.
- Regenerate `src/types/database.ts` from the local schema after the migration.

### Automated verification

- Run the focused pgTAP procedure-order series test.
- Run the complete local database test suite because a new relational table and
  versioned write RPC were added.
- Regenerate types again and verify a clean generated diff, including the new
  table and versioned function signatures.

### Manual verification

- Inspect one current, prior, and separate audit row and confirm that it matches
  the clinician's selection while the order's `procedure_series_id` still
  reflects the resolved series used for scheduling/completion.
- Create an order through the old RPC and confirm that it is displayed as
  legacy/unknown rather than explicit separate.

## Phase 2: Preserve Availability and Failure Information

### Files and changes

- Update `src/lib/clinical/procedure-series-labels.ts`.
  - Replace the lossy eligible-only view with a typed
    `ProcedureSeriesChoice`/availability view model containing the existing series
    metadata plus `eligible` and a stable `unavailableReason` code.
  - Keep exact recommendation-type matching at the dialog/view-model boundary so
    PRP recommendations do not display Botox or other unrelated series.
  - Return enabled current/prior choices using the current eligibility rules.
  - Retain useful ineligible same-type candidates for display with deterministic
    reasons: no performed procedure, current series not active, prior series not
    completed, or current series has an open order.
  - Use deterministic reason precedence when more than one condition fails:
    current open order, no performed procedure, then lifecycle mismatch; for a
    prior series, no performed procedure before lifecycle mismatch.
  - Sort enabled current choices before enabled prior choices; sort current
    choices by descending series number and prior choices by descending episode
    number then descending series number. Render disabled choices in the same
    relationship/order sequence after the enabled section.
  - Continue excluding deleted series entirely.
  - Add pure helpers that translate reason codes and persisted order relationship
    metadata into clinician-facing labels/descriptions.
- Update `src/app/(dashboard)/patients/[caseId]/visits/[encounterId]/page.tsx`.
  - Preserve the error returned by the procedure-series query instead of
    converting every failure into an empty successful result.
  - Load active/completed candidates needed for enabled choices and retain
    relevant non-deleted lifecycle states needed to explain disabled choices.
  - Pass a `seriesChoices` result with either data or a load-error state through
    `PainFollowUpEditor`.
- Update `src/lib/clinical/__tests__/procedure-series-labels.test.ts`.
  - Retain current label/numbering coverage.
  - Assert enabled and disabled classifications and every stable reason code.
  - Assert exact procedure-type filtering and persisted relationship labels,
    including legacy/unknown.

### Automated verification

- Run the focused procedure-series helper tests.
- Run TypeScript and lint checks for the changed server/client boundary types.

### Manual verification

- Verify that an open order, empty series, and lifecycle mismatch each appear as
  a disabled same-type choice with the expected explanation.
- Force or mock a series-load failure and verify it is visually distinct from “no
  existing matching series.”

## Phase 3: Make Relationship Selection Explicit

### Files and changes

- Add `src/components/ui/radio-group.tsx` following the repository's existing
  shadcn/Radix wrappers and using `RadioGroup` from the installed `radix-ui`
  package.
- Update `src/components/procedures/procedure-order-dialog.tsx`.
  - Rename the trigger from **Recommend Procedure** to
    **Create Procedure Order**.
  - Replace the select with an accessible radio group of full-width choice cards.
  - Initialize the selected value to `undefined`, not `new`.
  - Render eligible current/prior choices first, the separate-series choice last,
    and relevant unavailable same-type series as disabled cards with reasons.
  - Make the complete label and description visible on every card; do not require
    selection to reveal the meaning.
  - Show an explicit empty-state sentence when no existing same-type series is
    eligible.
  - On series-load failure, show an error message, disable the choices and submit
    action, and instruct the clinician to refresh.
  - Disable **Create Order** until an enabled choice is explicitly selected and
    while submission is pending.
  - Before the footer, display a short confirmation sentence describing the exact
    action the selected relationship will perform.
  - State that the relationship is saved by **Create Order**, not the follow-up
    note's **Save Draft**.
  - Reset selection when the dialog closes so a later attempt cannot reuse stale
    local intent.
  - Submit an explicit discriminated selection object:
    - `{ relationship: 'separate', selected_series_id: null }`;
    - `{ relationship: 'current' | 'prior', selected_series_id: <uuid> }`.
  - Keep the dialog open after action errors and preserve the current selection so
    the clinician can read the error and choose again.
  - Wrap submission in `try/catch/finally` so a rejected action promise cannot
    leave the dialog permanently pending.
  - Route user cancellation and successful closure through one close/reset helper
    so selection reset does not depend on Radix invoking `onOpenChange` after a
    programmatic state update.
  - On success, close the dialog and refresh the current visit instead of
    immediately navigating away; the refreshed recommendation card will become
    the durable ordered state introduced in Phase 4.
- Update `src/lib/validations/procedure-order.ts`.
  - Replace the optional nullable continuation field used by the new action with
    a discriminated union requiring an explicit relationship and consistent
    selected-series value.
  - Keep any legacy schema needed by the old RPC isolated from the new action;
    omission must fail new-action validation and must never be coerced to an
    explicit separate choice.
- Update `src/actions/procedure-orders.ts`.
  - Validate the discriminated action input and call the versioned RPC with the
    explicit relationship and selected series ID.
  - Do not use `?? null` to turn an omitted choice into a separate-series order.

### Automated verification

- Add `@testing-library/react`, `@testing-library/user-event`, and `jsdom` as
  dev-only dependencies and use a per-file jsdom Vitest environment so existing
  Node tests remain unchanged.
- Update `package.json` and `package-lock.json`; add only the minimal Radix/jsdom
  DOM polyfills required by the real dialog/radio interaction tests.
- Add `src/components/procedures/procedure-order-dialog.test.tsx` covering:
  - no default selection and disabled submit;
  - visible enabled and disabled cards/reasons;
  - the empty existing-series explanation;
  - the load-error state;
  - current/prior explicit relationship and UUID submission;
  - explicit separate/null submission;
  - pending and server-error behavior;
  - rejected-promise cleanup;
  - reset after user close and successful programmatic close;
  - current-visit refresh after success.
- Mock only the server action, router, and toast boundary; exercise the real radio
  group and dialog interaction.

### Manual verification

- Use keyboard navigation to open the dialog, move between radio choices, select
  one, and submit.
- Verify focus visibility, disabled-card semantics, narrow-screen wrapping, and
  readable labels for long procedure/site values.
- Confirm that closing and reopening requires a fresh choice.

## Phase 4: Replace Repeat Creation with Durable Order State

### Files and changes

- Add or extend a typed order-summary helper under `src/lib/clinical/` and cover it
  with a focused unit test.
  - Represent order ID/status, resolved series number/type, relationship kind,
    selected-series episode/series metadata, and legacy/unknown relationship.
  - Produce the same clinician-facing relationship label used by both visit and
    Procedures screens.
- Update `src/actions/procedure-orders.ts` with a shared, typed server-side loader
  and `getProcedureOrderContextForEncounter(caseId, encounterId)`.
  - Query non-deleted procedure orders for the case/encounter, their audit rows,
    and the resolved/selected series and episode metadata required by the summary
    view model.
  - Use explicit PostgREST relationship aliases if selecting both resolved and
    selected series in one query. Prefer staged ID-based queries if they make
    foreign-key selection unambiguous and easier to test.
  - Index orders by `source_recommendation_id`; rely on the existing unique index
    and treat duplicate rows as a data-integrity error rather than choosing one.
  - Preserve the order-query error separately from an empty result.
- Update `src/app/(dashboard)/patients/[caseId]/visits/[encounterId]/page.tsx`.
  - Call the encounter order-context loader in parallel with the series query once
    the encounter is known.
  - Pass its typed success/error result to the editor instead of constructing a
    raw nested PostgREST view model in the page.
- Update `src/components/visits/pain-follow-up-editor.tsx`.
  - Accept recommendation-order summaries and series/order load states.
  - For a recommendation with an existing order, replace the create dialog with
    an **Ordered** badge, order status, persisted relationship label, and a
    **View Procedures** link.
  - For a recommendation without an order, render the create dialog only when
    order-state loading succeeded.
  - If order state could not be loaded, show a non-destructive warning and no
    create action; do not risk presenting a duplicate action as available.
- Update `src/actions/procedure-orders.ts`.
  - Revalidate `/patients/[caseId]/visits/[encounterId]` after successful order
    creation in addition to Procedures and Timeline.
  - Preserve existing actionable RPC error mappings.

### Automated verification

- Add helper tests for current, prior, separate, cancelled/completed statuses, and
  legacy/unknown metadata.
- Add `src/actions/__tests__/procedure-orders.test.ts` using the repository's
  existing mocked Supabase action-test pattern. Cover query construction,
  relationship/audit mapping, query-error propagation, missing metadata,
  encounter/case scoping, and duplicate recommendation detection.
- Add focused component coverage for recommendation cards with no order, an
  existing order, and an order-state load failure.
- Retain the database uniqueness test proving one live order per recommendation.

### Manual verification

- Create an order and confirm the dialog is replaced in place by the ordered
  state after refresh.
- Reload and revisit the follow-up page; confirm the same state and relationship
  remain visible.
- Verify ordered, scheduled, cancelled, and completed order statuses do not
  restore the create action under the current one-order contract.

## Phase 5: Display Relationship on the Procedures Page

### Files and changes

- Update `src/actions/procedure-orders.ts`.
  - Expand `listProcedureOrders` to return a typed list item containing the base
    order plus resolved-series and selected-series/episode display metadata.
  - Reuse the shared loader/mapping path from Phase 4 rather than implementing a
    second relationship join.
  - Return an explicit error if required relationship metadata cannot be loaded;
    preserve legacy/unknown relationship as a supported display state.
- Update
  `src/app/(dashboard)/patients/[caseId]/procedures/page.tsx` to pass the typed
  order list to the scheduling table and surface an order-list loading error
  rather than silently substituting an empty array.
- Update `src/components/procedures/procedure-appointment-table.tsx`.
  - Keep the existing scheduling, rescheduling, completion, no-show, appointment
    cancellation, and order cancellation controls unchanged.
  - Add a concise line below each order showing one of:
    - current episode and resolved procedure type/series number, without claiming
      a procedure ordinal that is assigned only at completion;
    - continued from a named prior episode/series;
    - independent series;
    - relationship unavailable for a legacy order.
  - Use the shared relationship-label helper so this wording cannot drift from
    the follow-up page.

### Automated verification

- Test order-list view-model construction for all relationship kinds and missing
  optional legacy metadata.
- Extend the action tests to cover `listProcedureOrders` success, explicit
  PostgREST/staged relationship loading, mapping errors, and database-query error
  propagation.
- Add component coverage confirming the relationship label is rendered without
  changing the existing action controls.
- Run existing procedure scheduling/completion tests.

### Manual verification

- Verify the relationship displayed on Procedures exactly matches the ordered
  state on the source follow-up visit.
- Complete a current-series order and confirm numbering and same-series history
  remain unchanged.

## Phase 6: End-to-End Regression and Release Verification

### Files and changes

- Extend `supabase/tests/database/procedure_order_series_reuse_test.sql` or add a
  focused workflow fixture if keeping the existing test readable requires it.
- Update durable workflow documentation only if the UI labels or operator steps
  are documented elsewhere; do not duplicate the implementation plan.

### Automated verification

Run, in order:

1. Focused Vitest suites for procedure-series choices, order-summary helpers,
   validation, dialog interaction, recommendation ordered state, and Procedures
   display.
2. Focused pgTAP procedure-order series tests.
3. Full Vitest suite.
4. Full local database tests.
5. ESLint.
6. TypeScript/Next build.
7. `git diff --check` and a final diff review.

The database test requires the local Supabase/Docker environment. If unavailable,
report it explicitly and do not represent SQL inspection as execution.

### Manual verification

Exercise these workflows with matching PRP and Botox examples where practical:

1. No existing series: explicitly choose separate, create the order, and verify
   persistent independent-series status on both screens.
2. Eligible current series: choose it, verify the submitted and displayed current
   relationship, schedule/complete it, and confirm the next procedure number.
3. Eligible prior series: choose it, verify the new current-episode series and
   prior lineage, and confirm both screens display the prior episode/series.
4. Current series with an open order: verify it appears disabled with the reason
   and cannot be submitted.
5. Empty or wrong-lifecycle same-type series: verify the appropriate disabled
   explanation.
6. Different procedure type: verify unrelated series are not presented.
7. Series-load or order-state failure: verify the UI blocks creation and explains
   the failure.
8. Action-level stale eligibility: change the series after page load, submit, and
   verify the dialog remains open with the existing actionable error.
9. Existing/legacy order: verify no duplicate create action appears and unknown
   historical relationship is labeled honestly.
10. Cancelled/completed recommendation order: verify the create action remains
    unavailable under the existing uniqueness contract.

## Phase 7: Retire the Legacy Unaudited Write Path

### Files and changes

- After the application rollback window and expected cached-client lifetime have
  elapsed, verify production callers are using
  `create_procedure_order_from_recommendation_v2`.
- Generate and apply a separate Supabase migration that revokes authenticated
  execution of `public.create_procedure_order_from_recommendation` while leaving
  the function definition available for historical migration reproducibility.
- Keep all historical orders without audit rows readable as legacy/unknown; do
  not synthesize audit rows during retirement.
- Update any operational runbook that names the v1 RPC.

### Automated verification

- Before retirement, retain the mixed-version pgTAP assertion that v1 can create
  a valid unknown order and v2 creates an audited order.
- Against the retirement migration, assert authenticated v1 execution is denied
  and authenticated v2 execution still creates the order and immutable audit row
  atomically.
- Run the full database tests after the retirement migration, updating fixtures
  that intentionally called v1 to use v2 unless they specifically test historical
  compatibility before retirement.

### Manual verification

- Confirm no supported application build calls v1 before applying the retirement
  migration.
- Create current, prior, and separate orders through the deployed UI after
  retirement and confirm every new order has exactly one audit row.

## Risks and Rollback Considerations

- **Clinical audit accuracy:** Backfilling ambiguous historical relationships
  could create false lineage. Leave legacy orders without an audit row and label
  them unknown.
- **Zero-downtime compatibility:** Deploy the new audit table and versioned RPC
  before the application calls it. Old clients keep using the unchanged RPC and
  create valid unknown/legacy orders; new clients call only the explicit v2 RPC.
  Test both callers against the compatibility schema, then retire v1 in a
  separate migration after the rollback/cached-client window.
- **Migration locking:** The audit table is new and starts empty, so its checks and
  foreign keys avoid an in-place data rewrite or validation scan of existing
  orders. They can still take brief locks on referenced tables; review the
  generated migration and apply it during an appropriate deployment window.
- **Generated types:** Regenerate and type-check the new audit-table and v2-RPC
  types after the migration.
- **Client/server boundary size:** Do not pass raw nested Supabase rows into client
  components. Build compact serializable view models on the server.
- **Eligibility drift:** The UI helper explains current state, but the RPC remains
  authoritative and must continue revalidating under lock.
- **Load-error safety:** Blocking order creation on an order-state query failure is
  intentional; otherwise the UI may present a duplicate action.
- **New test tooling:** Keep jsdom isolated to component test files so the current
  fast Node test suite does not globally change environments.
- **Rollback:** The UI/action/helper changes can be rolled back independently.
  Keep the audit table, v2 RPC, and already written audit rows during an
  application rollback; the old UI naturally continues through the unchanged
  legacy RPC during the compatibility window. Do not retire v1 until the rollback
  window closes. After v1 retirement, an application rollback must target a build
  that calls v2 or deliberately restore v1 execution as an explicit database
  rollback decision; never drop v2 or its audit data.

## Completion Criteria

- The dialog has no default relationship and cannot create an order without an
  explicit enabled selection.
- All enabled choices and useful unavailable same-type series are visible without
  opening a collapsed dropdown.
- Empty eligible state and load failure are distinct and clearly explained.
- Orders created through the v2 action persist the exact relationship kind and
  selected series ID in the same transaction as order creation; compatibility-
  window v1 orders remain honestly labeled legacy/unknown.
- Current, prior, and separate database behaviors remain correct and protected by
  existing constraints.
- The source recommendation becomes a durable ordered state immediately after
  creation and remains so after refresh/revisit.
- The follow-up and Procedures screens show the same persisted relationship and
  order status.
- Legacy relationships are labeled unknown rather than inferred.
- After the compatibility window, authenticated v1 execution is retired so every
  supported new recommendation-order workflow produces an audit row.
- Duplicate creation is unavailable in the UI and still rejected by the database.
- Focused component, helper, schema, and database tests cover all three
  relationships, unavailable reasons, load failures, post-create state, and
  legacy behavior.
- Full tests, database tests, lint, type/build checks, diff checks, and manual
  acceptance pass, with any environment-limited verification explicitly noted.

## Implementation Status — 2026-09-04

- [x] Added the immutable relationship audit table and explicit v2 order RPC.
- [x] Preserved unavailable series choices and stable reason codes.
- [x] Replaced the defaulted select with required visible radio cards.
- [x] Added durable ordered-state and Procedures-page relationship summaries.
- [x] Added validation, helper, action, component, and pgTAP coverage.
- [x] Passed TypeScript, production build, focused lint, full Vitest, and diff checks.
- [ ] Run the local database reset and pgTAP suite when Docker or Podman is available.
- [ ] Complete the manual workflow matrix in a migrated local/staging environment.
- [ ] Retire v1 only after the production rollback/cached-client window closes.
