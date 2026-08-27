# Audited Finalized Discharge Corrections Implementation Plan

## Overview

Replace the misleading finalized-discharge **Edit / Unfinalize** control with a
real, audited correction workflow. A correction creates a replacement version
of the finalized discharge document without reopening the care episode,
reactivating completed procedure series, changing the completed discharge
encounter, or silently changing billing records.

This plan deliberately separates two workflows:

- **Start Return Visit** resumes clinical care in a new episode.
- **Correct Finalized Discharge** fixes an error in the historical discharge
  note for the already-discharged episode.

The correction workflow preserves the original PDF, records who corrected the
note and why, supports cancellation before replacement finalization, and makes
the document history understandable in the UI.

## Implementation Status

- [x] Phase 1 schema, RPC, generated-type surface, and pgTAP coverage authored.
- [x] Phase 2 correction validation, server actions, guards, and action tests.
- [x] Phase 3 correction UI, document revision labels, and billing protection.
- [x] Phase 4 TypeScript, Vitest, feature-scoped lint, build, diff, and
  durable-doc verification. Repository-wide lint still reports the unrelated
  pre-existing `invite-user-dialog.tsx` effect error.
- [ ] Apply the migration and run pgTAP/type generation against a clean local
  Supabase database. This remains blocked because this workstation has neither
  Docker nor Podman; no linked production database was modified as a workaround.
- [ ] Complete the manual clinical/PDF verification matrix after the migration
  is available in a test environment.

## Current State

- `src/actions/discharge-notes.ts::unfinalizeDischargeNote()` is a hard stop. It
  authenticates and checks the case lock, then always returns `A finalized
  episode discharge cannot be reopened. Start a return visit instead.`
- `src/components/discharge/discharge-note-editor.tsx::FinalizedView` still
  renders an **Edit** button and dialog that promise to reopen the note and
  remove the finalized PDF. The server can never fulfill that promise.
- `public.finalize_episode_discharge(...)`, most recently defined in
  `supabase/migrations/20260827175109_qualify_finalize_discharge_series_episode_id.sql`,
  performs a compound clinical transition:
  - finalizes the discharge note and links its generated document;
  - completes the discharge encounter;
  - completes active procedure series in the episode;
  - marks the care episode `discharged`.
- `care_episodes_one_active_per_case_idx` permits only one active care episode
  per case. Reopening an older episode would conflict when a later return
  episode is active and would rewrite clinical history.
- Ordinary draft save, regenerate, reset, vitals, and finalization actions
  resolve the active-or-latest episode from only `caseId`. They are not safe for
  editing an explicitly selected historical episode when a later episode exists.
- Follow-up-note unfinalization has an existing database guard against procedure
  orders and active `billing_source_claims`, but discharge has no corresponding
  correction RPC.
- `documents` contains the generated PDF, but it has no revision/supersession
  concept. `softDeleteFinalizedDocument()` also removes the storage object, so
  it must not be used for a medico-legal discharge correction.
- `audit_logs` exists but has no automatic triggers. A purpose-built correction
  record is needed to capture reason, original state, replacement state, actor,
  and timestamps atomically.
- Application roles are `admin`, `provider`, and `staff`; cases also have an
  `assigned_provider_id`.

## Desired End State

- The finalized view never offers an action that is guaranteed to fail.
- Authorized users see **Correct Finalized Discharge** instead of **Edit**.
- Starting a correction requires a meaningful reason and creates an immutable
  audit record before the note becomes editable.
- Authorization rules are fixed as follows:
  - an `admin` may correct a discharge in any case, including a locked case;
  - a `provider` may correct only a discharge for a case assigned to that
    provider, and only while the legal case is not locked;
  - `staff` cannot start, edit, cancel, or finalize a correction.
- An active billing claim for the discharge encounter blocks correction. The
  user must first remove the line from a draft invoice or void the invoice so
  the existing claim-release mechanism records the billing reversal.
- The correction is scoped by `caseId`, `episodeId`, `noteId`, and correction
  ID. It never falls back to the current active/latest episode.
- While correction is open:
  - the note is manually editable and visibly labeled **Correction in
    progress**;
  - the original finalized PDF remains downloadable;
  - AI generation, section regeneration, reset, and tone-driven rewriting are
    unavailable, preventing current source data from silently rewriting a
    historical encounter;
  - the user may cancel and restore the exact pre-correction note snapshot.
- Finalizing the correction creates a new PDF and finalizes the note, but leaves
  the episode `discharged`, the discharge encounter `completed`, and procedure
  series `completed`.
