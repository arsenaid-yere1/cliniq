# Visit Treatment-Plan Acceptance Implementation Plan

## Overview

Status: **deployed to production; spacing fix accepted by the user; understanding wording retained; production-branch documentation synchronization authorized**. The full clinician/browser/PDF checklist remains unconfirmed beyond the specific user feedback recorded below. The previous broad education/consent implementation was reverted on 2026-09-10 at the user's request. This plan supersedes the former procedure-consent and shared-generation infrastructure work. This plan is the single current planning document for this feature; the abandoned implementation does not constitute approval of this design.

Add a visible Patient's decision regarding the treatment plan control to visit notes, defaulting to Accepted. Explicit clinician Save Draft or Sign confirms that the reviewed selection reflects the patient's actual response to the plan discussed at this visit. Opening a visit, generation, intake saves, and autosave do not confirm acceptance. This documents the patient's treatment decision; it is not implied legal consent or permission to perform a procedure.

### Resolved decision — actual agreement, clinician-confirmed documentation

The intended workflow is an actual treatment-plan discussion followed by the patient's agreement and the clinician's review. When that occurred, documenting acceptance is appropriate. Accepted remains the visible draft default for convenience; it is not evidence by itself. The clinician may leave Accepted selected and confirm it using the existing Save Draft or Sign action. Do not require toggling the selection, a separate checkbox, an additional modal, or a separate patient signature for this visit-decision control.

The clinician selects Partial, Deferred, Declined, or Not documented when those reflect the encounter. Use Not documented if the patient's response was not established. Save/Sign records the clinician's confirmation of the response; it does not obtain agreement from the patient. The accuracy concern is an unreviewed default being recorded, not an actual, accurately documented agreement.

Acceptance covers the plan actually discussed and accepted. If only some components were accepted, document Partial acceptance and the limitations. Do not infer authorization to perform a proposed procedure from general visit-plan agreement. Understanding and procedure/telehealth consent remain separate. The clinic is in California; this product decision is not a legal-compliance certification and does not replace applicable consent requirements.

## Research baseline before implementation

After the revert, application files match HEAD. No new clinical-discussion table, provenance columns, generation RPCs, education cards, or procedure-consent controls remain.

- Initial Visit and Pain Evaluation share `src/components/clinical/initial-visit-editor.tsx`, `src/actions/initial-visit-notes.ts`, and `src/lib/claude/generate-initial-visit.ts`. Their plan is `treatment_plan` and their education section is `patient_education`.
- Discharge uses `src/components/discharge/discharge-note-editor.tsx`, `src/actions/discharge-notes.ts`, and `src/lib/claude/generate-discharge-note.ts`. Its plan is `plan_and_recommendations`.
- Follow-up uses `src/components/visits/pain-follow-up-editor.tsx`, `src/actions/pain-follow-up-notes.ts`, and `src/lib/claude/generate-pain-follow-up.ts`. Its plan is `treatment_plan`; telehealth consent is separately captured in `telehealth-intake-card.tsx`.
- `saveInitialVisitNote`, `saveDischargeNote`, and `savePainFollowUpNote` save draft narratives. Initial/discharge signing already saves form values before finalization; verify and align follow-up's explicit save-before-sign path.
- Existing finalization functions compare note versions before attaching the rendered document. Existing audited resets retain signed snapshots and support retained-content editing. These remain the lifecycle foundation.
- Current visit prompts contain unconditional understanding language in some branches. Acceptance must not introduce or reinforce unsupported understanding claims.

## Desired End State

| Item | Agreed behavior |
| --- | --- |
| Covered visits | Initial, pain evaluation, follow-up, discharge |
| Treatment decision | Accepted / Partially accepted / Deferred / Declined / Not documented |
| New unsaved selection | Accepted — pending clinician review |
| Confirmation | Existing Save Draft or Sign confirms the patient's actual response to the visible, discussed plan; no additional confirmation step |
| Partial acceptance | Require clinician-entered accepted/deferred treatment details |
| Deferred/declined | Optional clinician-entered explanation; never invent a reason |
| Not documented | No generated decision/agreement closing |
| Understanding | Independent evidence; no default understanding checkbox or inference from acceptance |
| Existing notes | Preserve saved prose and signed PDFs; no backfill or bulk regeneration |
| Changed plan | Show review notice; retain the recorded decision as historical to its reviewed plan until explicit reconfirmation |

