# Prior Episode History for Pain Evaluation Implementation Plan

## Overview

Include previous completed episodes in a returning patient's Pain Management evaluation through a separate, read-only `priorEpisodeHistory` input. Keep Case Summary as the shared accident/outside-record summary. Use the same historical facts for generation, section regeneration, and quality control (QC).

Implementation was authorized by the subsequent request to continue. Deployment remains a separate step.

## Current State

- `src/actions/initial-visit-notes.ts`, `gatherSourceData`, fetches finalized initial-visit reference data within the selected episode. A return episode usually has null `priorVisitData`. Current intake and vitals are separately episode-scoped.
- `src/lib/claude/generate-initial-visit.ts`, `InitialVisitInputData` and `buildSystemPrompt`, feed full and section generation. Existing pain-evaluation instructions assume persistent symptoms after conservative care and describe null priorVisitData as no prior visit on the case. These instructions need to distinguish a same-episode reference from earlier episodes.
- `computeSourceHash` hashes the full input; `computePrpTargetEvidenceHash` hashes only current PRP evidence. Source hashes do not currently enforce general sign-time freshness.
- `gatherSourceData` also supports save/finalize PRP validation. Historical retrieval must not become a dependency of these unrelated operations.
- `src/lib/clinical/load-follow-up-intake-history.ts` demonstrates completed-encounter/finalized-note joins and procedure facts, but serves a different intake workflow and only looks back one adjacent episode number. It is not the new loader.
- QC V3 uses `src/lib/qc/review-source.ts` snapshots, current `notes` as editable targets, and `sources` as evidence. Legacy QC uses `src/actions/case-quality-reviews.ts` and a separate model input.

## Desired End State

1. The patient returns after discharge and starts a new episode with pain evaluation. The generated history can describe prior evaluation, performed treatment, documented response, and discharge condition with dates.
2. The most recent eligible discharged episode has detailed chronology; older eligible episodes have deterministic compact records. Gaps in episode numbering are supported.
3. Successful prior discharge followed by recurrence is supported. Earlier treatment is not automatically called unsuccessful, nor are symptoms assumed continuous.
4. Current symptoms, examination, vitals, diagnoses, treatment decisions, and consent remain grounded in current evidence. Historical recommendations do not become current orders or PRP eligibility.
5. Follow-ups and discharge continue in the current episode under existing lifecycle rules. Historical notes remain unchanged.
6. QC can verify historical references without offering edits to previous episodes or counting previous procedures toward the current series.

## Key Discoveries

- `priorVisitData` has same-episode semantics; adding history to that field would undo isolation.
- Treatment Plan section regeneration has a special full-generator branch in `initial-visit-notes.ts`; both branches need coverage.
- `src/lib/claude/context-bundle.ts` retains nested input but drops empty top-level values. The new field must have a tested absence contract and must not reuse `priorProcedureNotes`, which receives special summarization.
- `src/lib/claude/visit-decision-output.ts` recognizes historical decisions only with specific attribution such as “At the previous visit …”. Use compatible prompt examples without weakening current-consent validation.
- Performed procedures belong to episodes through `procedures.episode_id`. Procedure notes join through `procedure_id`; they have no episode column. Do not use nonexistent `procedures.encounter_id` or mistake an ordering encounter for a performed encounter.
- Finalized discharge corrections update the canonical row in place. Open corrections/reset notes become drafts with revision snapshots. Initial scope consumes current finalized rows only, not archived snapshots or multiple versions of one visit.
- `review-trajectory.ts` selects sources by `type === 'procedures'`; historical procedures need a distinct type and defensive scope filtering.
- `review-findings.ts` currently checks future evidence for case-scoped sources; historical sources need the same temporal protection.

## What We Are Not Doing

