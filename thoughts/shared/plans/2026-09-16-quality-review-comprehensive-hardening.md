# Comprehensive Quality Review Hardening Implementation Plan

Date: 2026-09-16
Status: Core implementation and focused automated verification complete; production release requested on 2026-09-19 with known verification limitations; deployment in progress. See `thoughts/shared/research/2026-09-19-quality-review-implementation-results.md`.
Scope: Follow-up coverage, narrative consistency, and all nine additional researched gaps.
Supersedes: `2026-09-16-follow-up-quality-review-coverage.md` as the implementation plan. The earlier research remains evidence.

## Implementation checklist

- [x] Phase 1: Authoritative snapshot and source regression tests
- [x] Phase 2: Grounded rules and deterministic coverage
- [x] Phase 3: Identity, reconciliation, and assessment
- [x] Phase 4: Transactional persistence and database concurrency verification
- [x] Phase 5: Exact Verify and fenced Fix
- [x] Phase 6: UI, evidence, history, and navigation
- [ ] Phase 7: Integrated checks and live model matrix executed; repository-wide failures, manual validation, and rollout remain open
- [ ] Manual verification confirmed by user

Checked phase items above denote implementation and focused automated verification, not manual sign-off. Exact results and remaining release gates are recorded in the implementation-results report.

## Overview

Make Quality Review inspect the current saved clinical record, explain its evidence limitations, and report findings whose destinations, status, and verification are trustworthy. Complete coverage alone is insufficient: the implementation must also prevent unrelated Verify checks, recurring issues remaining resolved, misleading clean summaries, and failed rechecks replacing successful reviews.

This is a phased implementation plan, not authorization to change clinical coding policy beyond the existing documented behavior. No application changes are part of this planning task.

## Current State

The application is a Next.js application using server actions, Supabase persistence, and Claude generation. Quality Review orchestration and persistence live in `src/actions/case-quality-reviews.ts`; the AI contract and prompt live in `src/lib/claude/generate-quality-review.ts`; shared finding schemas and eligibility live in `src/lib/validations/case-quality-review.ts`; the interactive workflow lives in `src/components/clinical/qc-review-panel.tsx`. Note generation and editing remain owned by the respective initial-visit, procedure, discharge, and follow-up actions.

The collector directly supplies only 6/16 initial sections, 5/16 pain-evaluation sections, 5/20 procedure sections, 6/12 discharge sections, and 6/11 follow-up sections. Raw generation payloads can contain outdated prose. Some requested comparisons lack intake, effective imaging, overrides, or origin vitals. Narrative validators are not rerun by QC. Verify uses broad note-type signals for nonsynthetic findings. Assessment remains the model's even after deterministic findings are added. Message-dependent finding hashes and sticky resolution mishandle recurrence. Several query and write errors are ignored. Finding targets are structurally validated but not matched against the actual source records.

Detailed evidence and baseline results:

- `thoughts/shared/research/2026-09-16-follow-up-notes-quality-review.md`
- `thoughts/shared/research/2026-09-16-quality-review-additional-gaps.md`
- Existing baseline: 101 tests across the QC action, schema, diagnosis, and narrative suites passed during research. Those tests do not cover all failures described here.

## Desired End State

1. Every canonical saved section and relevant structured decision is reviewed, including follow-ups.
2. Comparisons use traceable current sources, explicit dates, and exact case/episode/encounter ownership. Missing evidence is visible.
3. Deterministic rules rerun on current text. AI consistency findings cite valid evidence and target valid destinations.
4. Verify proves the specific supported rule no longer fails. AI findings use recheck or clinician disposition, not an unrelated proxy.
5. Rephrasing does not create a new identity; recurring violations reopen. “Not detected on recheck” is distinct from “verified resolved.”
6. Counts, assessment, summary, and actions agree with merged findings and coverage.
7. Review generation is tracked separately from successful published reviews. Failures preserve the last successful result.
8. Concurrent reviews, clinician dispositions, and fixes cannot silently overwrite each other. Signed notes and existing case/episode restrictions remain enforced.

## Key Discoveries

