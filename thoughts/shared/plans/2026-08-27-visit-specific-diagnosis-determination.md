# Visit-Specific Diagnosis Determination Implementation Plan

## Overview

Make each clinical encounter's clinician-confirmed diagnosis selection the only authority for the diagnosis list emitted in that visit's generated note. Case summaries, prior notes, procedures, and records from other clinicians may remain labeled historical context or unchecked suggestions, but they must not silently become diagnoses for the current visit.

This plan covers initial evaluations, pain evaluations, pain follow-ups, and procedure-note generation. Discharge diagnoses remain intentionally course-wide and are out of scope except for regression checks proving the new visit pool does not alter discharge behavior.

The durable storage model will be additive columns on `clinical_encounters`, following the repository's existing JSONB diagnosis-list pattern on `procedures`:

- `diagnoses jsonb not null default '[]'::jsonb` stores `{ icd10_code, description }[]` selected for this encounter.
- `diagnoses_confirmed_at timestamptz` distinguishes an explicitly reviewed empty list from an unreviewed legacy/default list.
- `diagnoses_confirmed_by_user_id uuid references users(id)` records who confirmed the list.

Generated note rows will also receive a structured `diagnoses_snapshot jsonb` beside their existing diagnosis text (and procedure notes beside `assessment_and_plan`). Database finalization gates can then compare JSONB to JSONB atomically instead of trying to parse presentation text in SQL.

Per-item provider provenance is unnecessary because the encounter already owns `provider_id` and confirmation is an encounter-level clinical act. Historical source provenance will remain transient suggestion metadata rather than being mixed into the authoritative list.

## Current State

- `clinical_encounters` owns case, episode, provider, modality, provider intake, pain scores, and status, but no structured diagnosis selection (`supabase/migrations/20260826161632_care_episodes_and_encounters.sql`).
- `initial_visit` generation excludes case-summary, PM, and prior-visit context, but its diagnosis section is still generated as free text.
- `pain_evaluation_visit` sends case-summary suggested diagnoses, latest case-wide PM diagnoses/exam, and prior-visit diagnoses to Claude. Those reads are not encounter/provider scoped (`src/actions/initial-visit-notes.ts`, `src/lib/claude/generate-initial-visit.ts`).
- `pain_follow_up` sends the latest completed encounter, prior discharge, and all performed procedures—including diagnoses—to Claude, while its prompt has no diagnosis source boundary (`src/actions/pain-follow-up-notes.ts`, `src/lib/claude/generate-pain-follow-up.ts`).
- Procedure records already store provider-committed structured diagnoses, but procedure-note generation may add PM supplementary diagnoses and uses case-summary diagnoses as advisory context (`src/actions/procedure-notes.ts`, `src/lib/claude/generate-procedure-note.ts`).
- Procedure diagnosis defaults are built case-wide from PM and initial/pain-evaluation notes and some are prechecked (`src/actions/procedures.ts`, `src/components/procedures/record-procedure-dialog.tsx`).
- Note schemas persist diagnoses as text; Zod validates shape but not encounter provenance (`src/lib/validations/initial-visit-note.ts`, `src/lib/validations/pain-follow-up-note.ts`).

## Desired End State

- Every initial evaluation, pain evaluation, and pain follow-up has a clinician-confirmed structured diagnosis list owned by its `clinical_encounters` row.
- Generation and diagnosis-section regeneration require `diagnoses_confirmed_at` and render the diagnosis text deterministically from `clinical_encounters.diagnoses`.
- An explicitly confirmed empty list is allowed when clinically appropriate; an unconfirmed list blocks generation with a clear UI message.
- Historical diagnoses are displayed as unchecked, source-labeled suggestions. Selecting one is an explicit adoption by the current encounter's clinician.
- Raw diagnosis arrays are removed from historical/case-wide AI context. Historical narrative and imaging may still inform assessment, but cannot populate the visit diagnosis list.
- Procedure notes render diagnoses from `procedures.diagnoses` only. PM/case-summary diagnoses may not be promoted during note generation.
- Procedure recommendations emitted by pain follow-up may reference only diagnoses selected for the current encounter.
- Save, regeneration, and finalization paths reject diagnosis text or recommendation codes outside the authoritative encounter pool.
- The canonical confirmed-empty note text is exactly `No diagnoses selected for this encounter.`; its structured snapshot is `[]`.
- Legacy finalized notes remain unchanged. Existing non-finalized encounters are not auto-confirmed from AI-generated text and must be reviewed once before further generation/finalization.

