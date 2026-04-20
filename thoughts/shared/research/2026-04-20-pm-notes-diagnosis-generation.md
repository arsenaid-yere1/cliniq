---
date: 2026-04-20T23:29:58Z
researcher: arsenaid
git_commit: 6a3fc1c17bdbccf6e2acac083575dea9ecd80f97
branch: main
repository: cliniq
topic: "How can we improve Pain Management notes to strengthen diagnosis generation (MRI/exam-aligned coding, myelopathy/radiculopathy discipline)"
tags: [research, codebase, pain-management, icd10, diagnosis, myelopathy, radiculopathy, procedure-note, discharge-note, initial-visit, case-summary]
status: complete
last_updated: 2026-04-20
last_updated_by: arsenaid
---

# Research: Pain Management Notes → Diagnosis Generation Pipeline

**Date**: 2026-04-20T23:29:58Z
**Researcher**: arsenaid
**Git Commit**: 6a3fc1c17bdbccf6e2acac083575dea9ecd80f97
**Branch**: main
**Repository**: cliniq

## Research Question
How can we improve Pain Management notes to strengthen diagnosis generation — specifically: (a) remove unsupported myelopathy coding when no cord signal change and no UMN signs; substitute cervical disc displacement without myelopathy; (b) reframe lumbar radiculopathy as "radicular symptoms" / "possible nerve root irritation" unless objective deficits or confirmed impingement; (c) ensure ICD codes reflect documented findings only, no overdiagnosis beyond imaging/exam correlation.

This document describes the **current state** of the pipeline that produces PM-related diagnoses — extraction, storage, review, merging, and downstream note generation — without proposing changes.

## Summary