- Canonical section arrays exist in the four note validation modules. Use them rather than maintaining a second partial list.
- Provider intake is primary evidence in the initial/pain-evaluation generator. Follow-up intake and saved treatment decisions are encounter-linked. Never substitute default decision drafts for saved decisions.
- Approved/edited MRI, CT, and X-ray records carry content, dates, and provider overrides. Imaging override fallback preserves explicit null/empty values; existing PM consumers use nullish fallback. These are different policies and need explicit adapters and tests.
- `saveInitialVisitVitals` in `src/actions/initial-visit-notes.ts` can reassign a case-level nonprocedure vitals row to a later encounter. Historical origin readings may therefore be missing. Do not infer historical readings from the latest row.
- `computePlanAlignment` is a pure heuristic; an aligned plan does not prove an unrelated narrative issue resolved. `buildDischargePainTrajectory`, `buildTrajectoryForValidator`, and `validateDischargeTrajectoryConsistency` can be reused without writes. `refreshDischargeTrajectory` mutates notes and must not run from QC or Verify.
- The shared initial/pain-evaluation generator includes accident external-cause codes for both types. Follow-up has no established external-cause or encounter-suffix policy. Do not invent one.
- `parseIvnDiagnoses` normalizes M54.5 before QC can inspect the original text. Add a QC-specific nonnormalizing extraction path; preserve existing normalization for other callers.
- Review uniqueness is episode-scoped, not case-scoped. Reviews can apply to the latest discharged episode when no active episode exists. Do not impose an active-episode-only restriction.

## What We Are Not Doing

- Rewriting historical signed notes, automatically reopening encounters, or auto-applying fixes.
- Replacing clinician judgment with new medical recommendations, dose limits, mandatory improvement, or new follow-up coding rules.
- Repairing historical vitals ownership or redesigning every note save path. QC will expose unavailable evidence; data repair is separate work.
- Treating AI citation validation as proof of clinical correctness.
- Building a general background-job platform or changing model vendors.
- Modifying unrelated exam-finding/initial-visit work already present in the working tree.

## Implementation Approach

Implement in dependency order below. Keep the new workflow behind a single server-owned rollout flag until all phases pass; never run old and new writers concurrently for the same episode. Introduce focused QC modules rather than expanding the action file indefinitely:

- `src/lib/qc/review-types.ts`: client-safe contracts, rule identifiers, source references, coverage, transitions, and result unions.
- `src/lib/qc/review-source.ts`: server-only checked collection and source/version manifests.
- `src/lib/qc/review-rules.ts`: rule capabilities, applicability, severity, allowed sections, and Verify support.
- `src/lib/qc/review-findings.ts`: reconciliation, assessment, target validation, and evidence validation; keep cryptographic hashing server-only.
- `src/lib/qc/review-validators.ts`: current-source deterministic adapters.

Persist a versioned finding key generated on the server. The client must not import server-only hashing or database modules. Preserve legacy review readability with explicit legacy adapters.

| Gap | Primary phases |
|---|---|
| Follow-up sections, context, decisions, navigation | 1, 2, 5, 6 |
| Partial saved narratives / outdated raw payloads | 1 |
| Missing independent evidence | 1, 2 |
| Narrative warnings and consistency coverage | 2 |
| Overbroad Verify | 2, 5 |
| Clean assessment alongside critical findings | 3, 6 |
| Unstable identities, false resolution, recurrence | 3, 4 |
| Source failures and unsuccessful persistence | 1, 4, 6 |
| Diagnosis coverage and parent-code normalization | 2 |
| Invalid finding IDs/sections and misleading fixes | 2, 5, 6 |

## Phase 1: Authoritative, complete review snapshot

### Files and changes

Change `src/actions/case-quality-reviews.ts` to delegate collection to the new source module. Update `QualityReviewInputData` in `src/lib/claude/generate-quality-review.ts`. Use section arrays from `src/lib/validations/{initial-visit-note,procedure-note,discharge-note,pain-follow-up-note}.ts`.