## Key Discoveries

- Encounter ownership and composite `(encounter_id, episode_id, case_id)` foreign keys are already established, so the encounter is the correct authority boundary.
- JSONB arrays with database `jsonb_typeof(...)= 'array'` constraints are an established pattern in `procedures` and `pain_follow_up_notes` (`supabase/migrations/20260826161637_pain_follow_up_notes.sql`).
- `DiagnosisCombobox` already provides selection, free-entry validation, and semantic warning affordances, but it is procedure-specific and its existing case-sensitive selected-code comparison/normalization must be corrected during the shared-component refactor (`src/components/procedures/diagnosis-combobox.tsx`).
- `parseIvnDiagnoses`, `validateIcd10Code`, and deterministic rewrite helpers provide reusable normalization patterns (`src/lib/icd10/parse-ivn-diagnoses.ts`, `src/lib/icd10/validation.ts`, `src/lib/icd10/diagnosis-rewrite.ts`).
- Pain follow-up encounter intake is already the editable pre-generation surface and can host diagnosis selection (`src/components/visits/telehealth-intake-card.tsx`, `src/actions/clinical-encounters.ts`).
- Initial/pain-evaluation notes already own `encounter_id`, but provider-intake updates currently write only `initial_visit_notes`; the diagnosis action must update the linked encounter directly.
- A brand-new evaluation tab may not yet have an encounter: current ownership is created during generation or when intake/vitals are first saved. Diagnosis confirmation therefore needs an explicit pre-generation preparation path.
- Existing generator tests primarily assert prompt text. New pure-function and action-boundary tests are required to prove disallowed diagnoses cannot be persisted.

## What We Are Not Doing

- We are not changing discharge diagnosis aggregation; discharge is a treatment-course summary, not a single-visit diagnosis list.
- We are not attempting to infer clinical validity or automatically diagnose from prose. The clinician's confirmed selection is authoritative.
- We are not auto-adopting diagnoses from case summaries, PM extractions, prior providers, or prior visits.
- We are not backfilling confirmation metadata from existing generated note text, because that would misrepresent AI output as clinician confirmation.
- We are not adding a normalized diagnosis child table, billing-code catalog, or terminology service in this change.
- We are not removing historical narrative, imaging, or treatment trajectory needed for assessment and continuity; only diagnosis-bearing fields are excluded from code emission.

## Implementation Approach

Use a two-layer contract:

1. **Encounter selection contract:** validated structured diagnoses are saved and explicitly confirmed on the current encounter by an authenticated user while its episode is writable.
2. **Generation contract:** a shared visit-diagnosis helper normalizes/deduplicates the confirmed list, formats the note section, writes a matching structured snapshot, redacts diagnosis-bearing historical fields from AI input, and validates structured recommendations against the same allowed-code set.

The stored note text remains a read-only snapshot for PDFs and historical audit. On generation, regeneration, and ordinary note saves it is overwritten from the structured source. Finalization reparses the snapshot and rejects any stale or externally altered mismatch.

## Phase 1: Add Encounter Diagnosis Ownership

### Files and changes

