# Case Reactivation and Note Reset Implementation Plan

## Overview

Implement the design accepted by the user on 2026-09-08: separate **Reactivate
case** and **Reset note** actions, with optional selected-note resets inside the
reactivation confirmation. Reset means clearing generated text for a fresh start.

Implementation was authorized and completed in the workspace; database rollout
and the remaining local/manual verification are tracked below. Research baseline:
`thoughts/shared/research/2026-09-08-case-reactivation-and-note-reset.md`.

## Current State

`updateCaseStatus` changes case status and close date but does not reopen a care
episode. Draft/failed reset actions exist for discharge, procedure, initial visit,
pain evaluation, and pain follow-up notes. Finalized evaluation/procedure/follow-up
notes have separate unfinalization paths; some remove the previous PDF. Discharge
corrections preserve the signed record but do not reopen care.

Discharge finalization completes its encounter and active procedure series and
marks the episode discharged. Follow-up resets require an active episode and
in-progress encounter. Therefore, changing the case to Active alone does not
provide the requested fresh-start workflow.

## Desired End State

### Accepted product behavior

1. Reactivation sets the case to Active and reopens its latest discharged episode.
   Visits, performed procedures, intake, vitals, and billing records are preserved.
   An older episode cannot be reopened while a newer episode is active.
2. Reset clears generated text and AI metadata from explicitly selected notes,
   producing empty drafts ready for generation. Supported families are discharge,
   procedure, initial visit, pain evaluation, and follow-up.
3. Resetting finalized notes requires an administrator and a reason. The old signed
   content and PDF remain in revision history; a replacement finalization marks
   the prior version superseded.
4. Dependent billing claims or procedure orders block affected resets. The UI
   identifies the records to resolve; reset never deletes them automatically.
5. Confirmation lists the exact episode and notes affected. Note selection starts
   empty, so reactivation alone preserves documentation.
6. All database changes in a submitted operation succeed or fail together, with
   actor, reason, time, and affected records recorded in audit history.
7. **Correct discharge** remains the documentation-amendment workflow; **Start
   return visit** remains the new-course-of-care workflow.

### Concrete implementation defaults

- The new episode-reopening operation is administrator-only and requires a reason
  of at least 10 trimmed characters. Ordinary case status changes retain existing
  permissions. Resetting drafts retains existing authorized-user behavior; any
  finalized selection makes the whole operation administrator-only.
- Reactivation targets the latest nondeleted episode by explicit ID. Do not infer
  a different episode at submission time. If already active, do not alter its
  lifecycle; optional selected resets can still proceed. If no episode exists,
  offer the existing status-change flow instead. Cancelled episodes are ineligible.
- Standalone reset requires an unlocked case and active owning episode. A finalized
  discharge in a discharged episode routes to Reactivate case with that note
  selected, visibly confirmed. Do not silently reactivate through a reset request.
- Bulk selection is limited to the target episode and existing notes. No automatic
  selection of every historical note, and no dependent-note reset cascade.
- Reactivation alone preserves the finalized discharge and completed encounters as
  historical documentation. Display that the episode was reopened after discharge.
  A fresh discharge requires explicitly resetting that note and finalizing anew.
- Preserve procedure-series states on reactivation: completed treatment is not
  assumed to be unfinished. New treatment uses existing series/order workflows.
  Resetting a procedure note does not undo the performed procedure or appointment.
- Resetting an evaluation, discharge, or follow-up note returns its documentation
  encounter to in-progress and clears completion time. Retain service date,
  provider, consent, intake, measurements, and identifiers. Respect existing
  evaluation-note synchronization triggers rather than applying conflicting updates.
- Open discharge corrections block reactivation and resets in that episode until
  finalized or cancelled. Retain all completed/cancelled correction history.
- Block a selected finalized note when its encounter/procedure has an unreleased
  billing claim or its encounter has a live dependent procedure order. Voided or
  released relationships follow existing billing semantics. Apply these checks
  again inside the mutation transaction, not only in preview.
- Preserve signed versions as historical immediately after reset, label them
  “Reset — replacement pending,” and mark superseded only after a replacement
  finalizes. Never show a historical PDF as the current draft's finalized output.
- Existing Edit/unfinalize still retains text, but all finalized-to-draft entry
  points must use the same administrator/reason and signed-history protection.
  Otherwise Edit followed by draft Reset would bypass finalized-reset safeguards.
  Apply this to direct RPC access as well as the visible controls.

## Key Discoveries

- Case and episode statuses are separate; episode selection normally prefers an
  active episode over the latest historical episode.
- Existing reset semantics preserve source data but differ in cleared metadata.
  The new contract must clear section progress, structured generated recommendations,
  generation errors/hashes, and generated review/trajectory state consistently.