For clinician-confirmed Accepted, add “The patient agreed to the treatment plan discussed at this visit, as outlined above.” For partial acceptance, describe only the clinician-entered limitations. Deferred and declined use corresponding wording. Visit-plan agreement never becomes written consent, guardian authority, assent, or consent to PRP/Botox or a future procedure series.

## Key Discoveries

Four visit types map to three note tables, because initial and pain evaluation share `initial_visit_notes`. Keep the decision on the current note rather than adding a new cross-visit evidence system. Whole-object provider-intake saves are unrelated actions and must not capture acceptance defaults. Existing signed snapshots provide historical retention; new metadata still needs narrow reset/correction compatibility tests.

The previous audit reproduced these unsupported current-response strings passing broad historical/prospective exemptions:

- “The patient agreed to PRP and will discuss scheduling next week.”
- “After reviewing the prior note, the patient agreed to the full injection series.”

Retain these as regression cases for the smaller visit generation change. Do not reintroduce the abandoned global publication consistency claim.

## What We Are Not Doing

- No procedure-note or procedure-recording UI/action/schema/prompt changes.
- No new consent methods, guardian/assent controls, supporting-document links, or consent revisions.
- No education-topic checklist, affected-region personalization, or separate default understanding attestation.
- No replacement of shared generation locks, procedure scheduling RPCs, case-wide source fingerprints, or general signing/correction architecture.
- No automatic changes to legacy notes, telehealth consent, or signed PDFs.
- No remote deployment without a separate deployment request; implementation is now authorized.

## Implementation Approach

Use one nullable, versioned `visit_treatment_decision` JSON object on each of `initial_visit_notes`, `discharge_notes`, and `pain_follow_up_notes`. Null is the persisted legacy/missing value. Database and server schemas have no affirmative default. Suggested Accepted exists only in the interactive note editor.

The object contains decision, optional details (bounded to 2,000 characters), reviewed-plan hash, visit date, confirmed actor, and confirmed timestamp. Actor/time/hash/date are server-derived. A normalized nonempty plan is required to confirm acceptance or partial acceptance. Partial acceptance also requires details. Missing versus explicit Not documented remains distinguishable; both omit generated agreement wording.

Introduce only a narrowly scoped transactional visit-draft save operation where needed to save narrative and decision together. It validates active user, exact note/case/episode ownership, draft/writable state, expected note version, and valid decision shape; it stamps confirmation from the submitted reviewed plan and updates narrative/decision atomically. Do not reuse a generic intake/autosave endpoint for confirmation. Guard direct mutation of server-owned confirmation metadata. Follow the existing private-function/public-invoker pattern if an RPC is needed; restrict it to these three tables. It must compose with existing reset/signing lock order, rather than introduce a competing case-wide gate.

Explicit Sign first saves the visible note/decision through the same operation, then renders and finalizes the saved version through the existing path. A failed save stops signing; a failed finalization may leave the explicitly saved draft, which is acceptable and should be reported accurately. Do not permit a note with unsaved decision selections to render a different closing in its final PDF.

Generation resolves only the saved decision for that exact note during database persistence; the model itself does not author the current decision. A full regeneration may replace the plan; acceptance must not silently attach to that replacement. Compare normalized plan hash and visit date, show review if changed, and omit the application-generated acceptance closing until reconfirmed. Opening a legacy draft may display the suggested Accepted control, but must not alter its narrative without an explicit save. Never derive today's decision from previous notes or scheduled treatment.

## Phase 1: Visit decision contract and persistence

### Files and changes