- Add `supabase/migrations/<timestamp>_encounter_diagnosis_selections.sql`:
  - add `clinical_encounters.diagnoses jsonb not null default '[]'::jsonb`;
  - add `diagnoses_confirmed_at timestamptz` and `diagnoses_confirmed_by_user_id uuid references public.users(id)`;
  - add a reusable immutable SQL validator that requires an array of objects with exactly non-empty string `icd10_code` and `description` values, then use it in check constraints rather than checking only `jsonb_typeof`;
  - add an all-or-neither check for confirmation timestamp/user;
  - add `diagnoses_snapshot jsonb not null default '[]'::jsonb` with the same shape constraint to `initial_visit_notes`, `pain_follow_up_notes`, and `procedure_notes`;
  - add finalization guard triggers: on a transition to `finalized`, evaluation/follow-up note snapshots must equal a confirmed owning encounter pool, and a procedure-note snapshot must equal its owning procedure's diagnoses;
  - add a `BEFORE UPDATE OF diagnoses, diagnoses_confirmed_at, diagnoses_confirmed_by_user_id` trigger on `clinical_encounters` that checks `auth.uid()` against an active provider owning `encounter.provider_id` or an active admin, rejects staff/other providers even on direct Supabase updates, and sets confirmation audit fields itself;
  - add draft-snapshot guards so direct note-table updates may write only a snapshot equal to the owning encounter/procedure authority;
  - add immutable SQL formatting/match helpers and make finalization triggers require canonical diagnosis text (`No diagnoses selected for this encounter.` or formatted code/description lines), not merely a matching JSONB snapshot; for procedure notes, verify the canonical `DIAGNOSES:` block before `PLAN:`;
  - validate `pain_follow_up_notes.procedure_recommendations` diagnosis codes as non-null members of the confirmed encounter pool on finalization;
  - do not backfill confirmation fields;
  - keep completed/finalized legacy records readable without requiring retroactive confirmation.
- Regenerate `src/types/database.ts` with `npm run gen:types:local` after applying the local migration.
- Add a shared `visitDiagnosisSchema`, `visitDiagnosisListSchema`, and dedicated `saveEncounterDiagnosesSchema` to `src/lib/validations/clinical-encounter.ts`. Do not accept confirmation timestamps or user IDs from the client and do not fold confirmation into the general encounter-update schema.
- Update `src/actions/clinical-encounters.ts`:
  - add `saveEncounterDiagnoses(caseId, encounterId, diagnoses)` as the application mutation path; database triggers independently enforce the same authorization for direct Supabase writes;
  - define a dedicated input schema for this action rather than adding diagnosis audit fields to the general encounter-update schema;
  - authenticate, load the exact encounter, call `requireWritableEpisode`, normalize codes, write diagnoses plus server-generated confirmation metadata, and update `updated_by_user_id`;
  - authorize confirmation only when the actor is an active provider whose `provider_profiles.user_id` matches the session and whose profile owns `encounter.provider_id`, or an administrator using the repository's existing role helper; staff may prepare intake but may not confirm diagnoses;
  - reject completed/cancelled/no-show encounters;
  - expose a small read helper for the current encounter selection and confirmation state.
- Add an explicit evaluation preparation path in `src/actions/initial-visit-notes.ts`:
  - implement `prepareEvaluationVisit(caseId, visitType)` through a transactional/idempotent RPC that locks the episode, reuses the `clinical_encounters_initial_per_episode_idx` uniqueness contract from `supabase/migrations/20260826212445_episode_scoped_cardinality.sql`, creates/links the draft note when absent, and returns the exact `encounterId`;
  - populate `provider_id` from the case assignment on creation; when an existing encounter has null provider, repair it from the current case assignment or return a blocking “Assign a provider” error when none exists; never silently change a non-null encounter provider;
  - the initial-visit UI calls it before first diagnosis confirmation rather than relying on generation to create ownership;
  - generation reloads the note by `(case_id, visit_type)`, requires its exact non-null `encounter_id`, and passes that ID through all source gathering.
- Add `src/lib/clinical/visit-diagnoses.ts` containing pure functions:
  - structural validation and uppercase normalization via existing ICD-10 helpers;
  - non-billable parent normalization consistent with `DiagnosisCombobox`;
  - case-insensitive code deduplication with stable input order;
  - `formatVisitDiagnoses()` using the existing `• CODE — Description` note format;
  - render a confirmed-empty list as the exact sentinel `No diagnoses selected for this encounter.`;
  - `assertDiagnosisTextMatchesPool()` using `parseIvnDiagnoses` for manual note saves;
  - `assertRecommendationDiagnosesInPool()` for pain-follow-up recommendations;
  - `requireConfirmedVisitDiagnosisPool()` that distinguishes unconfirmed from confirmed-empty.

### Automated verification

