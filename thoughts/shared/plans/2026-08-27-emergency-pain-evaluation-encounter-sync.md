# Emergency Pain Evaluation Encounter Sync Implementation Plan

## Overview

Fix the visit lifecycle inconsistency that leaves a finalized Initial Visit or Pain Evaluation note linked to an `in_progress` encounter. A finalized Pain Evaluation must independently satisfy procedure-note prerequisites when an emergency visit intentionally skips Initial Evaluation. Saving vitals from the Pain Evaluation tab must not create an `initial_evaluation` encounter.

## Current State

- `finalizeInitialVisitNote()` finalizes `initial_visit_notes` and creates its PDF/document, but it does not complete the linked `clinical_encounters` row.
- `unfinalizeInitialVisitNote()` reopens the note without reopening its linked encounter.
- `checkProcedureNotePrerequisites()` correctly accepts a completed `initial_evaluation`, `pain_evaluation`, or `pain_follow_up`; it does not require Initial Evaluation specifically.
- `saveInitialVisitVitals()` has no visit-type argument and always creates/owns new non-procedure vitals through an `initial_evaluation` encounter.
- Production contains a finalized `pain_evaluation_visit` note whose linked `pain_evaluation` encounter remains `in_progress`, plus an unperformed `initial_evaluation` encounter created by vitals ownership. Consequently the procedure episode has zero qualifying completed encounters.

## Desired End State

- Finalizing either `initial_visit` or `pain_evaluation_visit` atomically marks its linked encounter `completed`, sets `completed_at`, and preserves the note's visit date as the encounter date.
- Reopening either note atomically restores its linked encounter to `in_progress` and clears `completed_at`.
- A finalized Pain Evaluation unlocks procedure-note generation even when no Initial Evaluation exists.
- Saving vitals from either tab creates or reuses the encounter corresponding to that tab and attaches the shared vitals row to that encounter.
- Existing finalized-note/encounter mismatches are repaired, and the narrowly identifiable phantom Initial Evaluation created for the affected emergency Pain Evaluation is removed without deleting genuine clinical visits.

## Key Discoveries

- `src/actions/procedure-notes.ts::checkProcedureNotePrerequisites()` already models the correct alternative prerequisite.
- `src/actions/pain-follow-up-notes.ts` and `supabase/migrations/20260826212446_return_visit_workflow_rpcs.sql` establish the pattern that note and encounter lifecycle changes belong in one database transaction.
- A database trigger on `initial_visit_notes` can enforce the invariant for existing server actions and any future direct authenticated writes without adding a new RPC API.
- `initial_visit_notes` already owns both `episode_id` and `encounter_id`, and ownership constraints ensure all three case/episode/encounter identifiers agree.
- Non-procedure vitals are currently a shared case snapshot. This fix preserves that compatibility behavior while correcting which encounter owns the snapshot.
- Supabase's August 2026 changelog has no relevant breaking change for ordinary Postgres triggers or PostgREST updates.

## What We Are Not Doing

- We are not requiring an Initial Evaluation before a Pain Evaluation.
- We are not changing the procedure-note prerequisite rule.
- We are not inferring `in_person` or `telehealth` modality for legacy records where it is unknown.
- We are not redesigning non-procedure vitals into multiple per-encounter snapshots in this fix.
- We are not deleting every encounter that lacks a note; only the strict phantom pattern produced by the known vitals bug is eligible for repair.

## Implementation Approach

Install a database invariant that synchronizes linked evaluation encounters after note insert/status changes, backfill current mismatches, and repair the phantom-vitals ownership pattern. Pass the selected `NoteVisitType` into the vitals action so future Pain Evaluation saves resolve `pain_evaluation` ownership instead of hard-coding Initial Evaluation.

## Phase 1: Database Lifecycle Invariant and Data Repair

### Files and changes

- Create a migration with `npx supabase migration new`.
- Add a `security invoker`, empty-search-path trigger function for `initial_visit_notes` that:
  - validates the linked encounter type matches `visit_type`;
  - marks the encounter completed when the note becomes finalized;
  - restores the encounter to in-progress when a finalized note is reopened;
  - synchronizes encounter date and updater metadata.
- Add an `AFTER INSERT OR UPDATE OF status, finalized_at, visit_date, encounter_id, deleted_at` trigger so the note and encounter update commit atomically.
- Backfill live note/encounter status mismatches using the same status mapping.
- Repair only a phantom `initial_evaluation` when all of these hold:
  - no live `initial_visit` note owns it;
  - a live Pain Evaluation note exists in the same case/episode;
  - it is still `in_progress`;
  - it owns non-procedure vitals;
  - it has no document, order, procedure, invoice, or other downstream ownership.
  Move the vitals to the Pain Evaluation encounter before soft-deleting the phantom encounter.