- Add `src/lib/validations/visit-treatment-decision.ts` with strict enums, bounded details, cross-field checks, and separate UI-draft construction.
- Add a fresh additive migration for the three nullable note fields and the narrow save/metadata safeguards. Do not restore `20260910212849_clinical_discussion_evidence.sql`.
- Update `src/types/database.ts` from an isolated development schema.
- Extend edit schemas in `src/lib/validations/initial-visit-note.ts`, `discharge-note.ts`, and `pain-follow-up-note.ts`, and the corresponding explicit save actions. Missing decision payload from an unrelated/legacy caller preserves stored metadata and cannot create acceptance.
- Preserve the new field in existing signed snapshots and retained-content Edit. Clear it when wiping the visit note; new episodes start null. Narrative-only discharge corrections retain the original confirmed decision and do not attest a new one. If correction prose changes the plan, show the decision mismatch for review; changing encounter facts still requires the authorized reset workflow.
- Make only the necessary additive compatibility changes to the currently installed reset/correction functions. Preserve independent completed-order reset behavior.

### Automated verification

Test UI-only Accepted defaults; nullable legacy values; all decision variants; required partial details; spoofed actor/time rejection; exact-owner access; stale version and locked/generating/finalized/open-correction rejection; atomic narrative/decision persistence; failed-save rollback; unrelated intake/autosave isolation; snapshot/keep-content/wipe behavior. Include a narrow two-connection save/sign or reset/save test for any new transactional function. Do not claim broad upstream-source concurrency guarantees.

### Manual verification

Save each decision on one draft per visit type, reload, and verify it persists. Confirm opening or cancelling without Save makes no database change.

## Phase 2: Compact note-editor controls

### Files and changes

- Add `src/components/clinical/visit-treatment-decision-fields.tsx` inside the editable note form, near Patient Education and the plan.
- Integrate only `initial-visit-editor.tsx`, `discharge-note-editor.tsx`, and `pain-follow-up-editor.tsx`.
- Label the field “Patient's decision regarding the treatment plan.” Show current saved state separately from “Accepted — pending clinician review.” Preserve partial/refused/deferred/not-documented values on reload and rerender.
- Add text beside existing Save/Sign actions: “Saving or signing confirms that the selected decision accurately reflects the patient's response to the plan discussed at this visit. Select Not documented if the response was not established.” No extra modal, confirmation checkbox, or mandatory selection toggle.
- Show details for partial/deferred/declined responses, preserving drafts on failures. Disable the fields with existing case/episode/note/correction locks.
- Show a plan/date-change review notice and require an explicit Save/Sign to reconfirm the displayed selection against the revised plan. Keep Not documented available; do not introduce a blanket finalization requirement for affirmative acceptance.

### Automated verification

Component tests for visible Accepted draft, no write on mount/autosave, explicit payload on Save and Sign, saved exceptions, partial validation, Not documented, stale-save failure preserving edits, changed plan notice, and locked historical/correction views. Verify that leaving the visible Accepted default unchanged and explicitly saving confirms it without an extra step, while selecting Not documented produces no agreement closing. Test Sign uses the saved version for PDF rendering.

### Manual verification

Check keyboard labels, mobile layout, all visit types, and partial/declined cases. Verify telehealth/procedure controls are unchanged.

## Phase 3: Visit wording and verification

### Files and changes

- Add matching TypeScript/SQL visit-decision closing helpers, with database persistence reconciling explicit saves and the three visit generators. Exact application fragments are replaceable; no internal markers are needed. Do not add procedure consent fragments or a broad evidence subsystem.
- Update `generate-initial-visit.ts`, `generate-discharge-note.ts`, and `generate-pain-follow-up.ts`, including regeneration. Preserve branch-specific counseling content and the initial-visit restriction on PRP education.
- Source understanding independently from documented encounter text; remove unconditional understanding requirements where necessary. Acceptance does not establish that education occurred, questions were answered, or understanding was verbalized. Preserve existing clinician-authored wording unless the clinician edits it; surface contradictions for review rather than silently rewriting arbitrary prose.
- Keep application-generated closings replaceable without duplication. Updating the decision or choosing Not documented removes the previous application closing; legacy manual agreement wording is flagged for clinician review when inconsistent.
- Keep section columns and raw generated output consistent, strip internal markers, and ensure exports use the saved reviewed text.
- Reserve current decision assertions for the deterministic helper; model assertions elsewhere trigger a bounded repair or actionable failure. Historical/prospective exceptions must qualify the assertion itself, not exempt the entire sentence.

