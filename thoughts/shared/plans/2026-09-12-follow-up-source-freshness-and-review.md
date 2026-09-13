# Follow-Up Source Freshness and Safe Regeneration Implementation Plan

## Overview

Address three related problems in pain follow-up notes: saved drafts silently outliving their source data, historical symptoms being overrepresented in current narratives, and regeneration overwriting provider edits without comparison.

Deliver the complete workflow for `pain_follow_up_notes` first. Define reusable source-manifest and revision contracts, but do not roll new behavior into procedure, initial-visit, or discharge notes in this release. This document is a plan; it does not authorize modifying existing clinical records during planning.

## Current State

Verified against the current repository and the preceding read-only investigation:

- `src/actions/pain-follow-up-notes.ts`, `gatherSource`, sends the current encounter, patient/provider data, latest completed encounter, prior-episode discharge, and procedures to generation.
- It selects the latest completed encounter using `selectLatestCompletedEncounter` in `src/lib/clinical/episode-context.ts`. That helper prefers completion timestamps, not the clinical visit date, and the gatherer has no prior-date cutoff. Procedures also lack a visit-date cutoff.
- The intake-prefill loader already applies prior-date filtering (`src/lib/clinical/load-follow-up-intake-history.ts`), so visible intake and generated-note history can use different source selections.
- Full generation stores a SHA-256 hash of `JSON.stringify(source.data)` in `source_data_hash`. No freshness comparison occurs on display or signing. Whole rows include metadata, and unordered query results make that hash unsuitable as a stable clinical fingerprint.
- `src/actions/clinical-encounters.ts`, `updatePainFollowUpEncounter`, saves intake and refreshes the page without changing the saved narrative.
- Full generation overwrites the existing note. Section regeneration generates a full result but immediately writes one section and replaces the response audit object. It does not refresh `source_data_hash`.
- `src/components/visits/pain-follow-up-editor.tsx` holds editable text locally. Its version-based key from `pain-follow-up-editor-key.ts` remounts the editor when the saved note version changes. Unsaved edits need explicit protection during refresh and replacement.
- The prompt in `src/lib/claude/generate-pain-follow-up.ts` requires historical date labels, but does not sufficiently limit old symptoms to those relevant to today's visit.
- Signing checks the note version and uses database lifecycle guards, but it does not compare source data. `public.finalize_pain_follow_up` delegates through `private.finish_clinical_note` in migration `20260908231215_case_reactivation_note_reset.sql`.
- Treatment decisions are bound to the reviewed plan/date by `save_visit_note_decision` and `guard_visit_decision` in migration `20260910234459_visit_treatment_decision.sql`. Source review must be separate from treatment agreement.

Case motivating this work: the May 2 follow-up draft included a dated April 13 shoulder complaint, supported by the earlier intake. The current follow-up intake did not list shoulder pain. The note also predated later intake edits. These establish separate historical-relevance and freshness concerns; absence of shoulder pain from today's intake does not establish resolution.

## Desired End State

1. Display a clear warning when note sources change, without replacing saved prose.
2. Allow clinicians either to generate a proposed replacement or manually reconcile their draft and record review of the current sources.
3. Require a source review matching both current source content and the saved note version before signing a stale/unknown draft.
4. Generate current symptoms primarily from today's intake. Use relevant dated history for comparison; never turn an old symptom into a current finding merely because it remains in a prior chart.
5. Preserve the original draft while replacement generation runs, fails, is cancelled, or is rejected.
6. Compare current and proposed sections before applying changes. Preserve structured recommendation/plan consistency and invalidate outdated treatment-decision confirmation as required by existing rules.
7. Reject stale writes and signing races on the server/database, including direct supported RPC calls.
8. Leave signed records and existing PDFs untouched. Reopening uses the existing audited workflow.

## Key Discoveries and Decisions

- Use explicit, versioned clinical source projections, not whole-row timestamps or the existing opaque hash.
- Source generation and freshness comparison must use the same snapshot builder. No independent UI-only hash or client-authoritative freshness flag.
- History is eligible only when its clinical date is strictly before the current visit date. Exclude undated and same-day historical encounters/procedures in this release because no trustworthy within-day ordering exists. Sort by clinical date, then stable ID. Missing current date blocks generation and source-review/signing rather than guessing.
- Do not redefine the shared `selectLatestCompletedEncounter` globally. Introduce a follow-up-specific selector so other episode workflows remain unchanged.
- A provider may retain and manually correct text after reviewing new sources. Do not force AI regeneration, and do not conflate source-review acknowledgement with patient treatment acceptance.
- Use a durable proposed-revision record. A browser-only proposal would be lost on refresh and cannot support reliable auditing or concurrency checks.
- Section replacement does not certify the whole note as fresh. It requires explicit review of the assembled note against current sources.
- Source lookup failures yield `unavailable`, not `current` or an empty successful context. Preserve draft text and allow ordinary draft editing; block generation, source confirmation, and signing until sources can be checked.