- Add `src/lib/clinical/__tests__/visit-diagnoses.test.ts` covering normalization, parent-code substitution, case-insensitive stable dedupe, confirmed-empty sentinel handling, formatting, code-and-description snapshot equality, and recommendation subset checks.
- Extend `src/lib/validations/__tests__/clinical-encounter.test.ts` for valid/invalid structured diagnoses and ensure client input cannot set confirmation audit fields.
- Add action tests for authentication, encounter/case ownership, writable-episode enforcement, locked status, assigned-provider/admin authorization, staff and wrong-provider rejection, normalization, and server-owned confirmation metadata.
- Extend initial-visit action tests for fresh-tab preparation, idempotent ownership creation, exact encounter propagation, and no generation-time bootstrap deadlock.
- Add pgTAP coverage for legacy defaults, JSONB item-shape rejection, all-or-neither confirmation metadata, and each finalization guard.
- Add direct-database pgTAP denial tests for staff/wrong-provider diagnosis updates, forged audit fields, mismatched snapshots, noncanonical text, out-of-pool recommendation codes, and direct status-finalization attempts; add admin/owning-provider success cases.
- Add concurrent preparation tests proving two callers receive one encounter/note, plus assigned-provider repair and null-provider blocking cases.
- Run the migration locally, `npm run gen:types:local`, the new narrow Vitest files, and `npx tsc --noEmit`.

### Manual verification

- Inspect a migrated legacy encounter and confirm `diagnoses=[]` with both confirmation fields null.
- Save a non-empty list and an explicitly empty list; verify both receive confirmation metadata and remain distinguishable from an untouched legacy row.
- Confirm completed/cancelled/no-show encounters cannot be changed.
- Open a fresh evaluation with no saved intake/vitals and confirm the preparation action creates one linked encounter before diagnosis confirmation.

## Phase 2: Add Clinician Selection UI and Historical Suggestions

### Files and changes

- Move/refactor `src/components/procedures/diagnosis-combobox.tsx` into a shared clinical component, preserving procedure behavior and warning affordances. Use a shared `{ icd10_code, description }` value type rather than `PrpDiagnosis`.
- Add `src/actions/visit-diagnoses.ts` with `getEncounterDiagnosisSuggestions(caseId, encounterId)`:
  - verify encounter ownership;
  - define “earlier” with the repository's encounter timestamp precedence (`completed_at`, then `encounter_date`, then `scheduled_start`, then `created_at`), exclude the current encounter, and use ID as the stable tie-breaker for equal/null timestamps;
  - return deduplicated, source-labeled historical suggestions from finalized `initial_visit_notes`, finalized `pain_follow_up_notes`, and performed procedures in the same episode only;
  - include source encounter/date/provider label when available;
  - exclude case-summary suggestions and case-wide PM extraction diagnoses because those sources lack reliable encounter ownership;
  - never return selected/default state; the UI decides selection solely from `clinical_encounters.diagnoses`.
- Update `src/components/visits/telehealth-intake-card.tsx` to show a “Diagnoses for this visit” card using the shared combobox, with historical suggestions clearly labeled and unchecked. Saving calls `saveEncounterDiagnoses`; confirmation state and confirmer/date are displayed.
- Update the initial/pain-evaluation provider-intake surface in `src/components/clinical/initial-visit-editor.tsx` to render the same encounter diagnosis selector for the note's linked encounter. Keep the selector outside AI-generated free-text sections.
- Update `src/app/(dashboard)/patients/[caseId]/initial-visit/page.tsx` and the related action loading contract so the editor receives the current encounter's diagnoses and confirmation state when ownership exists, and can invoke preparation when it does not.
- Disable full generation and diagnosis-section regeneration in both editors until the list has been confirmed. Show “Review and confirm diagnoses for this visit” rather than a generic generation error.
- Make the generated diagnosis section read-only in both note editors. Diagnosis changes occur through the structured encounter selector; normal note-save actions overwrite/ignore client diagnosis text from `formatVisitDiagnoses()` rather than accepting an independently editable copy.
- Preserve existing procedure-form combobox behavior after the shared-component move, but change new-procedure defaults in `src/components/procedures/record-procedure-dialog.tsx` and `record-botox-dialog.tsx` so all historical suggestions start unchecked. A provider must select every procedure diagnosis explicitly.
- Change `getCaseDiagnoses()` in `src/actions/procedures.ts` to return source labels and restrict IVN suggestions to the current episode. Exclude PM extraction diagnoses from automatic selection; until PM extractions gain encounter ownership, they may appear only as clearly labeled case-history suggestions and must remain unchecked.
- Update all procedure suggestion callers/types after the shared component and metadata change: `src/app/(dashboard)/patients/[caseId]/procedures/page.tsx`, `src/components/procedures/procedure-table.tsx`, and `src/components/procedures/procedure-appointment-table.tsx`.

