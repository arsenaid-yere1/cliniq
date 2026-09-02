# PRP Anatomic and Clinical Target Validation Implementation Plan

## Implementation status (2026-09-02)

Implemented across all five phases. The resulting source-of-truth pipeline is:

1. `src/actions/initial-visit-notes.ts:gatherSourceData()` loads approved, provider-effective MRI/CT/X-ray rows for Pain Evaluation only.
2. `src/lib/clinical/prp-target-evidence.ts:buildPrpTargetEvidence()` creates exact anatomic candidates and independently attaches current complaint and current examination evidence.
3. `src/lib/clinical/prp-target-evidence.ts:validatePrpTargetSelections()` rejects unknown, duplicate, or ineligible selections and hydrates persisted evidence exclusively from the server-built bundle.
4. `src/lib/clinical/render-prp-treatment-plan.ts:renderPrpTreatmentPlan()` renders the target block deterministically, including the no-target state.
5. Save, removal, regeneration, and finalization rebuild and hash the evidence bundle so stale or unsupported targets fail closed.

Automated verification completed: focused target tests, the full 95-file/1,286-test suite, TypeScript checking, changed-file lint, and a production build. Full-repository lint remains blocked by a pre-existing `react-hooks/set-state-in-effect` error in `src/components/settings/invite-user-dialog.tsx:62`. Database tests could not run because local Supabase was not available at `127.0.0.1:54322`; the migration therefore remains to be applied and generated types should be refreshed from the running local database before deployment. The provider/PDF scenarios under Manual verification remain release QA tasks.

## Overview

Replace free-form PRP target invention in the Pain Evaluation Visit with an evidence-backed target pipeline. Every automatically recommended PRP target must satisfy two independent gates:

1. A documented anatomic abnormality exists at the same region, level/location, and laterality where applicable.
2. Current clinical evidence makes that abnormality a plausible treatment target.

The implementation will preserve `treatment_plan` as the rendered report section for PDF compatibility, while adding a structured, auditable target model that is built before generation, validated after generation, persisted with the note, and surfaced to the provider. The literal `initial_visit` flow will continue to prohibit PRP recommendations.

## Current State

- `src/actions/initial-visit-notes.ts:gatherSourceData()` loads a synthesized `case_summaries` row for `pain_evaluation_visit`, but does not load the raw approved imaging findings used to establish exact anatomy.
- `src/lib/claude/generate-initial-visit.ts` asks the model to generate exact PRP regions and levels inside the free-text `treatment_plan`. The examples can supply regions and levels not found in the case.
- Diagnosis support rules correlate imaging and examination evidence, but those rules do not govern PRP target selection.
- `src/lib/validations/initial-visit-note.ts` validates `treatment_plan` only as a string.
- `src/lib/qc/narrative-validator.ts` does not compare PRP targets with anatomic and clinical evidence; warnings are non-fatal.
- `src/lib/procedures/compute-plan-alignment.ts` already provides region normalization and vertebral-level extraction, but its helpers and types are organized around planned-versus-performed procedures rather than target eligibility.
- `src/lib/procedures/sites-helpers.ts` and procedure records already use structured sites, including a nullable per-site `target_confirmed_imaging` field. This downstream field does not validate the upstream recommendation.

## Desired End State

- Pain Evaluation generation reads approved, provider-effective MRI, CT, and X-ray findings directly, retaining modality, source, region, level/location, laterality, description, and date.
- A deterministic evidence builder normalizes anatomic findings and current clinical signals into target candidates.
- A target is eligible for automatic recommendation only when:
  - it has a non-empty documented anatomic abnormality at that exact level/location;
  - its canonical body region matches a current complaint;
  - its canonical body region matches a current examination finding; and
  - laterality is compatible wherever the source data supplies laterality.
- Current provider intake is the required clinical anchor. Prior pain-management examination data may add support but may not replace both a current complaint and current examination match.
- Spine targets must match a documented imaging level exactly after normalization. A region-only spine finding cannot support invention of a specific level.
- Non-spine targets must match the documented anatomic location and laterality when present.
- The model may select targets only by stable candidate ID. It may not create regions, levels, structures, or evidence.
- Each selected target records separate anatomic-evidence and clinical-justification fields.
- The server rejects a generated selection whose candidate ID is unknown or ineligible. It does not silently save a clinically unsupported draft.
- Report prose is composed from validated structured targets, so the displayed/PDF target bullets cannot drift from the audited target data.
- Saving or finalizing after relevant imaging or provider-intake evidence changes is blocked until the Treatment Plan is regenerated against the new evidence bundle.
- If no target passes both gates, the Pain Evaluation remains valid but does not recommend PRP. Its plan states that no PRP target is established from the current anatomic and clinical evidence and continues non-interventional care/further evaluation.
- The provider UI shows why each recommended target passed both gates. Providers may remove an automatic target. Adding a target that failed the gates or was absent from the candidate set is out of scope for this change.

