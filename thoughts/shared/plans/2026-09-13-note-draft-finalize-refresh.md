# Save Draft → Finalize Without Refresh Implementation Plan

## Overview

Fix the two concrete stale-version paths identified in [the research](../research/2026-09-13-note-draft-finalize-refresh.md): follow-up draft saves that depend on refreshed props, and independent initial/discharge tone-hint writes. Preserve the server's protection against intervening edits. The plan was approved and implemented following the user’s “continue” instruction. Execution results are recorded below.

Baseline: `main`, commit `1a363f27aa44d38ed9cb93da2c5d6fe3a1f03b55`, inspected September 13, 2026. The user's exact note type/error remains unspecified; this plan addresses the reproduced follow-up mechanism and the separately verified tone-write mechanism, not every possible finalization error.

## Current State

- `src/components/visits/pain-follow-up-editor.tsx`: local fields initialize from props; `editValues.expected_updated_at` reads `initialNote.updated_at`. `run()` ignores saved data and requests refresh. Finalize calls save first and stops on error.
- `src/actions/pain-follow-up-notes.ts`: the decision-aware save returns `data.savedNote` and revalidates the route. Finalization accepts the timestamp returned by that save and rejects intervening edits.
- `src/components/clinical/initial-visit-editor.tsx` and `src/components/discharge/discharge-note-editor.tsx`: `acceptSavedNote` already updates the form timestamp, saved decision and education. Their tone blur handlers independently fire actions without awaiting them.
- `src/actions/initial-visit-notes.ts::saveInitialVisitNoteToneHint` and `src/actions/discharge-notes.ts::saveDischargeNoteToneHint` update rows without the editor's expected version, return no new timestamp, and do not refresh the route. Discharge includes an insert branch, although current callers are existing-draft editors.
- `src/hooks/use-visit-note-version.ts` accepts refreshed timestamps for matching narrative/decision fingerprints. It does not reconcile fire-and-forget tone responses.

## Desired End State

1. Follow-up Save Draft → Save Draft or Finalize works before any route refresh completes.
2. Successful local saves immediately supply the next expected version and update the displayed saved decision and canonical education.
3. In initial, pain-evaluation and discharge drafts, tone blur → Save/Finalize/Regenerate runs in order, with each operation using its predecessor's saved version.
4. Tone-only writes never replace unsaved prose or clinician selections.
5. Genuine external edits still cause a conflict; no automatic retry with a fetched newest timestamp, timestamp bypass, or unsigned fallback.
6. Existing locking, corrections, generation, reset and finalization behavior remains intact.

## Key Discoveries

- A component reproduction showed the follow-up editor submitting v1 a second time after Save Draft returned v2; mocked stale rejection prevented signing. This establishes the client sequence, not Next.js production timing.
- `src/lib/clinical/save-visit-decision.ts` already returns the row produced by the version-checked database save. A new database save mechanism is unnecessary.
- `src/lib/clinical/pain-follow-up-editor-key.ts` intentionally includes updated_at to reload generated/regenerated content. Keep this mechanism in this scoped fix; do not replace it with an identity-only key without redesigning generation/reset reconciliation.
- Both tone actions have only draft-editor callsites in the repository. Pre-generation controls pass tone directly to generation and do not use these blur actions.
- Calling `acceptSavedNote` for a tone-only response would replace education with persisted text and could lose unsaved edits. Tone response handling must be separate.

## What We Are Not Doing

- Changing procedure-note finalization, note content rules, patient decision semantics, PDF generation, or discharge correction behavior.
- Removing version checks or refreshing/retrying automatically after a genuine conflict.
- Reworking follow-up remount behavior, all metadata/vitals writers, or cross-tab synchronization.
- Adding migrations, changing RLS, upgrading dependencies, or deploying.

## Implementation Approach

Use successful mutation responses as the immediate version source. Keep route refresh for server-rendered status and generation transitions. Give initial/discharge draft operations a small shared per-editor FIFO queue so blur saves cannot race with explicit note actions. Every queued operation obtains its expected version at execution time, not from the click-time render.

### Contract decisions