- Resolve case and active-or-latest episode once through `src/lib/clinical/episode-context.ts`. Pass that exact episode through collection, generation, verification, and publication. Validate every linked encounter, note, and procedure against it.
- Collect all canonical current narrative columns, including null and empty values, plus status, note ID, encounter/procedure ID, visit date, and source version. Include follow-up `procedure_recommendations`, saved decision data, encounter modality/intake, and relevant structured clinical fields. Use the saved-decision parser from the visit-decision validation flow; preserve absent, explicit false, null, and undecided states.
- For follow-ups, batch-load encounter `encounter_date`, `status`, `modality`, `reason_for_visit`, `provider_intake`, `patient_reported_pain_min/max`, `patient_reported_measurements`, and `telehealth_consent_obtained`. Preserve a note with missing encounter context as unavailable, rather than dropping it. Project saved decisions to decision/details/reviewed plan/visit date; do not send confirming user identifiers as clinical evidence. Order follow-ups by encounter date, unknown dates last, then note ID.
- A parsed saved decision is not necessarily current: compare its `reviewed_plan_hash` against the current normalized plan using the same MD5/whitespace normalization as `20260910234459_visit_treatment_decision.sql`, and compare its visit date with the current effective note/encounter date. Represent matching, stale, absent, and malformed decisions separately. Keep `reviewed_plan` as historical evidence when stale; do not assert it confirms acceptance of a changed plan. Add deterministic stale-decision findings for applicable current draft notes; signed/corrected notes retain historical-decision provenance without treating permitted narrative corrections as a demand to reconfirm historical consent. Test those correction exceptions. Add fixtures for applicable current notes and fixtures for plan/date changes, normalization-only changes, and malformed payloads.
- Remove `raw_ai_response` from authoritative review text and source hashes. Keep database audit payloads intact. Recompute needed warnings against current text.
- Supply effective provider intake, reviewed case summary as secondary context, approved/edited nondeleted PM and imaging records, and explicit provenance. MRI uses `mri_date`; CT/X-ray use `scan_date`; include modality, region, laterality where present, findings, impression, review state, and IDs.
- Implement typed override adapters: imaging uses undefined-only fallback, preserving explicit null/empty overrides as in `src/lib/clinical/prp-target-evidence.ts`; PM uses existing nullish fallback as in procedure/discharge actions. Reject malformed override structures as unavailable evidence rather than inventing defaults. Test both policies independently.
- Keep case-level supporting documents labeled case-level. Do not infer episode membership. For historical note comparisons, exclude definitely later evidence; unknown study dates cannot establish a chronology violation. Use the latest applicable dated treatment plan at or before the procedure, including its documented origin and effective PM evidence. Same-date ties or conflicting applicable plans remain explicit ambiguity rather than array-order selection.
- Match origin and follow-up vitals to the exact encounter and case/episode. Match procedure vitals to its procedure and encounter. Missing or ambiguous readings remain unavailable; never borrow another encounter's measurement. Clearly distinguish measured and estimated discharge endpoints.
- Check every database response. A query error aborts the attempt with a source-specific error; a successful query with no row becomes an explicit missing-source state. An unavailable freshness check returns `unknown`, not `fresh`.
- Canonicalize clinical hashes with sorted object keys and stable date/ID ordering for unordered collections; preserve clinically ordered arrays. Include rule/schema version and coverage. Exclude progress, raw audit blobs, and wall-clock-dependent values. Track a separate version manifest for optimistic concurrency, including membership and note status changes.
- Because separate queries are not an atomic snapshot, compare consecutive source/version collections at start (maximum two retries) and recollect before publication. If sources changed, mark the attempt superseded and require a new run; do not publish it as current. A post-publication edit is handled by freshness checking. Do not claim this guarantees a transactional clinical snapshot.
- Bound serialized input size using a conservative configured budget established by synthetic large-case tests. If it exceeds the budget, return an explicit coverage/input-limit failure while preserving the previous review. Do not silently truncate notes or source evidence.

### Automated verification

Add `src/lib/qc/__tests__/review-source.test.ts` and extend action tests. Assert every canonical section survives projection; editing any section changes its clinical hash; raw-only audit changes do not. Test reordered query rows, explicit false/null, saved versus draft decisions, each query failure, absent rows, wrong-episode records, ambiguous vitals, historical/unknown dates, override semantics, version races, membership changes, and oversized inputs.

### Manual verification

Use synthetic cases with initial-entry and pain-management-entry episodes, follow-ups, discharged episodes, and older case-level documents. Confirm the snapshot contains current saved prose and reports evidence limitations without borrowing unrelated records.

## Phase 2: Grounded consistency rules and deterministic coverage

### Files and changes

Update `src/lib/claude/generate-quality-review.ts`, `src/lib/validations/case-quality-review.ts`, the new rule/validator modules, `src/lib/qc/{diagnosis-validators,narrative-validator,telehealth-follow-up}.ts`, and `src/lib/claude/pain-trajectory-validator.ts` where structured issue output is needed. Preserve existing generator-facing warning strings and APIs through adapters.