### Automated verification

Extend the three generator suites, edit-action tests, and shared closing tests. Cover accepted/partial/deferred/declined/missing/not-documented, no invented reasons or understanding, historical-only agreement, the two audit regressions, no procedure-consent promotion, full/section regeneration, changed plans, duplicate removal, and raw/PDF text parity. Retain procedure generator tests unchanged as a regression boundary.

Run affected tests, `npm test`, `npx tsc --noEmit`, changed-file ESLint, `npm run lint`, `npm run build`, and `git diff --check`; distinguish baseline failures from new failures. Run schema/lifecycle tests in an isolated environment. The user authorized remote Supabase verification when local Docker/Podman is unavailable; retain synthetic-fixture isolation and do not run a linked production reset.

### Manual verification

Preview notes and PDFs for every decision and visit type. Confirm existing signed notes remain unchanged. Verify no markers, IDs, confirmation metadata, or invented reasons appear in prose. Recheck a changed plan, declined treatment, reset/reconfirmation, and narrative-only discharge correction before release.

## Risks and rollback considerations

Accurately recording actual patient agreement is the intended behavior. The documentation risk arises if an unreviewed default is saved despite agreement not being established, or if the wording extends beyond the accepted plan. Visible draft labeling, explicit Save/Sign wording, alternative decisions, and partial-acceptance details address that workflow risk without adding a new confirmation step. Acceptance remains separate from understanding and procedure consent. Persisting a reviewed-plan baseline is necessary to avoid reusing acceptance after regeneration.

This is still a multi-file feature, but its infrastructure scope is limited to visit-draft persistence and existing lifecycle compatibility. Any discovered need for a broader generation/consent rewrite must be raised as separate work, not silently added back.

Deploy the small schema change before UI/actions/prompts. Reverting that release should preserve recorded decisions and signed metadata. Do not drop populated data or backfill acceptance. The current abandoned implementation has not been deployed, so today's revert requires no remote rollback.

## Completion criteria

- [x] Four visit types have a visible, editable Accepted default without automatic confirmation.
- [x] Existing Save/Sign confirms the patient's actual response and records the reviewed plan together, including an unchanged Accepted default, without an extra confirmation step.
- [x] Partial/refused/deferred/not-documented responses produce accurate wording.
- [x] Acceptance never invents understanding or procedural consent.
- [x] Changed plan/date prompts review; legacy and signed notes remain intact.
- [x] Procedure and telehealth consent workflows are unchanged.
- [x] Implementation and automated persistence/lifecycle, generation, editor, and PDF text checks are complete; the unrelated repository lint failure is documented below.
- [ ] Complete clinician/browser and visual PDF release checks.
- [x] Verified production’s evaluation lifecycle trigger, applied the feature migration, and promoted the application release after the user authorized production deployment.
- [x] Verify this revised implementation plan against the proposed schema/action details before writing code; the old broad-plan approval does not apply.

## Revert record — 2026-09-10

Restored 34 tracked application/test files to HEAD and removed 20 feature-only source/test/migration files. Preserved unrelated SQL scripts and committed case-reset changes. Recovery copy: `/tmp/cliniq-abandoned-consent-20260910-162510` (patch, manifest, and full source copies). Superseded planning and verification files were removed from the repository; recovery copies are in the same temporary backup under `plan-history/`. No remote migration was applied or rolled back in this operation.

Revert verification: `git diff --exit-code` passed (tracked files match HEAD); `npm test` passed (104 files, 1,350 tests); `npx tsc --noEmit --pretty false` passed; `git diff --check` passed. Only planning/research documents and the three unrelated pre-existing SQL scripts remain untracked. No new feature implementation is present.