## What We Are Not Doing

- Automatically rewriting notes when intake changes, bulk regenerating old notes, or changing signed PDFs.
- Removing all historical complaints, inferring symptom resolution from omission, or making automated clinical judgments about whether a symptom is active.
- Rebuilding all clinical note types or the intake-prefill feature.
- Bypassing telehealth, treatment-decision, episode, reset, correction, or authorization safeguards.
- Creating medical-data fixtures from the full production chart.

## Implementation Approach

### Source contract

Add a follow-up source snapshot with `schema_version`, current encounter, patient/provider fields actually used in generation, dated historical encounter, prior discharge, and dated procedures. Include stable source IDs and a separate manifest containing source type, date, label, and per-source fingerprint. No database credentials, actor metadata, raw logs, or unrelated chart fields.

Current clinical inputs include encounter date/type/modality, reason for visit, intake clinical fields, reported pain/measurements, consent, patient/provider locations and connection method. Exclude scheduling times, updated/created timestamps, generation metadata, `history_prefill.reviewed_at`, and status-reason metadata from content hashes. History-prefill provenance is displayed separately and must not be treated as newly reported symptoms.

Historical sources include their clinical date and only the clinical intake fields used by the model. Include selected procedures' dates/types/sites/diagnoses/numbers and prior discharge sections already used by the gatherer. Include patient demographics and provider identity fields sent to the model. Changing any included value or selected source changes the fingerprint; metadata-only edits and query-order changes do not.

Use one database JSONB snapshot builder and its canonical JSONB serialization for fingerprinting, returned through an authenticated read RPC. Both the server prompt adapter and all database acceptance/signing checks consume that builder. This avoids implementing equivalent SQL and JavaScript hashes separately. Keep clinical selection rules in this authoritative builder; TypeScript maps its result to labeled prompt sections and UI state.

### Persistence and review contract

Add nullable generation-baseline and review metadata to `pain_follow_up_notes`: source schema version, manifest, generated-source fingerprint, and review object containing current-source fingerprint, note-content fingerprint, reviewer, time, and review method (`generated_proposal` or `manual_reconciliation`). Retain the existing `source_data_hash` as legacy metadata; do not reinterpret old values as compatible fingerprints.

Use a new private revision table for follow-up proposals with note/case/episode/encounter ownership, requester, base note version, source snapshot/manifest/fingerprint, scope, status (`pending`, `ready`, `failed`, `applied`, `discarded`), proposed sections/recommendations, raw model output, and error metadata. Provide authorized RPCs instead of exposing arbitrary direct writes. The note remains an editable draft during proposal generation. Use one active pending/ready proposal per note, with a database uniqueness constraint and conditional state transitions. Mark abandoned pending work failed after a bounded timeout, without touching the draft.

Freshness values: `current`, `changed`, `unknown` (legacy/missing compatible baseline), and `unavailable`. A valid review compares the current source fingerprint and current note-content fingerprint. Subsequent note edits invalidate the previous review until reconfirmed; ordinary saving never silently updates source review. A baseline fingerprint alone is insufficient after mixed section edits.

### Atomicity

Acceptance, source review, and signing must recompute authoritative fingerprints in the database transaction and compare the base note version. Preserve the established note → encounter → episode → case lifecycle lock order. After those existing locks, acquire sorted case-scoped `pg_try_advisory_xact_lock` locks for all affected scopes. Use fail-fast acquisition: if any scope is busy, raise a retryable conflict and roll back. Never wait on a newly added advisory lock while holding lifecycle/source row locks.

Selected historical, demographic, and provider source rows use `FOR SHARE NOWAIT` when a protected snapshot is required. Relevant source-write triggers use the same fail-fast advisory lock before a change can commit. Trigger coverage includes clinical encounters, procedures, discharge notes, episodes, case/patient associations, patients, and provider profiles; include source eligibility/date/status, insertion, deletion, soft deletion, and ownership changes. Patient/provider updates lock all affected case scopes in sorted order; ownership changes lock old and new scopes. Lock failures roll back the whole mutation and surface a retryable conflict in source-edit actions. No automatic mutation retry without rechecking versions.

