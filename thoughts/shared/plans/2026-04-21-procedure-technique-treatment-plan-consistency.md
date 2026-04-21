---
date: 2026-04-21T18:45:11Z
author: arsenaid
branch: main
repository: cliniq
topic: "Procedure-technique consistency with the treatment plan"
tags: [plan, procedure-note, treatment-plan, prp, coherence, plan-alignment]
status: implemented
research_source: thoughts/shared/research/2026-04-21-procedure-technique-treatment-plan-consistency.md
---

# Plan: Strengthen Procedure-technique consistency with the treatment plan

**Date**: 2026-04-21T18:45:11Z
**Author**: arsenaid
**Branch**: main
**Repository**: cliniq
**Research**: [thoughts/shared/research/2026-04-21-procedure-technique-treatment-plan-consistency.md](thoughts/shared/research/2026-04-21-procedure-technique-treatment-plan-consistency.md)

## Goal

Close the plan-vs-performed gap in the PRP procedure-note pipeline. Before this work, the procedure-note generator enforced internal technique coherence (prose must match `procedureRecord.guidance_method`) and diagnosis-level source precedence, but it did not reconcile what the provider actually performed against what was planned in the initial visit note or pain-management evaluation.

## Context

`pmExtraction.treatment_plan` was serialized into the LLM payload but no prompt rule named it. `initial_visit_notes.treatment_plan` was not even fetched. A cervical PRP performed for a patient whose plan of care called for a lumbar facet injection would pass every existing check and read as fully consistent. No place on the encounter form captured *why* the provider deviated, and no medico-legal attestation existed for unplanned procedures.

## Design

Five layers, following the architectural pattern already established in the codebase (deterministic classification in TypeScript, narrative in Claude — same shape as `paintoneLabel`, `seriesVolatility`, `pmSupplementaryDiagnoses`).

1. **Ingest the plan** — fetch `initial_visit_notes.treatment_plan`; continue using the already-fetched `pm_extractions.treatment_plan`.
2. **Compute `planAlignment` in TS** — deterministic classification into one of four statuses with precomputed mismatch list.
3. **PLAN-COHERENCE RULE in the system prompt** — branches narrative language on `planAlignment.status`; requires mismatch naming with rationale citation or explicit bracket placeholder.
4. **Capture deviation rationale at the form** — new column + Textarea so the provider records intent at the point of care, not post-hoc on the draft note.
5. **Finalization gate** — block finalization for `status = 'unplanned'` until the provider explicitly acknowledges, producing a dated attestation.

## Implementation

### Layer 1 — Ingest the plan

[src/actions/procedure-notes.ts](src/actions/procedure-notes.ts)
- Initial-visit query extended to select `treatment_plan` (previously only `past_medical_history, social_history`).
- `ProcedureNoteInputData.initialVisitNote` extended with `treatment_plan: string | null` in [src/lib/claude/generate-procedure-note.ts](src/lib/claude/generate-procedure-note.ts).

### Layer 2 — `planAlignment` computation

[src/lib/procedures/compute-plan-alignment.ts](src/lib/procedures/compute-plan-alignment.ts)
- `computePlanAlignment({ performed, pmTreatmentPlan, initialVisitTreatmentPlan })` returns `{ status, planned, mismatches[] }`.
- Status values: `aligned | deviation | unplanned | no_plan_on_file`.
- Parses PM treatment_plan structured items (filters to `type = 'injection'` or injection-like descriptions). Parses initial-visit narrative by splitting sentences and extracting body region, laterality, guidance hint, and vertebral levels with regex.
- `normalizeRegion` handles synonyms (lumbosacral → lumbar, low back → lumbar, cervical spine → cervical, SI joint → sacroiliac, etc.) and strips laterality prefixes before lookup.
- Candidate selection prefers PM-structured over IV-narrative, and prefers candidates whose region matches the performed region.
- `unplanned` fires when plans exist but none covers the performed body region.
- `deviation` fires when the selected plan matches on region but laterality, guidance_method, or target levels diverge.

Tests at [src/lib/procedures/compute-plan-alignment.test.ts](src/lib/procedures/compute-plan-alignment.test.ts) — 16 cases covering the five status transitions plus region normalization.

Integration in [src/actions/procedure-notes.ts](src/actions/procedure-notes.ts): `planAlignment` is assembled inside `gatherProcedureNoteSourceData` with provider-override awareness (`provider_overrides.treatment_plan` beats the raw PM column when present), passed through to the generator payload, and stored alongside the other precomputed classifications on `ProcedureNoteInputData`.

