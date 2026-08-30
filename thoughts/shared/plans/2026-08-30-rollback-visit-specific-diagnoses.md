# Roll Back Visit-Specific Diagnoses Implementation Plan

## Overview

Remove the visit-specific diagnosis authority and automatic diagnosis suggestion feature introduced by commits `4824974`, `bd2f4ce`, `5bf5ced`, and `f49c421`. Restore the application and database behavior that existed at `0177fa2`, while preserving diagnosis prose already stored in finalized clinical notes and preserving immutable production migration history.

## Current State

- `origin/main` and the working branch point to `f49c421`.
- The four diagnosis feature commits are consecutive at the tip of the deployed branch.
- Production has applied migrations `20260828170917`, `20260828174112`, `20260828205049`, and `20260828223000`.
- The first migration added structured encounter diagnoses, confirmation audit fields, note snapshots, preparation RPCs, and diagnosis guard triggers.
- The second migration added finalization triggers and changed `finalize_pain_follow_up` to require the structured diagnosis authority.
- The third migration corrected the preparation RPC.
- The fourth migration corrected the finalization trigger and is applied in production but not yet tracked in Git.
- Production currently has one live encounter with structured diagnoses, one Initial/Pain Evaluation note snapshot, and one procedure-note snapshot. Finalized diagnosis prose is stored separately in existing note text fields.
- The working tree also contains an untracked diagnosis regression test and an untracked automatic-suggestion plan.

## Desired End State

- Application behavior matches the parent of `4824974` (`0177fa2`) for diagnosis selection, note generation, procedure diagnosis handling, and visit preparation.
- Automatic current-visit diagnosis suggestions and refresh controls are removed.
- Encounter diagnosis confirmation, diagnosis snapshots, and diagnosis finalization gates are removed from production.
- `finalize_pain_follow_up` matches its pre-feature implementation from `20260826212446_return_visit_workflow_rpcs.sql`.
- Existing finalized note diagnosis prose, procedure diagnosis arrays, documents, visits, and billing records remain unchanged.
- Applied migration files remain in the repository as immutable history, with a new forward rollback migration reversing their schema effects.

## Key Discoveries

- Deleting already-applied migration files would make local and production migration histories diverge. The rollback must retain all four historical migration files.
- Applying the database rollback before deploying the application rollback would break the currently deployed application because it selects the new columns. Deploy the application first, then immediately apply the database rollback migration.
- Deploying the application first is backward-compatible with the extra schema columns, although diagnosis-gated finalization may remain unavailable during the short interval before the database migration is applied.
- Dropping the structured columns removes three populated metadata values, but it does not modify `initial_visit_notes.diagnoses`, `pain_follow_up_notes.diagnoses`, procedure diagnosis arrays, or finalized PDFs.
- The previously soft-deleted phantom Initial Visit is unrelated clinical cleanup and will not be restored.

## What We Are Not Doing

- We are not deleting or rewriting diagnosis prose in finalized notes.
- We are not deleting procedure diagnosis arrays that existed before this feature.
- We are not restoring the soft-deleted empty Initial Visit encounter.
- We are not reverting older, unrelated diagnosis behavior such as discharge diagnosis rewriting, invoice diagnosis precedence, or extraction workflows.
- We are not rewriting production migration history.

## Implementation Approach

Create one coherent revert commit. Use Git's inverse patches for the four consecutive feature commits, retain the applied migration files, add a forward rollback migration, and remove uncommitted diagnosis-only artifacts. Verify the complete diff against `0177fa2` plus the intentionally retained migration history and new rollback migration.

## Phase 1: Revert Application Changes

### Files and changes

- Apply inverse patches for `f49c421`, `5bf5ced`, `bd2f4ce`, and `4824974` in reverse chronological order.
- Restore the already-applied migration files if the inverse patch removes them:
  - `supabase/migrations/20260828170917_encounter_diagnosis_selections.sql`
  - `supabase/migrations/20260828174112_enforce_visit_diagnosis_finalization.sql`
  - `supabase/migrations/20260828205049_fix_prepare_evaluation_visit_ambiguity.sql`
- Add the already-applied `20260828223000_fix_initial_visit_diagnosis_finalization.sql` file to source control.
- Remove the uncommitted automatic-suggestion plan and diagnosis-finalization regression test because they describe/test the removed feature.

### Automated verification

- Confirm application source outside migration history matches `0177fa2` for the reverted commit range.
- Run `git diff --check`.
- Run the full unit test suite, lint, type checking through the production build, and the production build.

### Manual verification

- Review the diagnosis UI and note-generation diff to ensure no visit-specific selection or suggestion controls remain.

## Phase 2: Add Forward Database Rollback

### Files and changes

- Generate a new Supabase migration with the CLI.
- Restore the pre-feature `public.finalize_pain_follow_up` definition from `20260826212446_return_visit_workflow_rpcs.sql`.
- Drop diagnosis finalization triggers from Initial/Pain Evaluation, follow-up, and procedure notes.
- Drop diagnosis snapshot triggers and the encounter diagnosis confirmation trigger.
- Drop `guard_note_diagnosis_finalization`, `guard_note_diagnosis_snapshot`, `authorize_encounter_diagnosis_confirmation`, and `prepare_evaluation_visit`.
- Drop `diagnoses_snapshot` from the three note tables.
- Drop `diagnoses`, `diagnoses_confirmed_at`, and `diagnoses_confirmed_by_user_id` from `clinical_encounters`.
- Drop the diagnosis formatting and validation helper functions after their dependents are removed.
- Add a pgTAP contract test proving the new columns/functions/triggers are absent and the pre-feature follow-up finalization function remains callable.

### Automated verification

- Run a production-linked migration dry run.
- Execute the rollback SQL inside an always-rolled-back production transaction and verify the target objects are absent inside the transaction.
- Verify the finalized note diagnosis text and existing procedure diagnoses are unchanged after the rolled-back rehearsal.

### Manual verification

- Inspect the migration ordering and dependency removal order.

## Phase 3: Deploy and Verify Production

### Files and changes

- Commit the application revert, historical migration record, forward rollback migration, and tests.
- Push the application rollback to `origin/main` and wait for the production deployment to become ready.
- Apply the new Supabase rollback migration to the linked production project.

### Automated verification

- Confirm production migration history contains the rollback migration.
- Confirm the removed columns, functions, and triggers no longer exist.
- Confirm finalized note diagnosis prose and procedure diagnoses still exist.
- Run a production smoke check against the affected case and a read-only application endpoint/page where possible.

### Manual verification

- Confirm the diagnosis selection/suggestion UI is gone after refresh.
- Confirm Initial Visit, Pain Evaluation, procedure, follow-up, and discharge pages load.

## Risks and Rollback Considerations

- The structured encounter diagnosis and snapshot values are permanently removed when the migration is applied. This is explicitly authorized; diagnosis prose remains.
- A short deployment interval exists where the old application runs against the newer schema. This is compatible for reads and ordinary edits, but finalization can remain gated until the database rollback completes.
- Reintroducing the feature later requires a new forward migration; production migration history must never be deleted or edited.
- Shared timeout changes in `f49c421` are reverted because they were introduced solely as part of diagnosis refresh recovery. Any future general timeout work should be reintroduced independently.

## Completion Criteria

- The four feature commits are fully reversed in application code.
- Historical migrations remain tracked and a new forward rollback migration is applied.
- Production no longer exposes visit-specific diagnosis columns, functions, or triggers.
- Existing finalized note diagnosis prose and pre-existing procedure diagnosis arrays are preserved.
- Tests, lint, build, migration rehearsal, deployment, and production verification pass, with any environment limitation reported.