- Initial/evaluation notes synchronize encounter state through database triggers.
- Follow-up reset/unfinalize already use transactional lifecycle checks. Existing
  initial/procedure unfinalize PDF deletion must not be reused for the new reset.
- Document revision presentation currently recognizes discharge corrections only.
  Preserving other signed note versions requires both history storage and display.
- Current source lookup during generation does not automatically regenerate other
  notes when an upstream note changes.

## What We Are Not Doing

Deleting clinical encounters, performed procedures, appointments, orders, invoices,
billing claims, intake, vitals, or storage objects; bulk-resetting older episodes;
starting a new care episode; automatic AI generation; changing settled billing;
or executing case-specific cleanup scripts. Existing Edit/unfinalize retains its
content-preserving purpose while adopting the shared signed-record safeguards.

## Implementation Approach

Add a shared preview and transaction-backed mutation contract used by the case
reactivation dialog and individual note reset controls. Preview returns exact
identities, note statuses/versions, permission decisions, and actionable blockers.
Submission supplies those identities, expected versions, selection, reason, and
an idempotency key. Recheck ownership, permissions, state, and dependencies inside
the database operation; reject stale previews without partial changes.

Use additive database audit/revision storage with immutable note snapshots and
original/replacement document references. Retain the existing discharge correction
model; combine its document lineage with reset history for presentation. Link the
replacement atomically with successful finalization, including the older
initial/procedure finalizers. PDF creation happens before this transaction, as in
the current finalization pattern; failed finalization cleans up only the newly
created unreferenced output. Every finalizer captures the exact note version used
to render the PDF and submits it to the committing RPC. Under lock, reject any
changed version/status instead of attaching an output rendered from stale content.

Use a reviewed common locking strategy across reset, finalization, correction,
episode creation/reactivation, and dependency creation. Preserve the existing
note → encounter → episode → case ordering where applicable, order multiple notes
deterministically, and avoid case-first calls into note-locking functions. Protect
against concurrent new episodes and dependencies with constraints and cooperating
locks. Retryable conflicts return a stable refresh/retry response.

## Phase 1: Transaction Contract, Audit, and Revision Storage

### Files and changes

- Create a timestamped migration via the Supabase CLI under `supabase/migrations/`.
  Add immutable reset-operation and note-revision records, explicit note ownership,
  original/replacement document references, actor/reason, expected versions, and
  unique idempotency protection. Preserve the one-active-episode constraint.
- Add preview and mutation RPCs for reactivation and selected-note reset. Validate
  all IDs against the same case/episode and supported note family. Reject generating,
  deleted, mismatched, cancelled, or stale rows. A request-key replay must return the
  original result; reuse with changed input must fail.
- Enforce active-account/administrator checks in the database for privileged work,
  with RLS and restricted grants for immutable history. Do not rely on UI role flags.
- Reset only generated fields, clear finalization/document pointers on reset drafts,
  preserve signed snapshots/PDFs, and update appropriate encounters atomically.
  Record case/episode transitions even when no notes are selected.
- Prevent later cleanup/delete actions from removing retained revision documents.
  Resolve legacy missing-document links by returning a specific blocker for signed
  resets rather than silently claiming a preserved PDF.
- Regenerate `src/types/database.ts` from the local schema.

### Automated verification

Add database tests for each note family and reactivation-only operations; source
data preservation; exact field clearing; immutable signed history; active/inactive
accounts and roles; cross-case IDs; later active episodes; cancelled episodes;
open corrections; billing/order blockers; mixed-selection rollback; stale versions;
idempotent replay; and concurrent finalize/reset/return-episode/dependency creation.
Exercise authenticated RPC access and denied direct history writes.

### Manual verification

Inspect representative before/after rows in a local fixture database. Confirm
reactivation without selection changes no note, procedure, or billing content.

## Phase 2: Server Actions and Finalization Integration

### Files and changes

- Add shared actions and validation modules under `src/actions/` and
  `src/lib/validations/` for preview/reactivate/reset contracts. Return structured
  blocker identities and user-facing messages without exposing database internals.
- Integrate `src/actions/case-status.ts` and the existing note action modules
  (`discharge-notes.ts`, `procedure-notes.ts`, `initial-visit-notes.ts`, and
  `pain-follow-up-notes.ts`) with the transaction-backed reset path. Retain compatible
  draft-reset callers while adding explicit note and episode identity for new flows.
- Make all four finalizers link pending reset revisions to replacement documents
  atomically with note finalization. Subsequent resets must extend, not overwrite,
  lineage. Update cleanup paths to preserve referenced historical documents.
- Route legacy initial/procedure/follow-up unfinalize actions and RPCs through the
  same guarded signed-revision transition, retaining narrative for Edit. Remove
  their deletion of signed PDFs and collect administrator/reason before opening
  a signed note. Prevent direct table writes from bypassing these transitions.