- Follow-up: use a local expected-version state/ref initialized from the mounted note and a saved-decision state; factor the draft save plus response adoption into one helper used by Save Draft and Finalize. Validate a returned timestamp before proceeding to sign. The current editor always supplies a decision, so it must receive the decision-aware saved response; missing response/version is an error and never permission to finalize without a version.
- Tone actions: add a required final argument `{ noteId: string; expectedUpdatedAt: string }`. Return `{ data: { updated_at: string; tone_hint: string | null } }` or `{ error: string }`. Keep existing authentication/case/correction checks. Constrain update by id, case, existing visit-type/episode ownership, status=draft, deleted_at=null, and the supplied timestamp. Select the updated timestamp/tone in that same update request. A zero-row match is a conflict. Never read the newest row and use its version in place of the client's version.
- Restrict these tone actions to existing drafts; remove discharge's unused insert branch. Pre-generation behavior remains in generation actions. Reject missing identity/version rather than supporting an unversioned fallback.
- On tone success, update only the form's expected timestamp and last-persisted normalized tone. Do not acknowledge unrelated persisted narrative or replace any prose/decision fields.

## Phase 1: Reconcile follow-up draft saves immediately

### Files and changes

- `src/components/visits/pain-follow-up-editor.tsx`: introduce a narrowly typed saved-response adopter. Update expected version, saved decision, canonical narrative fields and structured recommendations from the successful own-save response. Use the acknowledged version/recommendations in subsequent payloads and the acknowledged decision in `VisitTreatmentDecisionFields.saved`. Inputs are disabled during the action, so this own-save adoption does not overwrite edits made during the request.
- Factor save-and-adopt so both Save Draft and the preliminary Finalize save use it. Adopt before returning success or releasing pending. If signing fails after a successful preliminary save, retain that save's timestamp for retry. Always pass the explicit latest saved timestamp to finalization.
- Keep current refresh and version-key remount behavior for generation/regeneration/reset/status updates. Local response adoption must work even when refresh is a no-op/delayed.
- `src/components/visits/__tests__/pain-follow-up-decision.test.tsx`: use realistic full saved-row fixtures; add the regression matrix below.

### Automated verification

Run `npm test -- src/components/visits/__tests__/pain-follow-up-decision.test.tsx src/actions/__tests__/pain-follow-up-notes-finalize.test.ts src/lib/clinical/__tests__/pain-follow-up-editor-key.test.ts`.

Required cases:

- Mounted v1 → Save returns v2 → Finalize's save uses v2 → save returns v3 → finalizer receives v3, without rerendering props.
- Save twice uses v1 then v2; decision Saved indicator and normalized education reflect the returned row.
- Failed save preserves fields and version, shows error and does not finalize.
- Successful pre-finalization save then failed finalizer retains the new version for retry.
- Missing/invalid saved response stops finalization instead of omitting its expected version.
- Existing server test rejecting intervening edits continues passing; generation/regeneration key tests remain unchanged.

### Manual verification

On a disposable local follow-up visit, save an edited draft and immediately finalize with slow network delivery. Confirm the PDF contains reviewed text and the visit completes. Also confirm generate, regenerate and reset still refresh displayed content. Check a competing edit still reports a review conflict.

## Phase 2: Make tone saves return a guarded version

### Files and changes

- `src/actions/initial-visit-notes.ts::saveInitialVisitNoteToneHint` and `src/actions/discharge-notes.ts::saveDischargeNoteToneHint`: implement the contract above using the existing filtered update/select pattern. Preserve family ownership checks, authorization and correction guards. Distinguish stale/missing draft from unexpected database failure; never report success when no row changed.
- New `src/actions/__tests__/note-tone-version.test.ts`: cover both actions using the existing Supabase mock conventions.
- Update the two draft-editor calls to pass identity and their current expected version as part of Phase 3; complete Phases 2–3 together before treating the application as type-correct.

### Automated verification

Run `npm test -- src/actions/__tests__/note-tone-version.test.ts src/lib/clinical/__tests__/save-visit-decision.test.ts`.