## Pre-implementation verification — current visit-only design

Readiness: **Ready with minor revisions incorporated below**. The three note families and existing note-first lifecycle lock order support a narrowly scoped save RPC. Follow-up currently signs without saving its editor values; Phase 2 explicitly fixes that. No separate confirmation or procedure mutation is needed.

Implementation detail: a note-local trigger guards confirmation metadata and reconciles the deterministic closing against the saved decision, normalized plan, and visit date on narrative writes. It updates matching raw-response education text in the same row write. This avoids adding a shared generation protocol. Only model-generated decision assertions are rejected; manual prose gets review notices. Signed/correction narrative keeps its original source metadata. The save RPC uses note → encounter → episode → case row locks, matching existing reset/finalization ordering.

Remaining risks/tests: verify correction restoration and full regeneration retain or clear current-note metadata deliberately; prove stale save/sign behavior; keep broad upstream-source serialization outside scope. Supabase changelog and function documentation reviewed; no applicable API change to the invoker/private-function pattern was identified. Approval here is for implementation, not deployment or completed testing.

Phase tasks: (1) contract, note-local migration/save and SQL tests; (2) three editor integrations and component tests; (3) visit parsers, wording regressions, full checks and manual-review record.


## Implementation and verification record — 2026-09-10

Implemented all three phases within the visit-only scope. New code is centered on `visit-treatment-decision.ts`, `save-visit-decision.ts`, `visit-treatment-decision-fields.tsx`, `use-visit-note-version.ts`, and `visit-decision-output.ts`. The migration is `supabase/migrations/20260910234459_visit_treatment_decision.sql`. No procedure or telehealth consent behavior changed.

Lifecycle details verified during implementation:

- Save/Sign records the reviewed narrative and decision together. Sign passes the returned saved version to finalization; an intervening edit stops signing. Follow-up now saves before signing.
- Tone/vitals-only refreshes may advance the editor version when persisted narrative, visit date, and decision remain unchanged. External narrative changes retain stale-save protection and local draft edits.
- Follow-up saves compare the displayed encounter date with the locked encounter. Finalization rejects a decision whose reviewed plan/date changed. Pain-evaluation saves reject a server-rendered plan that differs from the submitted reviewed plan.
- Existing narrative-only discharge corrections bypass new closing reconciliation and new-attestation checks, retaining original evidence through save/cancel/finalize. Open corrections cannot confirm a new visit decision.
- Keep-content Edit retains metadata and signed snapshots; wipe Reset clears current metadata. The repository’s existing `sync_initial_visit_note_encounter_trg` automatically reopens and completes Initial/Pain Evaluation encounters when note status changes. The initial test environment omitted this trigger; the later gap-resolution verification below restores it on the isolated branch and tests the real transition. No extra evaluation lifecycle patch is required in this feature.
- The raw response reconciliation covers direct output plus the existing `raw` and `data` wrappers. There are no internal prose markers.
- Generated types were obtained from the isolated migrated schema; only the nine new nullable field declarations and new RPC signature were incorporated, preserving unrelated existing type differences.

Automated verification:

- `npm test`: **111 files, 1,392 tests passed** (includes PDF text extraction for five decision variants across four visit types).
- `npx tsc --noEmit --pretty false`: passed.
- Changed-file ESLint: passed. `npm run lint`: existing unrelated `react-hooks/set-state-in-effect` error in `src/components/settings/invite-user-dialog.tsx:62`; 40 existing warnings. No unrelated lint fixes included.
- `npm run build`: passed with network access for existing Google Fonts downloads; the first sandboxed attempt could not fetch fonts.
- `git diff --check`: passed.
- Remote schema-only Supabase verification branch: visit-decision SQL suite and expanded reset/snapshot/keep-content/correction-cancel suite passed. All 35 existing correction assertions passed after supplying the required provider-profile fixture in the isolated test script. Every pgTAP result was inspected using a direct PostgreSQL connection, rather than relying on the Management API's last-result-only response.
- `supabase/tests/concurrency/visit-treatment-decision.mjs`: passed with **observed blocking PIDs across two independent PostgreSQL connections**. Explicit save committed; the competing stale reset failed; the saved decision and narrative remained intact. Temporary `pg` tooling was installed outside the repository. This is a narrow save/reset guarantee, not a claim about all upstream generation inputs.

