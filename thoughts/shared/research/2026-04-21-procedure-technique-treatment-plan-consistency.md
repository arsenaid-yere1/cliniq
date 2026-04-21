---
date: 2026-04-21T18:11:56Z
researcher: arsenaid
git_commit: 8b1c6b33e12083ac1cd328f6f4cec320ba77aead
branch: main
repository: cliniq
topic: "Strengthen Procedure-technique consistency with the treatment plan"
tags: [research, procedure-note, treatment-plan, prp, coherence, pain-management, initial-visit]
status: complete
last_updated: 2026-04-21
last_updated_by: arsenaid
---

# Research: Strengthen Procedure-technique consistency with the treatment plan

**Date**: 2026-04-21T18:11:56Z
**Researcher**: arsenaid
**Git Commit**: 8b1c6b33e12083ac1cd328f6f4cec320ba77aead
**Branch**: main
**Repository**: cliniq

## Research Question
Provide a recommendation on how to strengthen consistency between the **procedure technique** (what the provider actually performed and captured on the procedure encounter) and the **treatment plan** (what was planned for the patient in the initial-visit note and/or pain-management extraction).

## Summary

The procedure-note generator today enforces **internal** technique coherence (the prose must match `procedureRecord.guidance_method`) and **diagnosis-level** precedence (provider-committed `procedureRecord.diagnoses` beats PM-supplementary codes), but it does **not** cross-check the performed technique against the planned treatment.

Two gaps:

1. `pmExtraction.treatment_plan` is serialized into the LLM payload but the `SYSTEM_PROMPT` never names it in a rule — the model sees the plan but has no instruction to reconcile it with `procedureRecord.{injection_site, laterality, guidance_method, needle_gauge}`.
2. `initial_visit_notes.treatment_plan` (the narrative long-form plan) is **not fetched at all** — the query at [src/actions/procedure-notes.ts:83-90](src/actions/procedure-notes.ts#L83-L90) selects only `past_medical_history` and `social_history`.

Consequence: a note can describe an ultrasound-guided lumbar facet PRP with `guidance_method = "ultrasound"` and look internally consistent, even when the plan of care on file called for a C5-C6 cervical epidural under fluoroscopy. Nothing in the pipeline surfaces that mismatch.

Recommendation — three-layer plan-vs-performed discipline following the same pattern already used for diagnoses (SOURCE PRECEDENCE) and targets (TARGET-COHERENCE):

1. **Ingest the plan** — fetch `initial_visit_notes.treatment_plan` (text) and pass both it and the already-fetched `pm_extractions.treatment_plan` (jsonb) through a pre-prompt **plan-digest** step that reduces them to a structured `plannedProcedure` object (body_region, laterality, guidance_method, approach_family, target_levels).
2. **Compute alignment deterministically in TypeScript** — compare `plannedProcedure` against `procedureRecord` fields and hand the model a `planAlignment` object with `{ status: "aligned" | "deviation" | "unplanned" | "no_plan_on_file", mismatches: [...] }`. Keep Claude out of the alignment decision; keep it in the narrative.
3. **Add a PLAN-COHERENCE RULE** to the system prompt (sibling to TARGET-COHERENCE + SOURCE PRECEDENCE) that dictates section-level wording based on `planAlignment.status` and requires the assessment/plan section to **name the deviation + rationale** when status ≠ "aligned". Block finalization on `status = "unplanned"` until provider acknowledges.

Additionally capture deviation at the encounter form (new `plan_deviation_reason text` column) so the provider records **why** they deviated at the point of capture — then the generator has data to narrate, not speculation.

## Detailed Findings

### Current data flow into the procedure-note generator

Orchestrator: `gatherProcedureNoteSourceData()` at [src/actions/procedure-notes.ts:31-133](src/actions/procedure-notes.ts#L31-L133) runs 11 parallel Supabase queries and assembles a `ProcedureNoteInputData` object that is JSON-serialized into the user message at [src/lib/claude/generate-procedure-note.ts:662-688](src/lib/claude/generate-procedure-note.ts#L662-L688).

Relevant queries today:

| Source | Query | Fields fetched | Plan-related? |
|---|---|---|---|
| PM extraction | [procedure-notes.ts:68-76](src/actions/procedure-notes.ts#L68-L76) | `chief_complaints, physical_exam, diagnoses, treatment_plan, diagnostic_studies_summary, provider_overrides, updated_at` | **Yes** — `treatment_plan` jsonb is fetched |
| Initial visit note | [procedure-notes.ts:83-90](src/actions/procedure-notes.ts#L83-L90) | `past_medical_history, social_history` only | **No** — `treatment_plan` text column exists in the table but is not selected |
| Case summary | [procedure-notes.ts:125-132](src/actions/procedure-notes.ts#L125-L132) | `chief_complaint, imaging_findings, prior_treatment, symptoms_timeline, suggested_diagnoses` | Partial — `prior_treatment` is historical, not forward plan |

The resulting `ProcedureNoteInputData.pmExtraction.treatment_plan` is typed as `unknown` at [generate-procedure-note.ts:115](src/lib/claude/generate-procedure-note.ts#L115); `initialVisitNote` is typed at [generate-procedure-note.ts:140-143](src/lib/claude/generate-procedure-note.ts#L140-L143) as only `{ past_medical_history, social_history }`.

### Schema — what "technique" looks like in the database

`procedures` table captures technique across two migrations:

**Base fields** ([supabase/migrations/013_prp_procedure_encounter.sql](supabase/migrations/013_prp_procedure_encounter.sql)):
- `injection_site` — text
- `laterality` — text, constrained `('left', 'right', 'bilateral')`
- `diagnoses` — jsonb (array of `{icd10_code, description}`)
- `procedure_number` — integer

**Detail fields** ([supabase/migrations/014_prp_procedure_details.sql](supabase/migrations/014_prp_procedure_details.sql)):
- `blood_draw_volume_ml`, `centrifuge_duration_min`, `prep_protocol`, `kit_lot_number`
- `anesthetic_agent`, `anesthetic_dose_ml`, `patient_tolerance`
- `injection_volume_ml`, `needle_gauge`, `guidance_method` (enum `ultrasound|fluoroscopy|landmark`), `target_confirmed_imaging`
- `complications`, `supplies_used`, `compression_bandage`, `activity_restriction_hrs`

### Schema — what "treatment plan" looks like in the database

`pain_management_extractions.treatment_plan` ([supabase/migrations/011_pain_management_extractions.sql:28-30](supabase/migrations/011_pain_management_extractions.sql#L28-L30)) — structured jsonb array, each item per the extractor tool schema at [src/lib/claude/extract-pain-management.ts:124-141](src/lib/claude/extract-pain-management.ts#L124-L141):

```
{ description: string,
  type: 'continuation'|'injection'|'therapy'|'medication'|'surgery'|'monitoring'|'alternative'|'other',
  estimated_cost_min: number|null,
  estimated_cost_max: number|null,
  body_region: string }
```

Provider overrides shadow this via `pain_management_extractions.provider_overrides.treatment_plan` ([procedure-notes.ts:388](src/actions/procedure-notes.ts#L388)).

`initial_visit_notes.treatment_plan` ([supabase/migrations/20260309194935_replace_initial_visit_notes_15_sections.sql:24](supabase/migrations/20260309194935_replace_initial_visit_notes_15_sections.sql#L24)) — free `text` narrative written by the initial-visit generator. Contains PRP recommendations, conservative care, and follow-up cadence in prose form.

**Structural asymmetry**: the PM plan is semi-structured (type + body_region are machine-comparable); the initial-visit plan is pure prose. Any alignment check must handle both shapes.

### Existing coherence rules — what the prompt enforces today

Four rules exist; all operate on inputs **other than** the treatment plan.

1. **TARGET-COHERENCE RULE** ([generate-procedure-note.ts:400-405, 460-465](src/lib/claude/generate-procedure-note.ts#L400-L405)) — internal only. Forces procedure-indication and procedure-injection prose to match `procedureRecord.guidance_method`:
   > "The language describing what this injection treats must match the documented technique on procedureRecord.guidance_method. Do NOT describe the procedure as disc-directed or intradiscal unless guidance_method = 'fluoroscopy' AND the injection_site explicitly names an intradiscal target."

2. **SOURCE PRECEDENCE RULE** ([generate-procedure-note.ts:495-505](src/lib/claude/generate-procedure-note.ts#L495-L505)) — diagnosis-only. Provider-committed `procedureRecord.diagnoses` is PRIMARY; `pmSupplementaryDiagnoses` is SECONDARY and must pass imaging+exam support to be added. `pmExtraction.updated_after_procedure` boolean further biases toward provider-committed list.

3. **DATA-NULL RULE** ([generate-procedure-note.ts:429-436, 443-448, 453-465](src/lib/claude/generate-procedure-note.ts#L429-L436)) — forces `[confirm X]` bracket placeholders when technique fields are null, never fabrication.

4. **PRIOR PROCEDURE NOTES CONTEXT / CLINICAL CONTINUITY** ([generate-procedure-note.ts:264-279](src/lib/claude/generate-procedure-note.ts#L264-L279)) — instructs the model that "treatment plan trajectory, and clinical reasoning should evolve coherently across the series". This is series-vs-series continuity; still doesn't compare technique to an original care plan.

### The gap — plan-vs-performed is neither fetched nor prompted

**Data-layer gap**: `initial_visit_notes.treatment_plan` is in the database but is not read by the procedure-note gatherer.

**Prompt-layer gap**: `pmExtraction.treatment_plan` is in the JSON payload the model receives but no `SYSTEM_PROMPT` section names it in a directive. The model has no rule of the form "compare `procedureRecord.injection_site` to the planned `treatment_plan[].body_region` for items where `type = 'injection'`; if they diverge, flag and explain".

**Form-layer gap**: the encounter form ([src/components/procedures/record-procedure-dialog.tsx](src/components/procedures/record-procedure-dialog.tsx)) has no field for "deviation from plan — reason". Providers who intentionally deviate have no place to record intent, so the note generator has no data to narrate a deviation honestly.

## Recommendation

### Layer 1 — ingest the plan

Update `gatherProcedureNoteSourceData` at [src/actions/procedure-notes.ts:83-90](src/actions/procedure-notes.ts#L83-L90) to also select `treatment_plan` from `initial_visit_notes`. Extend `ProcedureNoteInputData.initialVisitNote` type at [generate-procedure-note.ts:140-143](src/lib/claude/generate-procedure-note.ts#L140-L143) with `treatment_plan: string | null`.

Keep the PM fetch as-is; `treatment_plan` is already selected.

### Layer 2 — compute a deterministic `planAlignment` in TypeScript

Add `src/lib/procedures/compute-plan-alignment.ts`:

```ts
type PlannedProcedure = {
  source: 'pm_extraction' | 'initial_visit_note'
  body_region: string | null     // normalized: 'lumbar' | 'cervical' | 'thoracic' | 'sacroiliac' | 'knee' | ...
  laterality: 'left' | 'right' | 'bilateral' | null
  guidance_hint: 'ultrasound' | 'fluoroscopy' | 'landmark' | null
  target_levels: string[]        // e.g., ['L4-L5', 'L5-S1']
  raw_description: string        // full narrative for the prompt to quote if needed
}

type PlanAlignmentStatus = 'aligned' | 'deviation' | 'unplanned' | 'no_plan_on_file'

type PlanMismatch = {
  field: 'body_region' | 'laterality' | 'guidance_method' | 'target_levels'
  planned: string | null
  performed: string | null
}

type PlanAlignment = {
  status: PlanAlignmentStatus
  planned: PlannedProcedure | null
  mismatches: PlanMismatch[]
  source_priority: ('initial_visit_note' | 'pm_extraction')[]   // which source fed `planned`, for citation
}
```

Matching logic:

1. **Extract planned candidates** — from `pmExtraction.treatment_plan` filter to `type = 'injection'` items; use `body_region` directly. For `initialVisitNote.treatment_plan` text, run a small regex/keyword parser for body region + levels (`L4-L5`, `C5-C6`, `bilateral`, `ultrasound`, `fluoroscopy`) — or defer to a second tiny Claude call (cheaper Haiku) that returns the same `PlannedProcedure` structure. Keyword parser is the cheap path and handles the 80% case; Haiku is the accurate path if the parser is insufficient.

2. **Rank sources** — PM extraction is structured, prefer it. Initial-visit text is the tie-breaker / supplement.

3. **Normalize body_region** to a canonical set (existing [src/lib/procedures/parse-body-region.ts](src/lib/procedures/parse-body-region.ts) already does this — reuse it).

4. **Compare**:
   - `status = 'no_plan_on_file'` when both sources produce zero injection candidates.
   - `status = 'aligned'` when performed `injection_site` maps to the planned `body_region` AND `laterality` matches (or planned is null) AND `guidance_method` is consistent with `guidance_hint` (or planned hint is null).
   - `status = 'deviation'` when a plan exists but one or more of body_region / laterality / guidance / levels diverges. Populate `mismatches`.
   - `status = 'unplanned'` when a plan exists but the planned `type` is not `injection` for the body_region performed (e.g., plan said "therapy only for cervical" but lumbar PRP was performed — this is not a deviation from an injection plan, it's an injection with no injection plan).

5. **Attach** `planAlignment: PlanAlignment` to `ProcedureNoteInputData`.

Determinism matters: alignment status drives prompt branching, so it must be computed reliably and be auditable in tests (pattern already used for `paintoneLabel`, `seriesVolatility`, `chiroProgress` — see [generate-procedure-note.ts:83-97](src/lib/claude/generate-procedure-note.ts#L83-L97)).

### Layer 3 — PLAN-COHERENCE RULE in the system prompt

Insert, sibling to TARGET-COHERENCE and SOURCE PRECEDENCE, around [generate-procedure-note.ts:400](src/lib/claude/generate-procedure-note.ts#L400):

```
=== PLAN-COHERENCE RULE (MANDATORY) ===

The input payload supplies a precomputed "planAlignment" object. DO NOT re-derive
alignment yourself; trust planAlignment.status.

• planAlignment.status == "aligned"
  → In procedure_indication and assessment_and_plan, reference the plan in
    continuity terms: "The procedure performed today follows the care plan
    established at [source]" where source = "the initial visit note" or
    "the pain-management evaluation". Do NOT belabor the match.

• planAlignment.status == "deviation"
  → MANDATORY: In assessment_and_plan, include one sentence naming the
    specific deviation(s) from planAlignment.mismatches and the clinical
    rationale drawn from procedureRecord.complications or
    procedureRecord.patient_tolerance or pmExtraction.updated_after_procedure.
    When no rationale field explains the deviation, emit
    "[confirm rationale for plan deviation: planned <planned>, performed <performed>]".
    DO NOT fabricate a rationale.

• planAlignment.status == "unplanned"
  → MANDATORY: In procedure_indication, use language acknowledging the
    procedure was not part of the prior written plan — "performed based on
    clinical progression since the last evaluation" — and cite the specific
    clinical driver from procedureRecord or recent pmExtraction. Emit
    "[confirm indication for unplanned procedure]" when no driver is
    documented.

• planAlignment.status == "no_plan_on_file"
  → Do NOT invent a planned-vs-performed comparison. Proceed per the other
    rules. The procedure_indication section may state that the procedure was
    performed pursuant to the evaluating provider's clinical judgment, which
    is already true.

The NO CLONE RULE still applies: vary wording of plan-continuity sentences
across sessions in a series.
```

### Layer 4 — capture provider intent at the form

Add to the encounter form ([record-procedure-dialog.tsx](src/components/procedures/record-procedure-dialog.tsx)) a conditional **"Deviation from plan — reason"** textarea that appears only when the UI detects a mismatch at submit time (reuse the same `computePlanAlignment` in the client). Persist via new column `procedures.plan_deviation_reason text` (nullable) in a new migration.

Feed `procedureRecord.plan_deviation_reason` through to the generator so the PLAN-COHERENCE RULE can cite it instead of emitting a `[confirm rationale...]` placeholder. This closes the loop: provider intent is captured once, narrated faithfully.

### Layer 5 — finalization gate (optional, recommended)

Block `finalizeProcedureNote` when `planAlignment.status == 'unplanned'` unless the provider has checked an "Acknowledge unplanned procedure" confirmation on the editor ([procedure-note-editor.tsx](src/components/procedures/procedure-note-editor.tsx)). Persist acknowledgement to a new `procedure_notes.plan_deviation_acknowledged_at timestamptz` column. This mirrors the existing `consent_obtained` discipline and gives the medico-legal reviewer a dated attestation.

### Testing strategy

- Unit: `compute-plan-alignment.test.ts` covering the five status cases × (PM-only, IV-only, both, neither) × (body-region match / laterality mismatch / guidance mismatch / levels divergence).
- Prompt: extend [src/lib/claude/__tests__/generate-procedure-note.test.ts](src/lib/claude/__tests__/generate-procedure-note.test.ts) with fixtures per alignment status; assert the generated `assessment_and_plan` contains the mismatch language for `deviation` and `unplanned`.
- Regression: ensure the existing TARGET-COHERENCE and NO CLONE RULE behaviors are unchanged when `planAlignment.status == 'no_plan_on_file'` (the default for cases without an initial visit note or PM extraction).

### Why this shape (not alternatives)

- **Why compute alignment in TS, not let Claude do it?** The existing pattern ([paintoneLabel](src/lib/claude/pain-tone.ts), `seriesVolatility`, `pmSupplementaryDiagnoses` dedup) keeps deterministic classification in code and reserves Claude for prose. Alignment is classification; it belongs in code. This also makes it testable and auditable.
- **Why not just add "check the treatment plan" to the prompt and skip the TS layer?** `treatment_plan` text from initial-visit is narrative — Claude would do inconsistent, unauditable matching. The same trap that SOURCE PRECEDENCE was introduced to close for diagnoses (commit `8b1c6b3`).
- **Why add `plan_deviation_reason` on the form?** Without it, deviations default to `[confirm rationale...]` placeholders, which providers must edit post-generation. Capturing intent at the point of care eliminates that friction and produces a cleaner medico-legal record.
- **Why a finalization gate only for `unplanned` (not `deviation`)?** Deviations are expected in pain management and already get explicit narration under the rule. `unplanned` is the higher-risk case where a reviewer will ask "why was this done at all" — an explicit acknowledgement attests the provider saw the flag.

## Code References

- [src/actions/procedure-notes.ts:83-90](src/actions/procedure-notes.ts#L83-L90) — initial-visit query missing `treatment_plan`
- [src/actions/procedure-notes.ts:68-76](src/actions/procedure-notes.ts#L68-L76) — PM query does fetch `treatment_plan`
- [src/actions/procedure-notes.ts:372-421](src/actions/procedure-notes.ts#L372-L421) — where `pmExtraction` + `pmSupplementaryDiagnoses` are assembled (insertion point for `planAlignment`)
- [src/lib/claude/generate-procedure-note.ts:16-176](src/lib/claude/generate-procedure-note.ts#L16-L176) — `ProcedureNoteInputData` interface (extend here)
- [src/lib/claude/generate-procedure-note.ts:140-143](src/lib/claude/generate-procedure-note.ts#L140-L143) — `initialVisitNote` type (extend with `treatment_plan`)
- [src/lib/claude/generate-procedure-note.ts:400-465](src/lib/claude/generate-procedure-note.ts#L400-L465) — TARGET-COHERENCE RULE (PLAN-COHERENCE sits beside it)
- [src/lib/claude/generate-procedure-note.ts:495-505](src/lib/claude/generate-procedure-note.ts#L495-L505) — SOURCE PRECEDENCE RULE (pattern template)
- [src/lib/claude/extract-pain-management.ts:124-141](src/lib/claude/extract-pain-management.ts#L124-L141) — PM `treatment_plan[]` item schema
- [src/lib/procedures/parse-body-region.ts](src/lib/procedures/parse-body-region.ts) — existing body-region normalizer to reuse
- [supabase/migrations/013_prp_procedure_encounter.sql](supabase/migrations/013_prp_procedure_encounter.sql) + [014_prp_procedure_details.sql](supabase/migrations/014_prp_procedure_details.sql) — technique schema
- [supabase/migrations/011_pain_management_extractions.sql:28-30](supabase/migrations/011_pain_management_extractions.sql#L28-L30) — PM `treatment_plan jsonb`
- [supabase/migrations/20260309194935_replace_initial_visit_notes_15_sections.sql:24](supabase/migrations/20260309194935_replace_initial_visit_notes_15_sections.sql#L24) — IV `treatment_plan text`
- [src/components/procedures/record-procedure-dialog.tsx](src/components/procedures/record-procedure-dialog.tsx) — encounter form (add deviation reason)
- [src/components/procedures/procedure-note-editor.tsx](src/components/procedures/procedure-note-editor.tsx) — finalization UI (add acknowledgement)

## Architecture Documentation

**Pattern in this codebase**: deterministic classification happens in TypeScript before the prompt; the LLM narrates based on a precomputed label. Examples already in place:

- `paintoneLabel` / `paintoneSignals` / `seriesVolatility` — computed in [src/lib/claude/pain-tone.ts](src/lib/claude/pain-tone.ts), consumed by the PAIN TONE MATRIX block.
- `pmSupplementaryDiagnoses` dedup — computed at [procedure-notes.ts:400-421](src/actions/procedure-notes.ts#L400-L421), consumed by SOURCE PRECEDENCE RULE.
- `chiroProgress` — computed upstream, consumed by the physical-exam branching.

The proposed `planAlignment` fits this pattern exactly. It is not a new architectural style; it extends an existing one.

**Prompt-rule pattern**: MANDATORY-tagged rules tied to a specific precomputed input (e.g., `paintoneLabel`, `procedureRecord.guidance_method`, `pmExtraction.updated_after_procedure`). The PLAN-COHERENCE RULE follows the same shape, keyed to `planAlignment.status`.

## Related Research

- [thoughts/shared/research/2026-04-18-apply-medico-legal-editor-pass-to-procedure-note.md](thoughts/shared/research/2026-04-18-apply-medico-legal-editor-pass-to-procedure-note.md)
- [thoughts/shared/research/2026-04-18-prp-procedure-physical-exam-improvement-tone.md](thoughts/shared/research/2026-04-18-prp-procedure-physical-exam-improvement-tone.md)
- [thoughts/shared/research/2026-04-20-pm-notes-diagnosis-generation.md](thoughts/shared/research/2026-04-20-pm-notes-diagnosis-generation.md)
- [thoughts/shared/research/2026-04-21-pm-diagnosis-mri-exam-support-flow.md](thoughts/shared/research/2026-04-21-pm-diagnosis-mri-exam-support-flow.md)
- [thoughts/shared/research/2026-03-11-epic-4-prp-procedure-alignment.md](thoughts/shared/research/2026-03-11-epic-4-prp-procedure-alignment.md)
- [thoughts/shared/plans/2026-04-20-prior-procedure-note-context-for-procedure-generation.md](thoughts/shared/plans/2026-04-20-prior-procedure-note-context-for-procedure-generation.md)

## Open Questions

1. Is the initial-visit `treatment_plan` narrative structured enough to parse with regex/keywords, or will a Haiku-extract step be required for acceptable recall? Sample ~20 existing rows before committing to the parser-only approach.
2. Should `planAlignment` also incorporate `clinical_orders.recommended_procedures` ([src/lib/claude/generate-clinical-orders.ts](src/lib/claude/generate-clinical-orders.ts))? That table is a third plan source; it may be more machine-comparable than the IV narrative and deserve first-class treatment.
3. Do we want a per-clinic toggle for the finalization gate on `unplanned` status, or is it universal? Some clinics may treat unplanned procedures as routine under evolving clinical judgment.
4. Should the deviation reason on the encounter form be free text or a controlled vocabulary (e.g., `patient_request`, `interval_progression`, `imaging_update`, `prior_response`, `other`)? Controlled list improves downstream analytics; free text is faster to adopt.
