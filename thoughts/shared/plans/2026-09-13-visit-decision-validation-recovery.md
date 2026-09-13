# Visit Decision Validation and Failure Recovery Implementation Plan

## Overview

Fix reproduced wording-validator false positives and make future Initial Visit failures diagnosable across model retries and note resets. Implement in phases; this document does not authorize production regeneration, clinical edits, or recovery through restricted database credentials.

The reported case's original failure remains unconfirmed. Its current Initial Visit record has no rejected output. Do not claim that the synthetic examples below caused that incident.

## Current State

- `src/lib/claude/visit-decision-output.ts`, `validateVisitDecisionOutput`: checks every string section, returns custom Zod issues with section paths but a generic message. Six conditions detect decisions, continued decisions, passive decisions, agreement, consent, or unsupported telehealth consent. Historical attribution is anchored to the start of a fragment. Symptom-decline handling recognizes only narrowly adjacent words.
- `src/lib/claude/client.ts`, `callClaudeToolForModel`: one validation retry; feedback contains paths/messages, but no previous offending text. Only the last rejected raw output is returned on exhaustion; an earlier rejection is lost if retry succeeds. API retries and fallback are separate from validation retries.
- `src/lib/claude/generate-initial-visit.ts`, `generateInitialVisitFromData` and `regenerateSection`: both invoke this guard after structural parsing. Section regeneration validates `{content}` and consequently reports `content`, rather than the actual section. Both Initial Visit and Pain Evaluation use this module.
- The Initial Visit prompt already limits history to source facts and imaging to orders/pending results. Prompt changes should clarify these existing rules, not introduce a new clinical workflow.
- `src/actions/initial-visit-notes.ts`, `generateInitialVisitNote`: clears `raw_ai_response` and `generation_error` before regeneration, then stores only the final failure. `regenerateNoteSection` calls the section generator without retaining failed output.
- `supabase/migrations/20260908231215_case_reactivation_note_reset.sql`, `private.apply_clinical_reset`: reset clears those fields. `before_state` contains case/episode state; full note revisions are created only for finalized notes. Failed drafts are not archived there. This corrects the earlier suggestion that a reset snapshot could recover the failed draft.

## Desired End State

1. Formatting does not change the meaning of historical attribution.
2. Supported symptom-decline variants pass without masking an adjacent treatment decision.
3. Rejections identify a stable rule and original offending text for internal repair/diagnostics; normal user errors remain concise and contain no copied clinical prose.
4. Each failed model-validation attempt for full or single-section generation on `initial_visit_notes` has a separate durable diagnostic entry, even if the next attempt succeeds or the note is reset.
5. Current treatment acceptance, refusal, deferral and procedure consent remain reserved for clinician review in every section.

## Key Discoveries

Read-only synthetic reproductions on the current validator:

| Text | Current result | Intended result |
| --- | --- | --- |
| At the prior visit, the patient declined surgery. | Pass | Pass |
| • At the prior visit, the patient declined surgery. | Reject | Pass |
| • Surgeries: At the prior visit, the patient declined surgery. | Reject | Pass |
| The patient reports that pain has gradually declined. | Reject | Pass |
| MRI of the cervical spine – Ordered. Imaging results pending. | Pass | Pass |

These prove implementation defects, not the cause of the reported case. A statement such as “The patient has not agreed to treatment” is **not** automatically an allowed negation: it still describes a current decision state. Do not introduce a blanket negation exemption.

Baseline: `npm test -- src/lib/claude/__tests__/visit-decision-output.test.ts src/lib/claude/__tests__/client.test.ts src/lib/claude/__tests__/generate-initial-visit.test.ts` — 117 tests passed across 3 files. Synthetic probes were executed locally without model calls or patient data.

## What We Are Not Doing