- The original and replacement PDFs remain in storage and in `documents`.
  Document cards distinguish **Superseded discharge** from **Current corrected
  discharge**.
- If a later return episode exists, correction of the explicitly selected prior
  discharge still works because no episode is reopened.
- A finalized correction can itself be corrected again, creating another
  sequential audit record and preserving every prior PDF.

## Key Discoveries

- The existing episode-scoped discharge page accepts `?episode=<uuid>` and can
  load a historical episode. The correction flow should preserve that query
  parameter on every revalidation/navigation.
- The discharge note table permits one live note per episode and encounter. The
  workflow should retain that row and record revisions in a separate table,
  avoiding cardinality and ownership changes.
- Existing `save_invoice_with_claims(...)` releases claims when a draft invoice
  is edited, and the invoice trigger releases claims when an invoice is voided
  or deleted. The correction RPC can therefore enforce a simple active-claim
  precondition without inventing new invoice mutation behavior.
- Direct note updates are currently broadly available to authenticated users
  through existing RLS. This change will follow the repository's server-action
  pattern, while the new correction table exposes authenticated reads but
  routes writes through guarded RPCs.
- The existing `status` constraint already supports the required
  `finalized -> draft -> finalized` note transitions. No new discharge-note
  status is necessary; open correction state comes from the correction record.

## What We Are Not Doing

- Reopening a discharged care episode.
- Reactivating or renumbering completed procedure series.
- Changing the completed discharge encounter back to `in_progress`.
- Using discharge correction to resume treatment; **Start Return Visit** remains
  the only continuation workflow.
- Automatically editing, releasing, or recreating invoice lines or claims.
- Deleting the original finalized PDF or its storage object.
- Allowing AI regeneration during historical correction.
- Building a general document-versioning framework for every note type.
- Backfilling correction history for previously finalized discharge notes; they
  become revision 1 implicitly and enter history only when corrected.

## Implementation Approach

Add an episode-owned `discharge_note_corrections` table and four transactional
RPCs: begin, save, cancel, and finalize. The open correction row stores the original
note snapshot and original document/finalization metadata. The existing note row
temporarily becomes a draft for manual editing, while all surrounding clinical
state remains closed. Finalization links a newly rendered PDF and completes the
audit row. Cancellation restores the saved snapshot exactly.

The application obtains correction context by explicit IDs, applies the same
authorization and billing preconditions at both the action boundary and inside
the RPC, and renders a correction-specific editing state. The documents query
derives revision labels from correction history rather than changing the
existing `documents.status` constraint.

## Phase 1: Add the correction audit model and transactional RPCs

### Files and changes

- Add a new CLI-generated migration under `supabase/migrations/` that creates
  `public.discharge_note_corrections` with:
  - `id`, `case_id`, `episode_id`, and `discharge_note_id` ownership columns;
  - monotonically increasing `revision_number` per discharge note;
  - required trimmed `reason` with a 10-character minimum enforced by a check;
  - `original_document_id` and nullable `replacement_document_id`;
  - `original_note_snapshot jsonb` containing the complete pre-correction note
    row, including finalizer metadata and section content;
  - lifecycle `status` constrained to `open`, `finalized`, or `cancelled`;
  - opened/finalized/cancelled timestamps and actor IDs;
  - standard created/updated timestamps;
  - a new additive `(id, episode_id, case_id)` unique constraint on
    `discharge_notes`, then a composite correction-to-note foreign key so note,
    episode, and case ownership cannot diverge;
  - ordinary foreign keys for original/replacement documents, with
    same-case/episode/encounter ownership rechecked by the RPCs;
  - a unique partial index allowing one `open` correction per note and a unique
    `(discharge_note_id, revision_number)` index.
- Enable RLS on the new table. Allow authenticated reads needed by the discharge
  and document screens, revoke direct insert/update/delete from authenticated
  clients, and grant mutation only through the RPCs.
- Put narrowly scoped `SECURITY DEFINER` implementations in an unexposed
  `private` schema, with `search_path = ''`, explicit `auth.uid()`/role checks,
  fully qualified object names, and revoked execution for `public` and `anon`.
  Expose same-named `public` RPC wrappers as `SECURITY INVOKER`; grant the
  authenticated role only the private-schema usage/function execution needed by
  those wrappers. This follows current Supabase guidance not to place privileged
  functions in an exposed schema while still allowing writes after direct table
  privileges are revoked.
