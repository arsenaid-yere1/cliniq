# Case reactivation and clinical note reset

Date: 2026-09-08

## Research question

How does the current application reactivate cases and reset discharge, procedure,
and visit notes, including finalized notes and discharged care episodes?

The user clarified that reset means **clear generated text for a fresh start**,
rather than retain the text for editing. This document records current behavior
and the remaining scope decisions; it does not implement a feature.

## Summary

Case activation and draft-note reset already exist. No combined case/episode
reactivation and clinical-note reset operation was found in the inspected application.
Changing case status does not reactivate a discharged episode. Existing resets
accept draft or failed notes, retain their rows and source clinical data, and clear
generated content. Finalized initial/evaluation, procedure, and follow-up notes have
separate unfinalization actions. Finalized discharge uses audited correction,
which deliberately preserves the discharged episode.

## Application boundaries

This repository contains one Next.js application (`package.json`), with UI and
routes in `src/components` and `src/app`, server actions in `src/actions`, shared
clinical helpers in `src/lib/clinical`, generated database types in
`src/types/database.ts`, and Supabase schema/RPC definitions and database tests in
`supabase/migrations` and `supabase/tests/database`. No separate application or
workspace package is declared in the root package manifest.

## Case and episode lifecycle

- `src/components/patients/status-change-dropdown.tsx:37`,
  `StatusChangeDropdown`, exposes normal transitions and administrator overrides.
- `src/lib/constants/case-status.ts:17`, `CASE_STATUS_TRANSITIONS`, permits
  Pending Settlement → Active and Closed → Active. Archived normally moves to
  Closed first; an administrator override can move directly to Active.
- `src/actions/case-status.ts:55`, `updateCaseStatus`, authenticates, validates
  transitions unless administrator override applies, updates the case status and
  clears the close date for Active, then separately inserts status history.
  It does not update episodes, encounters, notes, or procedure series.
  `reopenCase` at line 183 delegates to that action.
- `src/actions/case-status.ts:15`, `assertCaseNotClosed`, blocks ordinary clinical
  writes in Pending Settlement, Closed, and Archived.
- `src/lib/clinical/episode-context.ts:105`, `requireWritableEpisode`, additionally
  requires the specific episode to be active. `getActiveOrLatestEpisode` at line 81
  prefers the active episode, otherwise the highest episode number.
- `src/actions/case-status.ts:187`, `startReturnCareEpisode`, invokes
  `start_return_episode` to create a return episode and first encounter. This is a
  separate operation from changing case status or resetting existing notes.

## Existing note operations

| Note family | Reset scope and action | Finalized behavior |
| --- | --- | --- |
| Initial / Pain Evaluation Visit | Case + visit type; `resetInitialVisitNote`, `src/actions/initial-visit-notes.ts:906` | `unfinalizeInitialVisitNote`, line 865, retains text; subsequent Reset clears it |
| Procedure | Procedure ID; `resetProcedureNote`, `src/actions/procedure-notes.ts:1049` | `unfinalizeProcedureNote`, line 1009, retains text; subsequent Reset clears it |
| Discharge | Active-or-latest episode; `resetDischargeNote`, `src/actions/discharge-notes.ts:1461` | Audited correction, not ordinary unfinalization/reset |
| Pain follow-up | Case + encounter; `resetPainFollowUpNote`, `src/actions/pain-follow-up-notes.ts:218` | `unfinalizePainFollowUpNote`, line 246, also reopens encounter and checks dependencies |

All four resets accept only live draft or failed notes. They set draft status,
clear narrative and AI metadata, and reset generation attempts. They retain note
identity and underlying clinical records rather than deleting performed procedures
or visit intake. Initial/evaluation reset also clears structured PRP recommendations
and their evidence hash; follow-up reset clears procedure recommendations.

Initial/evaluation and procedure reset actions use the case lock guard. Their reset
updates do not explicitly change the episode or encounter. Their unfinalization
actions clear finalization/document fields and call `softDeleteFinalizedDocument`
(`src/lib/supabase/finalize-document.ts:15`), which soft-deletes the document row
and removes the stored PDF. It does not return database/storage result errors.

Initial/evaluation draft and failed Reset controls appear in
`src/components/clinical/initial-visit-editor.tsx:528` and `:1485`; finalized Edit
appears at `:1725`. Equivalent procedure controls appear in
`src/components/procedures/procedure-note-editor.tsx:336`, `:481`, and `:777`.
Empty drafts return to the generation UI. These controls are disabled for locked
cases. Resetting one note does not automatically regenerate dependent notes.

### Follow-up transactional reset

`supabase/migrations/20260903215812_pain_follow_up_reset.sql:4`,
`reset_pain_follow_up`, locks note → encounter → episode → case, validates a draft
or failed note, an in-progress follow-up encounter, an active episode, and an
unlocked case. It clears generated sections and progress metadata in place.

