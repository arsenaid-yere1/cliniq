# Starting a new Episode after discharge

Date: 2026-09-24

## Research question

When does a new care Episode start, and does the implementation match the user's rule that it should start when a patient returns for pain evaluation after discharge?

## Summary

The application supports returning after discharge, but does not strictly implement that rule. Staff explicitly submit **Start Return Visit** on the Visits page. That transaction immediately creates an active Episode and a **pain_follow_up** encounter, including when the encounter is scheduled for a future date. It does not create a **pain_evaluation** encounter or wait for an evaluation to begin.

The database requires an eligible case status and no existing active Episode. It does not require a previous discharged Episode, a finalized discharge note, or a return date after the previous discharge. These findings describe repository code, not verified production database state.

## Application boundaries

This is a Next.js application. Routes and UI live under `src/app` and `src/components`, server actions under `src/actions`, shared clinical logic under `src/lib/clinical`, and schema/functions/tests under `supabase`. The root `package.json` declares one application rather than multiple workspace packages.

## Detailed findings

### UI and server actions

- `src/app/(dashboard)/patients/[caseId]/visits/page.tsx:9`, `VisitsPage`: finds an active Episode in the loaded list. If present, shows **Schedule Follow-Up**; otherwise shows **Start Return Visit**. This branch does not inspect discharge history.
- `src/components/visits/start-return-episode-dialog.tsx:25`, `submit`: requires a return reason, accepts modality, optional date/time and provider, and calls `startReturnVisit`. With no scheduled time it supplies today's UTC date. After success it navigates to the new encounter.
- `src/actions/care-episodes.ts:29`, `startReturnVisit`: checks the feature flag and delegates to `startReturnCareEpisode`.
- `src/actions/case-status.ts:187`, `startReturnCareEpisode`: validates input, authenticates, then invokes `start_return_episode` once with an idempotency key. It returns the new Episode and encounter IDs.
- `src/lib/validations/care-episode.ts:33`, `startReturnCareEpisodeSchema`: requires a nonempty reason, key and matching case IDs. `firstReturnEncounterSchema` in `src/lib/validations/clinical-encounter.ts` omits caller-selected Episode ID, encounter type and status. Neither schema checks prior discharge history.
- `src/lib/features/return-tele-visits.ts:7`: workflow is enabled by default unless `ENABLE_RETURN_TELE_VISITS` is exactly `false`.

### Database creation and timing

`supabase/migrations/20260826210732_start_return_episode_rpc.sql`, `start_return_episode`, is the only definition located for this RPC.

1. Lines 42–76 validate authentication and encounter input.
2. Lines 98–135 serialize actor/key retries, reject changed input for a reused key, and replay a completed result.
3. Lines 137–170 lock the case, permit `active`, `pending_settlement`, or `closed`, and reject an existing live active Episode. Archived cases must first move to Closed.
4. Lines 172–194 insert Episode number `max + 1`, immediately with `status = 'active'`. `opened_at` uses scheduled start, otherwise encounter date, otherwise current time.
5. Lines 197–242 insert the first encounter with `encounter_type = 'pain_follow_up'`. It is `scheduled` when scheduled start is supplied, otherwise `in_progress`.
6. Lines 244–266 move a Closed/Pending Settlement case to Active, clear its close date, and record status history. Prior Episodes and their notes are not rewritten by this RPC.

There is no check here that the preceding Episode was discharged, that a finalized discharge exists, or that the new visit date follows discharge. A future `opened_at` does not delay row creation or active status.

### Pain evaluation versus follow-up

`src/lib/constants/clinical-encounter.ts:1` defines `pain_evaluation` and `pain_follow_up` as distinct encounter types. The return transaction selects the latter.

`src/app/(dashboard)/patients/[caseId]/visits/[encounterId]/page.tsx:12`, `VisitPage`, only loads a `pain_follow_up` encounter and renders the **Pain Follow-Up** heading and `PainFollowUpEditor`. Thus the difference is reflected in both stored type and UI, not solely a database name.

`src/actions/clinical-encounters.ts:33`, `schedulePainFollowUp`, adds another encounter to an existing writable Episode without creating a new one. `changePainFollowUpStatus` updates the encounter when it begins, is cancelled or becomes a no-show; that action does not create or close an Episode.