### Layer 3 — PLAN-COHERENCE RULE

[src/lib/claude/generate-procedure-note.ts](src/lib/claude/generate-procedure-note.ts)
- New `=== PLAN-COHERENCE RULE (MANDATORY) ===` block inserted between PRIOR PROCEDURE NOTES CONTEXT and PROVIDER TONE/DIRECTION HINT.
- Branches narrative on `planAlignment.status`:
  - `aligned` — continuity sentence in `procedure_indication` and `assessment_and_plan`.
  - `deviation` — MANDATORY one-sentence deviation + rationale in `assessment_and_plan`; rationale source preference order is `procedureRecord.plan_deviation_reason` → `procedureRecord.complications` → `procedureRecord.patient_tolerance` → `pmExtraction.updated_after_procedure` → `caseSummary.prior_treatment`. Bracket placeholder `[confirm rationale for plan deviation: planned <planned>, performed <performed>]` when none present. Mismatch field labels humanized (`body_region → "treated region"`, etc.).
  - `unplanned` — MANDATORY acknowledgement in `procedure_indication` with clinical driver citation; same rationale preference chain. Bracket placeholder `[confirm indication for unplanned procedure]` when none.
  - `no_plan_on_file` — do not invent comparisons.
- Scope restricted: plan-continuity language belongs only in `procedure_indication` and `assessment_and_plan`, not in the procedure-mechanics sections.
- Interaction with other rules explicit: NO CLONE RULE still applies; PLAN-COHERENCE is independent of TARGET-COHERENCE (internal technique↔prose match) and does not override DIAGNOSTIC-SUPPORT RULE.
- PROVIDER TONE HINT override list updated to include PLAN-COHERENCE.

### Layer 4 — Capture deviation rationale at the form

Migration [supabase/migrations/20260425_plan_deviation_capture.sql](supabase/migrations/20260425_plan_deviation_capture.sql)
- `ALTER TABLE procedures ADD COLUMN IF NOT EXISTS plan_deviation_reason TEXT`.
- `ALTER TABLE procedure_notes ADD COLUMN IF NOT EXISTS plan_deviation_acknowledged_at TIMESTAMPTZ`.

Schema [src/lib/validations/prp-procedure.ts](src/lib/validations/prp-procedure.ts)
- `plan_deviation_reason: z.string().optional()` on the form schema.

Server action [src/actions/procedures.ts](src/actions/procedures.ts)
- `createPrpProcedure` + `updatePrpProcedure` persist `values.plan_deviation_reason?.trim() || null`.

UI [src/components/procedures/record-procedure-dialog.tsx](src/components/procedures/record-procedure-dialog.tsx)
- `ProcedureInitialData` interface gains `plan_deviation_reason: string | null`.
- Default value wired to `initialData?.plan_deviation_reason ?? ''`.
- New "Plan Deviation (optional)" section between Post-Procedure and Vitals with a Textarea + FormDescription explaining when to fill it in. Not added to the top-of-dialog section nav (nav spots are reserved for always-shown blocks).

Generator wiring
- [src/lib/claude/generate-procedure-note.ts](src/lib/claude/generate-procedure-note.ts) — `procedureRecord.plan_deviation_reason: string | null` added to input type.
- [src/actions/procedure-notes.ts](src/actions/procedure-notes.ts) — payload assembly includes the column.
- Prompt updated (Layer 3) to prefer `plan_deviation_reason` as the top rationale source.

### Layer 5 — Finalization gate

Migration [supabase/migrations/20260425010000_plan_alignment_status_snapshot.sql](supabase/migrations/20260425010000_plan_alignment_status_snapshot.sql)
- `ALTER TABLE procedure_notes ADD COLUMN IF NOT EXISTS plan_alignment_status TEXT`. Snapshot of `planAlignment.status` at generation time.

Server actions [src/actions/procedure-notes.ts](src/actions/procedure-notes.ts)
- On generation success, persist `plan_alignment_status: inputData.planAlignment.status` and reset `plan_deviation_acknowledged_at: null`.
- On re-generation (existing note clear), reset both snapshot and acknowledgement so a fresh draft re-triggers the gate if still unplanned.
- `finalizeProcedureNote` blocks with explicit error when `plan_alignment_status === 'unplanned'` and `plan_deviation_acknowledged_at` is null.
- New `acknowledgePlanDeviation(procedureId, caseId)` server action writes `plan_deviation_acknowledged_at = now()`.