Verify success returns the update result; filters include exact identity/ownership/status/deletion/expected timestamp; stale or missing row is an error; unauthenticated/locked/correction-blocked requests do not update; absent version cannot fall through to a write; only tone/audit fields change. Verify no insert is attempted for missing discharge draft.

### Manual verification

Using local test data, call the guarded tone save with the current timestamp, observe the returned new timestamp, then retry the old timestamp and confirm rejection. Do not use a production patient for this check.

## Phase 3: Serialize tone and draft mutations

### Files and changes

- `src/hooks/use-visit-note-version.ts`: extend its return value to `{ acknowledgeSavedNote, acknowledgeMetadataVersion }` and update both editor callsites. Track the current acknowledged version and superseded versions alongside the existing narrative fingerprint. Full-save acknowledgement updates fingerprint and version; metadata acknowledgement records the successful expected→returned version transition without changing the fingerprint or form content. When accepting matching-fingerprint props, ignore a known superseded timestamp instead of reverting the form. Keep rejecting external narrative/decision mismatches. Both metadata and full-save acknowledgement must record replaced versions before another prop effect can run.
- New `src/hooks/use-note-mutation-queue.ts`: a small per-mounted-editor ref-held FIFO for async callbacks. Return each task's outcome to its caller; recover the internal tail after rejection so retry is possible. Do not turn an operation error into success. Avoid recursive enqueue/deadlock. Cancel tasks that have not started on unmount or note-identity change; do not attempt to cancel an already-issued server request. Mark successful finalization terminal before releasing its queue item, and discard subsequent draft-write tasks. Recheck current writable/terminal state when each queued task starts.
- `src/components/clinical/initial-visit-editor.tsx` and `src/components/discharge/discharge-note-editor.tsx`: share one queue across tone blur, Save Draft, section regeneration, and the entire save-then-finalize operation. Leave discharge correction branches separate; the tone control is absent during correction.
- Capture tone text at blur; normalize trim/empty-to-null consistently and skip a write when it matches the last successfully persisted tone. Update that baseline only on success.
- Each explicit action reserves one queue item which first flushes the latest dirty tone using a non-enqueuing helper, then reads current form values/version and performs its operation. This covers keyboard actions and dirty tone that never blurred. A queued blur before it completes first; the flush then skips an already persisted value. Track the preceding tone outcome: an explicit action already waiting behind a failed blur must abort without automatically retrying it. Only a later user-initiated action may retry that dirty tone. If tone persistence fails, the dependent operation stops with the existing error UI; it must not silently regenerate/save/sign using stale tone. A subsequent user retry attempts the still-dirty tone again.
- A blur occurring while a save/regenerate/finalize task runs queues behind that task. Read expected version only when the queued tone task starts. Save/finalize is one indivisible queue item so no tone write can land between its save and signature call.
- Record the successful tone version transition through `acknowledgeMetadataVersion(expectedVersion, returnedVersion)` and apply it to `form.setValue('expected_updated_at', ...)` synchronously before the next task. Use normal `acceptSavedNote` only for full saves/regeneration.
- Do not disable the Save/Finalize trigger merely because its blur just queued a tone write: that can swallow the click. Preserve explicit-action pending UI and enqueue the user's requested action. Catch queue failures at each event boundary so there are no unhandled promises. Tone controls must not start writes when locked/correction-disabled.
- New `src/hooks/__tests__/use-note-mutation-queue.test.ts`: deferred-promise tests for ordering and recovery.
- New `src/components/clinical/__tests__/visit-editor-save-finalize.test.tsx`: parameterize initial_visit, pain_evaluation_visit and discharge, following the existing regeneration test mounts. Include discharge pain_score_max in fixtures so finalization is eligible.

### Automated verification

Run `npm test -- src/hooks/__tests__/use-note-mutation-queue.test.ts src/hooks/__tests__/use-visit-note-version.test.ts src/components/clinical/__tests__/visit-editor-save-finalize.test.tsx src/components/clinical/__tests__/visit-editor-regeneration.test.tsx src/actions/__tests__/note-tone-version.test.ts`.

Required deferred-promise/component tests:

- Change tone, blur directly onto Save; save waits for tone v2 and submits v2 without refresh.
- Tone blur followed by finalize: tone completes, form saves with its version, finalizer receives the save's version; no tone write interleaves before signing.
- Tone → Regenerate uses latest version; subsequent Save uses regeneration's returned version.
- Tone-only success preserves unsaved education, other prose and decision/details.
- Unchanged tone does not write or advance version; failed tone aborts the dependent operation; retry succeeds after transient failure.
- A tone task queued behind another mutation reads its resulting version, not the version captured at blur. Multiple captured tone changes persist in order.
- A failed preceding blur aborts the already-waiting action without automatic retry; a later user action may retry. Queued draft writes do not run after successful finalization, unmount, identity change or loss of writability.
- True stale-version failure is shown and never followed by a fetch-newest-and-retry or finalizer call.
- Extend `src/hooks/__tests__/use-visit-note-version.test.ts`: acknowledge tone v1→v2→v3, then deliver delayed matching-fingerprint v2 props; form stays on v3. Repeat after a full saved-row acknowledgement; an unrecognized newer matching-fingerprint metadata refresh still advances, while external narrative changes are rejected. Full-save canonical education reconciliation remains intact.
- Use realistic user-event focus/click ordering for the blur-on-Save case, not only separate fireEvent calls. Verify the requested action is not lost when blur runs first.

### Manual verification

For initial, pain evaluation and discharge drafts, change tone and click directly on Save Draft, Finalize, and Regenerate. Repeat with unchanged tone, slow requests, and a competing edit from a second session. Confirm no refresh is necessary for successful local operations and no prose disappears. Check correction mode stays unchanged.

## Final Verification

After all phases:

- Run the targeted commands above, then `npm test` because the queue spans multiple note families.
- Run `npx tsc --noEmit` and `npm run lint --` with the changed TypeScript files listed explicitly. Preserve existing file formatting; package.json defines no standalone format script.
- Run `git diff --check` and review the complete diff for unrelated changes.
- Perform the local guarded-write verification and manual browser flows above. Run `npm run db:test` if database infrastructure is available, since server mutations depend on existing concurrency/status rules; no schema reset is required.
- Record actual commands/results and distinguish mocked tests from local database and browser checks. If local services are unavailable, report those unverified checks rather than declaring them passed.

## Risks and rollback considerations

- Route revalidation can remount the follow-up editor during operations; the version-key behavior is pre-existing and retained. The browser check must exercise refresh arriving before and after action completion. If it reveals a reproducible loss/duplicate action caused by the remount, stop and extend the plan with an explicit parent-state reconciliation design before changing the key.
- A queue must not deadlock after rejection or silently proceed past failed tone persistence. Deferred-promise tests cover this.
- Tone timestamps must come from the guarded write itself; fetching a newer external version would weaken concurrency protection.
- Removing unused discharge tone insertion changes that action contract. Repository callers are updated together; pre-generation still persists tone through its generation path.
- No migration/backfill is needed. Roll back client and action-contract changes together; the original refresh workaround would return, and saved content remains valid.

## Completion criteria

- Both reproduced stale-version paths have permanent regression coverage and pass without mocked route refresh updating props.
- Own saves provide the next version; tone/save/regenerate/sign operations execute in order without losing the triggering click or unsaved content.
- External-edit conflicts, eligibility checks and failure handling remain enforced.
- Relevant automated checks pass; manual/database verification results are recorded with explicit limitations.

## Verification Summary

Overall readiness: **Ready**. Independently reviewed against the repository using the verify-plan workflow; approved for implementation after revisions.

### Findings

Resolved Major — Phase 3 queue dependency handling: an already-waiting action must abort after failed tone persistence, rather than silently retrying. Added explicit failure dependency tracking and deferred tests.

Resolved Major — Phase 3 lifecycle handling: cancel unstarted work after unmount/identity changes or successful finalization, and check writability when tasks execute. Added terminal-state and cancellation tests.

Resolved Major — Phase 3 version reconciliation: delayed matching-fingerprint props could revert an acknowledged timestamp. Added metadata-only acknowledgement, superseded-version tracking, and delayed-v2-after-v3 regression coverage.

### Missing Work

