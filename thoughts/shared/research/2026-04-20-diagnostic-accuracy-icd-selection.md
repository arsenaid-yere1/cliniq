---
date: 2026-04-20T13:50:36-07:00
researcher: arsenaid
git_commit: 1cdcc3c03fadcccbf1a3bd5ba52be03d124926f6
branch: main
repository: cliniq
topic: "Diagnostic accuracy: how ICD-10 codes are generated, filtered, and displayed across notes"
tags: [research, codebase, icd10, diagnosis, initial-visit, procedure-note, case-summary, prompts]
status: complete
last_updated: 2026-04-20
last_updated_by: arsenaid
---

# Research: Diagnostic accuracy — ICD-10 selection across cliniq note pipelines

**Date**: 2026-04-20T13:50:36-07:00
**Researcher**: arsenaid
**Git Commit**: 1cdcc3c03fadcccbf1a3bd5ba52be03d124926f6
**Branch**: main
**Repository**: cliniq

## Research Question

How does cliniq currently generate, filter, and persist ICD-10 diagnoses across the note pipelines? Specifically, document the code paths and prompt rules that govern scenarios the user flagged as legally risky:

- Lumbar radiculopathy coded without objective neuro deficits (only subjective radiation)
- "Myalgia" (M79.1) appearing redundantly alongside strain/region-specific pain codes
- Low back pain code M54.5 chosen instead of more specific M54.50/M54.51/M54.59 (or a strain code)

Purely descriptive. No recommendations or evaluations.

---

## Summary

Diagnoses flow through three LLM stages and one UI free-type layer, with **filtering concentrated in the procedure-note stage only**:

1. **Extraction** (`extract-pain-management.ts`, `extract-chiro.ts`, `extract-pt.ts`, `extract-orthopedic.ts`) — verbatim copy of ICD-10 codes (incl. 7th character) from uploaded provider documents. No inference, no normalization beyond `normalizeNullStringsInArray`.
2. **Case summary** (`generate-summary.ts`) — cross-references and consolidates diagnoses across sources into a single `suggested_diagnoses` array, each entry tagged with `confidence: high|medium|low` and a `supporting_evidence` string. **No entries are dropped** based on confidence — tagging only.
3. **Initial visit note** (`generate-initial-visit.ts`) — free-text `diagnoses` string. Prompt lists allowed codes by region and visit type; instructs the model to "cross-reference" `suggested_diagnoses` and "prefer" high-confidence entries that match exam/imaging. Prompt contains **no objective-finding gate** for radiculopathy, **no redundancy rule** against co-listing M79.1 with region pain codes, and **no guidance** on M54.5 vs its M54.50/M54.51/M54.59 subcodes.
4. **Procedure note** (`generate-procedure-note.ts`) — this is the only stage with a formal `DIAGNOSTIC-SUPPORT RULE` (filters A–E) that drops V/W/X/Y external-cause codes, gates myelopathy on UMN signs, gates radiculopathy on region-matched objective findings, gates "initial encounter" (`A`-suffix) sprain codes, and requires current-visit symptomatic support for retained codes (incl. an explicit guard against retaining M79.1 "Myalgia" without independent diffuse-myalgia findings).
5. **Discharge note** (`generate-discharge-note.ts`) — free-text diagnoses string assembled from procedure/summary/PM sources. No gating filter.
6. **UI — `DiagnosisCombobox`** — users may free-type any code matching `/^([A-Z][0-9A-Z.]{1,6})\s+(.+)$/i`; no ICD-10 chapter, specificity, or existence validation. Dedup is by exact uppercase code string.

The scenarios flagged by the user map to specific gaps in the initial-visit and case-summary stages, and to enforcement that only exists in the procedure-note stage. Discharge-note and UI layers have no filter.

---

## Detailed Findings

### 1. Extraction — ICD-10 codes from source documents (verbatim copy)

Four extraction prompts with identical rules: copy codes exactly as written, preserve 7th character.