Manual release checks remain unconfirmed: clinician review of wording, keyboard/mobile browser workflow, save/reload on all four visit types, and visual PDF review. Automated rendered-PDF text parity passed; it does not substitute for clinician/browser sign-off. No production migration, patient-data backfill, or signed-document rewrite was performed. Deploy the additive migration before the application release.

Verification cleanup: the temporary schema-only branch `codex-visit-decision-verification` was deleted after testing, and its local connection-credentials file was removed. The clinic project was not migrated.


## Subsequent plan verification — 2026-09-10

### Verification summary

Historical review outcome (findings resolved below): **Needed significant revision** to the completion/verification claims and targeted implementation corrections before release. The agreed visit-only scope, Accepted draft default, existing Save/Sign confirmation, and separation from procedure consent remain valid. A broader consent architecture is not recommended. This review supersedes the earlier readiness assessment; passing tests did not cover the cases below.

### Findings

1. **Major — section regeneration overwrites unrelated unsaved Patient Education.** Phase 2 requires preserving clinician drafts. `src/components/clinical/initial-visit-editor.tsx:1413` and `src/components/discharge/discharge-note-editor.tsx:481` unconditionally replace `patient_education` in `acceptSavedNote`, which is also called after regenerating any section. Editing Patient Education and then regenerating Assessment/another section restores the database's older education text without warning. A direct execution probe of both current callbacks reproduced this replacement. Separate explicit-save acknowledgment from section-regeneration reconciliation; preserve dirty education text and reconcile only the application's closing when appropriate. Add editor-level tests using unsaved education changes, not only shared field/hook tests.

2. **Major — current-response assertions bypass the model-output guard.** Phase 3 reserves these statements for clinician-confirmed deterministic output. Direct calls to `validateVisitDecisionOutput` in `src/lib/claude/visit-decision-output.ts:14` returned success for all three examples: “The treatment plan was accepted by the patient.”; “The patient is agreeable to the proposed treatment plan.”; and “The patient reviewed the options and has agreed to proceed.” The parser misses passive/adjectival forms and loses the patient subject after splitting on `and`. With a missing/Not documented decision, the persistence trigger does not remove these model-authored statements. Cover these grammatical forms, preserve subject/qualification context, and add actual full/section parser regressions. Document that a targeted text guard is not an exhaustive semantic guarantee.

3. **Major — full discharge regeneration has no decision-retention policy in the implementation.** Phase 1/3 requires historical retention against the reviewed plan and review when that plan changes. `generateDischargeNote` at `src/actions/discharge-notes.ts:747` does not load the saved decision, soft-deletes the current row at line 817, and inserts a replacement without it at line 833. Calling this full-generation action for a note with a saved Declined/Partial/Deferred decision leaves the replacement null; `visitDecisionDraft(null)` displays Accepted with no previous-decision or changed-plan notice. The archived row retains its JSON, but the active review workflow loses it. Define and implement preservation of the prior selection/baseline across same-visit regeneration, without confirming acceptance of the replacement plan. Explicit wipe Reset may still clear it. Add action-level regeneration tests; the existing SQL plan-update test only updates one row in place and does not exercise this replacement path.

4. **Minor — the evaluation lifecycle verification claim is inaccurate.** The record above calls evaluation completion a separate existing step. In the repository, `supabase/migrations/20260827154248_sync_evaluation_note_encounters.sql:6` and its trigger at line 51 automatically synchronize note finalization with encounter completion. The reset test manually sets the encounter completed at `supabase/tests/database/clinical_reset_test.sql:211`, masking absence/failure of that trigger in the tested schema. Replace that manual update with an assertion of the real transition, verify the isolated database includes the repository's lifecycle migrations, and reassess whether the added reset compatibility clause is necessary. No production-schema inspection or mutation was performed in this review.