This deliberately avoids a blocking cycle between a historical update that already owns its row and a finalizer that owns lifecycle rows. Snapshot comparison without protected source membership is insufficient: an inserted or re-dated historical row can change selection even when old selected rows are locked. Add separate-connection tests for those phantoms, source association changes, and existing evaluation-sync/reset triggers. No AI or network call runs while locks are held. Refresh the snapshot after locks are acquired; do not accept a client-supplied source fingerprint as authoritative.

The note-content fingerprint includes all eleven persisted narrative sections and ordered structured recommendations. Exclude timestamps, generation state, raw AI response, and source-review metadata. Compute it after existing treatment-decision triggers reconcile the resulting prose, so review describes the text actually saved. Every ordinary draft save must require `expected_updated_at`, including the branch without a treatment decision; remove its current unconditional-write behavior. A stale save cannot overwrite a newly accepted proposal or reviewed revision.

## Phase 1: Curated sources and historical boundaries

### Files and changes

- New `src/lib/clinical/pain-follow-up-source.ts`: typed source/manifest contract, prompt adapter, freshness result types and change labels.
- Define the action adapter contract for replacing raw `gatherSource` queries; keep production actions unchanged until the Phase 2 RPC exists. Wire this adapter in Phase 3, retaining authentication and episode checks.
- `src/lib/claude/generate-pain-follow-up.ts`: send labeled current-visit facts and historical context separately. Instruct the model that today's symptoms require today's documentation; prior symptoms require date attribution and relevance to a current comparison. An omitted symptom is not resolved and not automatically ongoing. Do not describe lower-back pain as newly developed without documented onset. Patient-reported movement pain is not a provider-observed video finding.
- Keep the current output schema and telehealth/decision guards. Do not use brittle keyword deletion to remove shoulder mentions.
- New source tests and additions to `src/lib/claude/__tests__/generate-pain-follow-up.test.ts`.

### Automated verification

Fixture coverage: old shoulder complaint absent today; shoulder confirmed today; historical shoulder radiation relevant to current neck assessment; no invented resolution/onset; current explicit correction conflicts with old history; dated historical comparison; future/completed-later encounter excluded; same-day/undated history excluded; procedures sorted deterministically; source-query failure does not produce empty successful context.

Prompt assertions verify payload boundaries and instructions, not semantic model correctness. Maintain a small synthetic end-to-end generation evaluation set for reviewed narrative outcomes; mocked tests alone cannot establish clinical wording quality.

### Manual verification

Review generated synthetic examples for relevance, attribution, missing-fact handling, and current/history separation. No automated claim that the model is incapable of factual error.

## Phase 2: Database snapshots, review metadata, proposals, and signing guard

### Files and changes

Create migration(s) using `supabase migration new follow_up_source_review` during implementation; do not invent a timestamped migration filename now. Generate database types afterward.

- Implement the private canonical snapshot/fingerprint builder and authenticated read wrapper with explicit case/encounter ownership and active-user checks.
- Add baseline/review fields and private proposal storage described above, with constraints, scoped authorization, and server-controlled reviewer/time metadata.
- Add RPCs to create/complete/discard proposals, accept a ready proposal, and confirm a manual source review. Model output must be validated before completion; acceptance reads stored proposal data rather than trusting submitted replacement prose or hashes.
- Guard direct note updates from forging baseline/review metadata. New metadata must not become writable through `save_visit_note_decision`'s patch allowlist.
- Put freshness enforcement on the pain-follow-up branch of `private.finish_clinical_note` so both public signing entry points enforce it. Preserve finalized replay behavior and all prior locking/ownership checks. Also reject bypassing the gate by direct draft-to-finalized table updates, consistent with existing lifecycle protections.
- Bind PDF rendering to an immutable checked source snapshot and note version. Recheck note/source fingerprints at signing after PDF rendering. Reject if sources changed during rendering; use existing unreferenced-document cleanup.
- Full wipe/reset clears baseline/review fields and invalidates pending proposals. Keep-content reopening retains provenance but requires current source review; signed snapshots must include provenance. Update both dedicated follow-up reset and generic audited reset paths.
- Implement the source-lock protocol above and validate against existing triggers before proceeding.

### Automated verification