### Automated verification

- Because Vitest currently runs in Node without jsdom/Testing Library, extract selector/default-state logic into pure functions and test confirmed-empty, unconfirmed, selected, removal, case-insensitive dedupe, and historical-suggestion adoption there. Treat rendered interaction as manual verification; do not add a new browser-test stack solely for this change.
- Add action tests proving suggestions are restricted to the same episode, include source labels, do not include case-summary diagnoses, and never become selected without the save mutation.
- Update procedure dialog tests to prove no suggestion is prechecked for a new procedure and editing preserves the procedure's stored diagnoses.
- Run the relevant component/action Vitest files, `npx tsc --noEmit`, and `npm run lint` for changed files.

### Manual verification

- On an initial evaluation, select and confirm diagnoses, reload, and verify the selection persists.
- On a pain evaluation/follow-up assigned to a different clinician, verify earlier diagnoses are visibly historical and remain unchecked until selected.
- Confirm an empty reviewed list enables generation while an untouched list does not.
- Open a new PRP/BOTOX form and verify historical suggestions are available but none are preselected.

## Phase 3: Make Initial and Pain-Evaluation Notes Deterministic

### Files and changes

- Update `gatherSourceData()` in `src/actions/initial-visit-notes.ts`:
  - load the note's linked `clinical_encounters` row and use its `provider_id`, `encounter_id`, diagnoses, and confirmation metadata;
  - scope vitals by `encounter_id` rather than latest case-wide non-procedure vitals;
  - scope the comparison visit's vitals by that prior note's `encounter_id`, not by a case-wide timestamp cutoff;
  - for pain evaluation, omit `suggested_diagnoses` from the case-summary query, omit `diagnoses` from the prior-visit query, and omit PM diagnoses from the PM query;
  - retain prior/history/imaging fields needed for narrative, explicitly labeled historical;
  - call `requireConfirmedVisitDiagnosisPool()` before generation.
- Update `InitialVisitInputData` and prompts in `src/lib/claude/generate-initial-visit.ts`:
  - add authoritative `visitDiagnosisPool`;
  - remove diagnosis candidate/promote/downgrade instructions that read case summary or PM diagnoses;
  - state that the diagnosis section must mirror the pool and historical findings cannot add codes;
  - retain exam/imaging rules as narrative and QC guidance, not code-source authority.
- After Claude returns, re-read the encounter diagnosis pool and confirmation timestamp; abort stale persistence if either differs from the generation input. Then overwrite `result.data.diagnoses` with `formatVisitDiagnoses(visitDiagnosisPool)` and write the identical `diagnoses_snapshot` before narrative validation/persistence. Including the pool in `source_data_hash` is audit data, not the concurrency guard.
- For diagnosis-section regeneration, bypass Claude and return the deterministic formatted pool. For other section regeneration, remove diagnoses from raw historical inputs and include the allowed pool as the only code list.
- Update `saveInitialVisitNote()` to overwrite the client diagnosis field and `diagnoses_snapshot` from the current pool. Finalization calls `assertDiagnosisTextMatchesPool()` and relies on the database finalization trigger for an atomic snapshot/pool check. The provider edits the structured selector, not a second free-text source.
- Preserve and explicitly test `sync_initial_visit_note_encounter()` from `supabase/migrations/20260827154248_sync_evaluation_note_encounters.sql`, which already transitions the linked encounter between `in_progress` and `completed`. As defense in depth, diagnosis saves also reject a linked finalized note even if lifecycle state is unexpectedly out of sync.
- Update context curation tests to prove nested historical diagnosis fields are absent from the curated generation payload used by this note type.

### Automated verification