## Key Discoveries

- The literal Initial Visit already has the intended safe boundary: imaging context is null and PRP is explicitly forbidden (`src/lib/claude/generate-initial-visit.ts:149-243`; `src/actions/initial-visit-notes.ts:70-80`).
- Approved MRI extraction findings retain exact `level` and `description` (`src/lib/validations/mri-extraction.ts:findingSchema`), but the case summary collapses imaging into region-level free text without source provenance (`src/lib/validations/case-summary.ts:imagingFindingSchema`).
- Provider overrides must be applied before evidence normalization. Pain-management overrides already use overrides-first precedence in `gatherSourceData()`; imaging rows need the same explicit behavior.
- Existing `normalizeRegion()` and level parsing in `src/lib/procedures/compute-plan-alignment.ts` are useful, but the level extractor is private and permissive parsing of plan prose is not suitable as the source of truth.
- The later procedure-note prompt already distinguishes anatomic pathology, symptom/exam concordance, and a primary pain generator (`src/lib/claude/generate-procedure-note.ts:534-538`). That is a useful terminology pattern, not an enforcement mechanism to reuse directly.
- The Initial Visit editor renders all report sections as editable textareas. Target bullets need a separate structured editor/display path to prevent free-text edits from bypassing validation.

## What We Are Not Doing

- We are not changing the literal Initial Visit to recommend PRP.
- We are not treating every radiographic abnormality as a treatment target.
- We are not making MRI the only possible source of an anatomic abnormality. The retained modality must be stated accurately, and modality-specific clinical policy can be tightened later without changing the target contract.
- We are not deciding that CT or X-ray evidence is equivalent to MRI for every pathology. The evidence record preserves modality; this change enforces documented anatomy plus clinical concordance, not modality equivalence.
- We are not changing performed-procedure site capture, billing, procedure-note plan alignment, or `target_confirmed_imaging` semantics.
- We are not providing an unsupported-target override workflow in this iteration. Providers can remove generated targets and can document continued evaluation, but cannot promote an ineligible candidate through the report editor.
- We are not retroactively rewriting finalized reports. Existing rows receive an empty structured-target value and retain their historical prose.

## Implementation Approach

Introduce a shared clinical target-evidence module, then make structured targets the source of truth for PRP target bullets.

Define these core shapes in `src/lib/clinical/prp-target-evidence.ts`:

- `AnatomicEvidence`: stable evidence ID, source table/row ID, modality, date, canonical region, normalized level/location, laterality, and verbatim finding description.
- `ClinicalEvidence`: stable evidence ID, source (`current_complaint`, `current_exam`, or supplemental `pm_exam`), canonical region, laterality, and source text.
- `PrpTargetCandidate`: stable candidate ID, target region/level/location/laterality, attached anatomic and clinical evidence IDs, eligibility status, and explicit ineligibility reasons.
- `PrpTargetRecommendation`: selected candidate ID, target structure, guidance/approach, clinical rationale, and the evidence IDs copied from the candidate.

Move canonical region and spinal-level normalization into a neutral shared module (`src/lib/clinical/anatomic-normalization.ts`) and update `compute-plan-alignment.ts` to import it. This avoids depending on procedure-plan parsing from clinical recommendation code.

Candidate construction will be deterministic:

1. Apply provider overrides to each approved imaging row.
2. Emit one anatomic evidence item per non-empty finding; normalize region, level/location, and laterality without changing the original description.
3. Emit current complaint and examination evidence from `providerIntake`; retain PM examination evidence as supplemental context.
4. Group by normalized region + exact level/location + laterality.
5. Mark a candidate eligible only when at least one anatomic item, one current complaint, and one current exam item match. Treat null laterality as compatible but never convert a unilateral finding into bilateral support.
6. Preserve every failed gate as a machine-readable reason for audit and UI display.

The Claude tool will return structured `prp_target_recommendations` in addition to narrative sections. The model can select only candidate IDs marked eligible. Server validation will resolve every selection back to its candidate, reject duplicate/unknown/ineligible IDs, and overwrite all evidence fields from the server-built candidate rather than trusting model-returned evidence.

The treatment plan will be assembled in TypeScript from:

- model-generated rationale/supportive-care paragraphs that cannot introduce target bullets;
- deterministic bullets rendered from validated recommendations and their evidence; and
- a deterministic no-eligible-target paragraph when the recommendation array is empty.