- Coordinate discharge correction guards/history with reactivated episodes:
  correction remains for finalized discharges in discharged episodes; while an
  episode is active, reset is the explicit fresh-start path. Preserve existing
  correction cancel/finalize behavior for unchanged episodes.
- Revalidate case overview/status, note route, visits, procedures, documents,
  timeline, and case lists as affected. Retain the return-visits feature gate for
  follow-up mutations in both individual and bulk requests.

### Automated verification

Add action tests for authorization, feature flags, version/identity forwarding,
error mapping, replay, and cache refresh. Test each reset → generate → finalize
sequence, failed upload/finalization, repeated revisions, and history-preserving
cleanup. Test Edit → Reset and direct legacy RPC/table-write bypass attempts.
Test reset/edit during PDF rendering: the stale finalizer must fail, retain the
winning note/history state, and remove only its own unreferenced output.
Run existing case-status, follow-up lifecycle, discharge-correction, and
generation tests to catch regressions.

### Manual verification

Generate and finalize one replacement of each family in local fixtures. Verify
that source data still populates generation and both original and replacement
documents remain accessible with correct lineage.

## Phase 3: Reactivation, Reset Selection, and Document History UI

### Files and changes

- Integrate a Reactivate case dialog into the case overview alongside the existing
  status controls. Keep Change Status's administrative meaning explicit; do not
  silently turn every transition to Active into an episode reopen.
- Add a reusable reset confirmation component under `src/components/clinical/`.
  List episode number, dated note titles/statuses, and exact proposed changes.
  Reactivation starts with zero selected notes. Finalized resets collect a reason.
- Connect all existing note editors to the shared preview and reset behavior.
  Hide/disable unsupported actions by capability, show blockers with navigable
  references, refresh stale previews, and prevent duplicate submission.
- Extend document loading and revision rendering, currently based on
  `src/lib/documents/discharge-revision-state.ts`, to include reset revisions without
  mislabelling existing corrections. Show historical, replacement-pending, and
  superseded states, with original/replacement downloads and actor/reason/time.
- Show the reopened-episode state with preserved discharge history. Keep Correct
  discharge and Start return visit clearly distinct from reset/reactivation.

### Automated verification

Add UI tests for empty default selection, exact affected-note confirmation,
administrator-only finalized reset, reason validation, blocker links, stale refresh,
failed-operation state, generating-note exclusion, and post-reset generation view.
Add revision-presentation tests covering mixed correction/reset chains and pending
replacement states. Verify ordinary draft reset remains usable for allowed users.

### Manual verification

Exercise admin and non-admin roles; reactivation alone; reactivation with several
selected notes; standalone reset; blockers; later episode conflict; and correction
versus reset versus return-care choices. Check keyboard operation and narrow layouts.
Confirm unselected notes and billing remain unchanged and historical PDFs are visible.

## Risks and rollback considerations

Use additive schema changes and keep existing signed records intact. Roll out
database functions before dependent application code. If disabled after use, retain
revision/history tables and documents; never roll back by erasing audit records.

The highest risks are concurrent lifecycle transitions, hidden dependency writers,
legacy incomplete ownership/document links, and confusing historical discharge
with current episode state. The database tests and explicit preview address those
boundaries. Do not guess that completed series should be reactivated.

## Completion criteria

- All accepted behaviors and concrete defaults above are implemented.
- Each phase's automated and manual checks pass, including database concurrency
  cases and immutable document history.
- Run targeted tests first, then `npm test`, `npm run lint`, `npx tsc --noEmit`,
  and `npm run build`; run `npm run db:test` against a prepared local database.
  Regenerate database types using the repository's local type-generation script.
- Review the final diff and report commands/results, separating automated checks,
  manual verification, and any environment limitations.
- No unrelated files or pre-existing cleanup scripts are modified.

## Plan Verification Summary

Overall readiness: **Ready for implementation** following the phased checks above.

### Findings and changes

- Major, Phase 2: legacy Edit/unfinalize could bypass signed-reset authorization
  and PDF retention. Resolved by bringing every finalized-to-draft entry point
  under the shared signed-revision safeguards and adding bypass regression tests.
- Major, finalization integration: atomic revision linking alone would allow a
  stale rendered PDF after concurrent reset/edit. Resolved by requiring the exact
  rendered note version at finalization and testing the competing transitions.

### Missing work and risks

No further product decisions were identified in the focused review. Migration,
locking, authorization, document lineage, and UI implementation remain planned
work, with their verification requirements above. Readiness is not a claim that
the schema changes or runtime behavior have been implemented or tested.

### Final recommendation

Approve the plan with the incorporated changes. Required sections and whitespace
were checked for this documentation update; application tests were not rerun
because no application code changed.


## Implementation status — 2026-09-08

### Completed implementation

