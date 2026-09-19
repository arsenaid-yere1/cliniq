# Follow-up notes in Quality Review

Date: 2026-09-16

## Research question

Does the existing Quality Review functionality include pain-management follow-up notes, and what does that inclusion cover?

## Summary

Yes, partially. Quality Review loads pain follow-up notes for the active care episode (or latest episode when none is active), sends six narrative sections to the AI reviewer, accepts and displays follow-up findings, and can route eligible findings to section regeneration. It does not review every follow-up section, prescribe follow-up-specific review rules, or provide a follow-up-specific editor link.

This is source-code research, not a live clinical-case review. No application code was changed.

## Detailed findings by component

### Source collection and episode scope

- `src/actions/case-quality-reviews.ts:46`, `gatherSourceData`, resolves the episode and collects its note chain.
- At line 102 it queries `pain_follow_up_notes` by `case_id`, `episode_id`, and `deleted_at IS NULL`. There is no note-status restriction, so draft and finalized notes are both eligible, as are other statuses. There is no explicit follow-up ordering or encounter-date join.
- At line 273 the rows become `painFollowUpNotes` in the review input. A null result becomes an empty array; the follow-up query error is not separately checked.
- `src/lib/clinical/episode-context.ts:81`, `getActiveOrLatestEpisode`, selects the active episode first and otherwise the highest episode number. The review does not aggregate follow-ups across every episode.

The six included narrative fields are `subjective`, `telehealth_observations`, `assessment`, `diagnoses`, `treatment_plan`, and `clinician_disclaimer`. Identifiers and status (`id`, `encounter_id`, `status`) are also included.

Compared with the eleven sections defined in `src/lib/validations/pain-follow-up-note.ts:9`, the review omits:

- `interval_history`
- `review_of_systems`
- `imaging_review`
- `patient_education`
- `follow_up`

It also does not select structured `procedure_recommendations`, encounter intake, or the encounter date for follow-up review.

### AI input and review rules

- `src/lib/claude/generate-quality-review.ts:64`, `QualityReviewInputData`, explicitly defines `painFollowUpNotes`.
- `generateQualityReviewFromData` serializes the full collected input into the user message. The selected follow-up fields therefore reach the model.
- The output tool includes `pain_follow_up` as a supported step and an `encounter_id` field. The result parser preserves that identifier.
- `SYSTEM_PROMPT` at line 120 still describes the chain as initial visit → pain evaluation → procedures → discharge. Its checklist at line 144 has no dedicated follow-up rules. Its completeness criteria at line 156 do not require follow-up notes.
- Inference: the model can raise follow-up findings from the supplied content and allowed output schema, but consistent follow-up coverage cannot be established merely from that support. No live model call was made.

### Deterministic checks

`src/actions/case-quality-reviews.ts`, `runCaseQualityReview`, merges `validateExternalCauseChain` and `validateSeventhCharacterIntegrity` with model findings. Both implementations in `src/lib/qc/diagnosis-validators.ts` inspect initial-visit, procedure, and/or discharge diagnoses; neither iterates `painFollowUpNotes`.

The separate `src/lib/qc/telehealth-follow-up.ts` validator is not called by the Quality Review action or generator. Its existence does not establish deterministic telehealth checking in Quality Review.

### Findings, fixes, and navigation

- `src/lib/validations/case-quality-review.ts` includes `pain_follow_up` in `qcStepValues`, permits encounter IDs, and incorporates a present encounter ID into a versioned finding hash.
- `findingFixEligibility` requires a follow-up finding to have an encounter ID, note ID, and non-synthetic target section.
- `src/actions/case-quality-reviews.ts:996`, `fixFinding`, dispatches follow-up fixes to `regeneratePainFollowUpSectionAction(caseId, encounterId, section, findingFix)` and runs the complete review again after successful regeneration.
- `src/actions/pain-follow-up-notes.ts:196`, `regeneratePainFollowUpSectionAction`, requires an in-progress encounter, writable episode, draft note, valid section, and enabled return-tele-visits feature. Inclusion in review does not mean a finalized follow-up can be regenerated.
- `src/components/clinical/qc-review-panel.tsx:87` displays the label “Pain Follow-Up.” Follow-up findings participate in the generic severity groups, scores, and provider overrides.
- `findingDeepLink` at line 95 has no `pain_follow_up` branch. The “View in editor” link consequently falls back to `/patients/${caseId}`, rather than the encounter editor.
- The panel's `VERIFIABLE_STEPS` contains only procedure and discharge. Follow-up findings can use the general resolution/recheck flow but do not get that Verify button.