Rule coverage:

| Check family | Implementation and boundaries |
|---|---|
| Current narrative style | Run existing forbidden-phrase, date, short-text, and duplicate checks on every applicable note type. Separate duplicate scope from short-text applicability; exempt standard disclaimers/approved repeated boilerplate. Style findings are info/warning, not automatically critical. |
| Completeness | Explicit per-note/status required-section rules; do not label every empty optional section invalid. Missing expected note coverage follows entry path and episode state. |
| Diagnosis | Inspect original diagnosis text and structured diagnosis fields. Detect M54.5 across all note types without pre-normalization. Apply established external-cause requirements to initial and pain evaluation, and existing exclusion/suffix rules to procedure/discharge. No new follow-up external-cause/suffix policy. Compare structured versus narrative diagnoses as a separate AI consistency rule. |
| Telehealth | Adapt existing telehealth validator to current follow-up text and confirmed encounter modality. Missing modality is unavailable context; in-person findings must not inherit telehealth restrictions. |
| Numeric trajectory | Rebuild from exact current source readings using pure trajectory helpers, retaining estimate provenance and missing values. Use structured rule IDs for exact numeric mismatches. Missing evidence cannot verify an issue resolved. |
| Symptoms and diagnoses | Explicit AI comparisons of symptom persistence/resolution, assessment, diagnoses, and treatment plans within and across dated visits. |
| Laterality/anatomy | AI comparisons across intake, examination, imaging, diagnoses, recommendations, and performed procedures. Do not treat an unknown site as a contradiction. |
| Medications/allergies/doses | Flag documented contradictory names, units, doses, routes, or allergy statements with evidence. Do not infer unsafe prescribing from an external clinical policy. |
| Chronology | Compare actual dated events and known sequence; tolerate unknown dates and legitimate documented changes. |
| Follow-up decisions | Compare saved consent/decline/defer decisions, plan, education, return interval, and procedure recommendations. Distinguish discussing or recommending a procedure from performing it. |
| Plan continuity | Compare current indication/performed procedure with the applicable prior plan and documented explanation. Pure `computePlanAlignment` is supporting evidence, never proof that any arbitrary finding is resolved. |

Follow-ups are optional, repeatable visits interleaved with procedures; absence alone is not incomplete coverage. Retain generating/failed notes in coverage accounting as unfinished, but do not analyze their partial output as completed prose. Required chain coverage follows the existing entry-path contract: initial visit or pain-evaluation origin as appropriate, procedure coverage, and discharge; visibly distinguish an in-progress episode from a missing completed record. Use each note schema’s existing required fields for section completeness, with optional fields explicitly excluded.

Telehealth consent, saved treatment decisions, and procedure consent are separate evidence categories. Compare affirmative telehealth-consent claims with the encounter flag; absent context is not refusal. Do not use the model-output decision guard to reject clinician-saved decisions. A structured-only recommendation or missing-context issue has no regenerable section; it remains displayable with Fix disabled. Recommendations are not proof of an order or scheduled appointment.

Create a source registry with stable source IDs, types, valid field paths, and dates. Require AI findings to return a registered rule ID, valid target tuple, and evidence references. Text evidence must quote actual current source text; missing-field findings must reference a valid absent field. Contradictions require references to both conflicting facts. A syntactically valid UUID is insufficient: note/encounter/procedure/section membership must match the collected record and canonical section inventory.

Reject invalid output through the existing structured-output validation/retry mechanism; after its bounded retry, fail the attempt rather than silently dropping findings and declaring clean. The server assigns AI/deterministic provenance and capabilities; model output cannot grant Verify eligibility. Cap AI findings transparently: add coverage status and limit information; reaching the output finding cap is conservatively limited coverage. Deterministic findings are not silently capped.

### Automated verification

Extend generator, diagnosis, narrative, and telehealth tests; add `review-validators.test.ts`. Include previously omitted sections, edited text with stale raw warnings, M54.5 original text, pain-evaluation origin, follow-up modality, missing numeric inputs, legitimate worsening, approved boilerplate, saved decline versus procedure performed, date ambiguity, and clean controls. Test forged/cross-episode IDs, unknown sections, unsupported rules, invented quotes, invalid missing-field claims, exhausted validation retries, and finding-limit reporting.