New database tests under `supabase/tests/database/`: source change/no-op metadata, changed source membership, deletion, unknown legacy baseline, forged review, cross-case/wrong-user access, concurrent note save (including no-decision saves), concurrent source write, duplicate proposal apply, reset during generation, stale proposal, direct finalize bypass, finalized replay, review invalidation after content edits, treatment-decision invalidation, and rollback/cleanup behavior. Exercise concurrent transactions using separate database connections where pgTAP alone cannot demonstrate the race.

No migration should mark old notes reviewed. Confirm ordinary draft saves remain possible while freshness is unknown/unavailable.

### Manual verification

Review migration grants, private-schema access, ownership checks, lock order, signed snapshot preservation, and reset integration. Do not expose stored source snapshots in public logs or client responses beyond the authorized review interface.

## Phase 3: Generate proposals without overwriting drafts

### Files and changes

- `src/actions/pain-follow-up-notes.ts`: wire the Phase 2 source snapshot RPC and add prepare/accept/discard/manual-review actions. Require optimistic version checks on every ordinary save, including the no-treatment-decision branch that currently drops `expected_updated_at`. Check note version at proposal creation and again at acceptance. Keep the original draft usable while generating. Capture actual model metadata when available; do not hard-code a fallback model as the model used.
- Full regeneration writes a proposal, not note prose. First generation may still create a new draft directly with its baseline, but must use the same source contract, validation, and conditional version checks.
- Section regeneration also creates a proposal. Only requested sections can be applied. Treat treatment plan and structured procedure recommendations as a linked replacement group, shown together; do not combine a new plan with old structured recommendations silently.
- Accept a full proposal only after user review; atomically replace reviewed content/recommendations, save the revision audit, and bind source review to the resulting note. For partial replacement, require explicit whole-note source review before signing.
- Preserve provider-confirmed decisions when the exact reviewed plan/date remains unchanged. Changed plan/date requires renewed decision review through existing decision handling. Never copy generated agreement as confirmation.
- On AI error, timeout, or source/note conflict, keep saved text unchanged and present a retry/review action. Refreshing should recover proposal state.

- `src/lib/pdf/render-pain-follow-up-pdf.ts`: accept the immutable checked source snapshot for patient identity, visit date, modality, consent, locations, and provider identity rather than independently re-querying those values. Capture rendering-only clinic assets/signature bytes once per render; they are not symptom-history sources. Pass the checked source fingerprint and note version through finalization. Remove the current-date fallback for a missing service date in this path.

### Automated verification

New `src/actions/__tests__/pain-follow-up-source-review.test.ts` and `pain-follow-up-proposals.test.ts`: successful and failed generation, stale source during AI call, note edit during generation, two requests, apply/discard/replay, full/section scope, linked recommendations, manual corrections plus review, and model metadata. Extend existing finalize/reset action tests to cover the new guards and PDF cleanup. Extend `src/lib/pdf/__tests__/render-pain-follow-up-pdf.test.ts` to assert checked snapshot fields are rendered without independent clinical-source reads, including a source edit followed by reversion during rendering (A → B → A). A final hash equality alone must not allow a PDF rendered from B to be signed under review of A.

### Manual verification

Check a saved provider edit survives generation failure and discard. Check an accepted revision changes only its selected scope and preserves recoverable prior text.

## Phase 4: Review UI and unsaved-edit protection

### Files and changes

- Visit page `src/app/(dashboard)/patients/[caseId]/visits/[encounterId]/page.tsx`: load authorized freshness/proposal data alongside note state. Return `unavailable` on source read failure.
- `src/components/visits/pain-follow-up-editor.tsx`: show “Visit information changed since this note was prepared” with changed-source labels. Offer “Generate updated draft” and “Review changes and keep my edits.” Legacy drafts say their source version is unavailable; do not imply known staleness.
- New comparison component: side-by-side current/proposed sections with source-change summary, plan/recommendation group, apply/discard controls, and explicit review confirmation.
- Track dirty editor text. Before starting generation require saving or explicitly discarding edits. Do not discard local content when incoming note version changes; retain local text and show a conflict/reload choice. Update the current key/remount behavior deliberately and cover it with tests.
- A saved intake change updates freshness without replacing the editor. Unsaved intake changes disable generate/review/finalize locally and prompt saving intake first; coordinate the intake card and editor through page-scoped client state rather than inferring it from stale server props.
- Review confirmation is separate from Save Draft and patient treatment decision. Disable signing when review is missing/stale/unavailable, while server enforcement remains authoritative.
- Signed notes display historical generation/review provenance without presenting later chart changes as retroactive defects in the signed record.