- Extend `src/lib/claude/__tests__/generate-initial-visit.test.ts`:
  - initial and pain-evaluation payloads contain only `visitDiagnosisPool` as code candidates;
  - case-summary/PM/prior-visit diagnosis arrays are absent;
  - generated extra codes are overwritten by deterministic formatting;
  - confirmed-empty renders exactly `No diagnoses selected for this encounter.` with `diagnoses_snapshot=[]`;
  - diagnosis regeneration bypasses Claude.
- Extend initial-visit action tests for current/prior encounter-scoped vitals, encounter provider identity, unconfirmed blocking, deterministic save/snapshot, stale-generation rejection, finalized-note edit rejection, unfinalize/reconfirm behavior, mismatch rejection, and legacy finalized-note readability.
- Run narrow tests, `npx tsc --noEmit`, and `npm run lint`.

### Manual verification

- Generate both visit types with historical case-summary/PM diagnoses that are not selected and verify none appear in Diagnoses.
- Select one historical suggestion, regenerate, and verify only the explicitly adopted code appears.
- Verify the generated diagnosis section is read-only and directs diagnosis changes to the structured selector; simulate a stale stored mismatch and verify finalization rejects it.

## Phase 4: Make Pain Follow-Up Notes Deterministic

### Files and changes

- Narrow `gatherSource()` in `src/actions/pain-follow-up-notes.ts`:
  - load the current encounter's confirmed diagnosis pool;
  - replace broad `select('*')` encounter reads with explicit narrative/trajectory fields so new encounter diagnosis columns from prior encounters cannot leak into the payload;
  - remove `diagnoses` from the performed-procedure select while retaining date/type/sites/number for treatment history;
  - keep prior discharge fields diagnosis-free;
  - require confirmation before full generation or diagnosis-section regeneration.
- Update `PainFollowUpSourceData` and `PAIN_FOLLOW_UP_SYSTEM_PROMPT` in `src/lib/claude/generate-pain-follow-up.ts`:
  - add authoritative `visitDiagnosisPool`;
  - explicitly prohibit deriving codes from latest encounter, prior discharge, performed procedures, imaging history, or another provider;
  - require every `procedure_recommendations[].diagnoses` item to come from the pool.
- Tighten `procedureRecommendationSchema` in `src/lib/validations/pain-follow-up-note.ts` and the Claude tool schema so recommendation diagnoses require a non-null, normalized ICD-10 code. Reject null-coded recommendation diagnoses in both application validation and the SQL finalization check; do not treat description-only items as pool members.
- After Claude returns, re-read and compare the encounter pool plus confirmation timestamp to reject stale generation. Overwrite the returned free-text diagnosis section with `formatVisitDiagnoses()`, write the same `diagnoses_snapshot`, and validate every recommendation diagnosis with `assertRecommendationDiagnosesInPool()` before returning success.
- Bypass Claude for diagnosis-section regeneration. Continue using Claude for other sections but pass only the authoritative pool.
- Update `savePainFollowUpNote()` to overwrite the client diagnosis field/snapshot from the current pool and reject recommendation codes outside the pool; `finalizePainFollowUpNote()` revalidates both the stored diagnosis snapshot and recommendations before creating the PDF.
- Add a migration replacing `public.finalize_pain_follow_up()` from `supabase/migrations/20260826212446_return_visit_workflow_rpcs.sql`. Inside its existing row-locked transaction, require confirmation, require `pain_follow_up_notes.diagnoses_snapshot = clinical_encounters.diagnoses`, and reject recommendation codes outside the encounter pool before transitioning the note/encounter. Keep the trigger guard as a second path-independent check.

### Automated verification

- Extend `src/lib/claude/__tests__/generate-pain-follow-up.test.ts` for authoritative pool wording, deterministic diagnosis formatting, prior-source redaction, recommendation subset acceptance/rejection, confirmed-empty handling, and regeneration bypass.
- Add action tests proving performed-procedure diagnoses and prior encounter diagnoses never enter the prompt, stale generation cannot persist, and unconfirmed encounters cannot generate/finalize.
- Add pgTAP tests that call `finalize_pain_follow_up()` directly for unconfirmed, mismatched-snapshot, out-of-pool recommendation, and valid cases.
- Add regression coverage for valid same-pool recommendations and the existing UUID normalization/telehealth safeguards.
- Run narrow tests, `npx tsc --noEmit`, and `npm run lint`.

### Manual verification