### Missing work and risks

- Add the three regression scenarios above, then rerun affected action/editor/parser and SQL lifecycle checks.
- Initial/discharge editor integration and actual full-regeneration coverage are needed; the shared component tests and follow-up happy paths cannot establish all four workflows.
- Keep clinician/browser and visual PDF review pending. The earlier PDF tests prove text rendering of supplied strings, not the full save/regenerate/sign workflow.
- The immediate risks are lost clinician text, unsupported model-authored agreement, and loss of previously selected exceptions during replacement generation. These do not change the user's accepted-default decision.

### Verification performed in this review

Re-read the current plan, contract, persistence migration, editor/save/regeneration paths, lifecycle synchronization migration, and relevant tests. Ran direct execution probes against the current parser and both editor acknowledgment callbacks; observed the bypasses and overwritten text described above. Ran the six focused field/hook/parser/save-helper/follow-up/PDF test files: **29 tests passed**, demonstrating that their existing cases miss these defects. `git diff --check` passed. No application code was changed, no remote test branch was created, and no migration was applied during this verification.

### Suggested changes and final recommendation

Keep the approved product scope. Correct the three implementation gaps, remove the lifecycle-test workaround in favor of asserting actual behavior, update completion claims, and complete the outstanding release checks. The implementation fixes and updated release constraints are recorded below.


## Gap resolution — 2026-09-10

The four review findings above are resolved in the implementation without changing the accepted-default workflow or adding consent controls.

- [x] **Preserve editor drafts.** `acceptSavedNote` in the Initial/Pain Evaluation and Discharge editors distinguishes an explicit save/education regeneration from regeneration of another section. It preserves clinician education prose and removes only the exact stale application closing after a changed-plan regeneration. Initial/Pain Evaluation text fields are disabled during the pending operation, matching Discharge. Both editors submit their reviewed version to section regeneration; both actions reject an externally changed version before gathering/generating. Tests in `visit-editor-regeneration.test.tsx` exercise the real editor controls for all three UI variants; `visit-section-version.test.ts` verifies the three stale-action paths.
- [x] **Close parser bypasses.** `validateVisitDecisionOutput` recognizes passive acceptance, adjectival agreement, and coordinated perfect-tense decisions. Shared parser and all three full/section generator suites cover the exact reported examples, historical attribution, prospective statements, and negative consent wording. This remains a targeted textual guard, not an exhaustive semantic guarantee.
- [x] **Retain discharge history on regeneration.** `generateDischargeNote` updates the existing note in place, claiming its expected version/status instead of deleting and replacing it. It never copies or changes server-owned decision metadata. Existing finalized notes require the reset workflow. Action tests cover Declined, Deferred, Partial and Not documented; database generation-cycle tests prove the original confirmation remains unchanged and the closing is omitted for a replacement plan until explicit reconfirmation.
- [x] **Test the actual evaluation lifecycle.** Removed the manual encounter-completion write from `clinical_reset_test.sql` and the redundant evaluation reset patch. The test now asserts automatic completion. The isolated schema copy had no `sync_initial_visit_note_encounter_trg`; applied the existing repository migration `20260827154248` there before testing. The feature migration now fails before schema changes if that prerequisite trigger is absent or disabled. Its enabled/disabled checks were verified transactionally.

Latest automated verification:

- `npm test`: **112 files / 1,411 tests passed**, followed by **3 additional stale-action tests passed** in the newly added `visit-section-version.test.ts`.
- `npx tsc --noEmit --pretty false`: passed after the added tests.
- Changed-file ESLint: passed, including the new action/editor tests.
- `npm run lint`: same unrelated baseline error at `src/components/settings/invite-user-dialog.tsx:62` and 40 warnings.
- `npm run build`: passed. `git diff --check`: passed.
- Disposable schema-only Supabase branch: decision SQL scenarios passed for **Initial, Pain Evaluation, Follow-up and Discharge**, including all exception decisions through full regeneration. Reset/snapshot/keep-content/wipe lifecycle passed with the actual synchronization trigger. All **35 correction assertions** passed using the existing isolated provider-profile fixture adaptation. The two-connection save/reset contention test passed again. No production writes were made.