### Staleness and execution flow

`computeSourceHash` hashes the collected input, and `checkQualityReviewStaleness` recollects that same input for comparison. Changes to included follow-up fields affect that hash. Changes confined to omitted fields do not affect the hash through those fields themselves.

Flow: Quality Review page → manual Run/Recheck → resolve episode → collect selected note fields → hash input → AI review → merge deterministic diagnosis findings → store review → display findings and scores. Eligible Fix with AI → regenerate the follow-up section → full Recheck.

`src/app/(dashboard)/patients/[caseId]/qc/page.tsx` explicitly labels review as manually triggered and loads both the saved review and staleness result.

## Existing tests and verification

- `src/actions/__tests__/case-quality-reviews.test.ts:683` directly tests encounter-scoped follow-up fix dispatch, including forwarding the target section and finding instructions. Its regenerator is mocked to return an error; it is not an end-to-end successful fix test.
- `src/lib/validations/__tests__/case-quality-review.test.ts` checks acceptance across all step values, including follow-up, alongside generic schema, scoring, hash, and fix-eligibility behavior.
- The inspected suites do not directly assert collection of a populated follow-up note, omitted-section coverage, or follow-up editor navigation.
- Ran `npm test -- src/actions/__tests__/case-quality-reviews.test.ts src/lib/validations/__tests__/case-quality-review.test.ts`: **2 files, 78 tests passed**.
- Source searches and manual tracing verified the collection, prompt, schema, UI, and dispatch behavior. No live UI, database, or model verification was performed.
- Formatting/lint/type checks were not run because this task only adds a research Markdown document. Existing unrelated working-tree changes were left intact.

## Historical context

`git log -1 -S "painFollowUpNotes" -- src/actions/case-quality-reviews.ts` identifies commit `561ff93` (2026-08-26), “feat: complete return tele-visit workflow,” as the latest commit changing that symbol's occurrence count. Current source is authoritative for the findings above.

The existing Graphify graph was consulted through a local adjacency traversal after its CLI was unavailable. It linked the Quality Review actions, generator, schema, UI, and diagnosis validators, but contained older source locations; citations above were verified against current files.

## Open questions

- Whether the six-section selection and lack of explicit follow-up review rules are intentional is not established by the inspected implementation.
- Actual model detection quality for follow-up issues is unverified; passing mocked unit tests does not establish clinical-review completeness.

## Follow-up question: narrative consistency

Quality Review already has AI instructions for pain-trajectory consistency, treatment-plan continuity, chief-complaint drift, diagnosis progression, symptom-resolution contradictions, and copied sentences across procedure notes (`src/lib/claude/generate-quality-review.ts:144`). These are semantic review instructions, not deterministic guarantees.

Separately, `src/lib/qc/narrative-validator.ts:77`, `validateNarrative`, produces nonfatal warnings for banned hedges, forbidden phrases, date formatting, short nonempty sections, and sentence duplication across sections (token overlap of at least 0.7). It does not compare clinical meaning or detect arbitrary contradictions. Empty sections are excluded from its checks.

A repository-wide caller search found this helper in initial-visit, procedure, and discharge action paths, but not in the follow-up generator or Quality Review action/generator. Follow-up generation has separate telehealth and treatment-decision guards, as described above. The implementation plan adds explicit follow-up semantic consistency instructions; it does not add the generic prose validator to follow-ups.