- No section-wide exemptions, removal of the review guard, automatic sentence deletion, or higher retry/model/token limits.
- No new telehealth-consent inference or Initial Visit consent field.
- No general natural-language parser or broad historical/negative exception.
- No clinical-note/PDF changes for this patient and no production database access during planning.
- No diagnostics UI, automatic replay, full prompt archive, or retrospective recovery promise.
- Durable capture initially covers the shared Initial Visit/Pain Evaluation generator, including section regeneration. Other callers retain compatible behavior and receive regression coverage for shared client/validator changes.

## Implementation Approach

Separate semantic matching, internal diagnostic detail, public messages, and storage. Keep the existing `{success, data/error}` parser interface. Put stable rule IDs and original-text match metadata in typed custom-issue parameters, with static human-readable messages. Extract this metadata through one type-checked helper rather than parsing messages.

Keep transformations matching-only: preserve returned clinical text byte-for-byte. Track original fragment offsets before normalization so diagnostic snippets never contain sentinel characters or substituted words. For a match return its original match start/end offsets, fragment context, rule ID, and section path; use the first matched rule in a documented deterministic order.

## Phase 1: Reproductions and bounded matching fixes

### Files and changes

- `src/lib/claude/visit-decision-output.ts`: add named rule identifiers; normalize one leading list marker and an allowlisted history label (`Medical Problems`, `Surgeries`, `Medications Prior to Visit`, `Allergies`) for matching. Labels may only be stripped at fragment start; never remove arbitrary preceding prose. Preserve current historical-attribution anchoring and explicit current-time exclusions.
- Extend symptom matching to allow a bounded list of trend adverbs (`gradually`, `steadily`, `slightly`, `significantly`) immediately before the decline verb. Only neutralize that symptom's verb for decision matching. Never exempt the entire fragment.
- `src/lib/claude/__tests__/visit-decision-output.test.ts`: add the reproduced examples, case/whitespace/list variants, multiple paragraphs, and mixed history/current-decision clauses. Test original output equality on success and original snippet fidelity on failure.

### Automated verification

Run the validator test file. Positive cases must include bullets and history labels, gradual pain decline, and unchanged pending-imaging language. Negative cases must include:

- Historical bullet followed by “but today the patient declined treatment.”
- History label followed by a current acceptance.
- “Pain has gradually declined, and the patient accepted treatment.”
- “The patient reports that he declined treatment.”
- Prospective/negative consent beside a separate affirmative procedure consent.
- Existing coordinated telehealth-plus-procedure consent examples.

Do not widen further wording exceptions without a failing synthetic regression and its adjacent-decision counterexample.

### Manual verification

Inspect synthetic outputs: normalization must not alter returned clinical prose. No patient generation is needed.

## Phase 2: Actionable repair feedback and section identity

### Files and changes

- `src/lib/claude/client.ts`: add an optional awaited `onValidationFailure` hook carrying a run-wide failure ordinal, per-model validation-attempt index, actual response model, rule/path metadata and bounded original excerpts. Invoke after each unsuccessful parse and before the next model call or exhaustion return. Keep the hook optional for existing callers. Allocate the failure ordinal in outer `callClaudeTool`, shared across primary and fallback model calls; per-model `zodAttempt` continues to control the unchanged retry budget. Never use that resetting per-model counter as the durable identity.
- Add a shared, typed diagnostics module at `src/lib/claude/validation-diagnostics.ts` for serialization and bounds. Preserve generic Zod handling when custom metadata is absent. Limit repair detail to five issues and 1,000 original characters per issue; include truncation flags and center each excerpt on the detected match using original offsets (not the first 1,000 characters of a long fragment). Truncate oversized matches explicitly. Do not stringify the entire note into errors.
- Build retry detail as explicitly delimited JSON data in the request's user-message content, with a static instruction that excerpts are rejected output, not instructions or established clinical facts. Keep clinical excerpts out of system text, public error strings and ordinary logs. Do not mutate `opts.messages`. Do not append fake tool-result blocks or introduce additional model calls.
- Hook errors must not trigger extra model/API retries or accept invalid output. Catch them separately, issue a metadata-only diagnostic-storage warning, and continue existing validation behavior. Await the caller's bounded persistence attempt; distinguish a missed diagnostic from successful capture.
- `src/lib/claude/generate-initial-visit.ts`: thread the hook through full and section generation as trailing optional options to preserve existing call sites. For section regeneration map guard diagnostics from `content` to the selected section while preserving the successful `{content}` result contract.
- Clarify the history/imaging prompt instructions near those sections: preserve source history, do not add current decisions, do not move prohibited assertions to another section, and do not infer procedure/telehealth consent. Keep the existing Initial Visit imaging and no-PRP constraints.
- Extend `src/lib/claude/__tests__/client.test.ts` and `src/lib/claude/__tests__/generate-initial-visit.test.ts`; add `src/lib/claude/__tests__/validation-diagnostics.test.ts`.