### Automated verification

Component tests cover banner states, source change after intake save, unsaved intake/text, browser refresh with ready proposal, failed generation preserving edits, compare/apply/discard, external-version conflict, manual review invalidation, partial replacement, accessibility labels, and signing disabled/enforced. Extend editor-key/state tests when ownership moves away from unconditional remounting.

### Manual verification

On synthetic records, edit pain score after generation, observe warning, compare replacement, discard once, then apply. Repeat with manually reconciled text. Verify today-only symptoms stay current, historical complaints remain appropriately dated, and a different browser session cannot overwrite the reviewed version.

## Phase 5: Verification and rollout

### Automated verification

Run narrow tests during each phase, then:

- `npm test`
- `npx tsc --noEmit`
- `npm run lint`
- `npm run db:test` against local migrated database
- `npm run build`
- `git diff --check`

Generate local database types with `npm run gen:types:local`. Verify migrations on a clean local database and an upgrade fixture containing legacy draft and finalized follow-ups. Use the Supabase skill's current CLI/docs and schema verification workflow during implementation. Record all failures, separating pre-existing repository lint failures from regressions.

### Rollout and manual verification

Use two additive rollout stages: deploy storage/RPCs with source checking in report-only mode, then deploy the compatible UI/actions and enable the hard signing guard after smoke tests. Keep enforcement mode in server/database configuration, not a client-only flag. Verify both signing entry points and older clients before enabling; return an actionable review-required message rather than corrupting existing flows.

Existing drafts with no compatible baseline require manual reconciliation or reviewed regeneration. Existing finalized notes remain unchanged. Do not bulk backfill review timestamps. For the motivating follow-up, compare current intake and dated shoulder history after rollout, then use the normal review flow if the user requests correction. Regeneration is not a guarantee that all historical shoulder references disappear.

## Risks and rollback considerations

- This is a workflow and persistence change, not just a prompt edit. Concurrency and lifecycle tests are release requirements.
- Source snapshots contain clinical data: retain within the existing authorized database boundary and include in existing retention/deletion policy; no new analytics export or full payload logging.
- Added proposal storage must follow case deletion/retention and signed-record audit rules. Discarded/applied proposals remain audit records, not indefinitely active work.
- Downgrade through report-only mode while keeping saved notes/revisions intact. Do not drop populated provenance columns or revert to overwrite-on-generation behavior.
- Historical relevance remains partly model-dependent. Payload boundaries and reviewed synthetic evaluations improve behavior but do not replace clinician review.
- Excluding same-day historical sources is intentionally conservative until the application has trustworthy clinical ordering.

## Completion Criteria

- [x] Shared authoritative source contract used for generation, comparison, review, and signing.
- [x] Stable fingerprints ignore metadata and detect changes to clinical values and source selection.
- [ ] Current/historical symptom boundaries and chronology covered by tests and reviewed examples.
- [x] Draft never silently overwritten by regeneration or refresh.
- [x] Full and section proposals are recoverable, scoped, and safe under concurrent edits.
- [x] Both finalize paths and direct writes reject missing/stale review; source races are transaction-tested.
- [x] Treatment decisions and structured recommendations remain consistent with reviewed content.
- [x] Legacy, reset, keep-content reopening, and signed-record behavior verified.
- [x] All checks and rollout outcomes recorded; no unrequested clinical-record rewrites.

No product decisions are left open. Phase 2 concurrency tests must prove the fail-fast protocol against existing database lifecycle triggers before UI integration; a failing race test blocks rollout rather than weakening signing checks.


## Implementation status — 2026-09-12

Phases 1–4 are implemented and their automated verification is complete. Phase 5 checks were run: application tests (1,608), type checking, production build, new database regression tests, and 12 separate-connection scenarios pass. The existing lint error and two existing database fixture failures remain; before/after baseline comparison found no additional database-suite failures. Full details, local baseline adjustments, changed symbols, and rollout instructions are in [the implementation record](2026-09-12-follow-up-source-freshness-implementation.md).

The combined narrative-example criterion remains unchecked because clinician review of synthetic generated examples has not occurred. All manual/browser checks and production rollout remain pending. Legacy signing enforcement is deliberately report-only until compatible deployment and smoke tests; the new signing action always enforces review.

Additional integration discovered during implementation: the QC page's follow-up section regenerator now creates a version-bound proposal and navigates to the visit review UI. It does not run a recheck or report a completed fix before the proposal is accepted. Other note families retain their existing behavior.