- Add a private SQL authorization helper used by every correction RPC:
  - load `auth.uid()` and `public.users.role`;
  - permit admin universally;
  - permit an assigned provider only when the case is not in
    `pending_settlement`, `closed`, or `archived`;
  - reject staff, inactive/missing users, cross-case IDs, and soft-deleted
    records.
- Add `public.begin_discharge_correction(...)`:
  - lock the case, episode, discharge encounter, note, and relevant correction
    rows;
  - require the note to be finalized with a live original document;
  - require the episode to be discharged and the encounter to remain completed;
  - reject any active `billing_source_claims` row for the discharge encounter;
  - allocate the next revision number under lock;
  - insert the audit row and full original snapshot;
  - update only the note to `draft`, clear its current document/finalization
    link, and retain the original document unchanged;
  - return the correction ID and support a stable duplicate-open error.
- Add `public.save_discharge_correction(...)`:
  - repeat authorization and explicit case/episode/note/correction ownership
    checks under lock;
  - require the correction to be open and the note to be draft;
  - accept the action-validated editable fields as JSON, explicitly map the 12
    note sections and `visit_date`, and reject missing/unexpected lifecycle
    mutation fields;
  - update content and `updated_by_user_id` only, leaving episode, encounter,
    documents, finalization metadata, and the correction snapshot untouched.
- Add `public.cancel_discharge_correction(...)`:
  - repeat authorization, ownership, and open-status checks, but do not block
    cancellation if a claim appeared concurrently because restoring the
    original is the safe recovery path;
  - lock the open correction and note;
  - restore every provider-editable, AI-metadata, status, finalization, and
    document field from `original_note_snapshot`; retain the original
    `created_at`/creator, let the existing trigger set `updated_at`, and set
    `updated_by_user_id` to the cancelling actor;
  - mark the correction `cancelled` with actor/time;
  - leave episode, encounter, series, original document, and storage untouched.
- Add `public.finalize_discharge_correction(...)`:
  - repeat authorization, ownership, open-state, and active-claim checks;
  - require a draft note and a new live generated document owned by the same
    case, episode, and encounter;
  - set the note back to `finalized` with the replacement document and current
    finalizer metadata;
  - close the correction audit row with replacement document, actor, and time;
  - explicitly do not update `care_episodes`, `clinical_encounters`, or
    `procedure_series`;
  - be idempotent when replayed with the already-recorded replacement document.
- Add a `BEFORE INSERT` trigger on `billing_source_claims` that rejects a visit
  claim for a discharge encounter while that encounter's correction is `open`.
  This closes the race between correction and invoice creation without relying
  only on the UI.
- Regenerate `src/types/database.ts` from the local schema after the migration.
- Add `supabase/tests/database/discharge_note_correction_test.sql` covering the
  database behavior and invariants.

### Automated verification

- Run the new pgTAP file through the local Supabase test runner.
- Verify begin correction:
  - changes only the note to draft;
  - preserves the original document and storage reference;
  - leaves episode discharged, encounter completed, and series completed;
  - works for an older discharged episode while a later episode is active.
- Verify authorization rejection for staff, an unassigned provider, and a
  provider on a locked case; verify admin access on a locked case.
- Verify rejection for cross-case IDs, non-finalized notes, non-discharged
  episodes, missing original documents, duplicate open corrections, and active
  discharge billing claims.
- Verify cancellation restores the exact saved note content, original document,
  original finalizer metadata, and finalized status.
- Verify correction finalization links the replacement, preserves the original,
  does not change clinical state, and is idempotent.
- Verify a second correction receives the next revision number.
- Verify billing-claim insertion is rejected while a correction is open, then
  succeeds after cancellation or corrected finalization.

### Manual verification

- Inspect the migrated rows locally and confirm the original document remains
  readable throughout begin, cancel, and finalize operations.
- Confirm a historical discharge can be targeted explicitly without changing
  the current active episode.

## Phase 2: Add explicit correction server actions and validation

### Files and changes

- Add correction request schemas to
  `src/lib/validations/discharge-note.ts`:
  - required correction reason;
  - explicit UUID ownership fields;
  - reuse `dischargeNoteEditSchema` for manual corrected content.