- No Case Summary rewrite, stored AI history summary, new table, migration, or backfill of signed notes.
- No changes to episode start/reset/discharge rules, billing, orders, current intake prefill, or follow-up generation.
- No automatic regeneration after old records change and no new general sign-time freshness gate.
- No use of draft text or last-signed revision snapshots as clinical evidence. Snapshot fallback can be a separate feature with an explicit provenance policy.
- No new history editor or UI panel in this first delivery.
- No repair of unrelated database/QC defects, migration-history changes, or database resets.

## Implementation Approach

### Shared contract and selection

Create a server-side `load-prior-episode-history.ts` loader and a pure `prior-episode-history.ts` contract/projector under `src/lib/clinical/`. Use the caller's authenticated client and existing access controls, never an elevated client.

Input: validated case ID, selected episode ID/number, and current pain-evaluation service date. Enable only for pain evaluations with episode number greater than one, including legacy return episodes without the newer requires-pain-evaluation flag. Validate selected episode ownership using the existing episode scope helpers.

Query all live same-case lower-numbered episodes, with deterministic ordering and pagination. Discharged episodes with a current finalized discharge attached to a live completed discharge encounter and discharge service date no later than the target date are eligible. The greatest eligible episode number gets detailed projection. Do not require consecutive numbers. Report clinically relevant skipped lower episodes and reasons in coverage metadata; wholly future-dated episodes/records are outside the cutoff and do not contribute counts, identifiers, coverage changes, or hashes; never silently present an older eligible episode as the immediately preceding one.

Historical note eligibility requires matching case and episode, live finalized note, live completed encounter of the expected type, and a known clinical service date no later than the target date. Evaluation/discharge dates use note visit date then encounter date; follow-ups use encounter date. Do not substitute created/finalized timestamps or scheduled dates for unknown service dates. Procedures use performed procedure date and owning episode; finalized narrative joins by procedure ID and matching case. Draft procedure narrative is excluded even when the performed procedure itself is valid.

Same-day records are allowed: lower episode number establishes prior-series membership, without claiming intraday order. Future, deleted, cancelled, wrong-case, wrong-episode, undated, and reopened draft records cannot supply clinical facts. Pending corrections are coverage limitations; finalized corrected canonical rows become authoritative on the next read. An episode whose discharge is reopened is temporarily ineligible and explicitly identified as such.

Return structured episode metadata, selected facts, provenance (table, row ID, episode ID/number, service date), coverage limitations/counts, and internal version descriptors. Version descriptors are separate from model input. Missing history is a valid explicit state; query failure is an error, never an empty history fallback.

### Projection and size policy

For the latest eligible episode include finalized evaluation complaint/diagnoses/relevant assessment and treatment narrative, all eligible follow-up subjective/interval/assessment/plan fields, performed procedure date/type/sites and documented immediate outcomes, finalized procedure narrative, and discharge subjective/assessment/plan/prognosis/pain fields.

For older episodes include evaluation dates and diagnoses, performed procedure dates/types/sites and explicitly documented outcomes, and discharge condition/recommendations/pain fields. Omit full examination and follow-up narratives deliberately; coverage states which categories were condensed or excluded and counts eligible visits. Do not generate another AI summary or infer improvement from procedure counts. Preserve measured versus estimated pain labels. Tolerance and complications describe immediate outcomes, not sustained benefit. Use existing site parsing/label helpers with legacy injection-site fallback.

Fetch in pages of 500 and enforce 16 MiB collected-data and 256 KiB projected-history UTF-8 JSON budgets, including provenance/coverage. Detect overflow rather than silently dropping rows or clipping narrative fields. Fail generation/regeneration/QC with a readable history-too-large error and preserve the existing note/review. No arbitrary episode-count cap. Sort episodes by number and facts by service date, source type, and ID; no wall-clock timestamps in the clinical payload. Include only selected raw fields as evidence; never synthesize text intended to be quoted by QC.

### Generation and safety