- Generate a follow-up in an episode containing procedures and notes from another clinician; verify only selected current-visit diagnoses appear.
- Verify a recommendation cannot save/finalize with a code outside the current visit pool.
- Regenerate Diagnoses and confirm it is stable and deterministic.

## Phase 5: Restrict Procedure Notes to the Procedure Record

### Files and changes

- Update `gatherProcedureNoteSourceData()` in `src/actions/procedure-notes.ts`:
  - stop constructing `pmSupplementaryDiagnoses`;
  - omit PM diagnosis arrays and `caseSummary.suggested_diagnoses` from the generation payload;
  - retain PM physical exam/imaging/treatment plan and case-summary narrative fields only where needed for indication, trajectory, and plan alignment;
  - keep prior procedure-note context but remove/sanitize the prior `assessment_and_plan` diagnosis block before prompt serialization.
- Update `ProcedureNoteInputData` and source-precedence rules in `src/lib/claude/generate-procedure-note.ts` so `procedureRecord.diagnoses` is the sole diagnosis pool. Historical data may explain continuity but may not add codes.
- Add a shared `replaceDiagnosisBlock()` helper for the combined `assessment_and_plan` field. After generation/regeneration, replace the `DIAGNOSES:` block with the deterministically formatted `procedures.diagnoses` list, write the same `procedure_notes.diagnoses_snapshot`, and preserve the generated `PLAN:` block.
- Preserve the existing storage-time `rewriteDiagnosesForProcedure()` behavior. Clinical-support prompt rules may produce QC warnings, but they may no longer silently substitute or add codes during generation; the provider changes the procedure record to change the diagnosis list.
- Validate the saved/finalized `assessment_and_plan` diagnosis block against `procedures.diagnoses`.
- After Claude returns, re-read `procedures.diagnoses` and reject stale persistence if it differs from the generation input. Ensure the source hash includes the committed list but do not treat the hash alone as a concurrency check.
- Update `updatePrpProcedure()` and `updateBotoxProcedure()` in `src/actions/procedures.ts` to reject diagnosis changes while an active linked `procedure_notes` row is finalized. The provider must unfinalize, edit the procedure, regenerate, and refinalize. Non-diagnosis procedure edits must follow the repository's existing finalized-note policy and are not broadened by this plan.

### Automated verification

- Extend `src/lib/claude/__tests__/generate-procedure-note.test.ts` to prove PM/case-summary/prior-note diagnoses cannot enter the output, the diagnosis block is replaced deterministically, and the plan block is preserved.
- Extend context-bundle tests for sanitizing prior `assessment_and_plan` diagnosis blocks.
- Add action/save/finalize tests for stale-generation/mismatch rejection, PRP and BOTOX diagnosis-edit locking, unfinalize/edit/regenerate success, and existing procedure rewrite behavior.
- Retain and run `src/lib/icd10/__tests__/diagnosis-rewrite.test.ts` and procedure dialog tests.
- Run narrow tests, `npx tsc --noEmit`, and `npm run lint`.

### Manual verification

- Generate a procedure note on a case with extra PM/case-summary diagnoses and verify the note lists exactly the procedure record's codes.
- Regenerate `assessment_and_plan` and verify the diagnosis block remains unchanged while the plan narrative updates.
- Edit the procedure's structured diagnoses, regenerate, and verify the note follows the new committed list.

## Phase 6: Cross-Workflow QC, Rollout, and Documentation

### Files and changes

- Add deterministic visit-pool findings to `src/lib/qc/diagnosis-validators.ts` and its tests:
  - unconfirmed encounter diagnosis selection on a non-finalized visit;
  - note diagnosis mismatch;
  - pain-follow-up recommendation diagnosis outside the pool;
  - procedure-note diagnosis block mismatch.