The same migration's `unfinalize_pain_follow_up` at line 229 requires a finalized
note and completed encounter. It refuses unfinalization if live procedure orders
or unreleased billing claims depend on the encounter. On success it returns the
note to draft, soft-deletes the document, and returns the encounter to in-progress.
The server action removes the PDF after the RPC succeeds; cleanup failure is logged.
Both actions are gated by the return-tele-visits feature flag.

`src/components/visits/pain-follow-up-editor.tsx:92` defines the reset confirmation;
the finalized branch at line 228 exposes Unfinalize and explains that Reset is a
separate action after reopening. Encounter status controls button availability;
the RPC enforces case and episode writability.

### Discharge lifecycle and correction

`src/actions/discharge-notes.ts:1461` blocks locked cases and open corrections,
resolves the current episode, then resets only draft/failed content. It leaves
visit date, vitals, tone hint, trajectory fields, and episode/encounter state intact.
The editor exposes draft/failed Reset but hides ordinary Reset in correction mode
(`src/components/discharge/discharge-note-editor.tsx:397`, `:633`).

Finalization calls `finalize_episode_discharge`
(`src/actions/discharge-notes.ts:1114`). Its definition at
`supabase/migrations/20260827175109_qualify_finalize_discharge_series_episode_id.sql:3`
finalizes the note, completes the discharge encounter and active procedure series,
and sets the episode to discharged with `ended_at` and
`end_reason = 'finalized_discharge'`. It does not change case status. The SQL guard
explicitly excludes Closed/Archived; the calling action's case guard also excludes
Pending Settlement. Open visits, procedure orders, or appointments block discharge.

`beginDischargeCorrection` (`src/actions/discharge-notes.ts:1197`) instead opens an
audited revision. The database implementation at
`supabase/migrations/20260827211412_audited_discharge_corrections.sql:144` requires
a finalized discharge, discharged episode, completed encounter, and original PDF.
An active administrator or eligible assigned provider can perform corrections;
unreleased visit billing claims block them. It snapshots the note and preserves
the original document. Cancelling restores the snapshot; finalizing records a
replacement PDF and revision. Neither resumes care nor reopens the episode.

## Execution flow and implications

Existing individual initial/procedure workflow:
Change Status to Active if locked → Edit/unfinalize → Reset → Generate.

Existing follow-up workflow also requires an active episode and no blocking
procedure orders or billing claims before unfinalization. A discharged episode
therefore remains a separate obstacle after setting the case to Active.

Inference from the verified mutations: a fresh-start action for a finalized
discharge cannot be implemented merely by exposing the existing Reset button or
calling `reopenCase`; neither reverses discharge finalization's episode, encounter,
and series transitions. Selecting an older episode also requires explicit scope,
because the default resolver prefers a newer active episode.

## History and local artifacts

- Commit `e226c27` introduced the pain follow-up reset workflow. The earlier
  `thoughts/shared/research/2026-09-03-pain-follow-up-reset-functionality.md`
  describes the pre-implementation absence of that action; current code supersedes it.
- Commit `f0ae4e1` introduced audited discharge corrections.
- The pre-existing untracked
  `scripts/db/reset-case-da5e3a68-discharge-and-procedures.sql` is a case-specific
  destructive cleanup, not an application action. It removes discharge/procedure
  records and related billing links, reopens episodes, and creates a fresh PRP
  series. It does not update case status or remove storage objects. Its existence
  does not establish that it has been executed. It was inspected, not modified or run.

## Verification and existing tests

Executed:

```sh
npm test -- src/actions/__tests__/case-status.test.ts src/actions/__tests__/pain-follow-up-notes-reset.test.ts src/actions/__tests__/pain-follow-up-notes-unfinalize.test.ts src/actions/__tests__/discharge-note-corrections.test.ts
```

Result: **4 files passed, 47 tests passed**. These are mocked server-action tests,
not verification against a running database. Existing SQL tests include
`supabase/tests/database/pain_follow_up_reset_test.sql`,
`discharge_note_correction_test.sql`, and `finalize_episode_discharge_test.sql`;
they were not executed. No dedicated initial/procedure reset/unfinalize tests were
found by symbol search in source test files.

The existing Graphify map located reset actions and related editors. Its CLI was
available through the saved Python interpreter rather than the shell PATH, and
reported skill/package version mismatch. Important conclusions above were checked
against source, not inferred from graph edges. No live UI or database was changed.
No application changes were made, so application lint/build/type checks were not
run. The research artifact was reviewed and checked for whitespace errors.

## Open questions for implementation

Resolved: reset clears generated text for a fresh start.

- Is activation plus reset one combined action, or independently selectable controls?
- Does reset target selected notes, the latest episode, or every episode? Does
  “visit notes” include both evaluation types and all follow-up notes?
- Which roles may reset finalized records, and should a reason be recorded?
- How should finalized PDF history and existing discharge correction revisions behave?
- Should billing/order dependencies block reset or require a separate resolution?
- When reversing discharge, which completed procedure series should become active,
  and what should happen if a later episode is already active?

These decisions are not supplied by existing generic reset behavior. Deleting
performed procedures, visits, orders, or billing records is not implied by the
confirmed request to clear generated note text.
