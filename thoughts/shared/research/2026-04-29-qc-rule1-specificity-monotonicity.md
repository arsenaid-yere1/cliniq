---
date: 2026-04-29T22:17:29Z
researcher: arsenaid
git_commit: 94d86069e4369e3d26cac497a94e153b6dfe1fcf
branch: main
repository: cliniq
topic: "Is QC rule 1's specificity-monotonicity (preserved/sharpened, never coarsened) respected across the notes-generation chain?"
tags: [research, codebase, icd10, generators, qc, diagnoses, chain, monotonicity]
status: complete
last_updated: 2026-04-29
last_updated_by: arsenaid
---

# Research: Is QC rule 1's specificity-monotonicity respected across the notes-generation chain?

**Date**: 2026-04-29T22:17:29Z
**Researcher**: arsenaid
**Git Commit**: 94d86069e4369e3d26cac497a94e153b6dfe1fcf
**Branch**: main
**Repository**: cliniq

## Research Question

Per QC rule 1 ("Diagnosis progression — ICD-10 codes should evolve coherently across IV → pain-eval → procedure → discharge"), is the implied logic that **code specificity should be preserved or sharpened across the chain, not coarsened** respected in the notes-generation workflow?

This document describes what each generator stage does today w.r.t. code specificity. It does not evaluate or recommend changes.

## Summary