Use synthetic semantic evaluation fixtures for every AI family with expected issue and clean-control cases. Mock contract tests do not establish model detection quality. Run the fixtures against the configured model during rollout and retain a versioned result report; no new real-patient evaluation dataset is required.

### Manual verification

Inspect evidence links and the actual saved sections for each rule family. Verify differences caused by legitimate visit progression are not presented as contradictions solely because values changed.

## Phase 3: Stable identities, lifecycle, and honest assessment

### Files and changes

Implement finding reconciliation in `review-findings.ts`; update schemas/action adapters and relevant schema tests.

- Use a versioned key based on registered rule ID, canonical target tuple, and a bounded rule-specific entity discriminator (for example the implicated diagnosis code). Exclude message wording, recommendation text, and severity. Aggregate multiple observations for the same tuple with merged evidence and maximum severity.
- Keep current detected findings separate from historical transitions. Store reconciliation transitions on the successful run, including the prior finding snapshot, old/new status, actor or automated reason, source fingerprint, and timestamps. Previous published reviews remain historical records.
- An AI finding absent on recheck becomes `not_detected`, never automatically `verified_resolved`. Exact deterministic replay may record `verified_resolved` only when applicable sources still exist and that specific rule passes. Deleted/missing/inapplicable sources produce `not_detected` or unavailable context, not verified resolution.
- A previously resolved or not-detected finding detected again becomes pending. Carry dismissal, acknowledgment, or edit disposition only if its relevant evidence fingerprint is unchanged; severity escalation or relevant source change reopens it. Preserve previous clinician rationale in history.
- Preserve explicit clinician manual resolution as `manually_resolved`, with actor/time/rationale; never relabel it verified. Its recurrence rule is identical to other resolved findings. The active predicate is: present pending/acknowledged/edited = active; dismissed/manually-resolved/verified-resolved/not-detected = inactive. Apply it after every disposition mutation and on read, so stored snapshots cannot leave UI summaries stale.
- Legacy hashes remain readable. Migrate carry-over only where an exact deterministic identity can be established; do not guess matches between ambiguous legacy AI findings. Retain their historical dispositions and label the first new review accordingly.
- Derive assessment after deterministic and AI merge, reconciliation, and coverage evaluation: incomplete coverage yields `incomplete`; otherwise actionable critical findings yield `major_issues`, warning/info findings yield `minor_issues`, and zero actionable findings yields `clean`. Show total detected and clinician-dispositioned counts separately. “Clean” wording must not imply no detected findings when findings were dismissed; use “No outstanding findings” with disposition counts in that case.
- Preserve generator-side severity-tier score normalization and the separate legacy fallback in `getFindingScore` (the latter does not normalize arbitrary numeric values). Normalize new merged scores at the server boundary. Aggregated duplicate findings take the maximum normalized score, not a sum. Derive active counts, total score, and assessment from one shared disposition predicate; acknowledged/edited findings remain outstanding until verified, no longer detected, or dismissed. Recompute these derived values after each disposition change. Test that counts and score cannot disagree with status.
- Generate the status summary from server counts/coverage, not the model's unchanged assessment. Optional AI explanatory narrative is subordinate to the server-derived status. Freshness is a separate state, never a hidden adjustment to severity.

### Automated verification

Add `review-findings.test.ts`. Cover identical issue with rephrased text, severity escalation, multiple entities per section, merged duplicates, returning violations, changed evidence with same key, absent AI versus absent exact deterministic rules, legacy migration, dismissed findings, missing sources, and all assessment precedence combinations. Regression: model says clean plus deterministic critical must never render clean.

### Manual verification

Run the same synthetic review twice with changed wording, resolve then reintroduce a deterministic violation, and remove an AI finding on recheck. Confirm history distinguishes recurrence, nondetection, and actual verification.

## Phase 4: Atomic publication and concurrent state changes

### Files and changes

Generate a migration with `supabase migration new quality_review_runs`; do not hand-invent a migration timestamp. Update generated `src/types/database.ts` with `npm run gen:types:local`. Add SQL tests under `supabase/tests/database/`. Refactor review actions to use the new transactional operations.