- Revoke direct trigger-function execution from `public`, `anon`, and `authenticated`; triggers continue to execute it as part of table writes.

### Automated verification

- Review the generated migration and run it through the local migration harness if available.
- Run an integrity query proving no finalized live Initial/Pain Evaluation note is linked to a non-completed encounter.
- Run an integrity query proving the affected Pain Evaluation episode has one completed qualifying encounter and no phantom Initial Evaluation.

### Manual verification

- Open the affected Visits screen and confirm Pain Evaluation is completed and Initial Evaluation is absent.
- Open the performed procedure and confirm Generate Procedure Note is enabled.

## Phase 2: Visit-Aware Vitals Ownership

### Files and changes

- Update `src/actions/initial-visit-notes.ts::saveInitialVisitVitals()` to accept `visitType` and resolve `pain_evaluation` versus `initial_evaluation` through `ensureLegacyEpisodeEncounter()` before either insert or update.
- When updating the existing shared non-procedure vitals snapshot, update its `encounter_id` to the encounter for the selected visit.
- Update `src/components/clinical/initial-visit-editor.tsx::VitalSignsCard` to receive and pass the active `visitType`.
- Add regression tests in `src/actions/__tests__/initial-visit-notes-save.test.ts` covering Pain Evaluation and Initial Visit ownership and readable ownership errors.

### Automated verification

- Run the targeted initial-visit action tests.
- Run TypeScript, lint, the full test suite, and production build because the server-action signature is shared with a client component.

### Manual verification

- On a new emergency case, open Pain Evaluation first, save vitals, and confirm only a Pain Evaluation visit appears.
- Finalize the Pain Evaluation without creating an Initial Visit and confirm procedure-note generation is available.

## Phase 3: Final Review and Rollout

### Files and changes

- Review the complete diff for unrelated changes and migration safety.
- Apply the migration using the repository's Supabase CLI workflow only after automated checks pass.
- Re-run de-identified production integrity checks.

### Automated verification

- Confirm migration history includes the new migration.
- Confirm production reports zero finalized evaluation notes with non-completed linked encounters.
- Confirm the affected active case has a completed Pain Evaluation encounter and its procedure episode passes the prerequisite query.

### Manual verification

- User confirms the affected screens and button state after deployment.

## Risks and rollback considerations

- A broad encounter cleanup could hide a legitimate undocumented visit. The repair predicate must require the exact vitals-created phantom pattern and absence of downstream references.
- Trigger recursion is avoided because the trigger updates `clinical_encounters`, not `initial_visit_notes`.
- A failed trigger update rolls back the note status change, preventing future note/encounter divergence.
- The migration is forward-fix oriented. If the trigger causes an unexpected issue, deploy a follow-up migration that drops it; do not reverse the already-correct status backfill.
- Shared-vitals behavior is preserved to avoid changing note-generation assumptions in this scoped fix.

## Completion criteria

- A Pain Evaluation can be the first and only evaluation in an emergency episode.
- Finalizing it yields a completed `pain_evaluation` encounter and enables Procedure Note generation.
- Saving its vitals never creates an Initial Evaluation.
- Reopening and re-finalizing keeps note and encounter states synchronized.
- The existing production mismatch and phantom Initial Evaluation are repaired safely.
- Targeted tests, TypeScript, lint, full tests, build, and post-migration integrity checks pass.

## Implementation verification

- [x] Database lifecycle trigger and guarded repair migration implemented.
- [x] Pain Evaluation and Initial Visit vitals ownership implemented.
- [x] Targeted regression tests pass: 13 tests across the action and episode-context suites.
- [x] Full test suite passes: 80 files, 1,206 tests.
- [x] TypeScript passes with `npx tsc --noEmit`.
- [x] Changed files pass ESLint directly.
- [x] Production build passes.
- [ ] Full repository lint is clean. It remains blocked by the pre-existing `react-hooks/set-state-in-effect` error in `src/components/settings/invite-user-dialog.tsx:62` and unrelated warnings.
- [ ] Local migration reset passes. The installed local Supabase service reports `LegacyLocalDbRunningError: failed to inspect service` before migrations run.
- [ ] Production migration and post-migration integrity checks are pending explicit deployment.
- [ ] Manual UI verification is pending deployment.