Resolve the clinical service-date cutoff once before history lookup, from the generation action’s explicit effective visit date or the persisted note/encounter service date. Do not use `pickVisitAnchor` fallback to finalized-at or today for historical selection; that helper can retain its existing age/display behavior. If regeneration has no valid service date, return explicit unavailable-history coverage without querying historical clinical facts. Share this cutoff policy with QC. Add an explicit gathering purpose/option: full generation and both section-regeneration branches include history; save/finalize PRP-only validation does not query it. Add backward-compatible optional `priorEpisodeHistory` to `InitialVisitInputData`; normalize absence consistently.

Revise shared pain-evaluation instructions and the misleading priorVisitData comment. Distinguish current episode, same-episode initial reference, and earlier episode facts. Permit documented prior-care comparison with dated attribution, including recurrence after improvement, but forbid treating old examination, pain scores, consent, medications, and plans as current facts. Current evidence wins where conditions differ over time; change alone is not a contradiction. Use validator-compatible historical-decision wording. Keep history outside `prpTargetEvidence` and current intake/vitals.

Full-input hashes naturally include deterministic clinical history. Do not include read timestamps or unused source metadata. Preserve existing PRP hashes and save/sign behavior. Historical corrections affect subsequent generation/QC, not already signed documents automatically.

### Quality control

Use the shared loader/projector in both QC paths. For V3, derive the cutoff from the selected return pain-evaluation service date, not today or later discharge. Load once per snapshot. If no return evaluation exists, attach no history. If its date is unknown, attach a coverage limitation rather than use today's date.

Extend `ReviewSource.scope` with `historical_episode`, use stable namespaced source IDs and types such as `prior_episode_procedure`, and include episode/date provenance plus exact selected source fields. Add history only to `snapshot.sources`, never `snapshot.notes`. Extend future-evidence validation to historical sources and explicitly filter current trajectory procedure sources by scope. Historical sources may support findings about current notes but cannot become fix targets.

Include projected clinical values, selection/coverage, and source membership in the clinical hash. Extend the internal `versions` entry type with an optional deterministic `fingerprint` while retaining `source_id` and nullable `updated_at`. Add a namespaced historical-selection entry whose fingerprint covers relevant membership/eligibility descriptors and contributing row versions; ordinary entries stay compatible. Keep these descriptors in `versions`, which is excluded from the clinical hash/model input. Correction, reopen, deletion, or membership changes detected by the existing final reread must abort stale publication. Do not make excluded future/cross-case records affect hashes. Existing stable-snapshot rereads must reread the historical selection too; avoid a cache that bypasses freshness checks.

Give legacy `QualityReviewInputData` the same history contract and update both model prompts to treat history as background evidence. Legacy parsing currently checks shape rather than current-target membership: validate each finding’s step/note/procedure/encounter tuple against the current episode input before publication, preserving existing case-summary/cross-step exceptions. Historical IDs may be evidence only. Revalidate the exact current target at legacy fix and verify dispatch before changing overrides or regenerating; reject mismatched/historical IDs rather than redirecting a step to a different current note. Add model-output and persisted-stale-finding regression tests for these guards. Preserve V3 target ownership, draft-only edits, expected-version/lease fencing, and previous published review on failed recheck. Recheck existing reviews after deployment when needed; do not auto-modify signed notes.

## Phase 1: Shared read-only historical source

### Files and changes

- Add `src/lib/clinical/prior-episode-history.ts` and `load-prior-episode-history.ts` with the contract, deterministic projection, provenance, size errors, and authenticated paged reads.
- Reuse ownership helpers from `src/lib/clinical/evaluation-scope.ts` and `episode-context.ts`; use `load-follow-up-intake-history.ts` only as a query-pattern reference.
- Add corresponding tests under `src/lib/clinical/__tests__/`.

### Automated verification

Test no history, multiple prior episodes with gaps, latest detailed/older compact projection, same-day inclusion, future/undated exclusions, wrong ownership, deleted/cancelled rows, completed-encounter requirements, performed procedures without finalized narratives, multiple sites and legacy fallback, draft corrections, finalized corrected data, query failures, pagination, deterministic ordering, byte-budget overflow, and explicit partial coverage. Assert no mutation calls.