Retain `case_quality_reviews` for successful snapshots and its one-live-review-per-episode constraint. Introduce `case_quality_review_runs` for attempts: run UUID, case/episode, actor, kind (review/fix), status, timestamps, lease expiry, progress, source hash/version, error category, published review ID, and reconciliation transitions. Permit only one processing attempt per episode via a partial unique index. Use one documented lock order consistent with existing clinical mutations: note (when mutating), encounter (when needed), episode, case, run, review. All new RPCs acquire their needed subset in that order; publication must not lock review/run before episode/case. Include lock-order contention in database integration tests.

- Begin RPC locks the episode, validates authorized case access and current case restrictions, expires abandoned attempts, rejects another active attempt, and inserts the run. Allow review of the resolved latest discharged episode; do not require writable note state merely to review signed content.
- Keep the model call outside database transactions. Renew a two-minute lease every 15 seconds independently of model section progress; fence progress, heartbeat, failure, and publication by exact run ID and processing state. Heartbeat and publication additionally require an unexpired lease; an expired run cannot renew itself. Failure of lease renewal stops publication and further mutations; a completed note save is still reported truthfully. Late callbacks cannot resurrect an expired attempt.
- Publish RPC locks the active review and run and rechecks current case restrictions and the selected episode relationship under transaction locks, checks expected prior review ID/version, atomically archives the old successful row, inserts the new completed snapshot, and completes the run. Check every result/error. A failed transaction leaves the old snapshot active.
- Reconcile overrides in TypeScript against the latest review, then publish with its expected version. If a clinician changed dispositions meanwhile, reread and reconcile up to three times without rerunning the model. Exhaustion fails the attempt clearly and leaves the old review intact. Revalidate source freshness before successful publication.
- Failure only changes the attempt. If recording failure also fails, return that persistence error explicitly; never return success. A case with no successful review remains “No completed review,” not clean.
- Add atomic per-finding disposition RPCs using expected review ID, finding key, and expected prior entry/version; update just that JSON key. Lock the same review row used by publication. Reject stale-review edits and preserve concurrent edits to other findings.
- Reuse authenticated SQL/RLS conventions from `20260827175109_qualify_finalize_discharge_series_episode_id.sql` and `20260910234459_visit_treatment_decision.sql`: explicit authorization, qualified objects/search path, least-privilege grants, and no service-role bypass. New attempt writes must go through these operations; maintain existing review read access. Any security-definer helper must be private with a restricted public wrapper and tested ownership checks.
- Reconcile legacy live failed/processing rows in migration: preserve their attempt history; restore the latest eligible completed historical review for that same episode, ordered by generated/created time and ID, only where one exists. Preserve all rows and never manufacture successful results. Legacy hashes are marked needing recheck. Test all backfill shapes and uniqueness before production deployment.

### Automated verification

Add action tests for each query/RPC failure, first-run failure, failed recheck retaining prior results, source changes during generation, stale callbacks, lease expiry, recheck/disposition conflicts, publication rollback, and legacy recovery. Extend the Supabase mock only as required; mocks are not transaction evidence.

Add pgTAP checks for authorization, case/episode mismatch, uniqueness, rollback, expected-version conflicts, and grants. Add a local two-connection integration test for simultaneous begin, begin versus publication, simultaneous disposition updates, publication versus disposition, expired run versus late publish, expired fix versus final note save, and fix versus review. Demonstrate serialized outcomes and no lost updates using a disposable local database.

### Manual verification

Start two browser sessions against the same synthetic episode. Confirm only one attempt starts, clinician edits are retained, and forced generation/save failures leave the previous successful review visible.

## Phase 5: Exact Verify and trustworthy Fix

### Files and changes

Update `verifyFinding`, `fixFinding`, and disposition actions in `src/actions/case-quality-reviews.ts`; use the shared rule registry and source snapshot. Update regeneration entry points in `src/actions/{initial-visit-notes,procedure-notes,discharge-notes,pain-follow-up-notes}.ts` only where required for exact target/version binding.

Verify:

- Accept expected review ID and finding key. Reject stale review requests. Resolve the finding from persisted data, not user-provided rule details.
- Offer Verify only for registered deterministic checks. Rerun that exact rule on fresh read-only sources and match its entity/target; return still-present, verified-resolved, unavailable-context, stale-review, or failure.
- Never read stored warning absence or general plan status as universal proof. Never regenerate or mutate source notes during Verify. AI findings retain Recheck and explicit clinician dispositions.

