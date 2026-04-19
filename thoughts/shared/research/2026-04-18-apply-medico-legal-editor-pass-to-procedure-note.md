---
date: 2026-04-19T01:28:00+0000
researcher: arsenaid
git_commit: fef3bb365461da79ec6f4d6873b474a75300bf24
branch: main
repository: cliniq
topic: "How to apply a medico-legal editor revision pass to the PRP procedure-note generator"
tags: [research, codebase, procedure-notes, prompts, medico-legal, defensibility, minors, placeholders, session-numbering]
status: complete
last_updated: 2026-04-19
last_updated_by: arsenaid
---

# Research: How to apply a medico-legal editor revision pass to the PRP procedure-note generator

**Date**: 2026-04-19T01:28:00+0000
**Researcher**: arsenaid
**Git Commit**: fef3bb365461da79ec6f4d6873b474a75300bf24
**Branch**: main
**Repository**: cliniq

## Research Question

The user supplied a **worked example** of a medico-legal editor prompt — a single-patient revision pass for a 16-year-old PI patient's PRP note. The question is not "install this prompt verbatim" but: **which techniques from that example can the existing procedure-note generator absorb, where would each technique be wired, and what data / schema / UI dependencies does each technique have today?**

The attached research [2026-04-18-prp-procedure-physical-exam-improvement-tone.md](2026-04-18-prp-procedure-physical-exam-improvement-tone.md) establishes the current structural baseline: `paintoneLabel` is wired into 4 of 20 sections (`subjective`, `review_of_systems`, `assessment_summary`, `prognosis`) and **not** into `objective_physical_exam` or `objective_vitals`; the physical-exam source is a single `pmExtraction.physical_exam` JSONB shared across every procedure in the case.

This document maps the example prompt's discrete techniques onto the current generator at [src/lib/claude/generate-procedure-note.ts](src/lib/claude/generate-procedure-note.ts), the source-data pipeline at [src/actions/procedure-notes.ts](src/actions/procedure-notes.ts), and the UI/DB around them. It is **documentation**, not an implementation plan.

## Summary

The example prompt isn't a drop-in replacement — it's a one-shot editor pass written around a specific patient (minor, 16 yo). Its value, for a reusable generator, is the set of **techniques** it demonstrates. Those techniques fall into three categories based on how they map onto the current codebase:

| Category | Techniques | Codebase state |
|---|---|---|
| **A. Prompt-only (purely text changes in `SYSTEM_PROMPT`)** | Anti-marketing guardrails ("highly concentrated growth factors", "regeneration" absolutes), "do not pre-commit to a 3-injection series", diagnostic-coherence rule ("do not imply disc-directed healing if technique is paraspinal"), neutral follow-up phrasing, bracketed `[confirm ...]` placeholders for missing prep data, deposition-defensibility tone | All feasible today. The current prompt already uses `paintoneLabel`-keyed branches ([L128–144](src/lib/claude/generate-procedure-note.ts#L128-L144), [L178–191](src/lib/claude/generate-procedure-note.ts#L178-L191)) — same mechanism would carry these new directives. |
| **B. Prompt + data-availability-aware (text changes that branch on data already in `ProcedureNoteInputData`)** | "Describe only the procedure actually performed" (branch on `guidance_method` ∈ `{ultrasound, fluoroscopy, landmark}` and `target_confirmed_imaging` to avoid disc-directed language when landmark-only or US-guided paraspinal), "insert `[confirm ...]` when prep fields are null", session-number-aware wording that avoids "N of 3" when no series total is recorded | Feasible today — all referenced fields already exist on the input payload ([generate-procedure-note.ts:29-52](src/lib/claude/generate-procedure-note.ts#L29-L52)) and are populated from the procedure record ([procedure-notes.ts:181-204](src/actions/procedure-notes.ts#L181-L204)). |
| **C. Requires schema / UI / pipeline work first** | Minor-patient consent branch (guardian written consent + patient verbal assent — distinct roles), "failed conservative care" citation, consent-witness / signer-relationship capture | Not feasible from the prompt alone. `consent_obtained` is a single boolean ([013_prp_procedure_encounter.sql:8](supabase/migrations/013_prp_procedure_encounter.sql#L8)); there is no guardian field, no assent field, no conservative-care history field. A consent-form / signer-relationship plan exists ([2026-04-08-procedure-consent-form.md](../plans/2026-04-08-procedure-consent-form.md)) but is unimplemented. |

Three orthogonal cross-cutting findings matter for any revision:

1. **Age is already anchored to visit date** — [procedure-notes.ts:165](src/actions/procedure-notes.ts#L165) calls `computeAgeAtDate(patient.date_of_birth, proc.procedure_date)`, so an `age < 18` branch in the prompt would see the correct age on procedure day. But there is **zero other minor-aware logic anywhere in the codebase** (no `minor`, `guardian`, `assent`, `pediatric` tokens).
2. **Diagnoses are not auto-aligned to the procedure performed** — [procedures.ts:170-227](src/actions/procedures.ts#L170-L227) surfaces case-level diagnoses from `pain_management_extractions` and `initial_visit_notes` for the provider to pick from; nothing validates that the chosen ICD-10 codes describe structures the recorded `injection_site` / `guidance_method` actually treated. The example prompt's "diagnostic coherence" directive therefore has to be enforced at the prompt level only.
3. **Section-level regeneration re-uses the full `SYSTEM_PROMPT`** — both full generation ([L306-324](src/lib/claude/generate-procedure-note.ts#L306-L324)) and per-section regeneration ([L344-373](src/lib/claude/generate-procedure-note.ts#L344-L373)) read the same constant, so any prompt revision propagates to both paths automatically. Regeneration is user-invoked per-section via a button on each textarea in [procedure-note-editor.tsx:481-511](src/components/procedures/procedure-note-editor.tsx#L481-L511).

## Detailed Findings

### 1. Mapping the example prompt's directives onto current prompt sections

The example prompt is organized as "Core objective → Critical context → Constraints → Preserve → Fix → Style → Output format → Issue log." For a reusable generator prompt, these need to be re-expressed as per-section directives, because the current `SYSTEM_PROMPT` is organized by the 20 structured output fields ([generate-procedure-note.ts:123-245](src/lib/claude/generate-procedure-note.ts#L123-L245)).

Below is the correspondence between each directive in the example and the section(s) in the current prompt where it would land.

#### 1a. "Do not pre-commit to a fixed 3-injection series"

- **Current section**: `16. procedure_followup` at [L222-L224](src/lib/claude/generate-procedure-note.ts#L222-L224). Reference example reads *"Patient was reminded of the potential need for 1-2 additional PRP injections, depending on the degree of symptom improvement."*
- **Also relevant**: `18. patient_education` at [L231-L233](src/lib/claude/generate-procedure-note.ts#L231-L233), which can reference the injection plan.
- **Data available**: `procedureRecord.procedure_number` ([L32](src/lib/claude/generate-procedure-note.ts#L32)) — but **no series total** field exists in the `procedures` schema ([013_prp_procedure_encounter.sql](supabase/migrations/013_prp_procedure_encounter.sql)) or on the payload. `procedure_number` is derived by counting existing procedures ([procedures.ts:92-98](src/actions/procedures.ts#L92-L98)).
- **Current behavior**: The existing reference example already uses soft wording ("1-2 additional") rather than "Session N of 3." No codebase search turned up hardcoded "of 3" strings.
- **What the example prompt adds**: explicit prohibition — "Do not automatically state 'Session 1 of 3,' '2 of 3,' or '3 of 3' unless explicitly documented for that visit." This is a prompt-only constraint that could be added to sections 16 and 18.

#### 1b. "Diagnostic coherence — don't imply disc-directed healing when technique is paraspinal"

- **Current section**: `10. procedure_indication` at [L198-L200](src/lib/claude/generate-procedure-note.ts#L198-L200), where the reference writes *"PRP injection to promote joint healing and reduce inflammation due to the 3.2 mm disc protrusion at L5-S1..."* This reference phrasing itself implies disc-directed healing.
- **Related section**: `14. procedure_injection` at [L214-L216](src/lib/claude/generate-procedure-note.ts#L214-L216). Reference: *"Under ultrasound guidance, a 25-gauge spinal needle was inserted into the facet joint..."*
- **Data available**: `procedureRecord.guidance_method` ∈ `{'ultrasound', 'fluoroscopy', 'landmark'}` ([014_prp_procedure_details.sql:18-23](supabase/migrations/014_prp_procedure_details.sql#L18-L23)), `procedureRecord.injection_site`, `procedureRecord.target_confirmed_imaging: boolean` — all present on the input payload ([generate-procedure-note.ts:45-48](src/lib/claude/generate-procedure-note.ts#L45-L48)).
- **Current behavior**: The prompt does not cross-reference the indication (disc protrusion) with the technique performed (US-guided facet). The example prompt flags this as a defensibility issue.
- **What the example prompt adds**: a rule tying the language in `procedure_indication` to `guidance_method` + `injection_site` — e.g., "if `guidance_method = 'ultrasound'` and the site is paraspinal, describe the target as periarticular / facet capsular / paraspinal musculoligamentous, not as disc-directed." This is feasible purely in the prompt because all the fields are already in the payload.

#### 1c. Bracketed `[confirm ...]` placeholders for missing prep data

- **Current sections**: `12. procedure_prp_prep` at [L206-L208](src/lib/claude/generate-procedure-note.ts#L206-L208), `13. procedure_anesthesia` at [L210-L212](src/lib/claude/generate-procedure-note.ts#L210-L212), `14. procedure_injection` at [L214-L216](src/lib/claude/generate-procedure-note.ts#L214-L216).
- **Data available** ([generate-procedure-note.ts:37-50](src/lib/claude/generate-procedure-note.ts#L37-L50)): `blood_draw_volume_ml`, `centrifuge_duration_min`, `prep_protocol`, `kit_lot_number`, `anesthetic_agent`, `anesthetic_dose_ml`, `injection_volume_ml`, `needle_gauge`, `guidance_method`, `target_confirmed_imaging` — all nullable.
- **Current behavior**: The prompt has no explicit instruction for what to do when a field is null. It has a single global guard at [L245](src/lib/claude/generate-procedure-note.ts#L245): *"Do not fabricate specific measurements, test results, or vital signs — use brackets only for data that requires in-person examination."* This covers exam-time vitals but not prep metadata.
- **What the example prompt adds**: named placeholder tokens (`[confirm exact PRP preparation system]`, `[confirm total PRP yield]`, `[confirm site-specific injectate distribution]`) to insert when those specific fields are missing. This is a prompt-only change; the fields being missing is already visible to the model because nulls ride through `JSON.stringify(inputData)` at [L315](src/lib/claude/generate-procedure-note.ts#L315).

#### 1d. Anti-marketing / anti-hype language

- **Current section**: `12. procedure_prp_prep` reference at [L208](src/lib/claude/generate-procedure-note.ts#L208) literally contains the phrase **"a highly concentrated amount of growth factors intended to promote tissue repair"** — one of the exact phrases the example prompt calls out as marketing hype.
- **Related sections**: `18. patient_education` at [L231-L233](src/lib/claude/generate-procedure-note.ts#L231-L233) ("role in promoting tissue regeneration"), `19. prognosis` at [L235-L238](src/lib/claude/generate-procedure-note.ts#L235-L238).
- **Current behavior**: No forbidden-phrase list for marketing/hype exists. There **is** a forbidden-phrase list — but only in `objective_physical_exam` at [L181](src/lib/claude/generate-procedure-note.ts#L181), and only for persistence-flavored phrasing that contradicts `paintoneLabel = "improved"`.
- **What the example prompt adds**: a parallel forbidden-phrase list targeted at sections 12 and 18 covering "highly concentrated growth factors," absolute regeneration claims, unsupported necessity claims, etc. The mechanism (FORBIDDEN PHRASES block) already exists in the codebase — this is a structural copy applied to different sections.

#### 1e. Minor-patient consent language (guardian written consent + patient verbal assent)

- **Current section**: `11. procedure_preparation` at [L202-L204](src/lib/claude/generate-procedure-note.ts#L202-L204). Reference: *"Informed consent was obtained from the patient. The risks, benefits, and alternatives of the PRP procedure were thoroughly explained..."* — written entirely in adult-patient voice.
- **Data available**: `age` (correctly computed at procedure date — [procedure-notes.ts:165](src/actions/procedure-notes.ts#L165), passed as top-level [`age` field](src/lib/claude/generate-procedure-note.ts#L23)). `procedureRecord.consent_obtained: boolean | null` ([013_prp_procedure_encounter.sql:8](supabase/migrations/013_prp_procedure_encounter.sql#L8)). Nothing else.
- **Missing data**: No field captures who consented, no guardian name, no patient-signer-relationship, no assent flag. The consent UI is a single shadcn Checkbox per [2026-04-06-procedure-consent-form-implementation.md](2026-04-06-procedure-consent-form-implementation.md).
- **Current behavior**: Zero minor/guardian/assent/pediatric tokens anywhere in the codebase. The prompt does not branch on age.
- **What the example prompt adds**: an age-conditional `procedure_preparation` branch — "if age < 18, phrase consent as *guardian provided written informed consent* and *patient provided verbal assent*; otherwise keep current adult phrasing."
- **What is implementable today vs. not**:
  - *Prompt-only, implementable now*: adding an `age < 18` text branch that cites guardian consent in general terms, since the CHECK of `consent_obtained = true` already acts as a proxy for "a consent step happened." The example prompt's own guidance — "Retain explicit guardian written consent and patient verbal assent" — treats this as language to preserve, not data to invent, so the prompt can instruct the model to include the construct whenever `age < 18`.
  - *Requires schema work*: distinguishing "guardian signed" vs "adult patient signed" at the data level, capturing the signer's name, or referencing them by relationship ("mother," "legal guardian"). See the unimplemented plan at [2026-04-08-procedure-consent-form.md](../plans/2026-04-08-procedure-consent-form.md), which designs a `patient_signer_relationship` field and minor-retention rules.

#### 1f. "Failed conservative care" citation for medical necessity

- **Current section**: `9. assessment_summary` at [L193-L196](src/lib/claude/generate-procedure-note.ts#L193-L196), `10. procedure_indication` at [L198-L200](src/lib/claude/generate-procedure-note.ts#L198-L200).
- **Data available**: No procedure-level field for prior conservative-care attempts. `chiroExtraction.functional_outcomes` is pulled ([procedure-notes.ts:100-108](src/actions/procedure-notes.ts#L100-L108)) but exposed to the prompt only as the derived `chiroProgress` enum ([generate-procedure-note.ts:70](src/lib/claude/generate-procedure-note.ts#L70)). `ptExtraction` is not pulled for procedure notes at all (it is pulled for discharge notes — see [generate-discharge-note.ts:71-96](src/lib/claude/generate-discharge-note.ts#L71-L96)).
- **Current behavior**: The prompt has no directive to cite failed conservative care. Any such citation in the current output comes from the model generalizing from training data.
- **What the example prompt adds**: a requirement to cite conservative-care failure only if documented, otherwise mark with a placeholder. **Implementable today but partial** — the prompt can instruct "cite prior PT/chiro trials only if `chiroProgress` or a new `ptExtraction` field is present; otherwise insert `[confirm prior conservative care]`." A fuller implementation would surface `ptExtraction` and/or a dedicated conservative-care history field into `ProcedureNoteInputData`.

#### 1f (cont.) Deposition / defensibility framing as the overall tone

- **Current section**: Global `SYSTEM_PROMPT` preamble at [L105-L107](src/lib/claude/generate-procedure-note.ts#L105-L107) already says *"This document is for medical-legal assessment and documentation for a personal injury case. It will be reviewed by attorneys, insurance adjusters, and opposing medical experts. Use precise medical terminology and formal clinical prose throughout."*
- **What the example prompt adds**: a stronger, more specific framing — "defensible under cross-examination," "not obviously templated," "suitable for PI litigation review." This is a tone-level refinement of existing framing.

### 2. The current prompt's existing FORBIDDEN PHRASES mechanism

The example prompt's style constraints ("avoid sales language", "avoid 'highly concentrated growth factors'", "no absolute regeneration claims") map cleanly onto a mechanism the current prompt already uses, but only in one place:

[generate-procedure-note.ts:181](src/lib/claude/generate-procedure-note.ts#L181):
> *"FORBIDDEN PHRASES (MANDATORY) when paintoneLabel is 'improved': do NOT use any of the following anywhere in the physical exam — 'continues to demonstrate', 'without meaningful interval change', 'persistent tenderness', 'ongoing muscle spasm', 'remains restricted', 'remains positive', 'unchanged from the prior visit', 'unchanged from the prior injection visit', 'no meaningful interval improvement', 'no clinically meaningful change', or 'similarly persistent'."*

This is the first forbidden-phrase block in the codebase and it lives inside section 8. Applying the technique to sections 12 (`procedure_prp_prep`) and 18 (`patient_education`) for anti-marketing language, and to section 16 (`procedure_followup`) for "of 3" series language, would reuse this exact pattern.

### 3. Data-availability branches the example prompt assumes

The example prompt's "fix these weaknesses" list implicitly assumes the model knows which prep fields are null so it can insert placeholders only where needed. The current payload serialization at [generate-procedure-note.ts:315](src/lib/claude/generate-procedure-note.ts#L315) is `JSON.stringify(inputData, null, 2)`, which preserves `null` values — so the model does see `"kit_lot_number": null` in the raw input. No transform is needed to expose nullness; the prompt just has to instruct the model to use that nullness as the trigger for `[confirm ...]` brackets rather than fabricating a value.

The same applies to `guidance_method`. Claude already sees the literal value (`"ultrasound"` / `"fluoroscopy"` / `"landmark"` / `null`) in the payload and can branch on it via prompt instruction without any payload changes.

### 4. Per-section regeneration preserves the technique

Both the full-generation call ([L299-L325](src/lib/claude/generate-procedure-note.ts#L299-L325)) and the per-section regeneration call ([L344-L373](src/lib/claude/generate-procedure-note.ts#L344-L373)) share the same `SYSTEM_PROMPT` constant — the regeneration call appends only a short scoping suffix naming which section to re-emit.

Consequence: any directive added to a section's instructions (e.g., the anti-marketing block in `procedure_prp_prep`) takes effect identically whether the user regenerates that one section via the per-textarea "Regenerate" button ([procedure-note-editor.tsx:481-511](src/components/procedures/procedure-note-editor.tsx#L481-L511)) or generates the whole note from scratch. No separate regen-mode guardrails exist or need to exist.

### 5. Output format — "Part 1 note + Part 2 issue log" doesn't map onto the tool-call contract

The example prompt asks for two outputs: (Part 1) a revised note, (Part 2) a short bulleted issue log listing defensibility fixes, missing facts, and residual risk points.

The current generator uses an Anthropic tool-call output schema ([L247-L297](src/lib/claude/generate-procedure-note.ts#L247-L297)) with exactly 20 required string properties — one per section. There is **no `issue_log` property**. The validation schema ([src/lib/validations/procedure-note.ts](src/lib/validations/procedure-note.ts), referenced at [L5-9](src/lib/claude/generate-procedure-note.ts#L5-L9)) enforces that shape end-to-end: if the model emitted a 21st field it would either be dropped or trigger a validation error depending on the Zod schema mode.

Consequence: the "Part 2 issue log" half of the example prompt cannot be absorbed without either (a) adding a 21st section to the tool schema, matching Zod schema, matching PDF renderer, and matching UI editor form; or (b) treating the issue log as an ephemeral side-channel (e.g., a logged-only field for internal review that never renders in the PDF). The current codebase has no precedent for (b).

### 6. The UI allows human edit + approval — which makes a "non-final" issue log useful or redundant

The procedure-note flow is **not** one-shot: the generator produces a *draft* that is editable in a 20-textarea form ([procedure-note-editor.tsx:468-526](src/components/procedures/procedure-note-editor.tsx#L468-L526)) and only becomes a PDF/finalized document after an explicit finalize step ([procedure-notes.ts:501-599](src/actions/procedure-notes.ts#L501-L599)). The provider reviews and can re-run per section.

Implication for the example prompt's "Part 2 issue log": in a generator with a human review loop, the same information (what's missing, what needs confirmation) is already surfaced as `[confirm ...]` brackets in the draft text. A separate structured issue log duplicates that signal unless it also aggregates *non-missing* defensibility concerns — which the text itself can't easily carry.

### 7. Summary of what each directive costs to implement

The following table restates Section 1's directives in terms of implementation surface:

| Example-prompt directive | Target section(s) in current prompt | Prompt-only? | Payload change? | Schema/UI change? |
|---|---|---|---|---|
| No "Session N of 3" unless documented | `procedure_followup` ([L222-224](src/lib/claude/generate-procedure-note.ts#L222-L224)), `patient_education` ([L231-233](src/lib/claude/generate-procedure-note.ts#L231-L233)) | Yes | No | No |
| Diagnostic coherence (no disc-directed phrasing when technique is paraspinal) | `procedure_indication` ([L198-200](src/lib/claude/generate-procedure-note.ts#L198-L200)), `procedure_injection` ([L214-216](src/lib/claude/generate-procedure-note.ts#L214-L216)) | Yes (branches on `guidance_method` + `injection_site` already in payload) | No | No |
| Bracketed `[confirm ...]` placeholders when prep fields are null | `procedure_prp_prep` ([L206-208](src/lib/claude/generate-procedure-note.ts#L206-L208)), `procedure_anesthesia` ([L210-212](src/lib/claude/generate-procedure-note.ts#L210-L212)), `procedure_injection` ([L214-216](src/lib/claude/generate-procedure-note.ts#L214-L216)) | Yes (branches on nulls already in serialized payload) | No | No |
| Anti-marketing / anti-hype forbidden-phrase list | `procedure_prp_prep`, `patient_education`, `prognosis` ([L235-238](src/lib/claude/generate-procedure-note.ts#L235-L238)) | Yes (reuses the forbidden-phrase pattern from [L181](src/lib/claude/generate-procedure-note.ts#L181)) | No | No |
| Age-conditional guardian consent + patient assent phrasing (language-only) | `procedure_preparation` ([L202-204](src/lib/claude/generate-procedure-note.ts#L202-L204)) | Yes (branches on `age < 18` already in payload) | No | No |
| Capture the actual guardian / signer relationship for use in the note | `procedure_preparation` | No | Yes (new field in `ProcedureNoteInputData.procedureRecord`) | Yes (schema migration; UI capture) — design exists at [2026-04-08-procedure-consent-form.md](../plans/2026-04-08-procedure-consent-form.md) |
| Cite failed conservative care only if documented | `assessment_summary` ([L193-196](src/lib/claude/generate-procedure-note.ts#L193-L196)), `procedure_indication` | Partial (prompt can branch on `chiroProgress`; a richer source would need payload work) | Partial (adding `ptExtraction` to the payload as discharge notes already do — [generate-discharge-note.ts:71-96](src/lib/claude/generate-discharge-note.ts#L71-L96)) | No |
| Part 2 "issue log" as structured output | N/A (would require a 21st field in the tool schema) | No | N/A | Yes (tool schema, Zod schema, PDF renderer, UI) |
| Deposition/cross-examination defensibility tone | Global `SYSTEM_PROMPT` preamble ([L105-107](src/lib/claude/generate-procedure-note.ts#L105-L107)) | Yes | No | No |

**Prompt-only wins** (A-category): 5 of 9 directives can be expressed by editing `SYSTEM_PROMPT` alone, because every data field they branch on is already in `ProcedureNoteInputData` and serialized verbatim to the model.

**Data-payload wins** (B-category, overlapping with A): 0 strictly needed for the A-list items; 1 optional enhancement for richer conservative-care citation.

**Schema/UI work required** (C-category): 2 directives — structured guardian/signer capture, and the Part-2 issue log.

### 8. Scope check — what the example prompt is silent on that the current prompt handles

The example prompt focuses on the *narrative defensibility* dimensions and does not address several dimensions the current prompt does handle:

- **Page-length targeting** — current prompt enforces "~6 PAGES" + per-section length targets ([L111-114](src/lib/claude/generate-procedure-note.ts#L111-L114)). The example does not.
- **PDF-safe formatting** — unicode bullets, ALL CAPS sub-headings, no markdown ([L117-122](src/lib/claude/generate-procedure-note.ts#L117-L122)). The example does not speak to this.
- **Interval-improvement framing across sessions** — four-way `paintoneLabel` branches ([L128-144](src/lib/claude/generate-procedure-note.ts#L128-L144)) and the physical-exam interval-change rule ([L174-191](src/lib/claude/generate-procedure-note.ts#L174-L191)). The example touches this only briefly ("measured and credible interval response if this is not the first injection") and does not break it down by pain delta.
- **Section coverage** — the example lists ~10 sections ("heading, pre-procedure assessment, current symptoms, focused physical exam, informed consent, procedure description, post-procedure status, diagnoses, plan, patient education, clinician disclaimer"), whereas the current output tool has 20 required fields. Several example sections (`current symptoms`, `pre-procedure assessment`) map to multiple current fields (`subjective`, `review_of_systems`, `objective_vitals`).

Consequence for absorbing the example's techniques: the result should be **additive** — layer the defensibility/placeholder/anti-marketing directives into the existing 20-section scaffold, rather than restructuring output to match the example's 10-section layout. The current scaffold already satisfies the PDF / schema / UI contracts downstream.

### 9. Relationship to the attached research document

[2026-04-18-prp-procedure-physical-exam-improvement-tone.md](2026-04-18-prp-procedure-physical-exam-improvement-tone.md) documents the structural reason near-duplicate physical-exam prose shows up across session notes: a single `pmExtraction.physical_exam` blob is the only exam source, `paintoneLabel` isn't wired into section 8, and nothing in the payload carries a *prior procedure's exam findings* for interval comparison.

The example prompt from the user does not directly address this structural issue. The example would, however, reinforce it in one sense: its "do not fabricate" directive would prevent the model from inventing interval-change details for the physical exam when no prior-procedure exam data exists in the payload. In other words, the example prompt's constraint style and the attached research's structural findings are compatible — they are orthogonal improvements (tone + defensibility vs. per-session exam data).

**Note**: the companion plan to that research — [2026-04-18-procedure-note-physical-exam-improvement-tone.md](../plans/2026-04-18-procedure-note-physical-exam-improvement-tone.md) — has already been implemented (the four-way tone branch at [L174-L191](src/lib/claude/generate-procedure-note.ts#L174-L191) and the FORBIDDEN PHRASES block at [L181](src/lib/claude/generate-procedure-note.ts#L181) are both in place on `main` at commit `fef3bb3`).

## Code References

- `src/lib/claude/generate-procedure-note.ts:105-245` — full PRP Procedure Note `SYSTEM_PROMPT` (all directives land here)
- `src/lib/claude/generate-procedure-note.ts:16-103` — `ProcedureNoteInputData` interface listing every field the model sees
- `src/lib/claude/generate-procedure-note.ts:181` — existing FORBIDDEN PHRASES block (pattern reusable for anti-marketing + anti–"of 3" directives)
- `src/lib/claude/generate-procedure-note.ts:198-200` — `procedure_indication` reference with disc-directed phrasing example
- `src/lib/claude/generate-procedure-note.ts:202-204` — `procedure_preparation` (adult-only consent language)
- `src/lib/claude/generate-procedure-note.ts:206-208` — `procedure_prp_prep` (contains "highly concentrated growth factors" marketing phrase)
- `src/lib/claude/generate-procedure-note.ts:222-224` — `procedure_followup` (soft "1-2 additional" wording; good baseline for no-"of 3" directive)
- `src/lib/claude/generate-procedure-note.ts:247-297` — tool output schema (20 required fields; no `issue_log` field)
- `src/lib/claude/generate-procedure-note.ts:299-325` — full generation call (`generateProcedureNoteFromData`)
- `src/lib/claude/generate-procedure-note.ts:344-373` — per-section regeneration (shares `SYSTEM_PROMPT`)
- `src/actions/procedure-notes.ts:29-261` — `gatherProcedureNoteSourceData` (full payload assembly)
- `src/actions/procedure-notes.ts:165` — `computeAgeAtDate` call at procedure_date
- `src/actions/procedure-notes.ts:181-204` — how procedure fields flow into `ProcedureNoteInputData.procedureRecord`
- `src/lib/age.ts:1-13` — age computation
- `supabase/migrations/013_prp_procedure_encounter.sql:8` — `consent_obtained boolean` (single field, nullable)
- `supabase/migrations/014_prp_procedure_details.sql:6-30` — all 14 PRP prep detail fields (`prep_protocol`, `kit_lot_number`, `guidance_method`, etc.)
- `src/components/procedures/procedure-note-editor.tsx:481-511` — per-section "Regenerate" button wiring
- `src/components/procedures/procedure-note-editor.tsx:468-526` — draft-edit form (20 textareas)
- `src/actions/procedure-notes.ts:501-599` — finalize path (PDF render, storage upload, `procedure_notes` status update)

## Architecture Documentation

### How the example prompt maps onto the generator architecture

The generator follows a four-layer pattern shared by all clinical-document generators in this codebase ([2026-04-18-prp-procedure-physical-exam-improvement-tone.md §Architecture Documentation](2026-04-18-prp-procedure-physical-exam-improvement-tone.md)):

1. **`InputData` interface** — shape of the model's view of the world.
2. **`SYSTEM_PROMPT` string** — per-section instructions, references, and branching rules.
3. **`Tool` definition** — structured-output contract with Anthropic tool-use.
4. **`generate*FromData` + `regenerate*Section` functions** — both reuse (2) and (3).

An example-prompt-style revision pass touches (2) only for category A directives, touches (1) and (2) for category B, and touches (1), (2), (3), plus downstream schemas/renderers/UI for category C.

### The forbidden-phrase pattern as an idiom

The codebase now has one instance of the FORBIDDEN PHRASES (MANDATORY) idiom at [generate-procedure-note.ts:181](src/lib/claude/generate-procedure-note.ts#L181). The idiom is: *(a) an ALL-CAPS header, (b) an enumerated list of quoted phrases, (c) an if-you-reach-for-one-of-these signal about what to do instead.* Multiple example-prompt directives (anti-marketing, no-"of-3", no-disc-directed-when-paraspinal) fit this idiom cleanly.

### Where Part-2 issue-log semantics would have to live

If the example's "issue log" output were absorbed, it would need to ride either:
- As a 21st field in `PROCEDURE_NOTE_TOOL.input_schema.properties` ([L274-295](src/lib/claude/generate-procedure-note.ts#L274-L295)), matching additions in `procedureNoteResultSchema` ([validations/procedure-note.ts](src/lib/validations/procedure-note.ts)), the `procedure_notes` DB row, the PDF renderer, and the editor form.
- Or as ephemeral output stripped before persistence (no precedent for this in the codebase today).

## Related Research

- [thoughts/shared/research/2026-04-18-prp-procedure-physical-exam-improvement-tone.md](2026-04-18-prp-procedure-physical-exam-improvement-tone.md) — companion structural analysis of how `paintoneLabel` is wired across sections and why physical-exam prose repeats across sessions
- [thoughts/shared/research/2026-04-18-procedure-note-pain-persistence-tone.md](2026-04-18-procedure-note-pain-persistence-tone.md) — earlier tone research that produced the current four-way `paintoneLabel` branching
- [thoughts/shared/plans/2026-04-18-procedure-note-pain-tone-improvements.md](../plans/2026-04-18-procedure-note-pain-tone-improvements.md) — implementation plan for the four-way branching (now landed)
- [thoughts/shared/plans/2026-04-18-procedure-note-physical-exam-improvement-tone.md](../plans/2026-04-18-procedure-note-physical-exam-improvement-tone.md) — implementation plan for the `objective_physical_exam` interval-change rule (now landed on `main`)
- [thoughts/shared/research/2026-04-06-procedure-consent-form-implementation.md](2026-04-06-procedure-consent-form-implementation.md) — state of consent capture (single boolean today; full signer/relationship design proposed)
- [thoughts/shared/plans/2026-04-08-procedure-consent-form.md](../plans/2026-04-08-procedure-consent-form.md) — plan to add `patient_signer_relationship`, minor retention rules, consent PDF
- [thoughts/shared/research/2026-04-18-age-relative-to-accident-date.md](2026-04-18-age-relative-to-accident-date.md) — research that motivated anchoring age to visit date
- [thoughts/shared/plans/2026-04-18-age-at-visit-date.md](../plans/2026-04-18-age-at-visit-date.md) — implemented plan for age anchoring
- [thoughts/shared/plans/2026-03-11-epic-4-story-4.3-generate-prp-procedure-note.md](../plans/2026-03-11-epic-4-story-4.3-generate-prp-procedure-note.md) — original procedure-note generator plan

## Open Questions

1. The current `procedures` schema has no **series total** or **treatment plan total** field, so the prompt cannot know whether "1 of 3" is actually documented anywhere. Prompt-only prohibition of "of 3" language is possible; data-backed "N of M" language would require a new field.
2. Capturing the **signer identity** (adult patient vs. guardian with name/relationship) requires the schema/UI work designed in [2026-04-08-procedure-consent-form.md](../plans/2026-04-08-procedure-consent-form.md), which is unimplemented. Until then, any minor-aware consent branch in the prompt would be phrased in general terms ("guardian provided written informed consent") without a named signer.
3. There is no clear decision rule in the codebase today for what `guidance_method = 'landmark'` vs `'ultrasound'` vs `'fluoroscopy'` implies about which anatomic targets are *plausibly* being treated. An explicit mapping (e.g., "US-guided paraspinal with `target_confirmed_imaging = false` → do not describe as disc-directed") would need to be authored — the schema fields exist, but the interpretive rule does not.
4. A "failed conservative care" citation would benefit from the same `ptExtraction` surface that discharge notes already use ([generate-discharge-note.ts:71-96](src/lib/claude/generate-discharge-note.ts#L71-L96)). That source is not currently threaded into `ProcedureNoteInputData`.
5. Whether the "Part 2 issue log" from the example prompt has real value in a system with a human edit + finalize step is an open question — the draft editor already allows the provider to read placeholders, edit text, and regenerate sections before finalizing to PDF, so a structured issue log may duplicate the signal already carried by `[confirm ...]` brackets.