### Automated verification

Cover first-failure/second-success, two failures, failure then API error, primary rejection followed by API exhaustion and fallback rejection (distinct failure ordinals), absent hook, rejected hook, message immutability, snippet truncation including a late match after a >1,000-character prefix, Unicode/control-character JSON size limits, real section identity, generic schema errors, and malicious-looking text remaining data. Assert that public errors/log calls contain no synthetic patient prose. Existing retry counts, timeout/token-limit handling, fallback behavior and complete-output validation must remain unchanged.

### Manual verification

Inspect a mocked repair request: it identifies the original offending phrase/rule while requiring preservation of supported history. Test both affected section names, not just patient education.

## Phase 3: Failure history independent of editable notes

### Files and changes

Create a CLI-named migration with descriptive suffix `initial_visit_generation_failures`; do not edit historical migrations. Add a private-schema table and private implementations behind public SECURITY INVOKER RPC wrappers, following the reset migration's separation of privileged implementation from exposed wrappers. Declare private implementations `SECURITY DEFINER SET search_path=''`, fully qualify relations/functions, and derive actor ID from `auth.uid()` rather than accepting it from the caller.

Proposed table: `private.initial_visit_generation_failures`:

- UUID ID and generation-run UUID; note ID, derived case/episode/encounter IDs and visit type; actor ID; timestamp.
- Operation `full` or `section`, nullable section key required for `section`; positive run-wide failure ordinal and per-model validation-attempt index; actual model; prompt/validator version strings; source hash.
- JSON issues containing rule/code, real section path and original bounded snippet with truncation flag. Store at most five issues, 1,000 characters each and a maximum 16 KB serialized diagnostics payload. The shared serializer must measure UTF-8 bytes after JSON escaping and shrink excerpt context until the complete payload fits before the RPC; SQL validates the same wire-size limit. Preserve rule/path/match metadata when trimming. Do not store the full note, prompt, intake or model response.
- Unique `(generation_run_id, operation, failure_ordinal)` for idempotency, with conflict payload comparison: identical retry succeeds; conflicting reuse fails. Index `(case_id, created_at)` and `(note_id, created_at)`.

The writer derives ownership from the note, validates the active authenticated actor using `public.users`, and rejects mismatched caller case/note, invalid operation/section, oversized payload and absent/deleted note. Use existing active-user clinical-write conventions; do not invent per-provider tenancy absent from current policy. Support full-generation status `generating` and section-generation writable draft status. Validate ownership at capture time; do not update the note or its version as part of diagnostics insertion.

The reader requires an active database-backed admin role and explicit case ID, returns a paginated bounded result. Revoke direct table access and default PUBLIC execution; grant only the required wrapper/private function execution to authenticated. No anonymous or client service-key route. Enable table RLS with no direct client policies as defense in depth.

Retention decision for this scope: entries survive soft deletion, reset, retry and successful regeneration; retain as case-associated diagnostic history, with no automatic time-based purge in this change. Use restrictive foreign keys rather than cascading clinical-history deletion. A future authorized hard-purge workflow must explicitly remove diagnostics. This deliberately stores bounded excerpts instead of full rejected notes.