Pain Management diagnoses enter the system through a **verbatim-copy extraction model**: Claude Sonnet 4.6 parses the PM evaluation PDF and emits `{ icd10_code, description }` pairs exactly as written in the source document, with no correlation against MRI findings or physical exam at extraction time ([extract-pain-management.ts:5-19](src/lib/claude/extract-pain-management.ts#L5-L19)). MRI/exam correlation is deferred to two downstream places:

1. **Case summary generation** (`generate-summary.ts`) applies an **ICD-10 OBJECTIVE-SUPPORT RUBRIC** (Rule 8a) that assigns high/medium/low confidence to radiculopathy and myelopathy codes based on imaging + exam evidence across all five extraction sources (MRI, chiro, PM, PT, ortho).

2. **Note generation prompts** (`generate-procedure-note.ts`, `generate-discharge-note.ts`, `generate-initial-visit.ts`) apply a **DIAGNOSTIC-SUPPORT RULE** with explicit filters:
   - Filter (B) — **Myelopathy guard**: omits M50.00/.01/.02, M47.1X, M54.18 unless UMN signs (hyperreflexia, clonus, Hoffmann, Babinski, spastic gait, bowel/bladder dysfunction) are documented. Downgrade: **M50.20 Other cervical disc displacement**.
   - Filter (C) — **Radiculopathy guard**: requires region-matched objective findings (Spurling for cervical, SLR + leg radiation for lumbar, matching dermatome/myotome/reflex). Downgrade: M50.12X → M50.20; M51.17 → M51.37; M51.16 → M51.36.

The core substitution target requested in the research question (**"cervical disc displacement without myelopathy"** = M50.20) is already the mandated downgrade for both myelopathy and cervical radiculopathy failures in procedure-note and discharge-note prompts. The reframing of lumbar radiculopathy to "radicular symptoms" is **not** currently encoded — the prompt instead downgrades to M51.36/M51.37 (Other intervertebral disc degeneration) while keeping the region pain code (M54.5x), not to a "radicular symptoms" descriptor.

Key gap in the current system: **PM extraction itself has no diagnostic discipline** — it copies whatever the source document says. The entire filtering/downgrading burden is on the note-generation prompts, which consume `pmExtraction.diagnoses` as one of several candidate sources. An unsupported myelopathy code on the PM PDF will pass through extraction, be surfaced in the `DiagnosisCombobox` via `getCaseDiagnoses()`, and only be filtered out when the procedure/discharge note is generated (and only if the current visit's exam lacks UMN signs).

## Detailed Findings

### 1. PM PDF Extraction Stage — Verbatim Copy, No Correlation

**Extraction prompt** ([extract-pain-management.ts:5-19](src/lib/claude/extract-pain-management.ts#L5-L19)) has 11 rules. Rule 5 is the diagnosis rule:

> "Extract ALL diagnosis codes exactly as written, including the ICD-10 7th character."

Rule 8 explicitly separates MRI from PM extraction:

> "For diagnostic studies, summarize referenced imaging findings — do not re-extract MRI data in detail (that's handled by MRI extraction)."

**Tool schema** ([extract-pain-management.ts:90-100](src/lib/claude/extract-pain-management.ts#L90-L100)) accepts `diagnoses: { icd10_code: string, description: string }[]` with no format validation, no laterality field, no source-correlation field, no confidence field.

**Zod schema** ([pain-management-extraction.ts:42-45](src/lib/validations/pain-management-extraction.ts#L42-L45)):

```ts
const diagnosisSchema = z.object({
  icd10_code: z.string().nullable(),
  description: z.string(),
})
```

**Physical exam schema** ([pain-management-extraction.ts:32-38](src/lib/validations/pain-management-extraction.ts#L32-L38)) captures `region`, `palpation_findings`, `range_of_motion[]`, `orthopedic_tests[]` (with `result: 'positive' | 'negative'`), `neurological_summary` (free-text) — but has **no explicit field for UMN signs, reflex grading, dermatomal/myotomal deficits**. These details live inside free-text `neurological_summary` or the named orthopedic tests.

**MRI correlation at extraction:** captured only as `diagnostic_studies_summary: string | null` ([extract-pain-management.ts:119-122](src/lib/claude/extract-pain-management.ts#L119-L122)). No structured link from a diagnosis to an imaging finding.

**Tests** ([extract-pain-management.test.ts](src/lib/claude/__tests__/extract-pain-management.test.ts)) assert only that `callClaudeTool` is invoked with the right model/toolName and that errors propagate. No tests for diagnosis filtering, MRI correlation, or myelopathy/radiculopathy rules at the extraction layer.

### 2. PM Review UI — Free-Text Editing, Overrides Precedence

**Review shell** ([pm-extraction-review.tsx:75-80](src/components/clinical/pm-extraction-review.tsx#L75-L80)) applies an overrides-first precedence: `overrides?.diagnoses ?? extraction.diagnoses`.

**Edit form** ([pm-extraction-form.tsx:467-529](src/components/clinical/pm-extraction-form.tsx#L467-L529)) exposes each diagnosis as two free-text inputs (`icd10_code`, `description`) with no format validation, no correlation hint, no confidence selection. Add/remove buttons at [pm-extraction-form.tsx:474](src/components/clinical/pm-extraction-form.tsx#L474) and [pm-extraction-form.tsx:492](src/components/clinical/pm-extraction-form.tsx#L492).

**Approval paths** ([pain-management-extractions.ts:165-233](src/actions/pain-management-extractions.ts#L165-L233)):
- `approve` (no edits) → `review_status: 'approved'`; original AI `diagnoses` column unchanged.
- `saveAndApprove` (edits) → writes full form to `provider_overrides` JSONB, sets `review_status: 'edited'`; the `diagnoses` column is never updated with overrides.
- `reject` → `review_status: 'rejected'`.

**Consequence for downstream merging**: `getCaseDiagnoses()` filters on `review_status='approved'` only ([procedures.ts:175-183](src/actions/procedures.ts#L175-L183)), so `'edited'` records are excluded from the procedure form combobox suggestions. The discharge note query accepts both `'approved'` and `'edited'` but reads the `diagnoses` column, not `provider_overrides` ([discharge-notes.ts:87-94](src/actions/discharge-notes.ts#L87-L94)).

### 3. Diagnosis Merge Layer — `getCaseDiagnoses`

[procedures.ts:171-242](src/actions/procedures.ts#L171-L242) is the sole aggregation point where PM diagnoses meet the procedure form.

Pipeline:
1. Fetch most recent **approved** PM extraction's `diagnoses`.
2. Validate each code via `validateIcd10Code` — drop structurally invalid ([procedures.ts:197-204](src/actions/procedures.ts#L197-L204)).
3. Normalize via `normalizeIcd10Code` — non-billable parents (currently only `M54.5 → M54.50`) are silently promoted.
4. Fetch preferred Initial Visit Note (preferring `pain_evaluation_visit` over `initial_visit`), parse ICD-10 codes from its `diagnoses` text field with regex `/^[•\-\d.]*\s*([A-Z]\d{1,2}\.?\d{0,4}[A-Z]{0,2})\s*[—–\-]\s*(.+)$/i`.
5. Deduplicate uppercase-insensitive; **PM wins conflicts** ([procedures.ts:234-239](src/actions/procedures.ts#L234-L239)).

Result populates `DiagnosisCombobox` ([diagnosis-combobox.tsx](src/components/procedures/diagnosis-combobox.tsx)). Provider selection is stored in `procedures.diagnoses` JSONB.

### 4. ICD-10 Validation Layer

[icd10/validation.ts:8-41](src/lib/icd10/validation.ts#L8-L41):

```ts
const ICD10_STRUCTURAL_REGEX = /^[A-Z]\d{2}(\.\d{1,4}[A-Z]{0,2}|\.?[A-Z0-9]{0,4})?$/i

export const NON_BILLABLE_PARENT_CODES: Record<string, string> = {
  'M54.5': 'M54.50',
}
```

Currently only one parent-code remap. No code-semantic checks (e.g., M50.00 requires UMN support, M54.12 requires cervical radic findings) — those live exclusively in the note-generation prompts.

### 5. Procedure Note — DIAGNOSTIC-SUPPORT RULE

[generate-procedure-note.ts:448-503](src/lib/claude/generate-procedure-note.ts#L448-L503) is the authoritative filter.

**Preamble (line 448):**
> "The diagnosis list in this procedure note is a FILTERED output, not a copy of the input. Apply the filters below to every candidate code regardless of whether it came from procedureRecord.diagnoses or pmExtraction.diagnoses. Omit any code that fails its filter — if a code is unsupported, substitute the downgrade listed below rather than just dropping it."

**Filter (A)** — V/W/X/Y external-cause codes: absolute omission.

**Filter (B) — Myelopathy guard (line 452):**
> "Myelopathy codes — require documented upper motor neuron signs. Omit 'myelopathy' codes (e.g., M50.00, M50.01, M50.02, M47.1X, M54.18) unless the objective_physical_exam on this visit's input data documents at least one of: hyperreflexia, clonus, Hoffmann sign, Babinski sign, spastic gait, or bowel/bladder dysfunction. Isolated subjective paresthesia, intact sensation, symmetric 2+ reflexes, and 5/5 strength do NOT support myelopathy."

**Filter (C) — Radiculopathy guard (lines 454-456):** Requires region-matched objective findings.
- Cervical (M50.1X): Spurling, C5-T1 dermatomal deficit, UE myotomal weakness, or diminished biceps/triceps/brachioradialis reflex. Explicit: "A positive straight-leg raise is a LUMBAR test and does NOT support a cervical radiculopathy code."
- Lumbar (M51.1X): SLR positive AND reproducing radicular leg symptoms (NOT just low back pain), L4-S1 dermatomal deficit, LE myotomal weakness, or diminished patellar/Achilles reflex. Explicit: "SLR reproducing 'low back pain' alone does NOT qualify."

**Filter (D)** — Encounter-suffix filter (A→D suffix on repeat visits).

**Filter (E) — Current-visit support requirement (lines 460-467):** Every retained code must be backed by THIS visit's subjective/ROS/exam. Includes specific guards for M54.6, G47.9, G44.309, M79.1, M54.2, M54.5, M54.6.

**Downgrade Table (lines 469-473):**
```
• M50.12X (cervical radiculopathy) → M50.20 (Other cervical disc displacement) + keep M54.2
• M51.17 (lumbosacral disc w/ radiculopathy) → M51.37 + keep M54.5
• M51.16 (lumbar disc w/ radiculopathy) → M51.36 + keep M54.5
• M50.00 (cervical disc w/ myelopathy) → M50.20 + keep M54.2
```

**M50.20 "Other cervical disc displacement, unspecified level"** is thus the universal cervical downgrade target for both myelopathy and radiculopathy filter failures — directly matching the substitution requested in the research question.

**Prior-note continuity:** [generate-procedure-note.ts:229-244](src/lib/claude/generate-procedure-note.ts#L229-L244) instructs that prior `assessment_and_plan` content is lower precedence than current filters — stale myelopathy/radiculopathy codes in prior notes must be dropped or downgraded this visit.

**MRI in procedure note** ([generate-procedure-note.ts:354-369](src/lib/claude/generate-procedure-note.ts#L354-L369)):
- Section 9 (`assessment_summary`): "linking exam findings to MRI/imaging"
- Section 10 (`procedure_indication`): MRI justifies injection targets but doesn't override exam-based diagnosis filters

**Tests** ([generate-procedure-note.test.ts:371-424](src/lib/claude/__tests__/generate-procedure-note.test.ts#L371-L424)) assert prompt contains: `'myelopathy'`, `'upper motor neuron signs'`, `'radiculopathy'`, `'dermatomal sensory deficit'`, `'REGION-MATCHED objective findings'`, the exact SLR-as-lumbar rejection sentence, the lumbar leg-symptoms requirement, the downgrade codes M50.12X/M50.20/M51.17/M51.37/M51.16/M51.36, and a WORKED EXAMPLE naming M50.00 as Filter (B) OMIT and M50.121 as Filter (C) OMIT.

### 6. Discharge Note — DIAGNOSTIC-SUPPORT RULE (widened evidence window)

[generate-discharge-note.ts:303-322](src/lib/claude/generate-discharge-note.ts#L303-L322).

**Filter (B) Myelopathy (line 307):** Same criteria as procedure note; downgrade to M50.20.

**Filter (C) Radiculopathy (lines 309-312):** Identical exam criteria, but evidence window is widened to "any finalized procedure note or in case_summary source docs" — not just THIS visit. Downgrades identical.

**Filter (G) Symptom-resolution at discharge:** Codes whose symptoms have fully resolved should be omitted or shifted to sequela "S"-suffix.

**Candidate sources (line 303):** `procedure.diagnoses`, `case_summary.suggested_diagnoses`, `pmExtraction.diagnoses`.

### 7. Initial Visit & Pain Evaluation Visit — Two Sub-Rules

[generate-initial-visit.ts](src/lib/claude/generate-initial-visit.ts) branches on `visitType`.

**First visit (`initial_visit`) at lines 161-185:**
- [line 172](src/lib/claude/generate-initial-visit.ts#L172): "Do NOT use disc displacement codes (M50.20, M51.16, etc.) — those require imaging confirmation."
- [line 183](src/lib/claude/generate-initial-visit.ts#L183): "Radiculopathy — do NOT emit M54.12, M54.17, M50.1X, or M51.1X at the first visit. These codes require imaging confirmation and region-matched objective findings, which are not available at initial presentation. Use the strain/sprain codes and region pain codes above instead."
- Myelopathy not separately named — implicitly prohibited via the disc-code prohibition.

**Pain evaluation visit (`pain_evaluation_visit`) at lines 284-300:**
- Filter (A) — Radiculopathy filter with identical exam criteria to procedure note; downgrades M50.1X→M50.20 + M54.2, M51.17→M51.37, M51.16→M51.36.
- Filter (D) — `suggested_diagnoses` confidence handling: "prefer 'high'-confidence entries that match imaging + exam. For 'medium'-confidence entries, require the same imaging + objective-finding support the filters above demand. OMIT 'low'-confidence entries unless independent imaging + exam evidence supports them."
- No explicit myelopathy filter — but common-codes table at [line 273](src/lib/claude/generate-initial-visit.ts#L273) lists M50.20 as valid; myelopathy filtering happens implicitly via the rubric/confidence filter.

**PM data is NOT directly queried by initial-visit generation** ([initial-visit-notes.ts:60-269](src/actions/initial-visit-notes.ts#L60-L269)) — PM reaches initial-visit only indirectly via `caseSummary.suggested_diagnoses` (which had the OBJECTIVE-SUPPORT RUBRIC applied upstream) and via `hasApprovedDiagnosticExtractions` (a boolean gate for MRI/CT presence).

### 8. Case Summary — OBJECTIVE-SUPPORT RUBRIC (Rule 8a)

[generate-summary.ts:17-21](src/lib/claude/generate-summary.ts#L17-L21) is the upstream confidence-tagging layer. Applied once when generating `case_summaries.suggested_diagnoses`:

> "Radiculopathy codes (M54.12, M54.17, M50.1X, M51.1X): 'high' requires BOTH (i) imaging showing nerve-root compromise in the matching region AND (ii) at least one region-matched objective finding in source docs — positive Spurling (cervical) or SLR reproducing radicular LEG symptoms (lumbar), dermatomal sensory deficit in the matching roots, myotomal weakness in the matching root distribution, or a diminished reflex in the matching root. 'medium' requires imaging evidence plus subjective radiation in the matching dermatome WITHOUT documented objective finding. 'low' when only subjective radiation is present (no imaging correlate or no objective finding in the same region)."

> "Myelopathy codes (M50.00/.01/.02, M47.1X, M54.18): 'high' requires imaging of cord compression AND at least one upper-motor-neuron sign in source docs (hyperreflexia, clonus, Hoffmann, Babinski, spastic gait, or bowel/bladder dysfunction). 'medium' when imaging shows cord contact but no UMN sign is documented. 'low' when neither is documented."

Line 23: "Do not drop diagnoses based on this rubric — tag them with the correct confidence and populate supporting_evidence accordingly. Downstream note generators rely on confidence + evidence to decide whether to emit each code."

**Cross-source consolidation (Rule 12, line 27):** "Cross-reference diagnoses across all sources. If MRI, chiro, PM, PT, and orthopedic all reference the same condition, consolidate into a single diagnosis entry with higher confidence."

**Sources cross-correlated:** `mriExtractions`, `chiroExtractions`, `pmExtractions`, `ptExtractions`, `orthoExtractions` ([generate-summary.ts:177-241](src/lib/claude/generate-summary.ts#L177-L241)).

### 9. Where "Radicular Symptoms" / "Possible Nerve Root Irritation" Language Currently Lives

**Grep result:** The phrases "radicular symptoms", "possible nerve root irritation", and "nerve root irritation" do **not** appear anywhere in the codebase prompts or tests. The current prompts always downgrade failed radiculopathy codes to a **disc-degeneration code** (M51.36/M51.37/M50.20) plus a **region pain code** (M54.2/M54.5x), not to a descriptive "radicular symptoms" phrase.

The only prose approximation is in the lumbar radiculopathy filter's requirement wording: "reproducing radicular leg symptoms (pain radiating down the leg, paresthesia below the knee…)" — which is a gating criterion for KEEPING M51.1X, not a descriptor for replacing it.

### 10. Data Flow Summary

```
PDF (Supabase: case-documents/)
  └─► extractPainManagementReport()  [actions/pain-management-extractions.ts:11]
        └─► extractPainManagementFromPdf  [claude/extract-pain-management.ts]
              • Rule 5: extract codes exactly as written
              • NO MRI/exam correlation at this stage
              └─► pain_management_extractions.diagnoses  (JSONB)

pain_management_extractions.diagnoses
  └─► PmExtractionReview  [pm-extraction-review.tsx:54]
        • overrides_first: provider_overrides.diagnoses ?? extraction.diagnoses
        └─► PmExtractionForm  [pm-extraction-form.tsx]
              • free-text edit of icd10_code + description
              • no validation, no correlation hint
              ├─► approve → diagnoses unchanged, review_status=approved
              ├─► saveAndApprove → provider_overrides=edited, review_status=edited
              └─► reject → review_status=rejected

pain_management_extractions [approved only]
  └─► getCaseDiagnoses()  [actions/procedures.ts:171]
        • validateIcd10Code + normalizeIcd10Code (structural + non-billable-parent)
        • merge with IVN-parsed codes (PM wins dedup)
        └─► DiagnosisCombobox  [procedures/diagnosis-combobox.tsx]
              └─► procedures.diagnoses  (JSONB, provider-committed)

pain_management_extractions [approved]
  └─► gatherProcedureNoteSourceData()  [actions/procedure-notes.ts:31]
        • inputData.pmExtraction = { chief_complaints, physical_exam,
                                     diagnoses, treatment_plan,
                                     diagnostic_studies_summary }
        • inputData.procedureRecord.diagnoses = procedures.diagnoses
        • inputData.mriExtractions = [...]
        └─► generateProcedureNoteFromData()  [claude/generate-procedure-note.ts]
              • DIAGNOSTIC-SUPPORT RULE filters A-E applied here
              • Myelopathy + radiculopathy downgrades to M50.20/M51.36/M51.37
              └─► procedure_notes.{assessment_summary, assessment_and_plan}

pain_management_extractions [approved OR edited]
  └─► gatherDischargeNoteSourceData()  [actions/discharge-notes.ts:32]
        • inputData.pmExtraction = { ..., diagnoses, ... }
        • inputData.procedures[].diagnoses (per-procedure)
        └─► generateDischargeNoteFromData()
              • DIAGNOSTIC-SUPPORT RULE filters A-G applied
              • Evidence window widened across treatment course
              └─► discharge_notes.{diagnoses, assessment}

case_summaries.suggested_diagnoses
  └─► generateSummaryFromData()  [claude/generate-summary.ts]
        • Rule 8a OBJECTIVE-SUPPORT RUBRIC (high/medium/low confidence tagging)
        • Rule 12 cross-source consolidation
        • Uses MRI + chiro + PM + PT + ortho extractions
        └─► consumed by generate-initial-visit.ts (pain_evaluation_visit)
              with suggested_diagnoses confidence gating
```

## Code References

### Extraction (no correlation, verbatim)
- [src/lib/claude/extract-pain-management.ts:5-19](src/lib/claude/extract-pain-management.ts#L5-L19) — 11-rule system prompt; Rule 5 (verbatim ICD), Rule 8 (imaging-only-as-summary)
- [src/lib/claude/extract-pain-management.ts:90-100](src/lib/claude/extract-pain-management.ts#L90-L100) — tool schema: `diagnoses[{icd10_code, description}]`
- [src/lib/claude/extract-pain-management.ts:119-122](src/lib/claude/extract-pain-management.ts#L119-L122) — `diagnostic_studies_summary` free-text field
- [src/lib/claude/extract-pain-management.ts:140-206](src/lib/claude/extract-pain-management.ts#L140-L206) — normalize + validate
- [src/lib/validations/pain-management-extraction.ts:42-45](src/lib/validations/pain-management-extraction.ts#L42-L45) — `diagnosisSchema`
- [src/lib/validations/pain-management-extraction.ts:32-38](src/lib/validations/pain-management-extraction.ts#L32-L38) — `physicalExamRegionSchema`

### Storage + Review
- [src/actions/pain-management-extractions.ts:11-101](src/actions/pain-management-extractions.ts#L11-L101) — extraction trigger
- [src/actions/pain-management-extractions.ts:103-129](src/actions/pain-management-extractions.ts#L103-L129) — success write
- [src/actions/pain-management-extractions.ts:165-233](src/actions/pain-management-extractions.ts#L165-L233) — approve/saveAndApprove paths
- [src/components/clinical/pm-extraction-review.tsx:75-80](src/components/clinical/pm-extraction-review.tsx#L75-L80) — overrides-first precedence
- [src/components/clinical/pm-extraction-form.tsx:467-529](src/components/clinical/pm-extraction-form.tsx#L467-L529) — Diagnoses tab free-text editor

### Merge + Validation
- [src/actions/procedures.ts:171-242](src/actions/procedures.ts#L171-L242) — `getCaseDiagnoses` full merge
- [src/actions/procedures.ts:197-204](src/actions/procedures.ts#L197-L204) — structural validation + normalize
- [src/lib/icd10/validation.ts:8](src/lib/icd10/validation.ts#L8) — `ICD10_STRUCTURAL_REGEX`
- [src/lib/icd10/validation.ts:13-15](src/lib/icd10/validation.ts#L13-L15) — `NON_BILLABLE_PARENT_CODES` (only `M54.5 → M54.50`)
- [src/lib/icd10/validation.ts:21-41](src/lib/icd10/validation.ts#L21-L41) — `validateIcd10Code` + `normalizeIcd10Code`

### Procedure Note (DIAGNOSTIC-SUPPORT RULE — the core enforcement site)
- [src/lib/claude/generate-procedure-note.ts:448-503](src/lib/claude/generate-procedure-note.ts#L448-L503) — full rule text
- [src/lib/claude/generate-procedure-note.ts:452](src/lib/claude/generate-procedure-note.ts#L452) — Filter (B) myelopathy guard
- [src/lib/claude/generate-procedure-note.ts:454-456](src/lib/claude/generate-procedure-note.ts#L454-L456) — Filter (C) radiculopathy guard
- [src/lib/claude/generate-procedure-note.ts:469-473](src/lib/claude/generate-procedure-note.ts#L469-L473) — Downgrade Table (M50.20 as cervical substitute)
- [src/lib/claude/generate-procedure-note.ts:229-244](src/lib/claude/generate-procedure-note.ts#L229-L244) — prior-note lower precedence
- [src/lib/claude/generate-procedure-note.ts:354-369](src/lib/claude/generate-procedure-note.ts#L354-L369) — MRI referenced in assessment_summary + procedure_indication
- [src/actions/procedure-notes.ts:354-362](src/actions/procedure-notes.ts#L354-L362) — pmExtraction assembly

### Discharge Note
- [src/lib/claude/generate-discharge-note.ts:303-322](src/lib/claude/generate-discharge-note.ts#L303-L322) — full DIAGNOSTIC-SUPPORT RULE (A-G)
- [src/lib/claude/generate-discharge-note.ts:307](src/lib/claude/generate-discharge-note.ts#L307) — Filter (B) myelopathy
- [src/lib/claude/generate-discharge-note.ts:309-312](src/lib/claude/generate-discharge-note.ts#L309-L312) — Filter (C) radiculopathy with widened evidence window
- [src/actions/discharge-notes.ts:87-94](src/actions/discharge-notes.ts#L87-L94) — PM query (approved OR edited)
- [src/actions/discharge-notes.ts:352-358](src/actions/discharge-notes.ts#L352-L358) — pmExtraction assembly

### Initial Visit + Pain Evaluation Visit
- [src/lib/claude/generate-initial-visit.ts:161-185](src/lib/claude/generate-initial-visit.ts#L161-L185) — first-visit specifics (disc codes + radiculopathy prohibited)
- [src/lib/claude/generate-initial-visit.ts:172](src/lib/claude/generate-initial-visit.ts#L172) — "Do NOT use disc displacement codes"
- [src/lib/claude/generate-initial-visit.ts:183](src/lib/claude/generate-initial-visit.ts#L183) — "do NOT emit M54.12, M54.17, M50.1X, or M51.1X at the first visit"
- [src/lib/claude/generate-initial-visit.ts:284-300](src/lib/claude/generate-initial-visit.ts#L284-L300) — pain eval visit filters including radiculopathy + confidence handling

### Case Summary (upstream confidence tagging)
- [src/lib/claude/generate-summary.ts:17-21](src/lib/claude/generate-summary.ts#L17-L21) — Rule 8a OBJECTIVE-SUPPORT RUBRIC
- [src/lib/claude/generate-summary.ts:27](src/lib/claude/generate-summary.ts#L27) — Rule 12 cross-source consolidation
- [src/lib/claude/generate-summary.ts:29](src/lib/claude/generate-summary.ts#L29) — Rule 14 orthopedic incorporation

### Tests asserting current myelopathy/radiculopathy behavior
- [src/lib/claude/__tests__/generate-procedure-note.test.ts:371-378](src/lib/claude/__tests__/generate-procedure-note.test.ts#L371-L378) — keyword presence (myelopathy, UMN, radiculopathy, dermatomal)
- [src/lib/claude/__tests__/generate-procedure-note.test.ts:391-401](src/lib/claude/__tests__/generate-procedure-note.test.ts#L391-L401) — region-matched Spurling + SLR-as-lumbar-only + leg-symptoms requirement
- [src/lib/claude/__tests__/generate-procedure-note.test.ts:403-411](src/lib/claude/__tests__/generate-procedure-note.test.ts#L403-L411) — Downgrade Table codes (M50.20/M51.37/M51.36)
- [src/lib/claude/__tests__/generate-procedure-note.test.ts:413-424](src/lib/claude/__tests__/generate-procedure-note.test.ts#L413-L424) — worked example M50.00→OMIT, M50.121→OMIT

## Architecture Documentation

### Layered diagnosis discipline model

The codebase currently implements diagnosis correlation as a **multi-layer filter** rather than a single choke point:

| Layer | Site | Correlation applied |
|---|---|---|
| 1. PM PDF extraction | `extract-pain-management.ts` | **None** — verbatim copy |
| 2. PM review UI | `pm-extraction-form.tsx` | None — free-text edit |
| 3. Structural validation | `icd10/validation.ts` + `procedures.ts:197-204` | Regex + non-billable-parent promotion only |
| 4. Case summary | `generate-summary.ts` Rule 8a | **Confidence tagging** (high/medium/low) across all 5 extraction sources |
| 5. Initial visit | `generate-initial-visit.ts` | First-visit: disc/radiculopathy codes prohibited. Pain eval: confidence gate + radiculopathy region-match filter |
| 6. Procedure note | `generate-procedure-note.ts` DIAGNOSTIC-SUPPORT RULE | **Hard filter** — myelopathy B, radiculopathy C, with M50.20 downgrade |
| 7. Discharge note | `generate-discharge-note.ts` DIAGNOSTIC-SUPPORT RULE | Same as procedure note with widened evidence window |

The cascade means a PM-sourced myelopathy or lumbar radiculopathy code CAN enter the `DiagnosisCombobox` (Layer 3 doesn't filter by semantics), and ONLY gets filtered out when a procedure or discharge note is generated AND the relevant UMN/radicular findings are absent from the current visit's exam.

### Substitution target mapping

| Research question request | Currently encoded as | Location |
|---|---|---|
| Remove unsupported myelopathy coding | Filter (B) in procedure + discharge prompts | `generate-procedure-note.ts:452`, `generate-discharge-note.ts:307` |
| Replace with "cervical disc displacement without myelopathy" | M50.20 (Other cervical disc displacement, unspecified level) | Downgrade Table `generate-procedure-note.ts:472` ("M50.00 → M50.20"); `generate-discharge-note.ts:307` |
| Reframe lumbar radiculopathy as "radicular symptoms" / "possible nerve root irritation" | **Not encoded** — instead downgraded to M51.36/M51.37 (disc degeneration) + M54.5x region pain code | Downgrade Table `generate-procedure-note.ts:470-471`; no prose substitution present |
| Ensure ICD codes reflect documented findings only | Filter (E) current-visit support + Filter (C) region-matched objective findings | `generate-procedure-note.ts:460-467`, `generate-procedure-note.ts:454-456` |
| Avoid overdiagnosis beyond imaging + exam correlation | Rule 8a OBJECTIVE-SUPPORT RUBRIC + DIAGNOSTIC-SUPPORT RULE cascade | `generate-summary.ts:17-21` + per-note prompts |

## Related Research
- [thoughts/shared/research/2026-04-20-diagnostic-accuracy-icd-selection.md](thoughts/shared/research/2026-04-20-diagnostic-accuracy-icd-selection.md) — ICD-10 code generation/filtering/merging across full note pipeline
- [thoughts/shared/research/2026-03-10-pain-management-pt-document-processing.md](thoughts/shared/research/2026-03-10-pain-management-pt-document-processing.md) — PM + PT extraction foundations
- [thoughts/shared/plans/2026-03-09-epic-2-story-2.3-pain-management-extraction.md](thoughts/shared/plans/2026-03-09-epic-2-story-2.3-pain-management-extraction.md) — original PM extraction plan

## Open Questions

1. **Extraction-layer discipline gap**: PM extraction copies verbatim; no mechanism exists to tag a PM-sourced code as "imaging/exam support unknown" so the UI or merger can signal provenance to reviewers.
2. **Edited-status handling**: `getCaseDiagnoses` filters on `review_status='approved'` only, excluding `'edited'` PM records from the procedure form combobox. Discharge-note query reads `diagnoses` column even for `'edited'` records, not `provider_overrides`. These two behaviors are not symmetric.
3. **Prose substitution for radiculopathy**: The codebase does not currently emit free-text phrases like "radicular symptoms" or "possible nerve root irritation" — it always downgrades to a disc-degeneration ICD code + region pain code. Any shift toward descriptive phrasing would require new prompt language and a new handling path (since prose descriptors don't map to the `{icd10_code, description}` emission contract).
4. **Initial-visit PM blindness**: `gatherSourceData` in `initial-visit-notes.ts` doesn't query PM extractions directly. PM data reaches initial-visit only via `caseSummary.suggested_diagnoses`. If PM data is newer than the last case summary regeneration, initial-visit note generation may lag.
5. **Provider-override precedence at generation time**: The procedure and discharge note generators read `diagnoses` (raw AI), not `provider_overrides`. Provider edits in `saveAndApprove` only reach downstream notes if the user re-approves without edits (updating `diagnoses`) or if the generator is updated to prefer `provider_overrides`.