- Extend `QualityReviewInputData` and `gatherSourceData()` in `src/actions/case-quality-reviews.ts` to select encounter pools/confirmation metadata, note diagnosis snapshots, pain-follow-up `procedure_recommendations`, and procedure-note snapshots. Do not change discharge aggregation.
- Wire findings through the existing deterministic merge/dedupe path, add stable finding codes/constants, add `verifyFinding()` dispatch for rechecks, and mark source-of-truth mismatches ineligible for AI section fixes (the fix is changing/confirming the structured source or regenerating).
- Add structured warning logs for blocked generation/finalization with case/episode/encounter IDs and reason only; do not log clinical narrative or full diagnosis payloads.
- Update durable workflow documentation near the research artifact to state the source-of-truth hierarchy and legacy behavior.
- Roll out additively:
  1. deploy migration and read-compatible code;
  2. deploy selectors/actions and UI confirmation;
  3. enable generation/finalization gates;
  4. monitor blocked-generation counts and unexpected mismatch findings.

### Automated verification

- Run all diagnosis, initial-visit, pain-follow-up, procedure-note, context-bundle, QC, and clinical-encounter tests.
- Run `npm run db:test`, `npx tsc --noEmit`, `npm run lint`, and `npm run build`, including the new RPC/finalization pgTAP cases.
- Review the full diff and generated database type changes.

### Manual verification

- Exercise one complete initial evaluation, pain evaluation, pain follow-up, and procedure-note lifecycle through save, generation, section regeneration, finalize, unfinalize, and regenerate.
- Confirm legacy finalized notes/PDFs remain readable and unchanged.
- Confirm discharge generation still uses its existing course-wide diagnosis pool.
- Confirm no UI automatically selects a historical or other-provider diagnosis.

## Risks and Rollback Considerations

- **Workflow friction:** Requiring confirmation adds a provider step. Mitigate with the existing combobox, source-labeled suggestions, explicit empty confirmation, and a precise blocking message.
- **Providers without login accounts:** `provider_profiles.user_id` is nullable. Such encounters require an administrator to confirm diagnoses unless a separate documented delegation policy is approved later; do not silently fall back to staff confirmation.
- **Legacy drafts:** Existing draft/in-progress visits will block until reviewed. This is intentional; do not auto-confirm AI text. Rollback can temporarily disable gates while retaining the additive columns and UI.
- **Generated-text compatibility:** Diagnoses remain text on note rows for PDFs and billing consumers. Deterministic formatting must preserve the parser-supported bullet/dash format.
- **Procedure clinical downgrades:** Removing AI substitutions makes the provider record authoritative. Existing validation/warnings must remain visible so unsupported codes are corrected at the structured source rather than silently rewritten in prose.
- **Historical context leakage:** Narrow selects and sanitizers are both required. Tests should inspect the exact serialized AI payload, not only prompt wording.
- **Concurrent edits:** Source hashes are audit metadata only. Every generator must re-read and compare its diagnosis authority after Claude returns, and finalization triggers/RPC checks must compare structured snapshots inside the database transaction.
- **Rollback:** All schema changes are additive. Reverting application gates restores legacy generation; columns can remain unused. Do not drop columns until all deployed versions and stored source hashes no longer depend on them.

## Completion Criteria

- `clinical_encounters` stores a clinician-confirmed structured diagnosis list with server-owned audit metadata.
- Only the encounter's linked active provider or an administrator can confirm it; staff and other providers cannot.
- Database triggers enforce that authorization and canonical snapshot/text rules even for direct authenticated Supabase updates.
- A fresh evaluation can prepare/link its encounter before diagnosis confirmation, with no generation bootstrap dependency.
- Initial evaluation, pain evaluation, and pain follow-up generation cannot proceed without explicit confirmation, including confirmation of an empty list.
- Their persisted diagnosis text is deterministically rendered from the current encounter selection.
- Structured note snapshots match their authority rows, and database finalization gates enforce that match atomically.
- Pain-follow-up recommendations cannot reference diagnoses outside that selection.
- Pain-follow-up recommendation diagnoses always have non-null normalized ICD-10 codes.
- Procedure-note diagnoses are deterministically sourced only from `procedures.diagnoses`.
- Case-summary, PM, prior-visit, prior-provider, and prior-procedure diagnosis arrays are absent from visit-generation payloads.
- Historical diagnoses are suggestions only and never preselected.
- Save, regeneration, and finalization reject mismatches.
- Mid-generation diagnosis changes reject stale persistence, and finalized procedure diagnoses cannot drift from the procedure record.
- Existing finalized records and discharge behavior remain unchanged.
- Narrow and full automated verification pass, manual lifecycle checks pass, and the final diff has been reviewed.