This makes the structured recommendations—not prose parsing—the persisted source of truth.

## Phase 1: Shared anatomic normalization and target-evidence model

### Files and changes

- Add `src/lib/clinical/anatomic-normalization.ts`.
  - Export canonical region normalization currently embedded in `compute-plan-alignment.ts`.
  - Export exact spinal-level normalization supporting `C5-6`, `C5/C6`, en/em dashes, and transitional levels such as `L5-S1`.
  - Export conservative laterality extraction/compatibility helpers.
  - Keep original source strings alongside normalized values.
- Update `src/lib/procedures/compute-plan-alignment.ts` to import the shared helpers without changing its public behavior.
- Add `src/lib/clinical/prp-target-evidence.ts`.
  - Define Zod schemas and TypeScript types for anatomic evidence, clinical evidence, candidates, recommendations, and eligibility reasons.
  - Implement provider-effective imaging-row normalization for MRI, CT, and X-ray inputs.
  - Implement current complaint/current exam/PM exam normalization.
  - Implement deterministic candidate grouping and the two-gate eligibility rules.
  - Exclude empty findings and candidates whose region or exact spine level cannot be normalized.
- Add focused tests:
  - `src/lib/clinical/anatomic-normalization.test.ts`.
  - `src/lib/clinical/prp-target-evidence.test.ts`.
  - Cover synonymous regions, exact and transitional levels, laterality compatibility, provider overrides, missing abnormality, missing complaint, missing current exam, incidental abnormalities, duplicate findings, and mixed modalities.

### Automated verification

- `npm test -- src/lib/clinical/anatomic-normalization.test.ts src/lib/clinical/prp-target-evidence.test.ts src/lib/procedures/compute-plan-alignment.test.ts`
- `npm run lint -- src/lib/clinical/anatomic-normalization.ts src/lib/clinical/prp-target-evidence.ts src/lib/procedures/compute-plan-alignment.ts`

### Manual verification

- Review representative cervical, lumbar, and non-spine inputs and confirm candidate IDs and normalized sites are stable and readable.
- Confirm a radiographic abnormality with no matching current complaint/exam remains visible as ineligible rather than disappearing.

## Phase 2: Load raw provider-effective evidence for Pain Evaluation

### Files and changes

- Update `InitialVisitInputData` in `src/lib/claude/generate-initial-visit.ts` to carry a `prpTargetEvidence` bundle only for `pain_evaluation_visit`.
- Update `gatherSourceData()` in `src/actions/initial-visit-notes.ts`.
  - For Pain Evaluation only, query approved/edited MRI, CT, and X-ray rows with IDs, dates, body regions, laterality where available, findings, impressions, and provider overrides.
  - Apply overrides-first precedence before building evidence.
  - Build the target candidate bundle from imaging rows, current provider intake, and supplemental PM examination data.
  - Keep the existing case summary for narrative context, but state in code that it is not authoritative for target eligibility.
  - For Initial Visit, preserve the null contract and do not perform the new imaging queries.
- Add a dedicated deterministic `computePrpTargetEvidenceHash()` over the normalized anatomic and current-clinical evidence bundle. Keep the existing whole-note `source_data_hash` behavior unchanged.
- Add `src/actions/__tests__/initial-visit-notes-generation.test.ts` for generation-specific query, evidence-building, validation, and persistence coverage; keep save/vitals cases in the existing save test.

### Automated verification

- Unit-test that raw imaging queries run only for `pain_evaluation_visit`.
- Unit-test provider-overrides precedence and source-hash changes after an imaging or intake edit.
- Unit-test that a case summary target or PM recommendation cannot create an eligible candidate without raw anatomic and current clinical evidence.
- Run `npm test -- src/actions/__tests__/initial-visit-notes-save.test.ts src/lib/claude/__tests__/generate-initial-visit.test.ts` plus the Phase 1 tests.

### Manual verification

- Inspect a Pain Evaluation generation payload and confirm it contains normalized evidence/candidates with modality and source IDs.
- Inspect an Initial Visit payload and confirm it still contains no imaging or PRP target evidence.

## Phase 3: Structured generation and fail-closed validation

### Files and changes

- Update `src/lib/validations/initial-visit-note.ts`.
  - Add `prp_target_recommendations` to the generated Pain Evaluation result contract.
  - Use a discriminated result schema or visit-type-specific parse so Initial Visit continues to require no PRP recommendations.
  - Add a server validation function that resolves selected candidate IDs against the input evidence and returns actionable errors for unknown, duplicate, or ineligible targets.