Fix:

- Eligibility requires an actual current target, canonical regenerable section, exact case/episode/note/encounter/procedure relationship, supported rule, permitted case state, and draft/editable note. Respect follow-up feature enablement, encounter status, discharge correction locks, and existing episode rules.
- Reserve a fix attempt for the episode. Add a per-finding operation token with prior disposition so cleanup only affects this operation. Fix regeneration and recheck belong to this one attempt; do not recursively start a competing review attempt.
- Bind regeneration to expected note ID, episode ID, `updated_at`, and the fix run token, including source collection inside the generator. Add a backward-compatible optional target context to existing action APIs; QC calls require it. A preflight followed by a case-level “latest draft” query is insufficient. Preserve existing structured PRP/evidence guards. For QC fixes, commit the final note patch through a database-guarded RPC that atomically checks the exact unexpired processing fix run, expected note version/status, case/episode/encounter restrictions, and allowed note table/section fields, then saves the patch with existing triggers. A separate pre-write lease check is insufficient. Preserve the existing contract for ordinary editor regeneration. Generate this RPC in the Phase 4 migration or an additive Phase 5 migration and regenerate types; test authorization, field whitelisting, and trigger behavior. Expiration during the model call must prevent the late fix from saving even if the note version is unchanged.
- Restore the prior disposition on regeneration failure only if the token is still current. Never delete a clinician's newer override.
- After successful regeneration, recheck fresh sources. Return explicit outcomes: applied-and-not-detected, applied-but-still-present, applied-recheck-failed, target-changed, or failed. AI nondetection is not verified resolution. If note save succeeded but review publication failed, state that clearly and preserve the previous review with stale status.
- On source edit/version conflict, do not silently regenerate a different note or overwrite edits. Revalidate case/episode restrictions at mutation time. Never modify signed notes automatically.

### Automated verification

Extend QC action tests with successful paths for all four note families and initial versus pain evaluation, exact-target races, changed episodes, signed notes, disabled follow-ups, completed encounters, discharge correction locks, stale review IDs, invalid sections, unrelated plan/trajectory signals, failed recheck after successful save, token cleanup races, expired leases during regeneration (no late note save), and restored prior overrides. Test updated regeneration actions against wrong expected note/episode/version.

### Manual verification

Fix one supported draft finding of each note family. Confirm the intended editor section changes, success wording matches the recheck outcome, and signed-note findings offer viewing/manual review without an executable fix.

## Phase 6: Review UI, destinations, coverage, and history

### Files and changes

Update `src/components/clinical/qc-review-panel.tsx`, `finding-edit-dialog.tsx`, `finding-dismiss-dialog.tsx`, and `src/app/(dashboard)/patients/[caseId]/qc/page.tsx` as needed. Add focused component tests.

- Load `{review, lastRun, freshness, coverage}`. Keep the last successful findings visible while a new attempt is processing or failed. Poll the attempt ID, not a replacing review row; stop on terminal state/unmount.
- Render server-derived assessment/counts, evidence limitations, stale/unknown freshness, input/output limits, and attempt errors. Make progress and successful-result timestamps distinct.
- Derive Verify/Fix controls from validated server capabilities. Display blocked-action reasons instead of relying solely on note type. Show precise fix outcomes and refresh both review and note status after mutation.
- Route follow-up findings to `/patients/${caseId}/visits/${encounterId}`. If a legacy finding lacks encounter identity, use the visits list and explain that the exact destination is unavailable. Preserve valid routes for other note types; do not guess IDs.
- Render source excerpts and dates with text escaping. Keep internal diagnostics/model payloads out of the clinical flow. Distinguish “not detected,” “verified resolved,” “dismissed,” and “recurring” in history; retrieve older run transitions with pagination.
- Revalidate the QC page and affected note/editor routes after successful publication or note mutation; do not invalidate as if a failed write succeeded.

### Automated verification

Component tests cover old-result retention, first-run failure, unknown freshness, critical merge, disposition counts, input/output limitation, evidence display, deterministic Verify eligibility, signed-note Fix gating, all fix outcomes, follow-up navigation, legacy fallback, history labels, and polling cleanup.

### Manual verification

Exercise loading, processing, failure, incomplete coverage, stale/unknown, reviewed-with-dispositions, and no-outstanding states. Confirm keyboard navigation, accessible action labels, long-evidence wrapping, and that navigation opens the correct encounter.