- Update `src/actions/discharge-notes.ts`:
  - remove the dead `unfinalizeDischargeNote()` export;
  - add `beginDischargeCorrection(caseId, episodeId, noteId, reason)`;
  - add `saveDischargeCorrection(caseId, episodeId, noteId, correctionId,
    values)` that validates the form and calls `save_discharge_correction`
    rather than directly updating the note;
  - add `cancelDischargeCorrection(...)`;
  - add `finalizeDischargeCorrection(...)` that renders/uploads the replacement
    PDF, creates its `documents` row, invokes the correction-finalization RPC,
    and cleans up only the newly uploaded file if the RPC fails;
  - add `getDischargeCorrectionContext(...)` for current/open/history state and
    original/replacement document paths;
  - centralize the action-side admin/assigned-provider check and return precise
    messages for authorization, locked cases, billing claims, and stale
    correction state;
  - use explicit episode/note/correction IDs for all correction operations;
  - add a shared no-open-correction guard to ordinary generate, save,
    regenerate, reset, vitals, tone, and first-time finalize actions so stale
    tabs and ordinary draft endpoints cannot mutate a correction draft;
  - revalidate the episode-specific discharge URL, documents, visits, timeline,
    and billing pages after lifecycle transitions.
- Ensure replacement PDF metadata and download naming continue to use the
  discharge `visit_date`, while the stored document name identifies the revision
  (for example, `Discharge Summary - Corrected v2`).
- Do not call `softDeleteFinalizedDocument()` anywhere in the correction path.
- Add focused action tests in a new
  `src/actions/__tests__/discharge-note-corrections.test.ts` using the existing
  Supabase action mocks, extending the test-local mock with storage
  upload/remove behavior because the shared mock currently exposes only query,
  RPC, and auth methods.

### Automated verification

- Test invalid/empty reasons and mismatched identifiers.
- Test that staff and unassigned providers are rejected before mutation.
- Test that an active claim produces the actionable billing error.
- Test save is limited to a draft note with the matching open correction.
- Test every ordinary discharge mutation returns a correction-specific error
  while a correction is open.
- Test upload/RPC failure removes only the uncommitted replacement PDF/document
  and never touches the original.
- Test finalization revalidation includes the episode-specific discharge route
  and document route.

### Manual verification

- Exercise each action against local data as admin and assigned provider.
- Confirm server errors remain understandable when the UI state becomes stale
  in another tab.

## Phase 3: Replace the stale UI with the correction experience

### Files and changes

- Update `src/app/(dashboard)/patients/[caseId]/discharge/page.tsx` to:
  - load the current user role and assigned-provider relationship;
  - load correction context for the explicitly resolved episode/note;
  - load the original PDF path while a correction is open;
  - pass authorization, correction history, and episode ID to the editor.
- Update `src/components/discharge/discharge-note-editor.tsx`:
  - remove the existing **Edit / Unfinalize** dialog and dead action import;
  - show **Correct Finalized Discharge** only to an authorized user;
  - require a correction reason in a confirmation dialog that explains the
    original remains preserved and that this does not resume care;
  - show an actionable billing-block message when the discharge encounter has
    an active claim;
  - add a **Correction in progress** editor mode with the reason and revision
    number visible;
  - use `saveDischargeCorrection` instead of the ordinary draft save action;
  - hide/disable Reset, AI Generate, section Regenerate, and tone controls in
    correction mode;
  - provide **Cancel correction** and **Finalize corrected discharge** actions;
  - keep **Download original PDF** available during correction;
  - after finalization show a **Corrected vN** badge and a compact revision
    history with original/replacement download links;
  - keep **Start Return Visit** language out of correction dialogs except for a
    short clarification that returning care uses the Visits screen.
- Update `src/actions/documents.ts` to join correction rows for generated
  discharge documents and derive a `revision_status` plus revision number for
  each original/replacement document.
- Update `src/components/documents/document-list.tsx` and
  `src/components/documents/document-card.tsx` to display **Superseded
  discharge** and **Current corrected discharge** badges without changing the
  existing review-status filter.
- Ensure superseded documents cannot be removed through the ordinary document
  delete action. Add a server guard in `src/actions/documents.ts::removeDocument`
  when a document participates in discharge correction history.
- Update billing candidate assembly in `src/actions/billing.ts` to omit a
  discharge encounter while it has an open correction. The Phase 1 database
  trigger remains the concurrency and security backstop.

### Automated verification

- Add unit coverage for the document revision-state derivation:
  - unrelated documents remain unchanged;
  - original document is superseded only after replacement finalization;
  - replacement receives the current revision label;
  - an open/cancelled correction does not falsely supersede the original.
- Add action coverage proving correction-history documents cannot be removed.
- Run the existing discharge validation, document filename, billing service-date,
  and invoice-claim tests as regression coverage.