UI [src/components/procedures/procedure-note-editor.tsx](src/components/procedures/procedure-note-editor.tsx)
- `NoteRow` extended with `plan_alignment_status` + `plan_deviation_acknowledged_at`.
- DraftEditor: "Acknowledge Unplanned Procedure" button appears before Finalize when gate is active. Finalize button disabled until acknowledgement persisted.
- Red banner above the form for unacknowledged unplanned; amber banner after acknowledgement (with timestamp); amber banner for `deviation` status reminding the reviewer to check the assessment-and-plan section.

### Migration notes

Two files under the same `20260425` date prefix. Supabase CLI treats the prefix numeric portion as the version key; the snapshot migration was named `20260425010000_*` to produce a distinct version. During initial push, the supabase_migrations table ended up with duplicate rows for 20260425 due to a mid-workflow content change. Recovery: `supabase migration repair --status reverted 20260425` followed by `supabase db push`. Both migrations use `ADD COLUMN IF NOT EXISTS` for idempotency.

Per memory feedback: migrations applied via `npx supabase db push`, not MCP tools.

Types regenerated with `npx supabase gen types` against project `glnuoiqbhcldvyjwzmru`.

## Tests + verification

- New unit tests [src/lib/procedures/compute-plan-alignment.test.ts](src/lib/procedures/compute-plan-alignment.test.ts) — 16 cases covering all five statuses and region normalization edge cases.
- Existing procedure-note generator test fixture updated with `planAlignment` + `procedureRecord.plan_deviation_reason` fields.
- `npx tsc --noEmit` clean.
- `npx vitest run` — 743/743 pass.
- `npx eslint` clean on touched files.

## Files touched

### New
- [src/lib/procedures/compute-plan-alignment.ts](src/lib/procedures/compute-plan-alignment.ts)
- [src/lib/procedures/compute-plan-alignment.test.ts](src/lib/procedures/compute-plan-alignment.test.ts)
- [supabase/migrations/20260425_plan_deviation_capture.sql](supabase/migrations/20260425_plan_deviation_capture.sql)
- [supabase/migrations/20260425010000_plan_alignment_status_snapshot.sql](supabase/migrations/20260425010000_plan_alignment_status_snapshot.sql)
- [thoughts/shared/research/2026-04-21-procedure-technique-treatment-plan-consistency.md](thoughts/shared/research/2026-04-21-procedure-technique-treatment-plan-consistency.md)

### Modified
- [src/actions/procedure-notes.ts](src/actions/procedure-notes.ts) — fetch `treatment_plan`, assemble `planAlignment`, persist snapshot, reset on re-gen, finalize gate, `acknowledgePlanDeviation`.
- [src/actions/procedures.ts](src/actions/procedures.ts) — persist `plan_deviation_reason`.
- [src/lib/claude/generate-procedure-note.ts](src/lib/claude/generate-procedure-note.ts) — input type extension + PLAN-COHERENCE RULE.
- [src/lib/validations/prp-procedure.ts](src/lib/validations/prp-procedure.ts) — optional `plan_deviation_reason` on form schema.
- [src/components/procedures/record-procedure-dialog.tsx](src/components/procedures/record-procedure-dialog.tsx) — Plan Deviation form section + `ProcedureInitialData` extension.
- [src/components/procedures/procedure-note-editor.tsx](src/components/procedures/procedure-note-editor.tsx) — acknowledgement button + banners + finalize gate in UI.
- [src/lib/claude/__tests__/generate-procedure-note.test.ts](src/lib/claude/__tests__/generate-procedure-note.test.ts) — fixture extension.
- [src/types/database.ts](src/types/database.ts) — regenerated.

## Open follow-ups

1. Sample ~20 existing `initial_visit_notes.treatment_plan` rows to confirm the regex-based parser reaches acceptable recall; consider a Haiku-extract step if not.
2. Evaluate whether `clinical_orders.recommended_procedures` ([src/lib/claude/generate-clinical-orders.ts](src/lib/claude/generate-clinical-orders.ts)) should be a third plan source — its structure may be more machine-comparable than the IV narrative.
3. Controlled vocabulary for `plan_deviation_reason` (e.g., `patient_request | interval_progression | imaging_update | prior_response | other`) if analytics on deviation reasons becomes valuable.
4. Per-clinic toggle on the finalization gate if some clinics treat unplanned procedures as routine under evolving clinical judgment.