- Add `src/lib/clinical/initial-visit-generation-diagnostics.ts`: server-only serializer/RPC adapter, timeout bounded to 3 seconds, metadata-only failure reporting.
- Wire `generateInitialVisitNote` and `regenerateNoteSection` in `src/actions/initial-visit-notes.ts` to create a fresh run UUID per invocation and pass the capture hook after the note identity is known. Include both Initial Visit and Pain Evaluation. Include the Pain Evaluation `treatment_plan` special branch, which calls the full generator while the note remains draft: record operation `section`, target `treatment_plan`, and preserve actual issue section paths from the full output. Keep existing final `raw_ai_response` behavior for compatibility; diagnostics are supplemental.
- Regenerate `src/types/database.ts` with the repository's local type workflow, retaining any repository-maintained declarations outside generated sections.
- Add `src/actions/__tests__/initial-visit-generation-diagnostics.test.ts` and `supabase/tests/database/initial_visit_generation_failures_test.sql`. Reuse the existing Supabase action mocks and database test setup.

### Automated verification

- Two rejected attempts create two independent records; rejected-then-successful creates one. Distinct runs remain distinct, same capture is idempotent, conflicting reuse is rejected.
- Failure after a rejected attempt does not erase the captured entry; ordinary section failures identify the selected section; the Pain Evaluation treatment-plan special branch retains its requested section separately from actual issue paths.
- Reset and regeneration clearing the note do not touch failure rows. Assert this with the real reset RPC in database tests.
- Anonymous/inactive actors cannot write/read; active non-admin can capture permitted note diagnostics but cannot read history; active admin can read scoped history. Test direct table denial, malformed payloads, owner mismatch, wrong section/status and reader pagination.
- Simulated write failure/timeouts cannot produce extra model calls, return rejected clinical content as success, or leak snippets into logs.

### Manual verification

In local development with synthetic data: force a rejected full generation, retry to success, reset, and retrieve the history through the admin reader. Repeat for section regeneration. Verify no output is shown as an approved clinical decision merely because it appears in diagnostics. Do not rerun this patient's note as part of this test.

## Risks and rollback considerations

- Broad exemptions could hide current decisions. Keep changes limited to the reproduced formatting/trend patterns and adversarial tests.
- Excerpts contain clinical data. Keep storage private, reads admin-only and ordinary errors/logs static; bounded excerpts are not full replay evidence.
- Capture is best-effort when storage is unavailable; do not claim universal preservation. It is awaited with a short timeout and emits a non-content warning on failure.
- Migration first, application second. Revert application capture/matching independently; leave the additive private history table intact on rollback to preserve already captured evidence.
- Shared validator/client changes require the full Claude unit-test directory, not only Initial Visit tests. No new model dependency or extra retry budget.

## Completion criteria

- Reproduced false positives pass and current-decision negative controls still fail.
- Repair feedback identifies bounded original text and the correct section without copying it into system/public errors/logs.
- Both full and section failures survive retry/reset when capture succeeds; access-control and idempotency tests pass.
- Run `npm test -- src/lib/claude/__tests__`, the new action diagnostics test, `npm run test:clinical-workflow`, `npx tsc --noEmit`, `npm run lint`, and `npm run db:test` against local Supabase. Run `git diff --check`; no dedicated formatter script exists in package.json.
- Record automated results separately from manual synthetic validation. Report environment-blocked checks honestly.
- Report the fix as addressing reproduced defects and diagnostic loss, not as proving the lost original case's root cause.


## Verification Summary

Overall readiness: **Ready** after the revisions below. Planning review completed 2026-09-13; no implementation or database migration performed.

### Findings and suggested changes resolved