- Update `src/lib/claude/generate-initial-visit.ts`.
  - Remove illustrative cervical/lumbar and C4-5/C5-6/C6-7 target examples that can leak into output.
  - Define the two independent gates explicitly.
  - Tell the model that an abnormality alone is not a treatment target and symptoms alone do not establish abnormal anatomy.
  - Require selection only from eligible candidate IDs.
  - Require `target_structure`, `guidance_method`, `approach`, and concise clinical rationale for each selected candidate.
  - Require an empty recommendation array when no candidate is eligible; do not force PRP into every Pain Evaluation.
  - Split the model's treatment-plan output into non-target narrative components so target bullets can be composed by code.
- Add a pure formatter, `src/lib/clinical/render-prp-treatment-plan.ts`.
  - Render validated target bullets with accurate modality language and separate anatomic/clinical rationale.
  - Render the no-eligible-target plan when appropriate.
  - Combine target output with medication, rehabilitation, monitoring, and escalation prose.
- Update `generateInitialVisitNote()` and `regenerateNoteSection()` in `src/actions/initial-visit-notes.ts`.
  - Validate target selections before persisting.
  - Fail the generation/regeneration with a clear error when model output references an invalid target; do not downgrade this to a narrative warning.
  - Rebuild `treatment_plan` from structured recommendations on full generation and treatment-plan regeneration.
  - Prevent regeneration of another section from mutating target recommendations.
- Extend `src/lib/claude/__tests__/generate-initial-visit.test.ts` and add `src/lib/clinical/render-prp-treatment-plan.test.ts`.

### Automated verification

- Test successful selection of a fully supported target.
- Test rejection of invented regions, invented levels, incompatible laterality, duplicate targets, and ineligible candidate IDs.
- Test empty-target behavior when anatomy or current clinical support is missing.
- Test that literal Initial Visit output cannot contain structured PRP targets.
- Test that target bullets cite the actual modality and do not relabel CT/X-ray evidence as MRI.
- Test full and treatment-plan-only regeneration paths.
- Run `npm test -- src/lib/claude/__tests__/generate-initial-visit.test.ts src/lib/clinical/render-prp-treatment-plan.test.ts src/lib/clinical/prp-target-evidence.test.ts`.

### Manual verification

- Generate Pain Evaluations for: fully concordant single-level disease, multilevel anatomy with one clinically concordant level, incidental imaging abnormality, symptoms without structural evidence, structural evidence without current symptoms/exam, and mixed-modality evidence.
- Confirm unsupported target generation fails closed and no invalid draft is saved.

## Phase 4: Persist auditable targets and protect editing/finalization

### Files and changes

- Add a Supabase migration under `supabase/migrations/` adding `prp_target_recommendations jsonb NOT NULL DEFAULT '[]'::jsonb` and nullable `prp_target_evidence_hash text` to `initial_visit_notes`.
  - Add a JSON-array check constraint.
  - Do not backfill recommendations from historical free text; existing rows remain empty.
- Regenerate `src/types/database.ts` with `npm run gen:types:local` after applying the migration locally.
- Update `src/actions/initial-visit-notes.ts` to clear both fields on reset/new generation and persist validated recommendations plus the evidence hash for Pain Evaluation only.
- Update the local `NoteRow` shape and report editor in `src/components/clinical/initial-visit-editor.tsx`.
  - For Pain Evaluation, render an “Evidence-backed PRP targets” card above the Treatment Plan.
  - Show region/level/laterality, anatomic abnormality with modality/date, and current complaint/exam justification separately.
  - Allow removing a recommendation before finalization.
  - Treat the generated target bullet block as read-only; keep supportive treatment-plan prose editable.
  - Display the deterministic no-target state when no candidate passes both gates.
- Update `saveInitialVisitNote()` to accept structured recommendations separately from editable prose and recompose the final `treatment_plan` server-side.
- Update `saveInitialVisitNote()` and `finalizeInitialVisitNote()` to rebuild the current evidence bundle and compare its hash with the note's stored `prp_target_evidence_hash`. If relevant imaging or provider intake changed, return an actionable “regenerate Treatment Plan” error instead of accepting stale recommendations.
- Update `finalizeInitialVisitNote()` to revalidate persisted recommendations against the current evidence bundle and recompose the target block before PDF rendering. Block finalization if structured data is invalid or target prose cannot be produced.
- Keep `src/lib/pdf/render-initial-visit-pdf.ts` and `src/lib/pdf/initial-visit-template.tsx` consuming the composed `treatment_plan` string; no PDF layout change is required unless the evidence text causes overflow during visual verification.
- Add/extend action and component tests for removal, save, reset, regeneration, finalization blocking, and historical rows with an empty structured array.