### Manual verification

Review synthetic three-episode output against source rows, including a successful discharge followed by recurrence. Confirm coverage identifies any excluded correction and condensed older follow-ups.

## Phase 2: Generation and regeneration integration

### Files and changes

- `src/actions/initial-visit-notes.ts`: date resolution, gathering option, loader integration for full and both regeneration branches.
- `src/lib/claude/generate-initial-visit.ts`: typed field, shared prompts, recurrence and current-evidence rules.
- Extend `src/actions/__tests__/evaluation-episode-isolation.test.ts`, `initial-visit-qc-episode.test.ts`, and `initial-visit-generation-diagnostics.test.ts`.
- Extend `src/lib/claude/__tests__/generate-initial-visit.test.ts`, `context-bundle.test.ts`, and `visit-decision-output.test.ts`.

### Automated verification

Assert full/section/Treatment Plan/QC regeneration receives identical history while priorVisitData remains same-episode only. Test Episode 1 compatibility, correct current intake/vitals, deterministic source-hash changes, unchanged PRP eligibility/hash when only history changes, no historical query on ordinary save/sign, no persistence after history retrieval failure, and unchanged prior notes. Test prompt contracts and decision-validator historical attribution; do not claim model wording is guaranteed by mock tests.

### Manual verification

Generate a return evaluation on synthetic data and inspect dated prior history, successful-discharge/recurrence wording, current exam/pain independence, and no inferred consent/PRP target. Regenerate a normal section and Treatment Plan. Confirm prior episode notes and Case Summary remain identical.

## Phase 3: QC evidence, isolation, and freshness

### Files and changes

- `src/lib/qc/review-types.ts`, `review-source.ts`, `review-findings.ts`, and `review-trajectory.ts`: history scope/sources, cutoff, temporal validation, deterministic hashes/version coverage, current-only trajectory.
- `src/actions/case-quality-reviews.ts` and `src/lib/claude/generate-quality-review.ts`: shared history for legacy/V3 prompts and legacy input.
- Extend relevant existing tests under `src/lib/qc/__tests__/` and the action QC tests; add historical snapshot integration fixtures.
- Preserve `review-service.ts`, `review-input.ts`, `review-identity.ts`, `review-validators.ts`, and `case-quality-review-findings.ts` contracts; change them only if required by typed integration.

### Automated verification

Verify evidence quoting resolves to exact historical fields and rejects future evidence; old notes never enter editable targets or current procedure counts. Included historical edits change clinical hash; metadata-only changes affect version checks as appropriate; future/wrong-case edits do neither. Reopen/delete/add/correct before the final freshness reread must abort stale publication; assert each changes the relevant version fingerprint. Changes after the final reread retain the existing publication race noted below. A failed history read preserves the prior published review. Update earlier tests that asserted all previous-episode edits were hash-irrelevant: only eligible included history now changes the hash. Test both QC modes and fenced fixes, including Treatment Plan regeneration. In legacy mode, model output targeting historical IDs and persisted mismatched target tuples must be rejected before publication/fix/verify; valid current findings still work.

### Manual verification

Run QC on the synthetic return evaluation. Inspect historical evidence references and current-episode navigation. Apply a supported current-note fix and verify no historical row changes. Correct or reopen a prior source, rerun QC, and verify revised coverage/freshness rather than duplicated visits.

## Phase 4: Regression verification and release readiness

### Files and changes

Record implementation results in this plan or a companion validation document. No database migration is expected. Review the final diff for unrelated changes and sensitive source logging; history content must not be added to operational logs.

### Automated verification

Run narrow tests after each phase, then the full shared regression set:

```sh
npx vitest run src/lib/clinical/__tests__/prior-episode-history.test.ts src/lib/clinical/__tests__/load-prior-episode-history.test.ts
npx vitest run src/actions/__tests__/evaluation-episode-isolation.test.ts src/actions/__tests__/initial-visit-qc-episode.test.ts src/actions/__tests__/initial-visit-generation-diagnostics.test.ts src/lib/claude/__tests__/generate-initial-visit.test.ts src/lib/claude/__tests__/context-bundle.test.ts src/lib/claude/__tests__/visit-decision-output.test.ts src/lib/qc/__tests__
npm test
npx tsc --noEmit
npm run lint
npm run build
git diff --check
```

Record commands and results, distinguishing pre-existing failures from regressions. No database reset or migration-history repair is needed. If implementation unexpectedly changes schema/RPC behavior, revise this plan before proceeding and add relevant database verification. Tests above are planned, not run as part of this planning task.

### Manual verification

Use synthetic data in a non-production environment for the lifecycle: prior discharge → return pain evaluation → follow-up → discharge. Check Episode 1 and existing legacy cases, QC modes, section regeneration, save/sign, and historical read-only navigation. Clinical prose review is required in addition to model-stub tests. Deployment is a separate execution step; do not alter production records to test this feature.

## Risks and rollback considerations

- Old records may be incomplete or reopened; explicit coverage prevents false completeness. No fallback to unreviewed or archived content.
- Large histories increase latency/context. Paging and explicit budgets avoid partial silent ingestion; overflow blocks generation/QC without losing existing work.
- Prompts cannot guarantee clinical accuracy; manual synthetic prose review supplements deterministic isolation and evidence tests.
- Existing QC performs a final source reread before publication but does not atomically compare every source row inside the publication RPC. This plan preserves that concurrency boundary; it does not promise immunity to an edit after the final reread. Closing that existing race requires separate transactional database work.
- Introducing historical evidence changes QC hashes for eligible return episodes. Existing review persistence remains compatible; fresh checks use the new evidence set.
- No schema changes means rollback is a code revert of generation and both QC integrations together. Keep already saved notes intact and recheck reviews against the restored evidence rules. Do not automatically strip historical prose from signed notes.
- The known unrelated procedure-QC database function issue and local/remote migration-history mismatch are outside this plan; do not conflate them with feature regressions or reset the database to obtain a green run.

## Completion criteria

- Return pain evaluations consistently receive correctly scoped and dated previous-episode context through a separate input.
- Older history coverage is explicit; unknown/draft/future/cross-case facts never become clinical evidence.
- Case Summary and historical notes are unchanged; current evidence, consent, PRP eligibility, lifecycle and save/sign rules remain intact.
- Full generation, both regeneration branches, V3/legacy QC and QC fixes have regression coverage.
- QC uses history as read-only evidence with freshness checks and never as an editable target or current-episode treatment count.
- Automated checks and synthetic manual verification pass or have clearly documented unrelated blockers before release.


## Implementation status — 2026-09-25

- [x] Phase 1: shared authenticated loader, deterministic projection, date/ownership guards, provenance, budgets, coverage, and tests.
- [x] Phase 2: full/section/Treatment Plan/QC regeneration integration, prompt updates, source-hash tests, PRP and save/sign isolation.
- [x] Phase 3: V3 historical evidence and freshness, legacy history and target validation, regression tests.
- [x] Phase 4 automated checks: full suite (2,315 passed, 11 skipped), focused final checks (58 passed), TypeScript, changed-file lint, production build, and whitespace review.
- [ ] Authenticated database smoke checks for restricted tables and manual clinical workflow/prose verification.
- [ ] Deployment (not performed).

See `thoughts/shared/plans/2026-09-25-prior-episode-pain-evaluation-history-validation.md` for detailed results and remaining verification. Repository-wide lint has one existing error outside this change. Legacy evaluation/discharge findings with omitted encounter IDs retain compatibility: exact current note membership is still mandatory and any supplied encounter ID must match. Follow-up fixes always require an exact encounter ID.