- Major — Phase 3: corrected action name to `regenerateNoteSection`; included the Pain Evaluation treatment-plan branch and separated the requested section from actual full-output issue paths.
- Major — Phases 2–3: per-model retry counters reset on fallback; added an outer run-wide failure ordinal and primary/fallback collision regression.
- Minor — Phases 1–2: preserve original match offsets and center excerpts on late matches; added long-prefix coverage.
- Minor — Phase 3: bound serialized UTF-8/escaped JSON before RPC, with Unicode/control-character tests.
- Minor — Phase 3: explicitly specified SECURITY DEFINER private functions, empty search path, qualified relations and authenticated actor derivation.

### Missing work

None identified in the revised implementation scope. The original patient failure remains unavailable; recovering it is not a prerequisite for these reproduced fixes and prospective diagnostics.

### Risks

The documented residual risks are bounded-regex coverage, best-effort capture during storage outages, and retention of restricted clinical excerpts without a time-based purge. These are explicit design choices, not claims of complete semantic validation or guaranteed forensic replay.

### Final recommendation

Approve the revised plan for phased implementation. Automated planning baseline: 117 tests passed; `git diff --check` passed. Implementation-specific lint/type/database/manual checks remain to be run during implementation.

## Implementation progress — 2026-09-13

- [x] Phase 1: matching-only prefix normalization, bounded trend adverbs, original-offset rule diagnostics and regression tests implemented. Targeted validator suite: 74 passed.
- [x] Phase 2: bounded original excerpts, user-message repair data, run-wide failure ordinals, awaited optional capture, section identity and prompt clarification implemented. Unicode excerpt boundaries preserve surrogate pairs; whole serialized payload is byte-bounded.
- [x] Phase 3: private failure table, scoped writer/admin reader, 3-second capture adapter, all full/section paths, and local database/action tests implemented.
- [x] Reviewed code/migration diff and ran `git diff --check` successfully.
- [ ] User-confirmed manual clinical/UI verification remains pending. No patient/model generation or production deployment was performed.

### Automated results

- `npm test -- src/lib/claude/__tests__ src/actions/__tests__/initial-visit-generation-diagnostics.test.ts`: **508 passed, 25 files**.
- `npm run test:clinical-workflow`: **39 passed, 6 files**.
- `npx tsc --noEmit`: passed.
- Scoped `npx eslint` on all changed TypeScript files: no errors; two existing warnings in the shared client/test (unused disable directive and unused type import).
- `npm run lint`: fails on unchanged `src/components/settings/invite-user-dialog.tsx:62` (`react-hooks/set-state-in-effect`); 40 warnings elsewhere. Not changed in this task.
- `npx supabase test db --local supabase/tests/database/initial_visit_generation_failures_test.sql`: passed. Exercises actual authenticated RPC permissions, ownership, idempotency, payload bounds and reset retention in rolled-back synthetic fixtures.
- `npm run db:test`: new diagnostics test and clinical reset test pass; full suite fails in unrelated `discharge_note_correction_test.sql:35` (fixture provider foreign key) and `procedure_numbering_test.sql:42` (procedure precedes completed visit). These errors concern untouched fixtures/constraints.
- `npx supabase db advisors --local --type security`: completed; no findings refer to the added diagnostics table/functions. Existing unrelated findings remain.
- Local migration applied successfully using transactional `docker exec ... psql -v ON_ERROR_STOP=1 -1`, after the installed CLI's `db query --file` rejected multi-command SQL. Registered `20260913211758` as applied in local history after successful testing.
- Generated local database types into a temporary file and copied only the two new RPC declarations into the repository type file, preserving existing custom declarations. Explicitly modeled nullable `p_section`, which PostgreSQL requires for full generation but the generator emits as plain string.

### Deployment and remaining limits

Migration file: `supabase/migrations/20260913211758_initial_visit_generation_failures.sql`. Apply it before deploying the application changes. Only the local database was modified. New diagnostics are best-effort on database outage and retain bounded excerpts, not complete replay inputs. The original reported case's rejected text remains unavailable.