## Phase 7: Integration, evaluation, and rollout

### Files and changes

Complete integrated fixtures in existing action/schema/generator suites and new QC helper/component/database tests. Add a short maintainer document under `thoughts/shared/research/` recording contracts, rule versioning, legacy behavior, rollout results, and remaining measured limitations.

Run phases in order; Phase 6 may be developed after contracts stabilize but must not ship before persistence/actions. Before rollout, apply the migration to a disposable database with representative legacy review shapes, regenerate types, and run all gates. Enable for synthetic cases first, then a controlled deployment. Log run IDs, error categories, durations, source/rule versions, and conflict counts without clinical text in general logs.

Required synthetic evaluation matrix: both episode entry paths; every note type; multiple procedures/follow-ups; missing optional and required sources; legitimate interval worsening; changed consent; unknown imaging dates; multiple episodes; signed/draft notes; contradictory versus consistent narrative pairs; long inputs; model failures; concurrent users; legacy reviews. Every explicit deterministic regression must pass. Each AI rule family must demonstrate both detection of its seeded issue and acceptance of its clean control on the configured model; unresolved false-positive/negative cases are documented and block claiming that family's coverage complete. Version prompt and fixture results together.

### Automated verification

Run during implementation and record exact outcomes:

```sh
npm test -- src/actions/__tests__/case-quality-reviews.test.ts src/lib/validations/__tests__/case-quality-review.test.ts src/lib/qc
npm test
npx tsc --noEmit
npm run lint
npm run db:test
npm run build
git diff --check
```

Also run changed note-regeneration and new component suites directly while implementing their phase. Run the two-session database concurrency harness separately from pgTAP. Execute database reset/migration tests only against a disposable local database. If existing unrelated failures occur, record their baseline and isolate changes; do not hide them or claim a passing gate.

### Manual verification

Use the two-session matrix from Phase 4 and all Phase 5 fix outcomes. Inspect a published review against the saved record after a manual note edit, an encounter transition, and an episode change. Confirm appropriate stale state and required recheck. Confirm no source note changes during generation or Verify.

## Risks and rollback considerations

- Larger source context can increase cost/latency. Bounded-input failure is the initial explicit behavior; batching is deferred until measured need justifies a separate design. Never label a truncated review complete.
- Semantic checks remain probabilistic. Grounded references, clean controls, and clear AI provenance limit misleading confidence but do not prove all contradictions will be detected.
- Legacy vitals may be irrecoverable. Disclose unavailable evidence rather than fabricate or silently repair it.
- Stable identity remains bounded by the declared rule/target/entity model. Moving an issue to another section can create a new identity; preserve history and avoid claiming semantic equivalence without evidence.
- Database rollout has the highest operational risk. Validate backfill, RLS, grants, uniqueness, and true concurrency locally before deployment. Keep migrations additive and retain historical records.
- Rollback disables new review/fix writes, drains or expires active attempts, and leaves successful reviews readable. Do not switch immediately to the old unsafe writer or drop attempt/history data. Deploy a forward fix; any old-writer fallback requires explicit compatibility checks and coordinated shutdown of new writers.
- Existing concurrent application work can change note contracts. Recheck canonical section arrays and regeneration signatures immediately before implementation; preserve unrelated changes.

## Completion criteria

- All canonical saved sections and relevant follow-up decisions reach QC; raw generation prose is not treated as current truth.
- Every source query failure is distinguishable from absent clinical data. Ambiguous evidence and freshness are visible.
- Every finding has validated provenance, rule, destination, and evidence; unsupported targets cannot be offered Fix.
- Deterministic narrative/diagnosis/trajectory/telehealth checks operate on current applicable sources, with the stated policy boundaries.
- Verify cannot resolve unrelated findings; recurring violations reopen; AI nondetection is not called verified resolution.
- Summary, assessment, counts, coverage, and dispositions agree.
- Failed or superseded attempts preserve the previous successful review; atomic publication and disposition updates pass real database concurrency tests.
- Fix outcomes accurately distinguish note-save success from review success and preserve concurrent clinician work.
- Follow-up navigation, legacy display, history, and signed-note restrictions pass component/manual checks.
- Required automated checks and model-fixture/manual results are recorded, with remaining limitations stated explicitly.
