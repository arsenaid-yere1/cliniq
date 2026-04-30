---
date: 2026-04-30T22:22:22Z
researcher: arsenaid
git_commit: a3dbf5ae530af19149ca8e7077cd17fc6cb0e737
branch: main
repository: cliniq
topic: "ICD-10 7th-character integrity & external-cause-code chain QC logic"
tags: [research, codebase, qc, icd-10, quality-review, diagnoses]
status: complete
last_updated: 2026-04-30
last_updated_by: arsenaid
---

# Research: ICD-10 7th-character integrity & external-cause-code chain QC logic

**Date**: 2026-04-30T22:22:22Z
**Researcher**: arsenaid
**Git Commit**: a3dbf5ae530af19149ca8e7077cd17fc6cb0e737
**Branch**: main
**Repository**: cliniq

## Research Question

Locate and document the logic for ICD-10 7th-character integrity QC. Specifically: where do flag strings such as "External cause code continuity across the chain" and "ICD-10 7th-character integrity; mismatched suffix vs. descriptor will be flagged on coding review" originate, and what code path produces them.

## Summary

Both flag strings are produced by the **case-level QC reviewer agent** ([src/lib/claude/generate-quality-review.ts](src/lib/claude/generate-quality-review.ts)) — an Opus-4.7 LLM call that reads the entire PI-workflow note chain (initial visit → pain evaluation → procedures → discharge) and emits free-text `findings[].message` entries.

The exact strings do **not** appear anywhere in the source tree. They are LLM-generated finding `message` text emitted by Opus when applying the QC system prompt's **Rule 1: "Diagnosis progression"** ([src/lib/claude/generate-quality-review.ts:109](src/lib/claude/generate-quality-review.ts#L109)). The prompt instructs the model to flag specific patterns ("radiculopathy emerging without imaging support", "M54.5 used without 5th-character specificity", "'A'-suffix codes persisting at discharge") — Opus paraphrases that guidance into the user-visible flag wording.

There is **no deterministic 7th-character validator** and **no deterministic external-cause continuity check** anywhere in the codebase. ICD-10 7th-character integrity is enforced only at two earlier-pipeline points:
1. **Extraction prompts** — instruct the LLM to copy 7th characters verbatim from source PDFs.
2. **Note-generation prompts** — explicit DIAGNOSTIC-SUPPORT rules tell the LLM which suffix variant to emit per visit type (A on initial, prefer D/S on later visits, omit V/W/X/Y on procedure & discharge).