- [src/lib/claude/extract-pain-management.ts:13](src/lib/claude/extract-pain-management.ts#L13) — Rule 5: `"Extract ALL diagnosis codes exactly as written, including the ICD-10 7th character."`
- [src/lib/claude/extract-chiro.ts:10](src/lib/claude/extract-chiro.ts#L10) — Rule 2: same phrasing.
- [src/lib/claude/extract-pt.ts:17](src/lib/claude/extract-pt.ts#L17) — Rule 9: same phrasing.
- [src/lib/claude/extract-orthopedic.ts:9](src/lib/claude/extract-orthopedic.ts#L9), [:13](src/lib/claude/extract-orthopedic.ts#L13) — Rules 1+5: lists `diagnoses` as a named section; Rule 5 says `"Extract ICD-10 diagnosis codes exactly as written in the report, including the 7th character."`

Tool-schema shapes: [chiro diagnoses](src/lib/claude/extract-chiro.ts#L55-L68) (incl. `region`, `is_primary`), [PM diagnoses](src/lib/claude/extract-pain-management.ts#L90-L98), [PT diagnoses](src/lib/claude/extract-pt.ts#L242-L250), [ortho diagnostics + diagnoses](src/lib/claude/extract-orthopedic.ts#L139-L161).

Post-processing is a single pass that converts the string `"null"` → real `null` for `icd10_code` fields (e.g., [extract-chiro.ts:208](src/lib/claude/extract-chiro.ts#L208)).

Zod schemas allow nullable `icd10_code`:
- [src/lib/validations/pain-management-extraction.ts:42-43](src/lib/validations/pain-management-extraction.ts#L42-L43)
- [src/lib/validations/chiro-extraction.ts:24-25](src/lib/validations/chiro-extraction.ts#L24-L25)
- [src/lib/validations/pt-extraction.ts:103-104](src/lib/validations/pt-extraction.ts#L103-L104)
- [src/lib/validations/orthopedic-extraction.ts:32-42](src/lib/validations/orthopedic-extraction.ts#L32-L42)

### 2. Case summary — consolidate and tag confidence (`suggested_diagnoses`)

File: [src/lib/claude/generate-summary.ts](src/lib/claude/generate-summary.ts)

**Prompt rules (verbatim):**

- [:13](src/lib/claude/generate-summary.ts#L13) Rule 6: `"For suggested diagnoses, provide ICD-10 codes when available and rate confidence based on supporting evidence strength"`
- [:15](src/lib/claude/generate-summary.ts#L15) Rule 8: `"Set confidence to \"low\" if source data is sparse or contradictory"`
- [:19](src/lib/claude/generate-summary.ts#L19) Rule 12: `"Cross-reference diagnoses across all sources. If MRI, chiro, PM, PT, and orthopedic all reference the same condition, consolidate into a single diagnosis entry with higher confidence"`
- [:21](src/lib/claude/generate-summary.ts#L21) Rule 14: incorporate orthopedic surgeon's ICD-10 diagnoses into summary.

**Tool schema fields** [src/lib/claude/generate-summary.ts:135-147](src/lib/claude/generate-summary.ts#L135-L147):

- `diagnosis` — `string`, no description
- `icd10_code` — `"ICD-10 code. Use \"null\" if not determinable."`
- `confidence` — enum `['high','medium','low']`, no description
- `supporting_evidence` — `"Brief explanation of supporting evidence. Use \"null\" if none."`

**Observed prompt silences:**
- No numeric rubric or definition for `"medium"` vs `"high"`.
- No minimum-length, quote, or source-citation requirement for `supporting_evidence`.
- No instruction to **drop** low-confidence entries — Rule 8 tags them, does not omit them.
- No instruction to flag or suppress codes that lack objective corroboration (e.g., radiculopathy without exam deficit or imaging).

Post-processing: [:314-317](src/lib/claude/generate-summary.ts#L314-L317) normalizes `"null"` strings. No confidence-based filter or dedup at the code level.

Zod: [src/lib/validations/case-summary.ts:38-39](src/lib/validations/case-summary.ts#L38-L39) — `suggestedDiagnosisSchema` with nullable `icd10_code`.

Storage: [supabase/migrations/006_case_summaries.sql:13](supabase/migrations/006_case_summaries.sql#L13) — `suggested_diagnoses jsonb`, GIN index at line 48.

### 3. Initial visit note — free-text `diagnoses` string (no filter)

File: [src/lib/claude/generate-initial-visit.ts](src/lib/claude/generate-initial-visit.ts)

**Common cross-visit rule** (`buildCommonSections`, [:120-127](src/lib/claude/generate-initial-visit.ts#L120-L127)) verbatim:

> "Use 'ICD-10 — Description' format. NO justification text after each code. NO 'supported by...' or 'consistent with...' parentheticals. If caseSummary.suggested_diagnoses is provided, cross-reference it when selecting clinical diagnosis codes. Use suggested codes with 'high' confidence when they align with the examination findings (first visit) or imaging findings (PRP evaluation). You may add or omit codes based on clinical judgment, but the suggested list should serve as a starting reference."

External-cause code mapping at [:123-127](src/lib/claude/generate-initial-visit.ts#L123-L127): `V43.52XA` auto, `W01.0XXA` slip/fall, `W18.49XA` workplace. (These are added at the initial visit and later filtered out in procedure notes — see §4 filter A.)

**First-visit code catalog** (`INITIAL_VISIT_SECTIONS`, [:161-173](src/lib/claude/generate-initial-visit.ts#L161-L173)):

> "Use clinical impression codes based on physical examination findings and mechanism of injury. These are NOT imaging-confirmed diagnoses. Use strain/sprain codes appropriate to the affected regions"

Region-keyed codes listed in prompt:

| Region | Codes offered |
|---|---|
| Cervical | `S13.4XXA`, `M54.2` |
| Thoracic | `S23.3XXA`, `M54.6` |
| Lumbar | `S39.012A`, **`M54.5`** |
| Headache | `G44.309` (post-traumatic), `R51.9` (no link) |
| Shoulder | `S43.402A`, `M25.511`/`M25.512` |
| Knee | `S83.509A`, `M25.561`/`M25.562` |
| Sleep disturbance | `G47.9` |
| General | **`M79.1`** (Myalgia), `M79.3` (Panniculitis) |

Explicit prohibition at [:172](src/lib/claude/generate-initial-visit.ts#L172): `"Do NOT use disc displacement codes (M50.20, M51.16, etc.) — those require imaging confirmation."`

**Pain-evaluation visit catalog** (`PAIN_EVALUATION_VISIT_SECTIONS`, [:258-271](src/lib/claude/generate-initial-visit.ts#L258-L271)):

> "Use imaging-confirmed diagnosis codes based on MRI findings from caseSummary.imaging_findings. Cross-reference caseSummary.suggested_diagnoses for pre-extracted ICD-10 codes — use suggested codes with 'high' confidence when they match the imaging findings."

Pain-eval catalog includes **`M54.12`** (cervical radiculopathy) and **`M54.17`** (lumbosacral radiculopathy), plus M50.20 / M50.320 / M51.16 / M51.17 / M51.26 / M51.27 / M51.86 / M50.80, and the pain codes M54.2, M54.5, M54.6, plus G44.309, G47.9, M79.1.

Closing constraint [:271](src/lib/claude/generate-initial-visit.ts#L271): `"Select codes that correspond to actual MRI findings in the source data. If caseSummary.suggested_diagnoses contains codes with 'high' confidence that match imaging findings, prefer those. Do NOT add codes for pathology not documented on imaging. If the patient reports sleep disturbance in chief complaints or review of systems, include G47.9."`

**Tool schema** [:361-367](src/lib/claude/generate-initial-visit.ts#L361-L367):

```
diagnoses: {
  type: 'string',
  description: 'ICD-10 diagnosis list. For first-visit cases: clinical impression codes (strain/sprain) based on exam and mechanism. For PRP evaluation cases: imaging-confirmed diagnosis codes',
}
```

**How `suggested_diagnoses` reaches the model**: the entire `inputData` object is serialized via `JSON.stringify(inputData, null, 2)` and embedded in the user message [:511](src/lib/claude/generate-initial-visit.ts#L511). No confidence-threshold pre-filtering, no drop list.

**Observed prompt silences relevant to user-flagged weaknesses:**

- **Radiculopathy objective-finding gate** — absent. `M54.12` and `M54.17` appear in the pain-eval catalog ([:267](src/lib/claude/generate-initial-visit.ts#L267)) with only the generic "codes that correspond to actual MRI findings" instruction. The prompt does not require a dermatomal deficit, myotomal weakness, reflex change, or Spurling/SLR positive on the exam before the model may emit a radiculopathy code.
- **Myalgia redundancy guard** — absent. `M79.1` is listed under "General" at [:170](src/lib/claude/generate-initial-visit.ts#L170) with no rule against co-listing with `M54.2`/`M54.5`/`M54.6` or region strain codes.
- **M54.5 specificity** — absent. The prompt offers only `M54.5` for lumbar pain at [:165](src/lib/claude/generate-initial-visit.ts#L165) and at [:267](src/lib/claude/generate-initial-visit.ts#L267). The subcodes `M54.50` (low back pain, unspecified), `M54.51` (vertebrogenic), and `M54.59` (other) are not mentioned anywhere in the prompt.
- **Confidence-threshold handling** — only "high" is addressed. No rule for "medium"/"low" entries from `suggested_diagnoses`; model may silently use them or ignore them.

Zod / storage:
- [src/lib/validations/initial-visit-note.ts:60](src/lib/validations/initial-visit-note.ts#L60) — `diagnoses: z.string()` (free text; finalize requires `min(1)` at [:87](src/lib/validations/initial-visit-note.ts#L87)).
- [supabase/migrations/010_initial_visit_notes.sql:22](supabase/migrations/010_initial_visit_notes.sql#L22) and [20260309194935_replace_initial_visit_notes_15_sections.sql:23](supabase/migrations/20260309194935_replace_initial_visit_notes_15_sections.sql#L23) — `diagnoses text`.

### 4. Procedure note — the only stage with a formal filter

File: [src/lib/claude/generate-procedure-note.ts](src/lib/claude/generate-procedure-note.ts)

**DIAGNOSTIC-SUPPORT RULE heading** [:448](src/lib/claude/generate-procedure-note.ts#L448):

> "DIAGNOSTIC-SUPPORT RULE (MANDATORY): The diagnosis list in this procedure note is a FILTERED output, not a copy of the input. Apply the filters below to every candidate code regardless of whether it came from procedureRecord.diagnoses or pmExtraction.diagnoses. Omit any code that fails its filter — if a code is unsupported, substitute the downgrade listed below rather than just dropping it. The procedure note is not the document that establishes mechanism of injury; that is the initial-visit note."

Prior-note interaction [:244](src/lib/claude/generate-procedure-note.ts#L244):

> "Prior narrative takes a lower precedence than the paintoneLabel / chiroProgress branching and the DIAGNOSTIC-SUPPORT RULE. If the prior assessment_and_plan listed a diagnosis that fails the current-visit filters in the DIAGNOSTIC-SUPPORT RULE (e.g., a V-code, or a radiculopathy code without region-matched findings on this visit), DROP or DOWNGRADE the code per the rule — do not retain it just because the prior note had it."

**Filters A–E** ([:450-467](src/lib/claude/generate-procedure-note.ts#L450-L467)):

- **(A) External-cause codes** [:450](src/lib/claude/generate-procedure-note.ts#L450): absolute omission of V/W/X/Y codes. `"Including them reads as aggressive billing and is a defensibility liability at deposition. No substitute — simply omit."`
- **(B) Myelopathy codes** [:452](src/lib/claude/generate-procedure-note.ts#L452): omit M50.00/.01/.02, M47.1X, M54.18 unless this-visit exam documents hyperreflexia, clonus, Hoffmann, Babinski, spastic gait, or bowel/bladder dysfunction. `"Isolated subjective paresthesia, intact sensation, symmetric 2+ reflexes, and 5/5 strength do NOT support myelopathy."`
- **(C) Radiculopathy codes** [:454-456](src/lib/claude/generate-procedure-note.ts#L454-L456): **region-matched objective findings required**. Cervical M50.1X needs Spurling / dermatomal deficit / myotomal weakness / reflex change **in the cervical exam** — `"A positive straight-leg raise is a LUMBAR test and does NOT support a cervical radiculopathy code."` Lumbar M51.1X needs positive SLR **reproducing radicular leg symptoms** (not just low back pain), dermatomal deficit, myotomal weakness, or reflex change in the lumbar exam.
- **(D) "Initial encounter" sprain codes** [:458](src/lib/claude/generate-procedure-note.ts#L458): prefer `D` suffix over `A` suffix on repeat visits; may keep `A` codes only on the first procedure note if already on `procedureRecord.diagnoses`.
- **(E) Current-visit support** [:460-467](src/lib/claude/generate-procedure-note.ts#L460-L467): every retained code needs support in this visit's subjective / ROS / objective_physical_exam. Explicit guards:
  - `M54.6` — thoracic pain this visit.
  - `G47.9` — current sleep complaint.
  - `G44.309` — current headache complaint.
  - `M79.1` — diffuse muscle pain beyond axial spine tenderness. `"M79.1 is additive-billing when kept alongside M54.2/M54.5 without independent diffuse-myalgia findings."` (worked example at [:476-497](src/lib/claude/generate-procedure-note.ts#L476-L497))
  - `M54.2/M54.5/M54.6` — retain only if corresponding region still has documented pain this visit.

**Worked example** [:475-497](src/lib/claude/generate-procedure-note.ts#L475-L497) — input 13 candidate codes including `M50.121`, `M51.17`, `M51.16`, `V43.52XA`, `S13.4XXA`, `S33.5XXA`, `M79.1`; output 7 codes (`M50.20`, `M51.36`, `M51.37`, `M54.2`, `M54.5`, `G44.309`, `G47.9`) after downgrading unsupported radiculopathy codes to disc-degeneration codes and dropping V-code, thoracic pain (no exam), and myalgia.

**Tool schema** [:573](src/lib/claude/generate-procedure-note.ts#L573):

```
assessment_and_plan: { type: 'string', description: 'DIAGNOSES heading with ICD-10 codes, then PLAN heading with action items' }
```

Tests covering filter behavior: [src/lib/claude/__tests__/generate-procedure-note.test.ts:324-640](src/lib/claude/__tests__/generate-procedure-note.test.ts#L324-L640) (V-code omission assertion at [:384-388](src/lib/claude/__tests__/generate-procedure-note.test.ts#L384-L388); radiculopathy downgrade worked example at [:633](src/lib/claude/__tests__/generate-procedure-note.test.ts#L633)).

### 5. Discharge note — free-text assembly, no filter

File: [src/lib/claude/generate-discharge-note.ts](src/lib/claude/generate-discharge-note.ts)

Diagnosis assembly [:38](src/lib/claude/generate-discharge-note.ts#L38), [:300-301](src/lib/claude/generate-discharge-note.ts#L300-L301): free-text bullet list `"• CODE – Description"` sourced from `procedure.diagnoses`, `case_summary`, and `pmExtraction.diagnoses`. Tool schema `diagnoses` is plain string [:340](src/lib/claude/generate-discharge-note.ts#L340), [:354](src/lib/claude/generate-discharge-note.ts#L354).

No DIAGNOSTIC-SUPPORT RULE analog. Storage: [supabase/migrations/016_discharge_notes.sql:15](supabase/migrations/016_discharge_notes.sql#L15) — `diagnoses text`.

### 6. Clinical orders — body-region ICD arrays

File: [src/lib/claude/generate-clinical-orders.ts](src/lib/claude/generate-clinical-orders.ts)

Imaging orders carry `icd10_codes: string[]` per region [:77-81](src/lib/claude/generate-clinical-orders.ts#L77-L81); chiro orders carry full `diagnoses` array [:121-134](src/lib/claude/generate-clinical-orders.ts#L121-L134). Prompt instructs extracting codes from the note's `diagnoses` section text [:12-28](src/lib/claude/generate-clinical-orders.ts#L12-L28). No gating filter.

### 7. Server-action merge/dedup (`fetchDiagnosisSuggestions`)

File: [src/actions/procedures.ts:169-227](src/actions/procedures.ts#L169-L227)

- Parallel Supabase queries: approved `pain_management_extractions` + IVN rows with `status IN ('draft','finalized')` and non-null `diagnoses`.
- Among IVN rows, `pain_evaluation_visit` is preferred over `initial_visit` (lines 200–203).
- IVN free-text parsed with regex [:212](src/actions/procedures.ts#L212):
  ```
  /^[•\-\d.]*\s*([A-Z]\d{1,2}\.?\d{0,4}[A-Z]{0,2})\s*[—–\-]\s*(.+)$/i
  ```
- Dedup by `icd10_code.toUpperCase()` [:220-224](src/actions/procedures.ts#L220-L224). PM-extraction entries placed first; IVN entries appended only if code not already seen.
- No ICD-10 chapter / existence / specificity validation — the regex is structural only.

Billing path uses the same fallback pattern: [src/actions/billing.ts:112](src/actions/billing.ts#L112), [:147-174](src/actions/billing.ts#L147-L174).

### 8. UI — `DiagnosisCombobox` free-type and dedup

File: [src/components/procedures/diagnosis-combobox.tsx](src/components/procedures/diagnosis-combobox.tsx)

- Free-type path: when no suggestions match, an "Add …" button appears. `addFreeText` ([:39-63](src/components/procedures/diagnosis-combobox.tsx#L39-L63)) parses with `/^([A-Z][0-9A-Z.]{1,6})\s+(.+)$/i`; if no match, the entire query is used as both `icd10_code` and `description`.
- Dedup in `selectSuggestion` ([:32-37](src/components/procedures/diagnosis-combobox.tsx#L32-L37)): exact-string check against `selectedCodes` Set (built from `value.map(d => d.icd10_code)` at [:21](src/components/procedures/diagnosis-combobox.tsx#L21)). Free-typed codes are uppercased first.
- No ICD-10 chapter, specificity, or existence validation at this layer.

### 9. PDF rendering — diagnoses section

- [src/lib/pdf/initial-visit-template.tsx:57](src/lib/pdf/initial-visit-template.tsx#L57) — `['diagnoses', 'Diagnoses']` section.
- [src/lib/pdf/discharge-note-template.tsx:48](src/lib/pdf/discharge-note-template.tsx#L48) — same pattern.
- [src/lib/pdf/invoice-template.tsx:217-221](src/lib/pdf/invoice-template.tsx#L217-L221) — renders `Diagnoses (ICD 10 codes)` from `diagnoses_snapshot`.

No formatting-time validation.

---

## Code References

**Generation (prompts + tool schemas)**
- `src/lib/claude/generate-initial-visit.ts:120-127` — common cross-visit rule + external-cause map
- `src/lib/claude/generate-initial-visit.ts:161-173` — first-visit code catalog (incl. M79.1 general; M54.5 lumbar)
- `src/lib/claude/generate-initial-visit.ts:258-271` — pain-eval code catalog (incl. M54.12/M54.17 radiculopathy)
- `src/lib/claude/generate-initial-visit.ts:361-367` — `diagnoses` tool schema description
- `src/lib/claude/generate-procedure-note.ts:244` — prior-note precedence vs filter
- `src/lib/claude/generate-procedure-note.ts:448` — DIAGNOSTIC-SUPPORT RULE header
- `src/lib/claude/generate-procedure-note.ts:450-467` — filters A–E (V-codes, myelopathy, radiculopathy, sprain suffix, current-visit support incl. M79.1 guard)
- `src/lib/claude/generate-procedure-note.ts:475-497` — worked filter example
- `src/lib/claude/generate-discharge-note.ts:300-301` — free-text diagnosis assembly
- `src/lib/claude/generate-summary.ts:13,15,19,21` — confidence / consolidate rules
- `src/lib/claude/generate-summary.ts:135-147` — `suggested_diagnoses` tool schema
- `src/lib/claude/generate-clinical-orders.ts:77-81,121-134` — order ICD arrays

**Extraction**
- `src/lib/claude/extract-pain-management.ts:13`
- `src/lib/claude/extract-chiro.ts:10`
- `src/lib/claude/extract-pt.ts:17`
- `src/lib/claude/extract-orthopedic.ts:9,13`

**Server actions / merge**
- `src/actions/procedures.ts:169-227` — `fetchDiagnosisSuggestions` merge + regex
- `src/actions/billing.ts:112,147-174` — invoice diagnosis derivation
- `src/actions/initial-visit-notes.ts:70,100,204,241` — passes prior IVN diagnoses + case-summary suggestions into LLM
- `src/actions/discharge-notes.ts:57-103,177-178` — discharge diagnosis input assembly

**UI**
- `src/components/procedures/diagnosis-combobox.tsx:21,32-37,39-63,69,109` — dedup + free-type
- `src/components/procedures/record-procedure-dialog.tsx:201-203,366`
- `src/components/clinical/case-summary-card.tsx:194,353-361` — `suggested_diagnoses` rendering
- `src/components/clinical/case-summary-edit-dialog.tsx:81,347-433` — field array editor
- `src/components/clinical/initial-visit-editor.tsx:288,1608` — diagnoses section
- `src/components/discharge/discharge-note-editor.tsx:173`

**Zod**
- `src/lib/validations/initial-visit-note.ts:60,87` — `diagnoses: z.string()`
- `src/lib/validations/discharge-note.ts:43,65` — `diagnoses: z.string()`
- `src/lib/validations/case-summary.ts:38-39,51,68` — `suggestedDiagnosisSchema`
- `src/lib/validations/prp-procedure.ts:3-4,73,84`
- `src/lib/validations/chiro-extraction.ts:24-25,81,90,104`
- `src/lib/validations/pain-management-extraction.ts:42-43,68,80`
- `src/lib/validations/pt-extraction.ts:103-104,136,152`
- `src/lib/validations/orthopedic-extraction.ts:32-42,84-85,95-96`
- `src/lib/validations/clinical-orders.ts:8,29`
- `src/lib/validations/invoice.ts:20-21`

**Migrations**
- `supabase/migrations/010_initial_visit_notes.sql:22` — `diagnoses text`
- `supabase/migrations/20260309194935_replace_initial_visit_notes_15_sections.sql:23`
- `supabase/migrations/016_discharge_notes.sql:15`
- `supabase/migrations/006_case_summaries.sql:13,48` — `suggested_diagnoses jsonb` + GIN
- `supabase/migrations/005_chiro_extractions.sql:21,60`
- `supabase/migrations/011_pain_management_extractions.sql:28,66`
- `supabase/migrations/012_pt_extractions.sql:60,96`
- `supabase/migrations/013_prp_procedure_encounter.sql:7-13`
- `supabase/migrations/021_orthopedic_extractions.sql:48-49,86`
- `supabase/migrations/017_invoice_enhancements.sql:29`

**Tests**
- `src/lib/claude/__tests__/generate-procedure-note.test.ts:324-640` — filter-phase coverage
  - `:384-388` V-code omission
  - `:633` radiculopathy downgrade worked example
- `src/lib/claude/__tests__/generate-initial-visit.test.ts:20,100` — fixture data
- `src/lib/validations/__tests__/prp-procedure.test.ts:8-103`
- `src/lib/validations/__tests__/chiro-extraction.test.ts:18-125`

---

## Architecture Documentation

**Where diagnostic filtering lives (current state)**

| Pipeline stage | Filter present? | Mechanism |
|---|---|---|
| Extraction (chiro/PM/PT/ortho) | No | Verbatim copy from source doc |
| Case summary (`suggested_diagnoses`) | No (tagging only) | `confidence` enum + `supporting_evidence` string; Rule 8 sets `"low"` on sparse/contradictory; no drop |
| Initial visit note | No | Region/visit-type code catalog in prompt; `"cross-reference"` instruction for high-confidence suggestions |
| Procedure note | Yes — filters A–E | DIAGNOSTIC-SUPPORT RULE drops V-codes, gates myelopathy, region-matches radiculopathy, handles sprain suffix, requires current-visit symptomatic support |
| Discharge note | No | Free-text assembly from upstream sources |
| Clinical orders | No | Region-keyed arrays, no validation |
| `fetchDiagnosisSuggestions` server action | Structural dedup only | `icd10_code.toUpperCase()` Set; regex is format-only, not semantic |
| `DiagnosisCombobox` UI | Structural dedup only | Exact-string Set; free-type regex `/^[A-Z][0-9A-Z.]{1,6}\s+(.+)$/i` |
| PDF templates | No | Render-time only |

**Data flow for user-flagged scenarios**

- **Lumbar radiculopathy without neuro deficits.** A radiculopathy code entering the pipeline from a PM/chiro/PT provider extraction → case summary (kept, tagged with confidence) → initial visit pain-eval note (no exam gate) → persisted as free-text `diagnoses`. The filter in §4 only activates when the code appears in a later procedure-note run; filter (C) requires region-matched objective findings there. Initial visit and discharge stages do not apply this gate.

- **Myalgia (M79.1) redundant with strain/region pain.** Listed as an allowed "General" code in the initial-visit prompt ([:170](src/lib/claude/generate-initial-visit.ts#L170)) with no redundancy rule. Procedure-note filter (E) explicitly flags `"M79.1 is additive-billing when kept alongside M54.2/M54.5 without independent diffuse-myalgia findings"` ([:462-467](src/lib/claude/generate-procedure-note.ts#L462-L467) + worked example). No guard at initial-visit or discharge.

- **M54.5 vs M54.50/M54.51/M54.59 specificity.** Only `M54.5` is listed in the initial-visit prompt catalogs ([:165](src/lib/claude/generate-initial-visit.ts#L165), [:267](src/lib/claude/generate-initial-visit.ts#L267)). The subcodes are not referenced anywhere in `src/lib/claude/` prompts. Strain code `S39.012A` (Strain of muscle/fascia/tendon of lower back) is offered alongside at [:165](src/lib/claude/generate-initial-visit.ts#L165), but no guidance on which to prefer.

**Procedure-note filter coverage of flagged weaknesses**

The DIAGNOSTIC-SUPPORT RULE explicitly addresses all three user-flagged issues, but only at the procedure-note stage:
- Radiculopathy → filter (C) (region-matched objective findings)
- M79.1 redundancy → filter (E) explicit guard
- M54.5 specificity → not addressed (filter keeps M54.5 when region still symptomatic; subcodes not mentioned)

---

## Related Research

- [2026-04-18-apply-medico-legal-editor-pass-to-procedure-note.md](thoughts/shared/research/2026-04-18-apply-medico-legal-editor-pass-to-procedure-note.md) — procedure-note medico-legal editor phases
- [2026-04-18-procedure-note-pain-persistence-tone.md](thoughts/shared/research/2026-04-18-procedure-note-pain-persistence-tone.md) — pain-tone branching in procedure prompt
- [2026-03-08-epic-2-story-2.3-clinical-case-summary-design.md](thoughts/shared/research/2026-03-08-epic-2-story-2.3-clinical-case-summary-design.md) — case-summary design
- [2026-03-09-epic-3-story-3.1-initial-visit-note-design.md](thoughts/shared/research/2026-03-09-epic-3-story-3.1-initial-visit-note-design.md) — initial visit design
- [2026-03-14-opus-vs-sonnet-report-generation.md](thoughts/shared/research/2026-03-14-opus-vs-sonnet-report-generation.md) — model selection

---

## Open Questions

- Whether any client-side or ETL layer (outside `src/`) pre-filters the case-summary `suggested_diagnoses` output by confidence before it reaches `generate-initial-visit.ts`. (Not found in the scan.)
- Whether initial-visit regeneration (`regenerateNoteSection`) runs the same prompt or a narrower one for the `diagnoses` section specifically. (Entry point at [src/actions/initial-visit-notes.ts](src/actions/initial-visit-notes.ts); section-level regeneration mentioned in `generate-initial-visit.ts` but its prompt slice for the diagnoses section was not traced here.)
- Whether `suggested_diagnoses` with `confidence: "low"` are rendered differently in the case-summary UI or filtered out of exported PDFs. (UI file `src/components/clinical/case-summary-card.tsx:194,353-361` shows rendering exists; no confidence-gated hide logic was traced.)