- Run lint and TypeScript/build checks for updated server/client prop contracts.

### Manual verification

- Finalized discharge, authorized admin/provider:
  - correction button is visible and reason is required;
  - original PDF downloads before and during correction;
  - manual edits save and survive refresh;
  - AI/reset controls are unavailable;
  - cancellation restores the original finalized display exactly;
  - finalization generates the corrected PDF with the normal header/signature.
- Staff/unassigned provider: no correction action is shown, and direct action
  invocation is rejected.
- Locked case: admin can correct; provider cannot.
- Active billing claim: begin is blocked with instructions to edit/void the
  invoice first; after the claim is released, begin succeeds.
- Historical episode with a later active return episode: correction stays on
  the selected historical episode and the active episode remains unchanged.
- Documents screen: both PDFs remain downloadable with unambiguous current and
  superseded labels.
- Returning care still uses **Schedule Follow-Up / Start Return Visit** and is
  unaffected by document correction.

## Phase 4: Regression, migration, and rollout verification

### Files and changes

- Update durable workflow documentation in
  `thoughts/shared/plans/2026-08-25-additional-pain-management-tele-visits-implementation.md`
  only after implementation, replacing the “future capability” statement with
  a reference to the implemented audited correction flow while retaining the
  prohibition against reopening discharged episodes.
- Review the complete diff and generated types for unrelated changes before
  committing. The worktree already contains unrelated active-series and
  discharge-generation work; do not include or alter those files unless they
  are directly required and ownership is reconciled first.

### Automated verification

- Run the narrow action and helper tests introduced above.
- Run `npm run db:test` against a clean local database.
- Run the existing `finalize_episode_discharge_test.sql` to prove ordinary
  first-time discharge behavior is unchanged.
- Run `npm test` for the full Vitest suite.
- Run `npm run lint`.
- Run `npm run build`.
- Run `npm run gen:types:local` after applying migrations locally and confirm
  generated database types are clean.

### Manual verification

- Execute the full correction matrix on a local case:
  - no later episode/no invoice;
  - later active episode;
  - draft invoice claim;
  - voided/released invoice claim;
  - closed case as admin;
  - assigned provider and unauthorized staff.
- Compare the original and replacement PDFs visually for header, provider
  signature, service date, and corrected content.
- Confirm visits, billing, procedure series, and case status before and after
  correction are identical except for the discharge note/document revision.

## Risks and rollback considerations

- **Medico-legal record loss:** deleting or overwriting the original PDF would
  destroy evidence of the prior signed record. Mitigation: never soft-delete or
  remove the original document/storage object; regression-test this invariant.
- **Historical episode corruption:** reusing the original finalization RPC would
  require an active episode and could touch series state. Mitigation: use a
  separate correction-finalization RPC that explicitly leaves clinical state
  unchanged.
- **Wrong-episode edits:** case-only resolution can target a later episode.
  Mitigation: every correction action uses and validates explicit case, episode,
  note, and correction IDs.
- **Billing inconsistency:** changing a discharge service date after billing can
  make the note and invoice disagree. Mitigation: block while any active visit
  claim exists, omit open corrections from billing candidates, reject concurrent
  claim insertion in the database, and rely on existing invoice edit/void claim
  release.
- **Abandoned correction:** a draft could otherwise leave the finalized note
  unavailable. Mitigation: retain the original PDF, expose correction status,
  and provide an atomic snapshot-based cancellation RPC.
- **Concurrent tabs:** two users could begin or finalize simultaneously.
  Mitigation: row locks, the unique open-correction index, and idempotent final
  RPC behavior.
- **Rollback:** hide/remove the correction UI and stop calling the additive
  RPCs. Do not drop correction rows or delete historical PDFs. Any already-open
  correction must be finalized or cancelled with the deployed RPC before the
  UI is rolled back.

## Completion criteria

- The stale Edit/Unfinalize promise is removed.
- Authorized users can begin, save, cancel, and finalize a corrected discharge
  through the UI with a required reason.
- Original and replacement PDFs are both preserved and clearly labeled.
- Correction works against an explicitly selected historical episode even when
  a later episode is active.
- Episode, encounter, procedure-series, case, and billing state do not change as
  a side effect of correction.
- Active billing claims prevent correction until released through the existing
  invoice workflow.
- Authorization is enforced in both server actions and database RPCs.
- Database, action, helper, regression, lint, type, and build checks pass.
- Manual verification confirms PDF header, signature, service date, revision
  labels, permissions, billing guard, and later-episode safety.