- [x] Phase 1: migration `supabase/migrations/20260908231215_case_reactivation_note_reset.sql`
  adds `preview_clinical_reset`, `apply_clinical_reset`, immutable operation/revision
  tables, signed-document retention, versioned finalization, dependency locks,
  and protected episode reactivation.
- [x] Phase 2: `src/actions/clinical-reset.ts` and
  `src/lib/validations/clinical-reset.ts` implement the shared contract. Note
  finalizers use the rendered version; old signed Edit endpoints fail closed and
  their replacement controls preserve content through the audited operation.
  Existing initial/procedure/discharge draft actions delegate to the shared
  contract; the compatible follow-up draft RPC remains available.
- [x] Phase 3: `ClinicalResetDialog` is connected to case overview and all note
  editors. Selection starts empty for case reactivation. Documents display pending
  and superseded signed versions with actor/reason/date. The case overview displays
  a reopened active episode; correction availability requires a discharged episode.
- [x] Review resulting diff and preserve unrelated cleanup scripts/research.

### Automated verification performed

- `npm test`: 104 test files, 1,350 tests passed (including reset actions, six
  confirmation-dialog cases, signed history, and failed-finalization cleanup).
- `npx tsc --noEmit`: passed with schema-introspected table/foreign-key additions
  and the new RPC signatures in `src/types/database.ts`.
- ESLint over all changed/new TypeScript files: passed with no warnings or errors.
- `npm run lint`: blocked by an existing, unrelated
  `react-hooks/set-state-in-effect` error in
  `src/components/settings/invite-user-dialog.tsx:62` (40 additional warnings).
- `npm run build`: passed after allowing the configured Google Fonts fetch.
- `git diff --check`: passed.
- `node /tmp/cliniq-reset-db/check.mjs`: applied migrations to an isolated PGlite
  PostgreSQL runtime and passed assertions from `clinical_reset_test.sql`,
  `finalize_episode_discharge_test.sql`, and `pain_follow_up_reset_test.sql`.
  The reset test exercises all four tables, inactive/nonadmin actors, ownership,
  open corrections, billing/orders, all-or-nothing reset, retained storage,
  Edit followed by Reset, repeated revisions, stale versions, generating status,
  idempotency, replacement finalization, and later-episode rejection.

### Verification limits and rollout checklist

- [ ] Run `npm run db:test` on the full local Supabase stack. The command was
  attempted but PostgreSQL at `127.0.0.1:54322` was unavailable; Docker is absent.
  The isolated runtime used SQL assertion helpers instead of pgTAP and minimal
  auth/storage fixtures. It also made historical duplicate `ADD COLUMN` statements
  idempotent in memory only; repository migrations were not altered for that workaround.
- [ ] Run real multi-connection reset/finalization/dependency/return-episode races.
  Sequential stale-state and dependency tests passed; PGlite does not establish
  multi-connection concurrency correctness.
- [ ] Re-run the existing discharge correction SQL suite with valid local provider
  fixtures. Its isolated run stopped at a pre-existing assigned-provider foreign-key
  fixture failure. New reset tests independently cover correction open/cancel blocking.
- [ ] Run `npm run gen:types:local` on that stack and compare the output. The local
  CLI generator requires the unavailable stack; changed table/foreign-key types were
  obtained from the isolated PostgreSQL schema instead.
- [ ] Perform the manual role, browser, keyboard/narrow-layout, generation, PDF
  download, and original/replacement history checks described for each phase.
  No manual check is marked complete without user confirmation.
- [x] Applied migration `20260908231215` to production, then promoted the ready
  Vercel deployment on 2026-09-08 following the user’s explicit rollout request.

### Implementation refinements

Version stamps use a monotonic timestamp instead of transaction-constant `now()`;
otherwise two edits within one transaction could evade stale-version checks.
Section regeneration also checks its input version so output generated before a
reset cannot repopulate the reset note. PDF cleanup marks its document discarded
before removing storage and stops if that update fails, including an uncertain
finalization response. These safeguards support the accepted reset/retention contract.


## Production release — 2026-09-08

Release commit: `829899a` (`feat: add case reactivation and note reset`).
Deployment: `dpl_2p37Ftt4wZ14mcSrUm7yLdnVCjJ6`, built from a clean archive of that
commit with production settings, reached READY. Supabase confirmed the new reset
migration was the only pending migration and applied it successfully before the
Vercel promotion. `https://cliniq-nine.vercel.app` resolves to the new deployment;
login returned 200 and unauthenticated `/patients` redirected to login.
Production permission checks passed, unauthenticated reset was rejected, and the
security advisor reported no errors. No patient records were reset during rollout.
Manual clinical workflow and true concurrency checks remain pending as listed above.
Automatic approval review blocked the separate push to `main`; the live deployment
is complete, and pushing the shared default branch requires explicit approval.