Remaining release requirements: clinician/browser and visual PDF checks are still unconfirmed. Before deployment, verify and restore the existing evaluation synchronization migration on the intended target if needed; the feature migration deliberately refuses a drifted target. The remote test branch’s missing trigger is evidence about the isolated schema copy, not a completed production audit. No production deployment is included in this task.

Cleanup: temporary branch `codex-visit-decision-gap-check` was deleted after verification, and its local connection file was removed. This remains the single current plan.


## Production release — 2026-09-10

User authorized production deployment with “push to prod.” Release commit: `61b6725` (`feat: record visit treatment-plan decisions`). The commit contains 38 feature source, migration, and test files; unrelated reset scripts and local planning/research documents were excluded.

Production preflight confirmed that `sync_initial_visit_note_encounter_trg` already exists and is enabled. No trigger repair or historical-data update was needed. The dry run identified only `20260910234459_visit_treatment_decision.sql`; that migration applied successfully. Production verification confirmed all three nullable/no-default columns, all three decision guards, existing note RLS, authenticated-only save permissions, the public invoker wrapper, reset compatibility, and rejection of a missing user identity. Security advisors reported no errors before or after rollout.

Vercel built the clean commit archive with production settings and reached READY before the migration was applied. Deployment `dpl_6DMVJsrBxjN9TaFf8vuimpGs2ZWb` was then promoted. Inspecting `https://cliniq-nine.vercel.app` resolves to that deployment. Login returned HTTP 200; unauthenticated `/patients` returned HTTP 307 to `/login`. No patient fixture writes or note generation were performed in production. Clinician/browser and visual PDF checks remain unconfirmed.

A local Python archive compatibility error initially led to creation of an empty temporary Vercel project, `cliniq-release-61b6725`. It was deleted. The actual release uses the existing `cliniq` project from a separately verified clean archive.

The separate GitHub push to `origin/codex/complete-return-tele-visits` was rejected by automatic approval review: it classified publishing potentially sensitive source to that feature branch as not specifically authorized by the production-deployment request. No workaround push was attempted. At that point the production deployment was live while release commit `61b6725` remained local. The user subsequently requested deletion of the extra branches, preserving the commit on local `main`, and later explicitly requested committing the plans to production `main`.


## Production spacing correction — 2026-09-10

User reported accumulating blank lines before the agreement closing. Root cause: PostgreSQL `btrim(text)` strips spaces but leaves newlines; removing/reappending the closing therefore accumulated separators. Migration `20260911011409_fix_visit_decision_spacing.sql` trims spaces/tabs/CR/LF around the removed application fragment and joins the closing with one space. Existing internal clinician paragraphs and signed notes are not bulk rewritten. An existing draft gap is corrected on the next explicit Save Draft.

Local commit `e7e95a4` contains the new migration and repeated-save regression. The regression failed before the fix and passed afterward across all four visit types; reset lifecycle and 35 correction assertions also passed. Applied the single pending hotfix to production and verified the migration record, inline separator, newline trim and all three active guards. No app redeployment or GitHub push was required. Temporary branch `codex-visit-spacing-check` was deleted and its connection file removed.

The user confirmed the missing sentence meant “The patient verbalized understanding,” then instructed “leave as is.” No automatic understanding assertion was restored; documented understanding remains separate from treatment-plan agreement. Production verification confirmed the spacing migration is installed, its three note guards are active, no migrations remain pending, and login returns HTTP 200. The user then reported “looks good” and requested that the plans be committed to production. This confirms acceptance of the reported correction, not completion of every earlier manual test scenario.