The structural ICD-10 regex in [src/lib/icd10/validation.ts:8](src/lib/icd10/validation.ts#L8) accepts/rejects only on overall shape — it does **not** check whether the 7th character matches the descriptor or the encounter context.

## Detailed Findings

### 1. Flag-string origin: case-level QC reviewer (LLM)

The two flag strings are emitted as the `message` field of `QualityFinding` objects produced by the QC reviewer Claude tool call.

#### Tool call

[src/lib/claude/generate-quality-review.ts:196-245](src/lib/claude/generate-quality-review.ts#L196-L245) — `generateQualityReviewFromData`:
- Model: `claude-opus-4-7`
- maxTokens: 16000
- Tool: `generate_case_quality_review` with output `{ findings[], summary, overall_assessment }`
- Each finding carries `severity`, `step`, `note_id`, `procedure_id`, `section_key`, `message`, `rationale`, `suggested_tone_hint`.

#### System prompt — what governs the flag wording

[src/lib/claude/generate-quality-review.ts:97-129](src/lib/claude/generate-quality-review.ts#L97-L129) — full `SYSTEM_PROMPT`. The relevant section is the "WHAT TO CHECK" list. **Rule 1** is the source of both flag strings in the question:

```
1. Diagnosis progression. ICD-10 codes should evolve coherently across IV → pain-eval → procedure → discharge. Flag radiculopathy emerging without imaging support, M54.5 used without 5th-character specificity, "A"-suffix codes persisting at discharge.
```

[src/lib/claude/generate-quality-review.ts:109](src/lib/claude/generate-quality-review.ts#L109) — single-line statement of Rule 1.

The model is told to "evolve coherently across IV → pain-eval → procedure → discharge" and to "flag … 'A'-suffix codes persisting at discharge". Opus then synthesizes user-facing strings such as:
- "External cause code continuity across the chain" — a paraphrase of the IV→procedure→discharge external-cause omission expectation that is encoded in the per-step DIAGNOSTIC-SUPPORT filters (see §3 below). The QC prompt inherits this expectation indirectly via "evolve coherently" and via the input data containing the actual diagnosis lists from each step.
- "ICD-10 7th-character integrity; mismatched suffix vs. descriptor will be flagged on coding review." — a paraphrase of "'A'-suffix codes persisting at discharge" plus the M54.5-specificity rule, generalized by the model to the broader concept of suffix↔descriptor consistency.

Other QC system-prompt rules ([src/lib/claude/generate-quality-review.ts:108-118](src/lib/claude/generate-quality-review.ts#L108-L118)):
1. Diagnosis progression
2. Pain trajectory consistency
3. Plan continuity
4. Provider intake echo
5. Procedure plan alignment
6. Pain-evaluation NUMERIC-ANCHOR
7. Cross-note copy/paste (NO CLONE)
8. Symptom resolution (discharge diagnoses ≠ resolved symptoms)
9. Missing-vitals branch
10. Forbidden-phrase scan ("complete resolution", "full recovery", "regenerative capacity")

Severity tiers: `critical` blocks documentation; `warning` is inconsistency / missing rationale; `info` is stylistic.

#### Output normalization

[src/lib/claude/generate-quality-review.ts:218-243](src/lib/claude/generate-quality-review.ts#L218-L243) — the `parse` callback coerces the literal string `"null"` to JS null on every nullable field, then validates against `qualityReviewResultSchema`.

[src/lib/validations/case-quality-review.ts:26-44](src/lib/validations/case-quality-review.ts#L26-L44) — schema for findings + result.

### 2. Server action that runs the reviewer

[src/actions/case-quality-reviews.ts:273-416](src/actions/case-quality-reviews.ts#L273-L416) — `runCaseQualityReview(caseId)`:

1. Auth + `assertCaseNotClosed`.
2. `gatherSourceData` ([src/actions/case-quality-reviews.ts:28-271](src/actions/case-quality-reviews.ts#L28-L271)) loads everything the reviewer sees:
   - case row + patient
   - latest `case_summaries` row (chief_complaint, imaging_findings, suggested_diagnoses, raw_ai_response)
   - `initial_visit_notes` (visit_type='initial_visit') and pain-evaluation note (visit_type='pain_evaluation_visit')
   - all `procedure_notes` joined to their parent `procedures` (procedure_date, procedure_number, diagnoses)
   - `vital_signs` per procedure (pain_score_min/max)
   - active `discharge_notes` row (incl. `pain_trajectory_text` + `raw_ai_response.trajectory_warnings`)
   - approved/edited extraction counts across mri/pt/pm/chiro/ortho/ct/x-ray
3. Captures prior `finding_overrides` from existing active row, soft-deletes that row.
4. Inserts a new `case_quality_reviews` row in `generation_status='processing'` with `source_data_hash`.
5. Calls `generateQualityReviewFromData` with a throttled progress writer.
6. On failure → marks row `failed` and stores `generation_error` + `raw_ai_response`.
7. On success → writes `findings`, `summary`, `overall_assessment`, `ai_model='claude-opus-4-7'`, `generation_status='completed'`.
8. **Override carry-over** ([src/actions/case-quality-reviews.ts:381-412](src/actions/case-quality-reviews.ts#L381-L412)):
   - Already-resolved entries preserved verbatim.
   - Hash present in new findings → preserve user's ack/edit/dismiss state.
   - Hash absent → flip to `resolved` with `resolution_source='auto_recheck'` (the drift the user was reviewing has gone away).
9. `revalidatePath` `/patients/${caseId}/qc`.

Also in this file:
- [src/actions/case-quality-reviews.ts:438-440](src/actions/case-quality-reviews.ts#L438-L440) — `recheckCaseQualityReview` is an alias of `runCaseQualityReview`.
- [src/actions/case-quality-reviews.ts:442-463](src/actions/case-quality-reviews.ts#L442-L463) — `checkQualityReviewStaleness` re-hashes source data and compares against the stored `source_data_hash`.
- Provider override mutators: `acknowledgeFinding` / `dismissFinding` / `editFinding` / `clearFindingOverride` / `verifyFinding` / `markFindingResolved` ([src/actions/case-quality-reviews.ts:494-789](src/actions/case-quality-reviews.ts#L494-L789)).
- `verifyFinding` ([src/actions/case-quality-reviews.ts:655-752](src/actions/case-quality-reviews.ts#L655-L752)) deterministic-resolves only `step='procedure'` (against `procedure_notes.plan_alignment_status != 'unplanned'`) and `step='discharge'` (against empty `discharge_notes.raw_ai_response.trajectory_warnings`). Diagnosis-progression findings are NOT eligible for `verifyFinding` and require manual `markFindingResolved`.

### 3. Per-step deterministic suffix rules embedded in note-generation prompts

These are the rules the QC reviewer is implicitly checking the LLM-generated notes against. They are enforced upstream as system-prompt instructions during note generation, not as post-hoc validators.

#### Initial visit — emit "A"-suffix sprain codes + the matching external-cause code

[src/lib/claude/generate-initial-visit.ts:130-134](src/lib/claude/generate-initial-visit.ts#L130-L134) — accident_type → external-cause code mapping:

| accident_type | External cause code |
|---|---|
| `auto` | V43.52XA – Car occupant injured in collision … initial encounter |
| `slip_and_fall` | W01.0XXA – Fall on same level from slipping, initial encounter |
| `workplace` | W18.49XA – Other slipping, tripping … initial encounter |
| `other` / null | omit |

[src/lib/claude/generate-initial-visit.ts:179-186](src/lib/claude/generate-initial-visit.ts#L179-L186) — region → A-suffix sprain code reference list (S13.4XXA cervical, S23.3XXA thoracic, S39.012A lumbar, S43.402A shoulder, S83.509A knee).

[src/lib/claude/generate-initial-visit.ts:190-201](src/lib/claude/generate-initial-visit.ts#L190-L201) — DIAGNOSTIC-SUPPORT RULE for initial visit:
- (A) M54.5 specificity — never emit parent; pick a 5th-character subcode (.50/.51/.59).
- (B) M79.1 redundancy guard.
- (C) No M54.12/M54.17/M50.1X/M51.1X at first visit (radiculopathy needs imaging).

#### Procedure note — Filters A-E

[src/lib/claude/generate-procedure-note.ts:593-611](src/lib/claude/generate-procedure-note.ts#L593-L611) — DIAGNOSTIC-SUPPORT filters:
- **(A) External-cause codes — ABSOLUTE OMISSION**. Omit every V/W/X/Y code (e.g. V43.52XA) even if present in `procedureRecord.diagnoses` or `pmExtraction.diagnoses`.
- (B) Myelopathy/cord-compromise codes require UMN signs.
- (C) Radiculopathy codes require region-matched objective findings.
- **(D) "Initial encounter" sprain codes (A-suffix: S13.4XXA, S33.5XXA …)** — on a repeat visit prefer subsequent-encounter "D" suffix or omit; permitted on first procedure note if on `procedureRecord.diagnoses`.
- (E) Current-visit support — every retained code must be backed by THIS visit's subjective/ROS/objective_physical_exam.

[src/lib/claude/generate-procedure-note.ts:613-649](src/lib/claude/generate-procedure-note.ts#L613-L649) — DOWNGRADE TABLE (framework-aware) and worked example explicitly walking V43.52XA → omit, S13.4XXA / S33.5XXA → keep on first procedure note else omit / downgrade to "D".

[src/lib/claude/generate-procedure-note.ts:583-589](src/lib/claude/generate-procedure-note.ts#L583-L589) — CODING FRAMEWORK RULE: TRAUMATIC default (M50.20 / M51.26 / M51.27) vs DEGENERATIVE-WITH-SUPERIMPOSED-TRAUMA (M50.23 / M51.36 / M51.37). Framework selection is a binary decision for the whole note; mixing frameworks within a note is forbidden.

#### Discharge note — Filters A-G

[src/lib/claude/generate-discharge-note.ts:401-427](src/lib/claude/generate-discharge-note.ts#L401-L427):
- **(A) External-cause codes — ABSOLUTE OMISSION** at discharge. Omit every V/W/X/Y.
- (B) Myelopathy/cord-compromise codes require UMN signs anywhere in treatment course.
- (C) Radiculopathy codes require region-matched objective findings.
- **(D) "A"-suffix sprain codes — DO NOT emit at discharge.** Prefer "D" (subsequent encounter) or "S" (sequela).
- (E) M79.1 redundancy guard.
- (F) M54.5 specificity (always 5th-character subcode).
- (G) Symptom-resolution at discharge — codes whose symptoms have fully resolved should be omitted or shifted to "S"-suffix sequela variant.

#### Clinical orders generator — exclude external-cause from imaging orders

[src/lib/claude/generate-clinical-orders.ts:23](src/lib/claude/generate-clinical-orders.ts#L23):
> "Relevant ICD-10 diagnoses from the note (musculoskeletal codes only — exclude external cause codes like V43.52XA)"

### 4. Extraction prompts — verbatim 7th-character preservation

Across all four extraction generators, the LLM is instructed to copy the 7th character verbatim from source PDFs without normalization or inference:

- [src/lib/claude/extract-pain-management.ts:13](src/lib/claude/extract-pain-management.ts#L13) — Rule 5: "Extract ALL diagnosis codes exactly as written, including the ICD-10 7th character."
- [src/lib/claude/extract-chiro.ts:10](src/lib/claude/extract-chiro.ts#L10) — Rule 2.
- [src/lib/claude/extract-orthopedic.ts:13](src/lib/claude/extract-orthopedic.ts#L13) — Rule 5.
- [src/lib/claude/extract-pt.ts:17](src/lib/claude/extract-pt.ts#L17) — Rule 9.

Each extraction emits an `icd10_code: string` field per diagnosis. There is no per-character validator on the way in — the value is trusted as written and persisted to the relevant `*_extractions` JSONB.

### 5. Structural validator — accepts but does not police suffixes

[src/lib/icd10/validation.ts](src/lib/icd10/validation.ts):

```ts
const ICD10_STRUCTURAL_REGEX = /^[A-Z]\d{2}(\.\d{1,4}[A-Z]{0,2}|\.?[A-Z0-9]{0,4})?$/i
```

[src/lib/icd10/validation.ts:8](src/lib/icd10/validation.ts#L8). Comment at line 7 lists accepted examples: `M54.5, M54.50, M50.121, S13.4XXA, V43.52XA, G47.9, R51.9`.

[src/lib/icd10/validation.ts:13-15](src/lib/icd10/validation.ts#L13-L15) — `NON_BILLABLE_PARENT_CODES` only contains `'M54.5' → 'M54.50'`. This is the only deterministic suffix-related transformation in the codebase: rejects bare M54.5 as `non_billable_parent` and suggests M54.50. The validator does **not** check 7th-character integrity (it does not know which 7th character a given descriptor expects), nor whether an A-suffix code is appropriate for a given encounter context.

[src/lib/icd10/validation.ts:21-34](src/lib/icd10/validation.ts#L21-L34) — `validateIcd10Code` returns one of `{ ok: true } | { ok: false, reason: 'structure' } | { ok: false, reason: 'non_billable_parent', suggestion }`. Used in:
- [src/lib/icd10/parse-ivn-diagnoses.ts:17](src/lib/icd10/parse-ivn-diagnoses.ts#L17) — drops lines whose first token fails the structural regex.
- DiagnosisCombobox free-type path (per file comment line 1) — used for combobox warnings.

[src/lib/icd10/validation.ts:46-68](src/lib/icd10/validation.ts#L46-L68) — `MYELOPATHY_CODE_PATTERN` and `RADICULOPATHY_CODE_PATTERN` plus `classifyIcd10Code(code) → 'myelopathy'|'radiculopathy'|'other'`. Used by note-generation downgrade logic but NOT by any 7th-character or external-cause validator.

### 6. ICD-10 → anatomy classifier (procedure_defaults fallback)

[src/lib/procedures/diagnosis-anatomy.ts:9-27](src/lib/procedures/diagnosis-anatomy.ts#L9-L27) — `ICD10_ANATOMY_PATTERNS` maps code prefix → anatomy_key (sacroiliac / cervical_facet / thoracic_facet / lumbar_facet / knee / shoulder / hip / ankle).

[src/lib/procedures/diagnosis-anatomy.ts:42-57](src/lib/procedures/diagnosis-anatomy.ts#L42-L57) — `singleAnatomyFromDiagnoses`. Per the inline comment at line 42:
> "Unclassified codes (e.g. external-cause V/W/X/Y, sprains S-codes filtered above) are ignored — they don't veto a single-anatomy match drawn from the remaining codes."

This is the only place external-cause codes are explicitly recognized as a class — purely to skip them in the anatomy lookup, not to validate continuity across notes.

### 7. UI surface for QC findings

[src/components/clinical/qc-review-panel.tsx](src/components/clinical/qc-review-panel.tsx) renders findings. Notable lines:
- [src/components/clinical/qc-review-panel.tsx:180](src/components/clinical/qc-review-panel.tsx#L180) — "Reviews the full case workflow chain. Reads finalized notes plus extractions."
- [src/components/clinical/qc-review-panel.tsx:390](src/components/clinical/qc-review-panel.tsx#L390) — "No findings — chain is clean." (empty-state copy when no findings remain after override-resolution).

### 8. Finding hash + override map

[src/lib/validations/case-quality-review.ts:101-111](src/lib/validations/case-quality-review.ts#L101-L111) — `computeFindingHash` is sha256 over `severity|step|note_id|procedure_id|section_key|message`. The `message` field is hashed verbatim, so any reword by Opus on regen produces a different hash and breaks override carry-over. This is the explicit design — comment at line 96-100 notes overrides are wiped on regen anyway.

[src/lib/validations/case-quality-review.ts:62-78](src/lib/validations/case-quality-review.ts#L62-L78) — `findingOverrideEntrySchema` with `status ∈ {acknowledged, dismissed, edited, resolved}`, plus `resolved_at` and `resolution_source ∈ {auto_recheck, manual_verify, manual_resolve}` (both default null when status≠resolved).

## Code References

- `src/lib/claude/generate-quality-review.ts:97-129` — full QC system prompt; Rule 1 at line 109 is the source of both flag strings in the question
- `src/lib/claude/generate-quality-review.ts:131-181` — `generate_case_quality_review` Anthropic tool schema
- `src/lib/claude/generate-quality-review.ts:196-245` — `generateQualityReviewFromData` Claude call
- `src/lib/validations/case-quality-review.ts:26-44` — `qualityFindingSchema` + `qualityReviewResultSchema`
- `src/lib/validations/case-quality-review.ts:101-111` — `computeFindingHash`
- `src/actions/case-quality-reviews.ts:28-271` — `gatherSourceData` (what the reviewer sees)
- `src/actions/case-quality-reviews.ts:273-416` — `runCaseQualityReview` orchestrator + override carry-over
- `src/actions/case-quality-reviews.ts:655-752` — `verifyFinding` deterministic resolution dispatch
- `src/lib/claude/generate-initial-visit.ts:130-134` — accident_type → V/W external-cause code mapping
- `src/lib/claude/generate-initial-visit.ts:179-201` — initial-visit A-suffix sprain reference + DIAGNOSTIC-SUPPORT (A)/(B)/(C)
- `src/lib/claude/generate-procedure-note.ts:593-611` — procedure-note Filters A-E (A = external-cause omission, D = A-suffix sprain handling)
- `src/lib/claude/generate-procedure-note.ts:613-649` — DOWNGRADE TABLE + worked example
- `src/lib/claude/generate-discharge-note.ts:401-427` — discharge Filters A-G (A = external-cause omission, D = no A-suffix at discharge, F = M54.5 specificity)
- `src/lib/icd10/validation.ts:8` — `ICD10_STRUCTURAL_REGEX` (shape only)
- `src/lib/icd10/validation.ts:13-15` — `NON_BILLABLE_PARENT_CODES` (M54.5 → M54.50 only)
- `src/lib/icd10/parse-ivn-diagnoses.ts:11-25` — IVN diagnosis line parser
- `src/lib/procedures/diagnosis-anatomy.ts:9-27` — ICD10_ANATOMY_PATTERNS
- `src/components/clinical/qc-review-panel.tsx:390` — "No findings — chain is clean." empty state
- `src/lib/claude/extract-pain-management.ts:13`, `extract-chiro.ts:10`, `extract-orthopedic.ts:13`, `extract-pt.ts:17` — verbatim 7th-character extraction rule

## Architecture Documentation

ICD-10 7th-character & external-cause-chain integrity is enforced at three layers, each implemented as LLM system-prompt rules rather than deterministic post-hoc validators:

1. **Extraction layer (write side)** — Each extraction prompt instructs Claude to copy 7th characters verbatim from source PDFs. No structural enforcement here beyond what the model produces.

2. **Note-generation layer (transform side)** — Per-note-type DIAGNOSTIC-SUPPORT RULE blocks tell the generation LLM which suffix variants are appropriate for that note's encounter context: A-suffix on initial visit, prefer D-suffix on later procedure visits, prefer D/S at discharge, omit V/W/X/Y external-cause codes on procedure & discharge. Downgrade tables specify replacement codes when filters omit a candidate, with framework-awareness (TRAUMATIC vs DEGENERATIVE-WITH-SUPERIMPOSED-TRAUMA).

3. **QC review layer (audit side)** — A separate Opus-4.7 call reads the full note chain plus extractions and emits free-text findings paraphrased from the QC system prompt's Rule 1. The two flag strings in the research question are LLM-generated paraphrases of:
   - "External cause code continuity" ← the cross-note expectation that V/W/X/Y appears at IV but is omitted at procedure/discharge
   - "ICD-10 7th-character integrity / suffix vs descriptor" ← the M54.5-specificity + A-suffix-at-discharge rules

The deterministic ICD-10 validator at `src/lib/icd10/validation.ts` only checks structural shape and the single non-billable parent code M54.5. It is not a 7th-character integrity check.

Findings are persisted to `case_quality_reviews.findings` (jsonb) and a parallel `finding_overrides` jsonb keyed by sha256 finding hash holds the provider's review state (acknowledged / dismissed / edited / resolved). On recheck the override layer is auto-merged: hashes that disappear flip to `resolved` with `resolution_source='auto_recheck'`, hashes that persist keep the user's prior state. `verifyFinding` deterministic-resolves only `step='procedure'` (plan_alignment_status check) and `step='discharge'` (trajectory_warnings empty check) — diagnosis-progression findings always require `markFindingResolved` (manual).

## Related Research

- [thoughts/shared/research/2026-04-20-diagnostic-accuracy-icd-selection.md](thoughts/shared/research/2026-04-20-diagnostic-accuracy-icd-selection.md) — full diagnostic-accuracy pipeline incl. extraction → suggestion → note-generation merging
- [thoughts/shared/research/2026-04-21-pm-diagnosis-mri-exam-support-flow.md](thoughts/shared/research/2026-04-21-pm-diagnosis-mri-exam-support-flow.md) — PM diagnosis MRI/exam support flow
- [thoughts/shared/research/2026-04-23-lapi-pm-report-zod-failure.md](thoughts/shared/research/2026-04-23-lapi-pm-report-zod-failure.md) — example of A-suffix codes (S13.9XXA, S43.409A, S39.021A, S33.5XXA) preserved through extraction
- [thoughts/shared/plans/2026-04-28-case-quality-review-agent.md](thoughts/shared/plans/2026-04-28-case-quality-review-agent.md) — implementation plan for the case-level QC reviewer agent

## Open Questions

- Whether downstream consumers (any future deterministic post-hoc validator) should police 7th-character ↔ descriptor consistency rather than rely on LLM paraphrase. Currently no such validator exists.
- Whether external-cause-chain continuity (V/W code present at IV → absent at procedure/discharge) should be auto-resolvable via `verifyFinding` rather than `markFindingResolved`. Today only `procedure` (plan_alignment_status) and `discharge` (trajectory_warnings) findings auto-verify.
