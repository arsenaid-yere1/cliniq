---
date: 2026-04-21T17:15:41Z
researcher: arsenaid
git_commit: 0faf8fd28114329c21d68b8adcc55d646bf1cb08
branch: main
repository: cliniq
topic: "Pain Management note Diagnosis section generation logic — MRI/exam support flow (myelopathy, radiculopathy)"
tags: [research, codebase, pain-management, diagnosis, icd10, myelopathy, radiculopathy, mri, exam-correlation, procedure-note, initial-visit, discharge-note, case-summary]
status: complete
last_updated: 2026-04-21
last_updated_by: arsenaid
---

# Research: Pain Management Notes → Diagnosis Generation Logic for Supporting Diagnosis from MRI/Exam

**Date**: 2026-04-21T17:15:41Z
**Researcher**: arsenaid
**Git Commit**: 0faf8fd28114329c21d68b8adcc55d646bf1cb08
**Branch**: main
**Repository**: cliniq

## Research Question

Check Pain Management notes generation logic for supporting diagnosis from MRI. User experienced two re-generations of the Diagnosis section to get correct output. Observed draft flaws:
- Myelopathy emitted without MRI cord signal change or exam UMN signs
- Radiculopathy inconsistently asserted then withdrawn (prose vs. code mismatch)

Document the **current pipeline** that produces PM-related diagnoses from extraction → case summary → note generation, with special focus on:
1. Where myelopathy is gated
2. Where radiculopathy is gated
3. How MRI findings and exam findings flow into the Diagnosis section
4. How `regenerateSection` re-runs the same rule set
5. Consistency rules linking code list and prose

This document describes WHAT EXISTS. No recommendations or critique.

## Summary

PM diagnoses traverse a **6-layer pipeline** with discipline applied at stages 4–6:

| Layer | File | Discipline on myelopathy/radiculopathy |
|---|---|---|
| 1. PM PDF extraction | [extract-pain-management.ts](src/lib/claude/extract-pain-management.ts) | Verbatim copy of source codes + per-code `imaging_support` / `exam_support` / `source_quote` tags (Rules 12–14) |
| 2. Review UI | [pm-extraction-review.tsx](src/components/clinical/pm-extraction-review.tsx), [pm-extraction-form.tsx](src/components/clinical/pm-extraction-form.tsx) | Free-text edit, no semantic filter |
| 3. Structural validation | [icd10/validation.ts](src/lib/icd10/validation.ts) | Regex + non-billable-parent (only `M54.5 → M54.50`). Classification patterns `MYELOPATHY_CODE_PATTERN` / `RADICULOPATHY_CODE_PATTERN` exported but no rejection |
| 4. Case summary | [generate-summary.ts](src/lib/claude/generate-summary.ts) | Rule 8a OBJECTIVE-SUPPORT RUBRIC — tags high/medium/low. Rule 8b DOWNGRADE PRECOMPUTE — populates `downgrade_to` per code |
| 5. Initial/PainEval visit note | [generate-initial-visit.ts](src/lib/claude/generate-initial-visit.ts) | First visit: disc + radiculopathy + myelopathy prohibited absolutely. PRP visit: Filters A–F with `downgrade_to` honor rule |
| 6. Procedure / Discharge note | [generate-procedure-note.ts](src/lib/claude/generate-procedure-note.ts), [generate-discharge-note.ts](src/lib/claude/generate-discharge-note.ts) | Filters B (myelopathy), C (radiculopathy), E (per-visit support), prose constraint, downgrade table |

Two observed flaws map to distinct enforcement sites:

**"Myelopathy not supported by MRI or exam"** — gated by:
- Case-summary Rule 8a: confidence `"high"` requires cord compression imaging + UMN sign; `"medium"` imaging-only cord contact; `"low"` neither ([generate-summary.ts:19](src/lib/claude/generate-summary.ts#L19))
- Case-summary Rule 8b: populates `downgrade_to="M50.20"` when UMN signs absent ([generate-summary.ts:25-31](src/lib/claude/generate-summary.ts#L25-L31))
- PRP initial visit Filter A: omit myelopathy codes unless UMN signs in THIS visit's `providerIntake.exam_findings` OR `pmExtraction.physical_exam` ([generate-initial-visit.ts:288](src/lib/claude/generate-initial-visit.ts#L288))
- Procedure note Filter B: identical UMN gate + downgrade to M50.20 / non-myelopathy stenosis code ([generate-procedure-note.ts:472](src/lib/claude/generate-procedure-note.ts#L472))
- Discharge note Filter B: same criteria ([generate-discharge-note.ts:307](src/lib/claude/generate-discharge-note.ts#L307))

**"Radiculopathy inconsistently asserted then withdrawn"** — the consistency rule between code list and prose:
- Procedure note Filter C PROSE-FALLBACK (MANDATORY): when a radiculopathy code is filtered out and downgraded, narrative prose must use `"radicular symptoms"` or `"possible nerve root irritation"` — **NEVER** `"radiculopathy"` or `"nerve root compression"` ([generate-procedure-note.ts:477](src/lib/claude/generate-procedure-note.ts#L477))
- Procedure note RADICULAR-PROSE CONSTRAINT at assessment_summary level: match prose to filtered code list; reserve `"radiculopathy"` for codes that PASS Filter C ([generate-procedure-note.ts:356](src/lib/claude/generate-procedure-note.ts#L356))
- Initial visit PRP prose consistency rule ([generate-initial-visit.ts:293](src/lib/claude/generate-initial-visit.ts#L293))

**Regeneration behavior:** `regenerateSection` / `regenerateProcedureNoteSection` use the **full SYSTEM_PROMPT unchanged** + section-specific suffix. All filters and prose constraints still apply. `regenerateProcedureNoteSection` additionally sends other already-finalized sections as `otherSectionsBlock` context (in a user-message block) so prose-vs-code consistency can be evaluated against finalized neighboring sections.

## Detailed Findings

### 1. PM PDF Extraction Stage — Structured Evidence Tags on Every Code

**File:** [src/lib/claude/extract-pain-management.ts](src/lib/claude/extract-pain-management.ts)

**Model:** `claude-sonnet-4-6` (tool-use)

System prompt rules for diagnosis (lines 5–28, verbatim):

> **Rule 5**: "Extract ALL diagnosis codes exactly as written, including the ICD-10 7th character."

> **Rule 12** (`imaging_support` tag):
> - `"confirmed"` if the report explicitly cites an MRI/CT finding that supports this specific code (e.g., "MRI shows C5-C6 disc herniation with cord contact" supporting a cervical disc code)
> - `"referenced"` if the report mentions imaging but does not tie a finding to this code
> - `"none"` if no imaging is cited for this code

> **Rule 13** (`exam_support` tag):
> - `"objective"` if the report documents an objective finding matching the code. **For myelopathy codes (M50.00/.01/.02, M47.1X, M54.18)**: require UMN sign (hyperreflexia, clonus, Hoffmann, Babinski, spastic gait, bowel/bladder dysfunction). **For radiculopathy codes (M50.1X, M51.1X, M54.12, M54.17)**: require region-matched finding — positive Spurling (cervical), SLR reproducing leg radiation (lumbar), dermatomal sensory deficit in matching roots, myotomal weakness in matching roots, or diminished matching reflex.
> - `"subjective_only"` if only patient-reported symptoms
> - `"none"` if no exam finding cited

> **Rule 14**: "Populate `source_quote` with the verbatim sentence from the PM report that establishes the strongest support for the code."

**Tool schema** (`EXTRACTION_TOOL.input_schema`, lines 99–122): `diagnoses[]` items require `{ icd10_code, description, imaging_support (confirmed|referenced|none), exam_support (objective|subjective_only|none), source_quote }` — all five fields mandatory.

### 2. Case Summary — OBJECTIVE-SUPPORT RUBRIC + DOWNGRADE PRECOMPUTE

**File:** [src/lib/claude/generate-summary.ts](src/lib/claude/generate-summary.ts)

**Model:** `claude-opus-4-6`

Synthesizes all five extraction sources (MRI, chiro, PM, PT, ortho + CT) into `CaseSummaryResult.suggested_diagnoses[]`.

**Diagnosis schema** ([case-summary.ts:37-47](src/lib/validations/case-summary.ts#L37-L47)): each entry carries `{ diagnosis, icd10_code, confidence: 'high'|'medium'|'low', supporting_evidence, downgrade_to: string|null|undefined }`.

**Rule 8a MYELOPATHY evidence rubric** ([generate-summary.ts:19](src/lib/claude/generate-summary.ts#L19), verbatim):

> "Myelopathy codes (M50.00/.01/.02, M47.1X, M54.18): 'high' requires imaging of cord compression AND at least one upper-motor-neuron sign in source docs (hyperreflexia, clonus, Hoffmann, Babinski, spastic gait, or bowel/bladder dysfunction). 'medium' when imaging shows cord contact but no UMN sign is documented. 'low' when neither is documented."

**Rule 8a RADICULOPATHY evidence rubric** ([generate-summary.ts:18](src/lib/claude/generate-summary.ts#L18), verbatim):

> "Radiculopathy codes (M54.12, M54.17, M50.1X, M51.1X): 'high' requires BOTH (i) imaging showing nerve-root compromise in the matching region AND (ii) at least one region-matched objective finding in source docs — positive Spurling (cervical) or SLR reproducing radicular LEG symptoms (lumbar), dermatomal sensory deficit in the matching roots, myotomal weakness in the matching root distribution, or a diminished reflex in the matching root. 'medium' requires imaging evidence plus subjective radiation in the matching dermatome WITHOUT documented objective finding. 'low' when only subjective radiation is present (no imaging correlate or no objective finding in the same region)."

**Rule 8b DOWNGRADE PRECOMPUTE** ([generate-summary.ts:25-31](src/lib/claude/generate-summary.ts#L25-L31), verbatim):

> "when a myelopathy or radiculopathy code would be tagged 'low' or 'medium' (i.e., it lacks the objective support Filter B/C requires at note-generation), populate `downgrade_to` with the substitution target so downstream note generators do not re-derive the substitution."
>
> - `M50.00 / M50.01 / M50.02 / M47.1X / M54.18` without UMN signs → `downgrade_to="M50.20"`
> - `M50.12X / M54.12` without region-matched cervical objective finding → `downgrade_to="M50.20"`
> - `M51.17 / M54.17` without region-matched lumbar radicular finding → `downgrade_to="M51.37"`
> - `M51.16` without region-matched lumbar radicular finding → `downgrade_to="M51.36"`
> - `M48.0X` with neurogenic-claudication qualifier but no UMN/neurogenic-claudication evidence → `downgrade_to="M51.37"` (lumbar) or `"M50.20"` (cervical)
> - All other cases → `downgrade_to=null`

**Retention rule** ([generate-summary.ts:23](src/lib/claude/generate-summary.ts#L23)):

> "Do not drop diagnoses based on this rubric — tag them with the correct confidence and populate supporting_evidence accordingly. Downstream note generators rely on confidence + evidence to decide whether to emit each code."

**Parse normalization** ([generate-summary.ts:295-344](src/lib/claude/generate-summary.ts#L295-L344)): `normalizeNullString` converts string `"null"` → JS `null` on `icd10_code`, `supporting_evidence`, `downgrade_to`.

### 3. Initial Visit Note Diagnosis — Two Visit-Type Branches

**File:** [src/lib/claude/generate-initial-visit.ts](src/lib/claude/generate-initial-visit.ts)

**Model:** `claude-opus-4-7`, `maxTokens: 16384`

Prompt assembled by `buildSystemPrompt(visitType)` at line 332, dispatching `INITIAL_VISIT_SECTIONS` (lines 140–227) or `PAIN_EVALUATION_VISIT_SECTIONS` (lines 229–329).

#### 3a. First Visit (`initial_visit`) — Absolute Prohibitions

Rule (A) M54.5 specificity — never parent, use `.50/.51/.59` ([line 174](src/lib/claude/generate-initial-visit.ts#L174)).

Rule (B) M79.1 redundancy guard ([line 181](src/lib/claude/generate-initial-visit.ts#L181)).

Rule (C) Radiculopathy prohibition ([line 183](src/lib/claude/generate-initial-visit.ts#L183), verbatim):

> "Radiculopathy — do NOT emit M54.12, M54.17, M50.1X, or M51.1X at the first visit. These codes require imaging confirmation and region-matched objective findings, which are not available at initial presentation. Use the strain/sprain codes and region pain codes above instead."

Disc code prohibition ([line 172](src/lib/claude/generate-initial-visit.ts#L172)):

> "Do NOT use disc displacement codes (M50.20, M51.16, etc.) — those require imaging confirmation."

Myelopathy codes are not listed in the first-visit code table; implicitly excluded as imaging-dependent.

#### 3b. Pain Evaluation Visit (`pain_evaluation_visit`) — Filters A–F

Filter **Master** preamble ([line 284](src/lib/claude/generate-initial-visit.ts#L284)):

> "The diagnosis list is a FILTERED output, not a copy of suggested_diagnoses or pmExtraction.diagnoses. Apply these filters before emitting any code. Candidate code sources: caseSummary.suggested_diagnoses, pmExtraction.diagnoses. For each pmExtraction diagnosis, inspect its imaging_support, exam_support, and source_quote tags (populated at extraction time) — a pmExtraction code with imaging_support='none' AND exam_support!='objective' has NO correlative support and must be dropped or downgraded."

DOWNGRADE-TO HONOR RULE ([line 286](src/lib/claude/generate-initial-visit.ts#L286)):

> "if a caseSummary.suggested_diagnoses entry carries a non-null downgrade_to value, prefer that pre-computed target over re-deriving the substitution. downgrade_to is populated by the case summary generator per Rule 8b and reflects cross-source evidence. Filters (A)-(F) still apply to the downgraded code."

Filter (A) **Myelopathy** ([line 288](src/lib/claude/generate-initial-visit.ts#L288), verbatim):

> "require documented upper-motor-neuron signs in THIS visit's `providerIntake.exam_findings` OR an explicit UMN finding in `pmExtraction.physical_exam`. Acceptable UMN signs: hyperreflexia, clonus, Hoffmann sign, Babinski sign, spastic gait, bowel/bladder dysfunction. Isolated paresthesia, intact sensation, symmetric 2+ reflexes, and 5/5 strength do NOT support myelopathy. If the filter fails, DOWNGRADE: replace M50.00/.01/.02 with M50.20 (Other cervical disc displacement) + keep M54.2 (Cervicalgia); replace M48.0X with the matching non-myelopathy stenosis or disc-degeneration code."

Filter (B) **Radiculopathy** ([lines 290–293](src/lib/claude/generate-initial-visit.ts#L290-L293), verbatim):

> "require REGION-MATCHED objective findings documented in THIS visit's providerIntake.exam_findings OR a pmExtraction diagnosis with exam_support='objective' for the same region. MRI signal of nerve-root contact alone is NOT sufficient; subjective radiation alone is NOT sufficient."

> "**Cervical (M54.12 / M50.1X)** — one of: positive Spurling maneuver, dermatomal sensory deficit in C5/C6/C7/C8/T1, myotomal weakness in an upper-extremity root distribution, OR diminished biceps/triceps/brachioradialis reflex. A positive SLR is a LUMBAR test and does NOT support a cervical radiculopathy code."

> "**Lumbar (M54.17 / M51.1X)** — one of: SLR positive AND reproducing radicular leg symptoms (pain radiating down the leg, paresthesia below the knee — SLR reproducing 'low back pain' alone does NOT qualify), dermatomal sensory deficit in L4/L5/S1, myotomal weakness in a lower-extremity root distribution, OR diminished patellar/Achilles reflex."

> "DOWNGRADE: replace M54.12/M50.1X with M50.20 + keep M54.2; replace M54.17/M51.17 with M51.37 + keep the lumbar pain code; replace M51.16 with M51.36 + keep the lumbar pain code. Do NOT leave disc pathology unrepresented."

Prose consistency rule ([line 293](src/lib/claude/generate-initial-visit.ts#L293), verbatim):

> "In imaging_findings prose for downgraded radiculopathy codes, describe the clinical picture as 'radicular symptoms' or 'possible nerve root irritation' — NEVER as 'radiculopathy' or 'nerve root compression'. Reserve 'radiculopathy' prose for codes that pass the region-match filter."

Filter (C) M79.1 redundancy ([lines 295–296](src/lib/claude/generate-initial-visit.ts#L295-L296)).

Filter (E) confidence gate ([line 302](src/lib/claude/generate-initial-visit.ts#L302)):

> "prefer 'high'-confidence entries that match imaging + exam. For 'medium'-confidence entries, require the same imaging + objective-finding support the filters above demand. OMIT 'low'-confidence entries unless independent imaging + exam evidence supports them."

Filter (F) pmExtraction strong evidence ([line 304](src/lib/claude/generate-initial-visit.ts#L304)):

> "A pmExtraction diagnosis with imaging_support='confirmed' AND exam_support='objective' is strong evidence; emit as-is if it passes the filters above. A pmExtraction diagnosis with exam_support='subjective_only' or 'none' for a myelopathy/radiculopathy code fails Filters A/B automatically and must be downgraded. Cite source_quote verbatim in the imaging_findings or medical_necessity narrative when it establishes correlation."

Scope limiter ([line 306](src/lib/claude/generate-initial-visit.ts#L306)): "Do NOT add codes for pathology not documented on imaging."

### 4. Procedure Note — DIAGNOSTIC-SUPPORT RULE with PROSE-FALLBACK

**File:** [src/lib/claude/generate-procedure-note.ts](src/lib/claude/generate-procedure-note.ts)

**Model:** `claude-opus-4-7`. System prompt ≈500+ lines, all rules inline.

Master preamble ([line 458](src/lib/claude/generate-procedure-note.ts#L458)):

> "The diagnosis list in this procedure note is a FILTERED output, not a copy of the input. Apply the filters below to every candidate code regardless of whether it came from procedureRecord.diagnoses or pmExtraction.diagnoses. Omit any code that fails its filter — if a code is unsupported, substitute the downgrade listed below rather than just dropping it."

**CODING FRAMEWORK RULE** ([lines 460–466](src/lib/claude/generate-procedure-note.ts#L460-L466)) — binary choice governs whole note:
- Framework (a) TRAUMATIC: disc anchors `M50.20 / M51.26 / M51.27`; prose says "traumatic disc displacement"
- Framework (b) DEGENERATIVE-WITH-SUPERIMPOSED-TRAUMA: disc anchors `M50.23 / M51.36 / M51.37`; prose says "degenerative disc disease with superimposed traumatic exacerbation"

Filter (A) External-cause V/W/X/Y codes — **absolute omission** ([line 470](src/lib/claude/generate-procedure-note.ts#L470)).

**Filter (B) Myelopathy / M48.0X** ([line 472](src/lib/claude/generate-procedure-note.ts#L472), verbatim):

> "Myelopathy and cord-compromise codes — require documented upper motor neuron signs OR (for stenosis codes) documented neurogenic claudication with objective lower-extremity findings. Omit the following codes unless the objective_physical_exam on this visit's input data documents the required evidence: M50.00, M50.01, M50.02, M47.1X, M54.18, M48.0X (spinal stenosis codes when billed with a neurogenic claudication / myelopathy qualifier), and M47.2X variants carrying a myelopathy qualifier."
>
> "For myelopathy codes (M50.0X, M47.1X, M54.18): at least one of hyperreflexia, clonus, Hoffmann sign, Babinski sign, spastic gait, or bowel/bladder dysfunction."
>
> "For M48.0X with neurogenic claudication: documented positional lower-extremity pain/weakness with a standing/walking exacerbation pattern AND an objective lower-extremity finding (dermatomal deficit, myotomal weakness, or diminished reflex)."
>
> "Isolated subjective paresthesia, intact sensation, symmetric 2+ reflexes, and 5/5 strength do NOT support any code in this set."
>
> "do not substitute — the underlying disc pathology is already captured by non-myelopathy disc codes (see below); M48.0X may be downgraded to the matching non-myelopathy stenosis or disc-degeneration code (e.g., M51.36/M51.37) per the Downgrade Table."

**Filter (C) Radiculopathy** ([lines 474–477](src/lib/claude/generate-procedure-note.ts#L474-L477)):

Master gate (line 474):
> "require REGION-MATCHED objective findings. Each radiculopathy code must be supported by an objective finding in the SAME anatomic region as the code. Objective findings elsewhere do NOT cross-validate a different region."

Cervical (line 475): Spurling same laterality, C5-T1 dermatomal deficit, UE myotomal weakness, or diminished biceps/triceps/brachioradialis reflex. Explicit: "A positive straight-leg raise is a LUMBAR test and does NOT support a cervical radiculopathy code."

Lumbar (line 476): SLR reproducing leg symptoms (NOT just LBP), L4/L5/S1 dermatomal deficit, LE myotomal weakness, diminished patellar/Achilles reflex.

**PROSE-FALLBACK (MANDATORY)** ([line 477](src/lib/claude/generate-procedure-note.ts#L477), verbatim):

> "when a radiculopathy code is filtered out and downgraded: in the assessment_summary, objective_physical_exam, and assessment_and_plan narrative prose, describe the clinical picture as 'radicular symptoms' or 'possible nerve root irritation' — NEVER as 'radiculopathy' or 'nerve root compression'. Reserve the word 'radiculopathy' in prose for codes that PASS Filter (C). This applies to prose regardless of what the MRI shows — imaging-only nerve-root contact without objective exam correlation is described as 'possible nerve root irritation', not 'radiculopathy'."

**RADICULAR-PROSE CONSTRAINT** at assessment_summary section ([line 356](src/lib/claude/generate-procedure-note.ts#L356)):

> "RADICULAR-PROSE CONSTRAINT (MANDATORY): match the prose to the filtered diagnosis list. If a radiculopathy code (M50.1X / M51.1X / M54.12 / M54.17) is emitted after passing Filter (C), you may write 'radiculopathy' or 'radicular features' in this section. If the radiculopathy code was filtered out and downgraded to M50.20 / M51.36 / M51.37, describe the clinical picture as 'radicular symptoms' or 'possible nerve root irritation' — do NOT use 'radiculopathy' or 'nerve root compression' in prose."

Filter (E) Per-visit support ([lines 483–488](src/lib/claude/generate-procedure-note.ts#L483-L488)) — evaporates codes when THIS visit's subjective/exam does not support them. Includes the explicit M79.1 redundancy rule + worked example at [line 518](src/lib/claude/generate-procedure-note.ts#L518).

**Downgrade Table** ([lines 490–504](src/lib/claude/generate-procedure-note.ts#L490-L504)) parameterized by framework:

| Failed code | Framework (a) landing | Framework (b) landing | Plus |
|---|---|---|---|
| M50.12X cervical radic w/o cervical objective | M50.20 | M50.23 | + M54.2 |
| M51.17 lumbar radic w/o lumbar radicular | M51.27 | M51.37 | + M54.5 |
| M51.16 lumbar disc w/ radic w/o lumbar radicular | M51.26 | M51.36 | + M54.5 |
| M50.00 cervical disc w/ myelopathy w/o UMN | M50.20 | M50.23 | + M54.2 |

Closing rule ([line 504](src/lib/claude/generate-procedure-note.ts#L504)): "Never leave disc pathology completely unrepresented in the output list."

Prior-note override ([line 244](src/lib/claude/generate-procedure-note.ts#L244)):

> "Prior narrative takes a lower precedence than the paintoneLabel / chiroProgress branching and the DIAGNOSTIC-SUPPORT RULE. If the prior assessment_and_plan listed a diagnosis that fails the current-visit filters (e.g., a V-code, or a radiculopathy code without region-matched findings on this visit), DROP or DOWNGRADE the code per the rule — do not retain it just because the prior note had it."

### 5. Discharge Note — Widened Evidence Window, Identical Filters

**File:** [src/lib/claude/generate-discharge-note.ts](src/lib/claude/generate-discharge-note.ts)

DIAGNOSTIC-SUPPORT RULE at [lines 303–322](src/lib/claude/generate-discharge-note.ts#L303-L322).

Candidate sources ([line 303](src/lib/claude/generate-discharge-note.ts#L303)):

> "The discharge diagnosis list is a FILTERED output, not a copy of every code that appeared during the treatment course. Apply the filters below to every candidate code from procedure.diagnoses, case_summary.suggested_diagnoses, and pmExtraction.diagnoses."

DOWNGRADE-TO HONOR RULE ([line 305](src/lib/claude/generate-discharge-note.ts#L305)) — identical to procedure note.

Filter (B) Myelopathy ([line 307](src/lib/claude/generate-discharge-note.ts#L307)) — identical criteria, downgrade M50.20.

Filter (C) Radiculopathy ([lines 309–312](src/lib/claude/generate-discharge-note.ts#L309-L312)) — identical exam criteria, but evidence window widened to "any finalized procedure note or in case_summary source docs" (not just current visit).

Filter (G) Symptom-resolution: omit or shift to sequela "S" suffix.

### 6. `regenerateSection` Behavior — Full Rule Set Reapplied

#### 6a. Initial Visit Regen

[generate-initial-visit.ts:595-629](src/lib/claude/generate-initial-visit.ts#L595-L629).

- System prompt: identical `buildSystemPrompt(visitType)` ([line 601](src/lib/claude/generate-initial-visit.ts#L601))
- System suffix ([line 610](src/lib/claude/generate-initial-visit.ts#L610)):
  > "You are regenerating ONLY the '${sectionLabel}' section of an existing Initial Visit note. Visit type: ${visitLabel}. Write a fresh version of this section based on the source data. Do not repeat the section title — just provide the content. Follow the exact length targets and conciseness constraints from the section-specific instructions above."
- User message ([lines 613–617](src/lib/claude/generate-initial-visit.ts#L613-L617)): section label + `currentContent` + full `JSON.stringify(inputData)`
- Tool: simpler `SECTION_REGEN_TOOL` returning `{ content: string }`
- Model: `claude-opus-4-7`, `maxTokens: 4096`
- **All Filters A–F still apply** because full system prompt is preserved.

#### 6b. Procedure Note Regen

[generate-procedure-note.ts:661-691](src/lib/claude/generate-procedure-note.ts#L661-L691).

Key difference: accepts an optional `otherSections?: Partial<Record<ProcedureNoteSection, string>>` parameter. When provided, the user message includes finalized content of all other sections, allowing the regenerator to see finalized prose when rebuilding one section (useful for keeping prose and code list consistent).

System suffix includes de-duplication instruction ([line 678](src/lib/claude/generate-procedure-note.ts#L678)):
> "Avoid duplicating content that already appears in the OTHER SECTIONS listed in the user message — each section must contribute NEW information."

Token budget: 4096. Full `SYSTEM_PROMPT` is preserved so all DIAGNOSTIC-SUPPORT RULE filters + PROSE-FALLBACK + RADICULAR-PROSE CONSTRAINT still fire.

### 7. ICD-10 Classification Patterns (Reference-Only, Not Enforced Here)

[src/lib/icd10/validation.ts:52-68](src/lib/icd10/validation.ts#L52-L68).

```
MYELOPATHY_CODE_PATTERN  = /^(M50\.0[0-2][0-9]?|M47\.1[0-9]?|M48\.0[0-9]?|M54\.18)$/
RADICULOPATHY_CODE_PATTERN = /^(M50\.1[0-9]{0,2}|M51\.1[0-9]?|M54\.12|M54\.17)$/
```

`classifyIcd10Code` returns `'myelopathy' | 'radiculopathy' | 'other'`. Used by the combobox to "warn a reviewer" (per comment at line 43). **No rejection or filtering** here — enforcement lives in prompts.

`NON_BILLABLE_PARENT_CODES` has only one entry: `M54.5 → M54.50`.

### 8. How MRI Findings Feed the Diagnosis Section

MRI enters via three parallel channels in `inputData` for note generators:

1. **`caseSummary.imaging_findings`** (structured imaging summary with body_region, summary, key_findings, severity). Primary source for Pain Evaluation Visit diagnosis code basis ([generate-initial-visit.ts:271](src/lib/claude/generate-initial-visit.ts#L271)).

2. **`caseSummary.suggested_diagnoses[]`** with precomputed `confidence` + `downgrade_to`. Filter (E) gates by confidence; DOWNGRADE-TO HONOR RULE honors `downgrade_to`.

3. **`pmExtraction.diagnoses[]`** with per-code `imaging_support` / `exam_support` / `source_quote` tags. A pmExtraction code with `imaging_support='none' AND exam_support!='objective'` is dropped/downgraded.

For procedure notes, MRI is also cited in `assessment_summary` (linking exam findings to imaging) and `procedure_indication` (justifying injection targets) — but does not override Filter B/C gates.

### 9. How Physical Exam Feeds the Diagnosis Section

Exam enters via:

- **`providerIntake.exam_findings`** — current-visit structured exam (general_appearance, regions[], palpation_findings, muscle_spasm, additional_findings, neurological_notes). Primary gate for Filter A (myelopathy UMN signs) and Filter B/C (region-matched objective findings).

- **`pmExtraction.physical_exam`** — PM-provider-documented exam. Secondary evidence source. Per Filter A wording: "OR an explicit UMN finding in `pmExtraction.physical_exam`".

- **`pmExtraction.diagnoses[].exam_support`** tag — if `"objective"` for same region, satisfies Filter B/C.

The initial visit Pain Evaluation branch at line 288/290 explicitly names BOTH sources as disjunctive alternatives for satisfying the gate.

### 10. Data Flow Trace — Diagnosis Section Only

```
PM PDF
  └─► extract-pain-management.ts (Sonnet 4.6)
        • Rule 5: verbatim codes
        • Rule 12-14: imaging_support / exam_support / source_quote tags
        └─► pain_management_extractions.diagnoses (JSONB with tags)

All source extractions (MRI+chiro+PM+PT+ortho+CT)
  └─► generate-summary.ts (Opus 4.6)
        • Rule 8a: confidence tagging per myelopathy/radiculopathy rubric
        • Rule 8b: downgrade_to precompute
        └─► case_summaries.suggested_diagnoses[]
              { diagnosis, icd10_code, confidence, supporting_evidence, downgrade_to }

Case summary + provider intake + PM extraction
  └─► generate-initial-visit.ts (Opus 4.7) for pain_evaluation_visit
        • Filters A (myelopathy), B (radiculopathy region-match), C (M79.1), D, E (confidence), F (pmExtraction strong evidence)
        • DOWNGRADE-TO HONOR RULE consumes case_summary.downgrade_to
        • Prose consistency rule at line 293
        └─► initial_visit_notes.diagnoses (text) + imaging_findings prose

Procedure record + case summary + PM extraction + prior procedure notes
  └─► generate-procedure-note.ts (Opus 4.7)
        • CODING FRAMEWORK RULE — binary traumatic vs degenerative
        • Filter (A) external-cause, (B) myelopathy, (C) radiculopathy
        • PROSE-FALLBACK mandatory for downgraded radic codes
        • RADICULAR-PROSE CONSTRAINT at assessment_summary
        • Downgrade Table parameterized by framework
        └─► procedure_notes.{assessment_summary, assessment_and_plan, ...}

All procedures + case summary + PM extraction + finalized procedure notes
  └─► generate-discharge-note.ts (Opus 4.7)
        • Same Filter B/C with widened evidence window
        • Filter G symptom-resolution
        └─► discharge_notes.{diagnoses, assessment}

regenerateSection / regenerateProcedureNoteSection
  • Full SYSTEM_PROMPT preserved
  • Only section label + current content added in suffix
  • All filters + prose constraints STILL apply on regen
```

### 11. What Governs Diagnosis-vs-Prose Consistency

Two layered rules guarantee code list ↔ prose alignment:

1. **PROSE-FALLBACK (MANDATORY)** — Filter (C), [generate-procedure-note.ts:477](src/lib/claude/generate-procedure-note.ts#L477). Applies to `assessment_summary`, `objective_physical_exam`, and `assessment_and_plan` narratives. Explicit phrase whitelist (`"radicular symptoms"`, `"possible nerve root irritation"`) and blacklist (`"radiculopathy"`, `"nerve root compression"`) when radiculopathy code was filtered out.

2. **RADICULAR-PROSE CONSTRAINT** — [generate-procedure-note.ts:356](src/lib/claude/generate-procedure-note.ts#L356). Specific to the `assessment_summary` section; restates the constraint with explicit code → prose mapping (pass Filter C → "radiculopathy" allowed; downgrade to M50.20/M51.36/M51.37 → must use "radicular symptoms").

Initial visit PRP prose constraint at [generate-initial-visit.ts:293](src/lib/claude/generate-initial-visit.ts#L293) mirrors (1) but applies specifically to `imaging_findings` narrative.

Discharge note does not include an explicit PROSE-FALLBACK clause at the same level of specificity as the procedure note.

## Code References

### Extraction (evidence tags per code)
- [src/lib/claude/extract-pain-management.ts:5-28](src/lib/claude/extract-pain-management.ts#L5-L28) — system prompt Rules 1–14
- [src/lib/claude/extract-pain-management.ts:99-122](src/lib/claude/extract-pain-management.ts#L99-L122) — `diagnoses[]` tool schema with `imaging_support` / `exam_support` / `source_quote`

### Case Summary (rubric + downgrade precompute)
- [src/lib/claude/generate-summary.ts:17-21](src/lib/claude/generate-summary.ts#L17-L21) — Rule 8a OBJECTIVE-SUPPORT RUBRIC
- [src/lib/claude/generate-summary.ts:25-31](src/lib/claude/generate-summary.ts#L25-L31) — Rule 8b DOWNGRADE PRECOMPUTE
- [src/lib/validations/case-summary.ts:37-47](src/lib/validations/case-summary.ts#L37-L47) — `SuggestedDiagnosis` schema

### Initial Visit (two visit-type branches)
- [src/lib/claude/generate-initial-visit.ts:140-227](src/lib/claude/generate-initial-visit.ts#L140-L227) — INITIAL_VISIT_SECTIONS
- [src/lib/claude/generate-initial-visit.ts:172](src/lib/claude/generate-initial-visit.ts#L172) — "Do NOT use disc displacement codes"
- [src/lib/claude/generate-initial-visit.ts:174-183](src/lib/claude/generate-initial-visit.ts#L174-L183) — first-visit DIAGNOSTIC-SUPPORT RULE (A, B, C)
- [src/lib/claude/generate-initial-visit.ts:229-329](src/lib/claude/generate-initial-visit.ts#L229-L329) — PAIN_EVALUATION_VISIT_SECTIONS
- [src/lib/claude/generate-initial-visit.ts:284](src/lib/claude/generate-initial-visit.ts#L284) — PRP DIAGNOSTIC-SUPPORT RULE master
- [src/lib/claude/generate-initial-visit.ts:286](src/lib/claude/generate-initial-visit.ts#L286) — DOWNGRADE-TO HONOR RULE
- [src/lib/claude/generate-initial-visit.ts:288](src/lib/claude/generate-initial-visit.ts#L288) — Filter (A) Myelopathy
- [src/lib/claude/generate-initial-visit.ts:290-293](src/lib/claude/generate-initial-visit.ts#L290-L293) — Filter (B) Radiculopathy + prose consistency
- [src/lib/claude/generate-initial-visit.ts:302](src/lib/claude/generate-initial-visit.ts#L302) — Filter (E) confidence gate
- [src/lib/claude/generate-initial-visit.ts:304](src/lib/claude/generate-initial-visit.ts#L304) — Filter (F) pmExtraction strong evidence
- [src/lib/claude/generate-initial-visit.ts:595-629](src/lib/claude/generate-initial-visit.ts#L595-L629) — `regenerateSection`

### Procedure Note (filters + prose constraints)
- [src/lib/claude/generate-procedure-note.ts:244](src/lib/claude/generate-procedure-note.ts#L244) — prior-note lower precedence
- [src/lib/claude/generate-procedure-note.ts:356](src/lib/claude/generate-procedure-note.ts#L356) — RADICULAR-PROSE CONSTRAINT at assessment_summary
- [src/lib/claude/generate-procedure-note.ts:458](src/lib/claude/generate-procedure-note.ts#L458) — DIAGNOSTIC-SUPPORT RULE master
- [src/lib/claude/generate-procedure-note.ts:460-466](src/lib/claude/generate-procedure-note.ts#L460-L466) — CODING FRAMEWORK RULE
- [src/lib/claude/generate-procedure-note.ts:470](src/lib/claude/generate-procedure-note.ts#L470) — Filter (A) external-cause omission
- [src/lib/claude/generate-procedure-note.ts:472](src/lib/claude/generate-procedure-note.ts#L472) — Filter (B) myelopathy + M48.0X
- [src/lib/claude/generate-procedure-note.ts:474-477](src/lib/claude/generate-procedure-note.ts#L474-L477) — Filter (C) radiculopathy + PROSE-FALLBACK
- [src/lib/claude/generate-procedure-note.ts:483-488](src/lib/claude/generate-procedure-note.ts#L483-L488) — Filter (E) per-visit support
- [src/lib/claude/generate-procedure-note.ts:490-504](src/lib/claude/generate-procedure-note.ts#L490-L504) — Downgrade Table (framework-parameterized)
- [src/lib/claude/generate-procedure-note.ts:661-691](src/lib/claude/generate-procedure-note.ts#L661-L691) — `regenerateProcedureNoteSection` with `otherSections` context

### Discharge Note
- [src/lib/claude/generate-discharge-note.ts:303-322](src/lib/claude/generate-discharge-note.ts#L303-L322) — DIAGNOSTIC-SUPPORT RULE Filters A–G
- [src/lib/claude/generate-discharge-note.ts:305](src/lib/claude/generate-discharge-note.ts#L305) — DOWNGRADE-TO HONOR RULE
- [src/lib/claude/generate-discharge-note.ts:307](src/lib/claude/generate-discharge-note.ts#L307) — Filter (B) Myelopathy
- [src/lib/claude/generate-discharge-note.ts:309-312](src/lib/claude/generate-discharge-note.ts#L309-L312) — Filter (C) Radiculopathy widened window

### Validation + Classification
- [src/lib/icd10/validation.ts:8](src/lib/icd10/validation.ts#L8) — ICD10_STRUCTURAL_REGEX
- [src/lib/icd10/validation.ts:13-15](src/lib/icd10/validation.ts#L13-L15) — NON_BILLABLE_PARENT_CODES (M54.5 → M54.50)
- [src/lib/icd10/validation.ts:52](src/lib/icd10/validation.ts#L52) — MYELOPATHY_CODE_PATTERN
- [src/lib/icd10/validation.ts:58](src/lib/icd10/validation.ts#L58) — RADICULOPATHY_CODE_PATTERN
- [src/lib/icd10/validation.ts:62-68](src/lib/icd10/validation.ts#L62-L68) — classifyIcd10Code

### Merge Layer
- [src/actions/procedures.ts:171-242](src/actions/procedures.ts#L171-L242) — `getCaseDiagnoses` aggregation
- [src/actions/procedure-notes.ts:354-362](src/actions/procedure-notes.ts#L354-L362) — pmExtraction assembly into inputData
- [src/actions/discharge-notes.ts:352-358](src/actions/discharge-notes.ts#L352-L358) — pmExtraction assembly

### Tests asserting current myelopathy/radiculopathy behavior
- [src/lib/claude/__tests__/generate-procedure-note.test.ts:371-424](src/lib/claude/__tests__/generate-procedure-note.test.ts#L371-L424) — myelopathy keywords, SLR-as-lumbar, downgrade codes, worked examples M50.00 OMIT + M50.121 OMIT

## Architecture Documentation

### Enforcement surface for myelopathy/radiculopathy

| Concern | Enforcement site | Mechanism |
|---|---|---|
| Source-document evidence tagging | PM extraction Rule 13 | Per-code `exam_support='objective'` requires UMN sign or region-matched finding |
| Cross-source confidence | Case summary Rule 8a | `confidence` field on each suggested_diagnoses entry |
| Precomputed downgrade target | Case summary Rule 8b | `downgrade_to` field populated per-code |
| First-visit prohibition | Initial visit INITIAL_VISIT_SECTIONS | Absolute — no imaging-dependent codes |
| PRP visit gating | Initial visit PAIN_EVALUATION_VISIT_SECTIONS Filters A–F | Exam + imaging gate with downgrade fallback |
| Procedure-visit gating | Procedure note DIAGNOSTIC-SUPPORT RULE Filter B/C | Current-visit exam gate with framework-parameterized downgrade |
| Discharge gating | Discharge note Filter B/C | Widened-window evidence gate |
| Prose-vs-code consistency | PROSE-FALLBACK + RADICULAR-PROSE CONSTRAINT | Explicit phrase whitelist/blacklist on narrative sections |

### Regeneration semantics

All three regen paths (`regenerateSection`, `regenerateProcedureNoteSection`, `regenerateDischargeNoteSection`) preserve the full `SYSTEM_PROMPT` and append a section-specific suffix. Filters are not relaxed on regen. The procedure-note regen additionally accepts finalized sibling sections as context to support prose-vs-code cross-checking.

## Related Research

- [thoughts/shared/research/2026-04-20-pm-notes-diagnosis-generation.md](thoughts/shared/research/2026-04-20-pm-notes-diagnosis-generation.md) — earlier research on PM → diagnosis generation pipeline, including layered filter model and substitution target mapping
- [thoughts/shared/research/2026-04-20-diagnostic-accuracy-icd-selection.md](thoughts/shared/research/2026-04-20-diagnostic-accuracy-icd-selection.md) — ICD-10 selection logic across full note pipeline
- [thoughts/shared/research/2026-04-18-apply-medico-legal-editor-pass-to-procedure-note.md](thoughts/shared/research/2026-04-18-apply-medico-legal-editor-pass-to-procedure-note.md) — medico-legal editor pass phases
- [thoughts/shared/plans/2026-04-20-procedure-note-medico-legal-critiques.md](thoughts/shared/plans/2026-04-20-procedure-note-medico-legal-critiques.md) — plan for medico-legal critique fixes

## Open Questions

1. Discharge note does not include a PROSE-FALLBACK clause at the same explicit level as procedure note — prose constraint coverage is partial at the discharge stage.
2. Initial visit prose consistency rule ([line 293](src/lib/claude/generate-initial-visit.ts#L293)) targets `imaging_findings` narrative specifically; coverage of other narrative sections (`medical_necessity`, `physical_exam`) at the same level of explicitness is not present.
3. `regenerateSection` for initial visit does not receive `otherSections` context like procedure note regen does — prose consistency on initial-visit regen relies only on the full SYSTEM_PROMPT + currentContent + inputData.