### Automated verification

- Apply migrations with the repository's local Supabase workflow.
- `npm run gen:types:local`
- `npm run db:test`
- `npm test -- src/actions/__tests__/initial-visit-notes-save.test.ts src/lib/validations/__tests__/initial-visit-note.test.ts`
- Run the Phase 1-3 focused tests.
- `npm run lint`
- `npm run build`

### Manual verification

- Confirm the provider can distinguish the abnormality evidence from the clinical-target justification at a glance.
- Remove one of several recommended targets, save, reload, and finalize; confirm the PDF contains only the retained target.
- Confirm editing supportive prose cannot introduce a new target bullet.
- Open a historical finalized report and confirm it renders unchanged.
- Render representative PDFs and check pagination, bullet wrapping, modality labels, and no-target wording.

## Phase 5: Regression coverage across downstream procedure workflow

### Files and changes

- Extend `src/lib/procedures/sites-from-plan.test.ts` and `src/lib/procedures/compute-plan-alignment.test.ts` with treatment plans rendered from the new formatter.
- Update procedure-default loading in `src/actions/procedures.ts` to select `prp_target_recommendations`. Prefer a non-empty validated structured array over parsing `treatment_plan`; use the existing prose parser only when the field is empty on a historical note. Add tests for both paths.
- Verify that `target_confirmed_imaging` remains unset until the provider records the performed procedure; do not infer performed-site confirmation solely from the planning recommendation.
- Update the research document `thoughts/shared/research/2026-09-01-prp-target-area-mri-support.md` with links to the implemented evidence contract after completion.

### Automated verification

- `npm test -- src/lib/procedures/sites-from-plan.test.ts src/lib/procedures/compute-plan-alignment.test.ts src/lib/claude/__tests__/generate-procedure-note.test.ts`
- Run all changed-file tests, then `npm test`, `npm run lint`, and `npm run build`.

### Manual verification

- Create a PRP procedure from a newly generated Pain Evaluation and confirm only validated structured targets are suggested.
- Create a procedure from a historical note and confirm the legacy prose parser still supplies existing defaults.
- Confirm planned-versus-performed mismatch reporting continues to identify region, laterality, guidance, and level deviations.

## Risks and rollback considerations

- **Clinical-policy strictness:** Requiring both a current complaint and current exam match will reduce automatic recommendations when intake is incomplete. This is intentional fail-closed behavior; the UI must explain which gate is missing.
- **Normalization errors:** Region, level, and laterality synonyms can create false mismatches. Preserve original text, keep normalization conservative, and cover known variants with fixtures before expanding aliases.
- **Modality ambiguity:** CT/X-ray findings may document anatomy without being sufficient for every PRP indication. Retaining modality prevents false MRI claims. Tightening modality eligibility later should occur in the candidate builder, not in prompt prose.
- **LLM retry behavior:** A model may still return an invalid candidate ID. Treat this as generation failure with the existing retry UX; never persist the invalid target.
- **Existing drafts:** Historical drafts have target prose but no structured recommendations. Do not infer audit data from prose. Finalized historical notes remain untouched. Unfinalized Pain Evaluation drafts with PRP prose and no structured targets must regenerate the Treatment Plan before finalization.
- **PDF length:** Separate evidence-backed wording may lengthen the Treatment Plan. Keep bullets concise and render-test representative multi-target cases.
- **Rollback:** Dropping the new JSONB column is mechanically reversible because the composed `treatment_plan` remains stored. Do not remove the column until application code has been rolled back. New reports would retain readable prose but lose structured audit data after a rollback.

## Completion criteria

- Every automatically recommended PRP target resolves to a server-built eligible candidate.
- Every eligible recommendation has exact anatomic evidence and current complaint/exam concordance at the same canonical region, with exact level/location and compatible laterality where applicable.
- Anatomic evidence and clinical justification are stored and displayed separately.
- Invented or ineligible target IDs cause generation to fail before draft persistence.
- No eligible target produces a non-PRP plan rather than a fabricated recommendation.
- Literal Initial Visit behavior remains unchanged and PRP-free.
- Treatment-plan prose and structured recommendations cannot drift during generation, editing, regeneration, save, or finalization.
- Evidence changes after generation invalidate stale recommendations and require Treatment Plan regeneration before save/finalization.
- New procedure defaults prefer structured validated targets; historical notes retain legacy parsing.
- Database migration, generated types, focused unit/integration tests, full test suite, lint, build, and representative PDF/UI verification all pass.