### Discharge, first Episode and reactivation

- `supabase/migrations/20260827175109_qualify_finalize_discharge_series_episode_id.sql:27`, `finalize_episode_discharge`: checks writability and unresolved visits/procedures. Lines 44–55 finalize the note, complete its encounter and active procedure series, and mark its Episode `discharged` with `ended_at = now()`. Case status is not changed by that function.
- `supabase/migrations/20260908231215_case_reactivation_note_reset.sql:288` moves that function into `private`; the versioned `finish_clinical_note` path invokes it at line 323. The wrapper additionally checks the active Episode, unlocked case, reviewed note version and document.
- `supabase/migrations/20260827040741_create_initial_episode_for_new_cases.sql:5`, `create_initial_care_episode`: Episode 1 is created automatically on case insertion, normally active; locked case statuses produce a cancelled initial Episode. This is separate from subsequent return Episodes.
- `src/actions/case-status.ts:183`, `reopenCase`, only changes case status through `updateCaseStatus`.
- The audited reset/reactivation operation in `20260908231215_case_reactivation_note_reset.sql:159` can reactivate the latest discharged Episode in place. It requires an administrator and reason and does not create a new Episode. Direct ordinary-role discharged-to-active updates are guarded at line 390.

## Execution flow

Finalize discharge → existing Episode becomes discharged → Visits page has no active Episode → staff submit Start Return Visit → transaction creates active Episode N+1 and pain-follow-up encounter → UI opens Pain Follow-Up.

If staff merely schedule another visit while an Episode is active, that visit stays in the same Episode. If staff use audited reactivation, the existing Episode is reopened instead.

## Comparison with the stated rule

| Rule aspect | Current behavior |
| --- | --- |
| Return after discharge opens a new Episode | Supported through explicit Start Return Visit |
| Prior discharge is required | Not required by the return RPC |
| First return encounter is pain evaluation | Stored and displayed as pain follow-up |
| Episode starts when the patient comes back | Created immediately on submission, including advance scheduling |
| Return date follows discharge | Not compared by the return RPC |

Inference: if “pain evaluation” means the application's distinct Pain Evaluation Visit workflow, current behavior does not match. If it means any reassessment of pain, the follow-up visit may serve that clinical purpose, but the timing and discharge prerequisites remain as described above.

## Existing tests and verification

Executed:

```sh
npm test -- src/actions/__tests__/case-status.test.ts src/lib/validations/__tests__/care-episode.test.ts src/lib/clinical/__tests__/episode-context.test.ts
```

Result: **3 files passed, 40 tests passed**. Tests cover the single RPC call, replay, cross-case rejection, active-Episode conflict, validation, Episode selection and writability. Server-action tests mock the database; they do not prove SQL transaction behavior.

Search of `supabase/tests/database` found no direct `start_return_episode` invocation. Related database suites include `finalize_episode_discharge_test.sql`, `clinical_reset_test.sql`, and `discharge_note_correction_test.sql`; they were not run for this research. No live UI or database validation was performed.

The Graphify index was queried using its saved Python runtime after the CLI was unavailable on PATH. Query terms were `start return episode discharge`. It located the dialog and feature flag but provided little relationship detail and reported a skill/package version mismatch. Important findings were verified against source.

Only this research document was added. No application changes were made, so application formatting, lint, type checking and build were not run. Document whitespace was checked with `git diff --no-index --check /dev/null thoughts/shared/research/2026-09-24-return-episode-start.md`.

## Historical context

Git history for the return dialog/RPC includes `2208851` (atomic return visit start), `561ff93` (complete return tele-visit workflow), and `0001f37` (align consent and encounter dates). The September 8 reactivation migration adds a separate way to resume the existing Episode; it does not redefine the return-start RPC. Earlier research about reactivation predates that implementation and should not be treated as current behavior.

## Open questions

- Does “comes back” mean scheduling the return visit, beginning its intake/evaluation, or completing it?
- Does “pain evaluation” require the existing distinct evaluation type/editor, or describe reassessment through the follow-up editor?

No implementation changes or recommendations are included in this research.