No blocking planning omissions remain. Implementation and the specified automated/manual checks are future work.

### Risks

Follow-up route remount timing and real guarded database writes still require the browser/database checks above; mocked component tests do not establish those results.

### Suggested Changes

All required review revisions have been incorporated.

### Final Recommendation

Approve implementation. Planning verification included full-plan review, source/contract inspection, and `git diff --check` (passed). Application code was not changed and tests were not rerun for this documentation-only planning task.


## Implementation Results — September 13, 2026

### Phase checklist

- [x] Phase 1: follow-up save responses update the local version, saved decision, canonical prose and recommendations before another action. Missing saved rows cannot proceed to signing. Same-render duplicate action dispatch is guarded.
- [x] Phase 1 automated checks: 3 files / 21 tests passed.
- [x] Phase 2: both tone actions require exact draft identity and expected timestamp, return their own updated timestamp, and report zero-row updates as conflicts. The unused discharge tone insert branch is removed.
- [x] Phase 2 automated checks: 2 files / 22 tests passed.
- [x] Phase 3: the per-editor queue coordinates tone blur, save, regeneration and signing; failed dependencies abort waiting actions; unstarted work is cancelled after terminal/lifecycle changes. The version hook ignores known superseded props and accepts tone versions without changing prose.
- [x] Phase 3 automated checks: hook/version/regeneration suites (3 files / 22 tests) and new parameterized editor flows (1 file / 18 tests) passed. The queue suite was rerun after removing an unused test parameter warning (9 tests passed).
- [x] Full application suite: `npm test` — 123 files, 1,665 tests passed. Includes 54 new JavaScript/TypeScript regression cases.
- [x] Type check: `npx tsc --noEmit` passed after correcting a save-result union narrowing error found on the first run.
- [x] Targeted ESLint: all 12 changed/new TypeScript files checked; no errors. One new test unused-parameter warning was corrected and that file rechecked cleanly.
- [x] Final diff review and `git diff --check` passed.
- [x] Local database integration: `npx supabase test db --local supabase/tests/database/note_tone_version_test.sql supabase/tests/database/visit_treatment_decision_test.sql` — 2 files / 2 aggregate pgTAP assertions passed. Each assertion exercises multiple scenarios; the tone test checks all three draft families and rolls back its disposable rows.
- [ ] Full database suite: `npm run db:test` reached local Supabase but failed in two unchanged SQL tests. `discharge_note_correction_test.sql:35` references an assigned provider absent from provider_profiles; `procedure_numbering_test.sql:42` violates the existing procedure-date ordering rule. Ten other database test files passed. These failures do not execute the changed TypeScript actions and no existing SQL test or migration was changed.
- [ ] Manual browser checks/user confirmation remain outstanding, including delayed route remount timing, final PDFs, generation/reset, and correction mode. No app was listening on port 3000; the app’s existing environment targets a hosted database. No hosted clinical records were used for verification.

### Files changed

- Follow-up editor and its existing decision tests.
- Initial/discharge tone server actions and new `src/actions/__tests__/note-tone-version.test.ts`.
- Initial/discharge editors, shared version hook and its tests.
- New `src/hooks/use-note-mutation-queue.ts` and its tests; new `src/components/clinical/__tests__/visit-editor-save-finalize.test.tsx`.
- New `supabase/tests/database/note_tone_version_test.sql` for repeatable local integration verification.

### Implementation details and scope notes

The tone coordinator is exported alongside the FIFO in the planned queue-hook file, avoiding duplicated sequencing logic between editors. Discharge correction saves retain their separate action path. Generation/remount keys, RPCs, migrations, and procedure-note code are unchanged.

The only extension to the planned file list is the permanent local pgTAP tone regression test, added to make the planned guarded-write check repeatable. Its initial temporary /tmp location was not visible inside the test container; moving it into the workspace test directory resolved that runner limitation. No schema changes or persistent test records were created.

Supabase update/select behavior was checked against the official update reference. CLI help and local tests required filesystem access for the CLI’s telemetry preference. Application and focused database verification are complete; the full database failures and manual browser checks above remain explicitly unverified/failed rather than passed.