Rule 1 lives only in the **case-quality-review (QC) reviewer prompt** at [src/lib/claude/generate-quality-review.ts:109](src/lib/claude/generate-quality-review.ts#L109). The reviewer is asked to flag three specific specificity issues:

1. Radiculopathy emerging without imaging support
2. M54.5 used without a 5th-character subcode
3. "A"-suffix encounter codes persisting at discharge

Across the four generator stages (initial-visit, pain-evaluation, procedure-note, discharge-note), specificity is enforced by **prompt-only filters** (no deterministic post-validation of LLM output). Each generator independently re-derives its diagnosis list from a per-stage candidate pool; there is **no machine-readable structured-array carry-forward** across the full chain. The closest thing to a "preserve specificity" rule is the per-generator `DOWNGRADE-TO HONOR RULE` and the explicit anchor-code lists, plus the "keep [pain code]" instructions in each stage's downgrade table.

The chain stages and their specificity posture:

| Stage | Sees prior diagnoses as | Specificity rules |
|---|---|---|
| Initial visit | Nothing (`caseSummary`, `pmExtraction`, `priorVisitData` all null) | Whitelist of A-suffix sprain + region pain codes; M54.5 → 5th-char; no radiculopathy/disc-displacement; M79.1 redundancy guard |
| Pain evaluation | `caseSummary.suggested_diagnoses`, `pmExtraction.diagnoses`, prior IVN `diagnoses` (text only, narrative ref) | Filters A–F: myelopathy/radiculopathy gating with downgrades; M54.5 5th-char; M79.1 redundancy; suggested-confidence + provenance |
| Procedure note | `procedureRecord.diagnoses` (provider-committed jsonb), `pmSupplementaryDiagnoses`, `caseSummary.suggested_diagnoses`. **IVN diagnoses NOT loaded.** | Filters A–E + downgrade tables for two coding frameworks (traumatic vs degenerative); A-suffix → D-suffix on repeat visits |
| Discharge note | `procedures[].diagnoses` (jsonb across all procedures), `caseSummary.suggested_diagnoses`, `pmExtraction.diagnoses`. **IVN diagnoses arrive only as concatenated narrative text in `assessment_and_plan`, not as parsed codes.** | Filters A–G: V/W/X/Y absolute omit; myelopathy/radiculopathy gates; A→D/S transition; M79.1; M54.5 5th-char; symptom-resolution shift |

Key structural observations (descriptive, not evaluative):

1. **No stage runs `validateIcd10Code` / `normalizeIcd10Code` on the LLM payload pre-prompt or post-response.** Those helpers from [src/lib/icd10/validation.ts](src/lib/icd10/validation.ts) gate only the per-procedure combobox path ([src/actions/procedures.ts:222-224](src/actions/procedures.ts#L222-L224)) and IVN free-text parsing ([src/lib/icd10/parse-ivn-diagnoses.ts:17,20](src/lib/icd10/parse-ivn-diagnoses.ts#L17-L20)). They do not inspect generator inputs or outputs.

2. **The IV→procedure→discharge code transmission is structured (jsonb arrays); the IV→pain-eval and IV→discharge transmission of IVN codes is text-only.** IVN diagnoses are written as a free-text string by the IV generator, then either (a) parsed back into objects via regex for the procedures combobox ([src/lib/icd10/parse-ivn-diagnoses.ts:15](src/lib/icd10/parse-ivn-diagnoses.ts#L15)), or (b) concatenated with `treatment_plan` and passed as `initialVisitNote.assessment_and_plan` narrative to the discharge generator ([src/actions/discharge-notes.ts:464](src/actions/discharge-notes.ts#L464)). Lines that don't match the bullet/code/dash regex are silently dropped.

3. **The pain-evaluation generator does not receive the IVN diagnoses string as a code source.** It receives `priorVisitData.diagnoses` only for narrative comparison; the prompt names `caseSummary.suggested_diagnoses` and `pmExtraction.diagnoses` as candidate pools, not the prior IVN. (Same prompt file: [src/lib/claude/generate-initial-visit.ts:300](src/lib/claude/generate-initial-visit.ts#L300).)

4. **The procedure-note generator does not load IVN diagnoses at all.** [src/actions/procedure-notes.ts:88-94](src/actions/procedure-notes.ts#L88-L94) selects from `initial_visit_notes` without the `diagnoses` column.

5. **A-suffix → D-suffix transition is rule-based per stage, not enforced as a chain.** Procedure-note Filter D ([src/lib/claude/generate-procedure-note.ts:602](src/lib/claude/generate-procedure-note.ts#L602)) instructs A→D on repeat visits. Discharge Filter D ([src/lib/claude/generate-discharge-note.ts:419](src/lib/claude/generate-discharge-note.ts#L419)) prohibits A-suffix at discharge. Each stage applies its own rule from scratch against the pool it sees.

6. **The QC reviewer at [src/lib/claude/generate-quality-review.ts:97-129](src/lib/claude/generate-quality-review.ts#L97-L129) sees the full chain after the fact** — every note's `diagnoses` field plus per-procedure `diagnoses` jsonb plus `caseSummary.suggested_diagnoses`. Its rule-1 trigger phrasing names three pattern violations explicitly and does not phrase a generalized "no coarsening" check.

## Detailed Findings

### Stage 1: Initial visit generator

**File:** [src/lib/claude/generate-initial-visit.ts](src/lib/claude/generate-initial-visit.ts)

**What prior diagnoses it sees:** Nothing. For `visitType === 'initial_visit'`, [src/actions/initial-visit-notes.ts:72](src/actions/initial-visit-notes.ts#L72) sets `loadImagingContext = false`, which short-circuits `summaryQuery`, `pmQuery`, and `priorVisitQuery` to `{ data: null, error: null }` ([src/actions/initial-visit-notes.ts:85-108](src/actions/initial-visit-notes.ts#L85-L108)). The generator is explicitly told `caseSummary`, `pmExtraction`, `priorVisitData` are null ([src/lib/claude/generate-initial-visit.ts:152-158](src/lib/claude/generate-initial-visit.ts#L152-L158)).

**Specificity rules in IV section:**
- Whitelist of A-suffix sprain + region pain codes by body region ([src/lib/claude/generate-initial-visit.ts:178-188](src/lib/claude/generate-initial-visit.ts#L178-L188)). All traumatic codes are A-suffix ("initial encounter").
- M54.5 parent prohibition with 5th-char subcodes M54.50 / M54.51 / M54.59 ([src/lib/claude/generate-initial-visit.ts:192-195](src/lib/claude/generate-initial-visit.ts#L192-L195)).
- M79.1 redundancy guard ([src/lib/claude/generate-initial-visit.ts:197-198](src/lib/claude/generate-initial-visit.ts#L197-L198)).
- No radiculopathy / disc-displacement codes at first visit ([src/lib/claude/generate-initial-visit.ts:188,199](src/lib/claude/generate-initial-visit.ts#L188)).

**Output:** Free-text `diagnoses` string. Schema validates only `z.string()` ([src/lib/validations/initial-visit-note.ts:49-66](src/lib/validations/initial-visit-note.ts#L49-L66)). Stored to `initial_visit_notes.diagnoses` (text column).

### Stage 2: Pain-evaluation generator

**File:** Same as IV ([src/lib/claude/generate-initial-visit.ts](src/lib/claude/generate-initial-visit.ts)) — dispatched by `buildSystemPrompt()` at lines 349-352, using `PAIN_EVALUATION_VISIT_SECTIONS` ([src/lib/claude/generate-initial-visit.ts:245-347](src/lib/claude/generate-initial-visit.ts#L245-L347)).

**What prior diagnoses it sees:**
- `caseSummary.suggested_diagnoses` — jsonb array of `{ icd10_code, confidence, downgrade_to, supporting_evidence }` from the case summary ([src/actions/initial-visit-notes.ts:289-296](src/actions/initial-visit-notes.ts#L289-L296)).
- `pmExtraction.diagnoses` — with `provider_overrides.diagnoses` precedence ([src/actions/initial-visit-notes.ts:212-219](src/actions/initial-visit-notes.ts#L212-L219)).
- `priorVisitData.diagnoses` — IVN diagnoses string for narrative reference only, not named as candidate code source ([src/actions/initial-visit-notes.ts:255](src/actions/initial-visit-notes.ts#L255), [src/lib/claude/generate-initial-visit.ts:251-269](src/lib/claude/generate-initial-visit.ts#L251-L269)).

**Specificity rules:**
- DIAGNOSTIC-SUPPORT RULE — list is filtered, not copied ([src/lib/claude/generate-initial-visit.ts:300-302](src/lib/claude/generate-initial-visit.ts#L300-L302)).
- DOWNGRADE-TO HONOR RULE — uses `downgrade_to` from case summary ([src/lib/claude/generate-initial-visit.ts:302](src/lib/claude/generate-initial-visit.ts#L302)).
- Filter A: myelopathy gating + downgrade ([src/lib/claude/generate-initial-visit.ts:304-305](src/lib/claude/generate-initial-visit.ts#L304-L305)).
- Filter B: radiculopathy region-matched objective findings + downgrade + prose-fallback ([src/lib/claude/generate-initial-visit.ts:306-311](src/lib/claude/generate-initial-visit.ts#L306-L311)). M54.12/M50.1X → M50.20 + keep M54.2; M54.17/M51.17 → M51.37 + keep lumbar pain code; M51.16 → M51.36 + keep lumbar pain code.
- Filter C: M79.1 redundancy ([src/lib/claude/generate-initial-visit.ts:313](src/lib/claude/generate-initial-visit.ts#L313)).
- Filter D: M54.5 5th-character ([src/lib/claude/generate-initial-visit.ts:315-318](src/lib/claude/generate-initial-visit.ts#L315-L318)). Adds an imaging-correlate condition for M54.51 (Modic changes) not present in the IV version.
- Filter E: confidence handling for `suggested_diagnoses` ([src/lib/claude/generate-initial-visit.ts:320](src/lib/claude/generate-initial-visit.ts#L320)).
- Filter F: pmExtraction provenance ([src/lib/claude/generate-initial-visit.ts:322-323](src/lib/claude/generate-initial-visit.ts#L322-L323)).

**Output:** Same free-text `diagnoses` string into `initial_visit_notes.diagnoses` (text).

### Stage 3: Procedure-note generator

**File:** [src/lib/claude/generate-procedure-note.ts](src/lib/claude/generate-procedure-note.ts)

**What prior diagnoses it sees:**
- `procedureRecord.diagnoses` — `Array<{ icd10_code: string | null; description: string }>` jsonb, provider-committed ([src/lib/claude/generate-procedure-note.ts:40](src/lib/claude/generate-procedure-note.ts#L40)).
- `pmSupplementaryDiagnoses` — PM codes NOT already in `procedureRecord.diagnoses`, with evidence tags ([src/actions/procedure-notes.ts:405-427](src/actions/procedure-notes.ts#L405-L427)).
- `caseSummary.suggested_diagnoses`.
- **IVN diagnoses NOT loaded** — [src/actions/procedure-notes.ts:88-94](src/actions/procedure-notes.ts#L88-L94) selects from `initial_visit_notes` without the `diagnoses` column.

**`procedureRecord.diagnoses` is the result of the combobox path:**
- `getCaseDiagnoses()` ([src/actions/procedures.ts:181-271](src/actions/procedures.ts#L181-L271)) merges PM extraction codes (validated + normalized via `validateIcd10Code` / `normalizeIcd10Code` at lines 222-226) with IVN free-text codes parsed via `parseIvnDiagnoses` (line 245). Lines failing the regex `/^[•\-\d.]*\s*([A-Z]\d{1,2}\.?\d{0,4}[A-Z]{0,4})\s*[—–\-]\s*(.+)$/i` are silently dropped ([src/lib/icd10/parse-ivn-diagnoses.ts:15](src/lib/icd10/parse-ivn-diagnoses.ts#L15)). Provider then selects subset; selection is written to `procedures.diagnoses` jsonb.

**Specificity rules:**
- DIAGNOSTIC-SUPPORT RULE + SOURCE PRECEDENCE RULE ([src/lib/claude/generate-procedure-note.ts:569-581](src/lib/claude/generate-procedure-note.ts#L569-L581)).
- CODING FRAMEWORK RULE — binary traumatic vs degenerative-with-superimposed-trauma; anchor codes per region ([src/lib/claude/generate-procedure-note.ts:583-589](src/lib/claude/generate-procedure-note.ts#L583-L589)).
- DOWNGRADE-TO HONOR RULE ([src/lib/claude/generate-procedure-note.ts:591](src/lib/claude/generate-procedure-note.ts#L591)).
- Filter A: V/W/X/Y absolute omission ([src/lib/claude/generate-procedure-note.ts:593](src/lib/claude/generate-procedure-note.ts#L593)).
- Filter B: myelopathy gating ([src/lib/claude/generate-procedure-note.ts:595](src/lib/claude/generate-procedure-note.ts#L595)).
- Filter C: radiculopathy region-match + prose-fallback ([src/lib/claude/generate-procedure-note.ts:597-600](src/lib/claude/generate-procedure-note.ts#L597-L600)).
- Filter D: A-suffix on repeat visits → D-suffix or omit ([src/lib/claude/generate-procedure-note.ts:602](src/lib/claude/generate-procedure-note.ts#L602)).
- Filter E: current-visit support per code ([src/lib/claude/generate-procedure-note.ts:604-611](src/lib/claude/generate-procedure-note.ts#L604-L611)).
- Downgrade tables per framework ([src/lib/claude/generate-procedure-note.ts:613-627](src/lib/claude/generate-procedure-note.ts#L613-L627)) — every entry pairs the downgrade with a "keep [pain code]" instruction.
- M54.5 not directly named in prompt; only enforced upstream in combobox via `NON_BILLABLE_PARENT_CODES` ([src/lib/icd10/validation.ts:13-15](src/lib/icd10/validation.ts#L13-L15)).

**Output:** Diagnoses appear inside `assessment_and_plan` (text). No structured `diagnoses` column on `procedure_notes` ([src/types/database.ts:820](src/types/database.ts#L820) — `procedure_notes` table has no `diagnoses` field).

### Stage 4: Discharge-note generator

**File:** [src/lib/claude/generate-discharge-note.ts](src/lib/claude/generate-discharge-note.ts)

**What prior diagnoses it sees:**
- `procedures[].diagnoses` — jsonb across all procedures ([src/actions/discharge-notes.ts:63-68,216-219](src/actions/discharge-notes.ts#L63-L68)).
- `caseSummary.suggested_diagnoses` ([src/actions/discharge-notes.ts:457](src/actions/discharge-notes.ts#L457)).
- `pmExtraction.diagnoses` with `provider_overrides` precedence ([src/actions/discharge-notes.ts:477-491](src/actions/discharge-notes.ts#L477-L491)).
- `ptExtraction.diagnoses`, `chiroExtraction.diagnoses` — present in payload, NOT named as filter-target sources in the prompt.
- **IVN diagnoses arrive only inside `initialVisitNote.assessment_and_plan` as `[diagnoses, treatment_plan].filter(Boolean).join('\n\n')`** ([src/actions/discharge-notes.ts:464](src/actions/discharge-notes.ts#L464)) — unstructured narrative text, not a parsed code list.

**Specificity rules:**
- DIAGNOSTIC-SUPPORT RULE + DOWNGRADE-TO HONOR RULE ([src/lib/claude/generate-discharge-note.ts:404-407](src/lib/claude/generate-discharge-note.ts#L404-L407)).
- Filter A: V/W/X/Y absolute omission ([src/lib/claude/generate-discharge-note.ts:408-410](src/lib/claude/generate-discharge-note.ts#L408-L410)).
- Filter B: myelopathy gating + downgrade + prose-fallback ([src/lib/claude/generate-discharge-note.ts:410-411](src/lib/claude/generate-discharge-note.ts#L410-L411)).
- Filter C: radiculopathy gating + downgrade + prose-fallback ([src/lib/claude/generate-discharge-note.ts:413-417](src/lib/claude/generate-discharge-note.ts#L413-L417)).
- Filter D: A-suffix → D or S at discharge ([src/lib/claude/generate-discharge-note.ts:419](src/lib/claude/generate-discharge-note.ts#L419)).
- Filter E: M79.1 redundancy ([src/lib/claude/generate-discharge-note.ts:421-422](src/lib/claude/generate-discharge-note.ts#L421-L422)).
- Filter F: M54.5 5th-character ([src/lib/claude/generate-discharge-note.ts:423](src/lib/claude/generate-discharge-note.ts#L423)).
- Filter G: symptom-resolution / sequela shift ([src/lib/claude/generate-discharge-note.ts:425-426](src/lib/claude/generate-discharge-note.ts#L425-L426)).

The phrase "substitute the downgrade … rather than leaving pathology unrepresented" ([src/lib/claude/generate-discharge-note.ts:405](src/lib/claude/generate-discharge-note.ts#L405)) is the closest verbatim equivalent of "do not coarsen without preserving pathology". The phrases "preserve specificity", "do not coarsen", "carry forward", "do not regress" do not appear verbatim.

**Output:** Free-text `diagnoses` written to `discharge_notes.diagnoses` (text) ([src/actions/discharge-notes.ts:827](src/actions/discharge-notes.ts#L827)).

### Stage 5: QC reviewer (case-quality-review)

**File:** [src/lib/claude/generate-quality-review.ts](src/lib/claude/generate-quality-review.ts)

**Rule 1 verbatim:**
```
1. Diagnosis progression. ICD-10 codes should evolve coherently across IV → pain-eval → procedure → discharge. Flag radiculopathy emerging without imaging support, M54.5 used without 5th-character specificity, "A"-suffix codes persisting at discharge.
```
([src/lib/claude/generate-quality-review.ts:109](src/lib/claude/generate-quality-review.ts#L109)).

**Input:** Full case payload — every note's `diagnoses` text plus per-procedure `diagnoses` jsonb plus `caseSummary.suggested_diagnoses` ([src/lib/claude/generate-quality-review.ts:9-92](src/lib/claude/generate-quality-review.ts#L9-L92)). Reviewer is the only stage that sees all four note diagnoses simultaneously.

**Rule-1 named patterns:**
1. Radiculopathy emerging without imaging support — addresses Filter B/C upstream behavior.
2. M54.5 without 5th-character — addresses M54.5 prohibition rule.
3. A-suffix codes persisting at discharge — addresses A→D/S transition.

These are pattern matches, not a generalized "specificity must be monotonic non-decreasing" check.

### Deterministic helpers (icd10/validation.ts)

**File:** [src/lib/icd10/validation.ts](src/lib/icd10/validation.ts)

**Exports:**
- `validateIcd10Code(raw)` — structural regex + `NON_BILLABLE_PARENT_CODES` lookup ([src/lib/icd10/validation.ts:21-34](src/lib/icd10/validation.ts#L21-L34)).
- `normalizeIcd10Code(raw)` — applies parent→child substitution ([src/lib/icd10/validation.ts:36-41](src/lib/icd10/validation.ts#L36-L41)).
- `classifyIcd10Code(code)` — `'myelopathy' | 'radiculopathy' | 'other'` via `MYELOPATHY_CODE_PATTERN` and `RADICULOPATHY_CODE_PATTERN` ([src/lib/icd10/validation.ts:62-68](src/lib/icd10/validation.ts#L62-L68)).
- `NON_BILLABLE_PARENT_CODES` — currently `{ 'M54.5': 'M54.50' }` ([src/lib/icd10/validation.ts:13-15](src/lib/icd10/validation.ts#L13-L15)).

**Where used (descriptive):**
- `src/components/procedures/diagnosis-combobox.tsx:30,62,98` — UI guardrails on suggestion click and free-text entry
- `src/actions/procedures.ts:222,224` — `getCaseDiagnoses()` server action, when normalizing PM extraction codes for combobox
- `src/lib/icd10/parse-ivn-diagnoses.ts:17,20` — IVN free-text parsing path

**Where NOT used:**
- None of the four generator files (`generate-initial-visit.ts`, `generate-procedure-note.ts`, `generate-discharge-note.ts`, `generate-quality-review.ts`) imports from `@/lib/icd10/validation`.
- No post-LLM Zod schema invokes any function from `validation.ts`. The `diagnoses` field across `initialVisitNoteResultSchema` ([src/lib/validations/initial-visit-note.ts:49-66](src/lib/validations/initial-visit-note.ts#L49-L66)) and `dischargeNoteResultSchema` ([src/lib/validations/discharge-note.ts:36-49](src/lib/validations/discharge-note.ts#L36-L49)) is plain `z.string()`.

### Chain transmission diagram (descriptive)

```
case_summaries.suggested_diagnoses (jsonb structured, with downgrade_to)
   ├── PE generator (filter sources)
   ├── procedure-note generator (framework + downgrade target)
   └── discharge generator (filter source)

initial_visit_notes.diagnoses (text, free-form)
   ├── PE generator (priorVisitData.diagnoses — narrative ref, NOT code source)
   ├── procedures combobox via parseIvnDiagnoses (regex parse — silent drops on mismatch)
   └── discharge generator (concatenated into initialVisitNote.assessment_and_plan narrative)

procedures.diagnoses (jsonb structured, provider-committed)
   ├── procedure-note generator (PRIMARY source)
   └── discharge generator (jsonb across all procedures)

procedure_notes.assessment_and_plan (text, contains DIAGNOSES: heading)
   └── NOT machine-read by any downstream stage

pain_management_extractions.diagnoses (with provider_overrides precedence)
   ├── PE generator
   ├── procedure-note generator (as pmSupplementaryDiagnoses, deduped)
   └── discharge generator
```

## Code References

- [src/lib/claude/generate-quality-review.ts:109](src/lib/claude/generate-quality-review.ts#L109) — Rule 1 verbatim text
- [src/lib/claude/generate-initial-visit.ts:178-188](src/lib/claude/generate-initial-visit.ts#L178-L188) — IV whitelist of A-suffix sprain + region pain codes
- [src/lib/claude/generate-initial-visit.ts:192-195](src/lib/claude/generate-initial-visit.ts#L192-L195) — IV M54.5 rule
- [src/lib/claude/generate-initial-visit.ts:300-323](src/lib/claude/generate-initial-visit.ts#L300-L323) — PE filters A–F
- [src/lib/claude/generate-procedure-note.ts:583-627](src/lib/claude/generate-procedure-note.ts#L583-L627) — Procedure framework + filters + downgrade tables
- [src/lib/claude/generate-discharge-note.ts:401-426](src/lib/claude/generate-discharge-note.ts#L401-L426) — Discharge filters A–G
- [src/actions/initial-visit-notes.ts:72-108](src/actions/initial-visit-notes.ts#L72-L108) — `loadImagingContext` gate
- [src/actions/procedure-notes.ts:88-94](src/actions/procedure-notes.ts#L88-L94) — IVN select WITHOUT diagnoses column
- [src/actions/discharge-notes.ts:464](src/actions/discharge-notes.ts#L464) — IVN diagnoses concatenated into narrative
- [src/lib/icd10/validation.ts:13-15](src/lib/icd10/validation.ts#L13-L15) — `NON_BILLABLE_PARENT_CODES`
- [src/lib/icd10/parse-ivn-diagnoses.ts:11-25](src/lib/icd10/parse-ivn-diagnoses.ts#L11-L25) — `parseIvnDiagnoses` regex parser

## Architecture Documentation

**Per-stage filter authority.** Each generator carries its own DIAGNOSTIC-SUPPORT RULE block and re-evaluates the candidate pool independently. There is no cross-stage rule that says "the discharge code list must be at least as specific, code-by-code, as the prior procedure code list". Each downgrade is computed from the current stage's evidence against its own pool.

**Two carry-forward currencies.**
- **Structured jsonb arrays** flow IVN-form → `procedures.diagnoses` → procedure-note generator + discharge generator. These preserve `{ icd10_code, description }` plus optional evidence tags.
- **Free-text strings** flow IV generator → `initial_visit_notes.diagnoses` → (a) regex parse for combobox, (b) narrative concatenation into discharge `assessment_and_plan`. The free-text path drops lines that don't match the bullet-code-dash regex.

**Downgrade always pairs with "keep pain code".** Each downgrade entry in PE Filter B, procedure-note downgrade tables, and discharge Filter B/C is written as "replace [specific code] with [less-specific anchor code] AND keep [region pain code]". The pairing is the prompts' way of preserving region representation when the more-specific code fails its evidence gate.

**`downgrade_to` precomputed in case summary.** The `case_summaries.suggested_diagnoses[].downgrade_to` field is generated once by the case-summary stage and honored by PE, procedure-note, and discharge generators. This is the only cross-stage precomputed substitution mechanism.

**LLM enforcement only.** All filter logic is prompt text. No generator runs `validateIcd10Code` on its input or output. No Zod schema parses the `diagnoses` field as anything other than `z.string()`. The QC reviewer is itself an LLM call and applies pattern-match rules in prompt text.

## Related Research

- [thoughts/shared/research/2026-04-28-clinical-note-qc-pi-workflow.md](thoughts/shared/research/2026-04-28-clinical-note-qc-pi-workflow.md) — case-quality-review agent design context
- [thoughts/shared/research/2026-04-20-diagnostic-accuracy-icd-selection.md](thoughts/shared/research/2026-04-20-diagnostic-accuracy-icd-selection.md) — earlier ICD selection design
- [thoughts/shared/research/2026-04-21-pm-diagnosis-mri-exam-support-flow.md](thoughts/shared/research/2026-04-21-pm-diagnosis-mri-exam-support-flow.md) — PM diagnosis evidence-support pipeline
- [thoughts/shared/research/2026-04-20-pm-notes-diagnosis-generation.md](thoughts/shared/research/2026-04-20-pm-notes-diagnosis-generation.md) — PM notes diagnosis generation

## Open Questions

- Whether QC rule 1 currently flags coarsening cases that fall outside its three named patterns (e.g., a procedure note that emits M51.36 where the case summary's `downgrade_to` was M51.37 — same family but coarser sublevel) is observable only by reading historical QC outputs against historical chains, not from prompt text alone.
- Whether the IV→discharge text-only path (IVN diagnoses → narrative concatenation) loses A-suffix tokens that the discharge generator could otherwise recognize for A→D conversion is observable only by inspecting actual discharge inputs and outputs.
