# Episode pain evaluation series Implementation Plan

## Overview

Implement new return Episodes with the sequence pain evaluation → zero or more follow-ups → discharge, preserving previous Episodes and existing legacy series.

## Current State

`start_return_episode` creates an active Episode and pain-follow-up encounter. Initial/pain evaluation notes still have case/type uniqueness and case-scoped actions; legacy ownership selects Episode 1. Discharge and follow-ups already support explicit Episodes. Evaluation note status is synchronized to its encounter by `sync_initial_visit_note_encounter`.

## Desired End State

New return Episodes require the latest Episode to be discharged with a finalized discharge, and a visit date no earlier than that discharge's service date. Starting/registering the return evaluation atomically creates an active Episode, a pain-evaluation encounter, and a draft evaluation note. Existing optional scheduling remains available; registration creates the Episode immediately. Finalizing that evaluation unlocks follow-ups and discharge. All evaluation intake, vitals, narrative, orders and navigation target an explicit Episode. Existing return Episodes keep their prior workflow; Episode 1 retains initial-visit plus pain-evaluation tabs.

## Key Discoveries

- `src/actions/initial-visit-notes.ts` uses case/type queries and `ensureLegacyEpisodeEncounter`; `gatherSourceData` only scopes to Episode for QC.
- `src/lib/clinical/save-visit-decision.ts` selects notes by one discriminator; adding optional Episode scope preserves callers.
- `src/components/clinical/intake-draft-context.tsx` centrally saves intake sections and can carry Episode scope.
- `src/app/(dashboard)/patients/[caseId]/initial-visit/page.tsx` can accept `episode` and `visitType` query parameters and pass scope to the existing editor.
- `src/actions/clinical-orders.ts` already uses Episode ownership but implicitly selects active/latest; selected Episode must be forwarded.
- `20260413_initial_visit_visit_type.sql` defines case/type uniqueness; `20260414_initial_visit_date_order.sql` compares sibling dates by case.
- `20260827154248_sync_evaluation_note_encounters.sql` synchronizes note status/date to encounter.

## What We Are Not Doing

No historical note conversion, case reactivation redesign, procedure-series renumbering, production deployment, or changes to note clinical content/templates. A follow-up is optional before discharge; evaluation is mandatory for newly created return Episodes.

## Implementation Approach

Use a backwards-compatible `requires_pain_evaluation` Episode flag, false for existing records and true for new return RPC creations. Apply sequencing in database triggers as well as UI. Keep RPC signature/idempotency contract. Add optional final Episode argument to evaluation actions; omitted scope resolves Episode 1 rather than an arbitrary matching note. Return route supplies explicit scope. Do not treat client-supplied IDs as authority: verify case ownership and Episode writability.

## Phase 1: Database lifecycle

### Files and changes

- New CLI-generated migration: Episode workflow flag, Episode/type note uniqueness, Episode-scoped date ordering, replace return RPC to require previous discharge and create pain evaluation plus draft note atomically.
- Sequence guard: prevent live follow-up/discharge progression for flagged Episodes until its evaluation is finalized/completed; reject dates before evaluation. Preserve existing discharge unresolved-work checks.
- Update generated database types for flag.
- Remove case-wide reparenting from legacy `prepare_evaluation_visit`; constrain it to writable Episode 1. Preserve scheduled status on initial draft insertion in `sync_initial_visit_note_encounter`; generation transitions it to in-progress.
- Scope the procedure-date database trigger to the procedure Episode, including historical procedure updates.
- New database test: two Episodes with same visit type preserve notes; initial return evaluation and idempotency; no prior discharge/active conflict/date checks; follow-up/discharge gating and successful full sequence; legacy compatibility.

### Automated verification

Run local SQL test suite, including new return-series test and existing discharge/reset tests. Inspect local migration application without destructive reset. Run database lint/advisors if available.

### Manual verification

Review migration for existing-row preservation, grants/RLS, locking, replay semantics and service-date comparisons.

## Phase 2: Evaluation isolation

### Files and changes

- `src/actions/initial-visit-notes.ts`: explicit Episode filtering throughout getters, generation, intake, save, finalization, reset, regeneration, tone, vitals and source gathering; retain QC target behavior.
- `src/lib/clinical/episode-context.ts` or new focused helper: resolve Episode 1 by default or validate supplied Episode; reject writes to ended Episodes, wrong cases and inappropriate return visit type.
- `src/lib/clinical/save-visit-decision.ts`: optional Episode selector scope.
- `src/actions/clinical-orders.ts`: optional explicit Episode for selected evaluation orders and writability checks.
- Action/helper regressions for multiple Episodes, source isolation, vitals isolation, old/default callers, wrong-case and discharged writes.
- Scope `src/actions/procedures.ts` diagnosis choices to current Episode and procedure update date floors to the procedure's owning Episode. Preserve billing's intentionally case-wide per-encounter charge list and procedure-note generation's existing post-filter by owning Episode.

### Automated verification

Run affected initial-note, intake, vitals, decision, order and Episode tests; TypeScript check.

### Manual verification

Review every evaluation action caller and source query to prevent mixing older and new Episode notes/vitals.

## Phase 3: UI and navigation

### Files and changes

- Initial-visit route: explicit selected Episode, pain-only return editor, scoped read-only state for ended Episodes, correct date and vitals.
- InitialVisitEditor and intake context: carry Episode to all actions/orders, scope realtime/state identity, preserve ordinary Episode 1 tabs.
- Return dialog: explain evaluation-first flow, route to scoped evaluation (handle old idempotency replay safely).
- Visits page/list: correct evaluation links, evaluation-first controls, follow-ups/discharge on same Episode, visible Episode identity.
- UI regressions: explicit Episode action arguments, historical links, workflow controls.

### Automated verification

Run affected component tests, full `npm test`, `npx tsc --noEmit`, ESLint on changed source, `git diff --check`. Broaden SQL regression tests because cardinality changes.

### Manual verification

If local app is available, exercise discharge → new return evaluation → finalized evaluation → follow-up → discharge and revisit older Episode. Otherwise report browser verification not performed.

## Risks and rollback considerations

Case-scoped readers outside the editor may assume one evaluation; audit all `initial_visit_notes` references and scope singleton reads or intentionally choose latest as appropriate. Existing databases may not be available locally; report exact verification limits. Migration must precede new UI use; do not revert uniqueness after new Episodes have evaluation notes. Roll back by disabling new return starts while retaining data and Episode-aware readers.

## Completion criteria

- [x] New return series opens with independent pain evaluation after prior discharge.
- [x] Follow-up and discharge require finalized evaluation for new series.
- [x] Older notes/intake/vitals remain unchanged and viewable.
- [x] Existing return series and Episode 1 workflows remain usable.
- [x] Relevant tests and static checks pass; verification limitations recorded.

## Follow-up: Existing workflow and Quality Review compatibility

Audit both feature-flag paths, editor links, source snapshots, persistence and source hashes against multiple Episodes. Concrete compatibility gaps: legacy `fixFinding` omitted the new final Episode argument, and QC evaluation editor links omitted Episode/visit type. Preserve existing review generation, finding disposition, lease/version checks and historical records.

Changes: forward the selected Episode in the legacy fix caller; bind evaluation/discharge deep links to the review Episode; add action, panel and snapshot regressions. Add database QC/return-series integration tests using the existing QC migration inside a rollback-only local transaction because the local migration history cannot be safely replayed. Verify existing QC SQL tests, new compatibility SQL, all app tests with bounded workers, types, changed-file lint and diff checks. Do not alter unrelated migrations or repair local history. This is an extension of the original isolation plan; no lifecycle rules change.
