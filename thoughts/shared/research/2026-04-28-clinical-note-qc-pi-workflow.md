---
date: 2026-04-28T21:32:15Z
researcher: arsenaid
git_commit: 4536cf24a722be287e0a2c6227020e050ed98327
branch: main
repository: cliniq
topic: "Quality control surfaces after each clinical note in the PI workflow"
tags: [research, codebase, procedure-notes, discharge-notes, initial-visit-notes, case-summaries, pain-trajectory, validation, clinical-orders]
status: complete
last_updated: 2026-04-28
last_updated_by: arsenaid
last_updated_note: "Re-scoped: PI workflow = IV → Order Imaging → Pain Evaluation → Procedures → Discharge. Question is about note-generation quality, not regulatory QC."
---

# Research: Quality Control After Each Clinical Note in the PI Workflow

**Date**: 2026-04-28T21:32:15Z
**Researcher**: arsenaid
**Git Commit**: 4536cf24a722be287e0a2c6227020e050ed98327
**Branch**: main
**Repository**: cliniq

## Research Question
How can we add quality control after each clinical note? Each report needs verification in the context of the entire PI (procedure-injection / initial-visit / discharge) workflow.

## Summary

The codebase already has a layered, partially-wired QC surface. This document maps **what exists today** so any future QC layer plugs into existing seams rather than re-inventing them. No new QC layer is proposed here — only the current state.

PI workflow in this codebase = **case-scoped chain**: `case_summaries` (extraction synthesis) → `initial_visit_notes` (initial_visit + optional pain_evaluation_visit) → `procedure_notes` (one per `procedures` row) → `discharge_notes` (one per case). All four pipelines:

- Use the same Claude client at [src/lib/claude/client.ts](src/lib/claude/client.ts) with a shared `stop_reason='max_tokens'` short-circuit, Zod parse retry, and exponential-backoff API retry.
- Persist to dedicated tables with a uniform `status` enum: `'generating' | 'draft' | 'finalized' | 'failed'`.
- Carry `raw_ai_response jsonb` (audit blob), `source_data_hash text` (drift detector), `ai_model text`, `generation_attempts int`, `sections_done/sections_total int` (live progress), `tone_hint text` (provider hint persisted across regen).
- Are gated at finalization: PDF render + upload to `case-documents` Storage bucket + `documents` row insert + `document_id` back-reference. `unfinalize*` actions reverse the lock.

Cross-note context already flows **forward**:
- `case_summaries.suggested_diagnoses` (with `confidence` + `downgrade_to`) is consumed by procedure note's DIAGNOSTIC-SUPPORT RULE and discharge note's 7-filter DIAGNOSTIC-SUPPORT RULE at generation time.
- Procedure note pulls finalized prior procedure notes' `subjective`, `assessment_summary`, `procedure_injection`, `assessment_and_plan`, `prognosis` sections + finalized initial visit note's `past_medical_history`, `social_history`, `treatment_plan`.
- Discharge note pulls all procedures' vitals, finalized initial visit note's `chief_complaint`, `physical_exam`, `diagnoses`, `treatment_plan`, plus PT/PM/chiro/MRI extractions.
- Pain-evaluation-visit IV pulls the prior `initial_visit` row's full state for re-anchoring.

Cross-note **verification** exists in exactly one place: [src/lib/claude/pain-trajectory-validator.ts](src/lib/claude/pain-trajectory-validator.ts) runs **after** discharge generation and during discharge section regen. Its warnings are non-fatal (logged + embedded in `raw_ai_response.trajectory_warnings`); they do not block save or finalization.

A second deterministic gate exists at procedure finalize: `plan_alignment_status === 'unplanned' && !plan_deviation_acknowledged_at` blocks finalize until the provider explicitly acknowledges the deviation via `acknowledgePlanDeviation()`.

A third gate: `finalizeDischargeNote` blocks when `pain_score_max IS NULL` — discharge cannot finalize without provider-entered visit vitals.

A fourth gate: `checkProcedureNotePrerequisites` and `checkDischargeNotePrerequisites` require a finalized initial_visit_note before generation can start.

Beyond these, there is **no** rubric scoring, no model-graded eval, no cross-note consistency checker spanning {procedure_notes ↔ initial_visit_notes ↔ discharge_notes}, no per-section approval workflow, no review queue, no audit log of who edited which section, no `quality_*`/`qc_*`/`verified_*` columns on any note table, no statuses like `'reviewed'` or `'signed'` (only `'draft'` → `'finalized'`).

## Detailed Findings

### Pipeline Architecture (3 generative pipelines + 1 aggregator)

#### Procedure Note
- **Generator**: [src/lib/claude/generate-procedure-note.ts](src/lib/claude/generate-procedure-note.ts) — model `claude-opus-4-6`, `maxTokens: 16384` (lines 759–760). Tool `generate_procedure_note` (lines 686–736), 20 required string sections. System prompt (lines 197–684) embeds GLOBAL RULES, NO CLONE RULE, MISSING-VITALS BRANCH, PAIN TONE MATRIX (two-signal: `vsBaseline`/`vsPrevious`), SERIES VOLATILITY, PRIOR PROCEDURE NOTES CONTEXT, PLAN-COHERENCE RULE, PROVIDER TONE/DIRECTION HINT, and 20 section-specific instructions.
- **Server action**: [src/actions/procedure-notes.ts](src/actions/procedure-notes.ts) — `generateProcedureNote(procedureId, caseId, toneHint?)` at line 518; `gatherProcedureNoteSourceData` at line 35 fans out 11 parallel Supabase queries plus a batched prior-procedure vitals + prior-procedure-notes query.
- **Zod**: [src/lib/validations/procedure-note.ts](src/lib/validations/procedure-note.ts) — `procedureNoteResultSchema` (AI output, `z.string()` per section) and `procedureNoteEditSchema` (edit form, `.min(1)` per section).
- **Page**: [src/app/(dashboard)/patients/[caseId]/procedures/[procedureId]/note/page.tsx](src/app/(dashboard)/patients/[caseId]/procedures/[procedureId]/note/page.tsx)
- **Editor**: [src/components/procedures/procedure-note-editor.tsx](src/components/procedures/procedure-note-editor.tsx) — react-hook-form + Supabase Realtime `GeneratingProgress`, branches by `status`. Per-section regen via `regenerateProcedureNoteSectionAction`.
- **Finalize gate**: [src/actions/procedure-notes.ts:810-818](src/actions/procedure-notes.ts) — refuses if `plan_alignment_status === 'unplanned' && !plan_deviation_acknowledged_at`.

#### Discharge Note
- **Generator**: [src/lib/claude/generate-discharge-note.ts](src/lib/claude/generate-discharge-note.ts) — `claude-opus-4-6`, `maxTokens: 16384`. Tool `generate_discharge_note` (lines 453–487), 12 required string sections. System prompt (lines 203–451) includes DETERMINISTIC PAIN TRAJECTORY block (verbatim `painTrajectoryText` + `dischargeVisitPainDisplay`), SUPPLEMENTARY PAIN OBSERVATIONS sidecar, BASELINE DATA-GAP OVERRIDE, two-signal PAIN TONE MATRIX, SERIES VOLATILITY, 7-filter DIAGNOSTIC-SUPPORT RULE.
- **Server action**: [src/actions/discharge-notes.ts](src/actions/discharge-notes.ts) — `generateDischargeNote(caseId, toneHint?, visitDate?)` at line 553. Uses **soft-delete + re-insert** for regeneration (lines 644–648, 654–681) instead of update-in-place. Pre-gen gate at lines 637–642 errors if both `painTrajectoryText` and `dischargeVisitPainDisplay` are null.
- **Post-gen validation**: `validateDischargeTrajectoryConsistency()` invoked at line 797. Warnings written to `raw_ai_response.trajectory_warnings` at lines 808–816. Non-fatal.
- **Zod**: [src/lib/validations/discharge-note.ts](src/lib/validations/discharge-note.ts) — `dischargeNoteResultSchema` and `dischargeNoteEditSchema` plus `dischargeNoteVitalsSchema`.
- **Page**: [src/app/(dashboard)/patients/[caseId]/discharge/page.tsx](src/app/(dashboard)/patients/[caseId]/discharge/page.tsx)
- **Editor**: [src/components/discharge/discharge-note-editor.tsx](src/components/discharge/discharge-note-editor.tsx) — also calls `getDischargePainTimeline(caseId)` on mount (lines 485–506) which re-runs trajectory builder for the read-only `<PainTimelineTable>` widget.
- **Finalize gate**: [src/actions/discharge-notes.ts:927](src/actions/discharge-notes.ts) — refuses if `note.pain_score_max == null`.

#### Initial Visit Note (initial_visit + pain_evaluation_visit)
- **Generator**: [src/lib/claude/generate-initial-visit.ts](src/lib/claude/generate-initial-visit.ts) — `claude-opus-4-6`, `maxTokens: 16384`. Same generator handles both visit types, system prompt branches via `buildSystemPrompt(visitType)`. Tool `generate_initial_visit_note` (lines 365–444), 16 sections. Pain-evaluation prompt includes PRIOR VISIT REFERENCE block + NUMERIC-ANCHOR rule against `priorVisitData.vitalSigns.pain_score_max`.
- **Server action**: [src/actions/initial-visit-notes.ts](src/actions/initial-visit-notes.ts) — `generateInitialVisitNote(caseId, visitType, toneHint?, visitDate?)` at line 329; `gatherSourceData` at line 62 conditional-loads `priorVisit`, `caseSummary`, `pmExtraction` only when `visitType === 'pain_evaluation_visit'`.
- **Zod**: [src/lib/validations/initial-visit-note.ts](src/lib/validations/initial-visit-note.ts) — `initialVisitNoteResultSchema`, `initialVisitNoteEditSchema`, `initialVisitVitalsSchema`, `romMovementSchema/romRegionSchema/initialVisitRomSchema`, `providerIntakeSchema`.
- **Page**: [src/app/(dashboard)/patients/[caseId]/initial-visit/page.tsx](src/app/(dashboard)/patients/[caseId]/initial-visit/page.tsx) — single URL; tabs switch visit type.
- **Editor**: [src/components/clinical/initial-visit-editor.tsx](src/components/clinical/initial-visit-editor.tsx) — manages tabs, vitals card, ROM via `useFieldArray`, provider intake.
- **Date-order trigger**: [supabase/migrations/20260414_initial_visit_date_order.sql](supabase/migrations/20260414_initial_visit_date_order.sql) — `enforce_initial_visit_date_order_trg` raises SQLSTATE 23514 if `pain_evaluation_visit.visit_date < initial_visit.visit_date` for the same case.

#### Case Summary (extraction aggregator — not a note, but a QC-relevant cross-document layer)
- **Generator**: [src/lib/claude/generate-summary.ts](src/lib/claude/generate-summary.ts) — `claude-opus-4-6`, `maxTokens: 24000`, **extended thinking enabled** (`budget_tokens: 8000`, line 307). Only generator using thinking. Tool choice `{ type: 'auto' }` (line 311).
- **Server action**: [src/actions/case-summaries.ts](src/actions/case-summaries.ts) — `generateCaseSummary(caseId)` at line 115 reads 7 extraction tables in parallel, errors if all empty (lines 86–95).
- **Output schema**: 7 keys including `suggested_diagnoses[]` with `confidence`/`downgrade_to`. The DIAGNOSTIC-SUPPORT RULE in procedure + discharge generators reads this array.
- **Staleness check**: `checkSummaryStaleness(caseId)` at line 244 recomputes `computeSourceHash(inputData)` and compares against the persisted `source_data_hash`.
- **Approve workflow**: `approveCaseSummary` (`review_status: 'approved'`) and `saveCaseSummaryEdits` (`review_status: 'edited'`) — only the case_summary itself has an explicit approve/edit/reject gate. Notes do not.

### Shared Generation Infrastructure

- **`callClaudeTool`**: [src/lib/claude/client.ts:109](src/lib/claude/client.ts) — sole call site for `messages.create`. `stop_reason === 'max_tokens'` returns `{ error }` without Zod parsing. `ZOD_RETRY_ATTEMPTS = 1` (one parse retry → 2 total parse attempts), `API_RETRY_ATTEMPTS = 2` (3 total API calls per parse attempt). Retryable errors: 429, 529, 5xx, network. Backoff `MIN(1000 * 2^n, 15000)` with jitter (line 161). Streaming `inputJson` event drives `onProgress` callback (line 81). Logs `model`, `input_tokens`, `output_tokens` per call (lines 173–179).
- **Generation lock**: [src/lib/supabase/generation-lock.ts](src/lib/supabase/generation-lock.ts) — `acquireGenerationLock(supabase, table, rowId, userId)`. Procedure note path uses lock on existing rows (procedure-notes.ts:568). Concurrent inserts caught via Postgres unique-violation `code === '23505'` (procedure-notes.ts:642).

### Pain Tone / Trajectory / Observations — The Existing QC Layer

- **[src/lib/claude/pain-tone.ts](src/lib/claude/pain-tone.ts)**: pure functions. `computePainToneLabel(current, reference, context)` returns one of `'baseline' | 'missing_vitals' | 'minimally_improved' | 'improved' | 'stable' | 'worsened'`. Thresholds: `≤-3` improved, `=-2` minimally_improved, `[-1,+1]` stable, `≥+2` worsened. `computeSeriesVolatility(painSeries)` returns `'mixed_with_regression' | 'monotone_improved' | 'monotone_worsened' | 'monotone_stable' | 'insufficient_data'`. `deriveChiroProgress(functionalOutcomes)` returns `'improving' | 'stable' | 'plateauing' | 'worsening' | null`. Used by procedure-notes.ts (lines 264, 277–289, 364–367) and discharge-notes.ts (lines 335, 340–346, 355–357).
- **[src/lib/claude/pain-trajectory.ts](src/lib/claude/pain-trajectory.ts)**: `buildDischargePainTrajectory(input)` — pure TS, builds chronological `entries[]` (intake → procedures → discharge) and `arrowChain` string. Discharge endpoint priority (lines 154–199): (1) provider `dischargeVitals` non-null → verbatim; (2) `finalIntervalWorsened || overallPainTrend ∈ {stable,worsened}` → `latestVitals` verbatim; (3) else → `latestVitals - 2` floored at 0, `dischargeEstimated: true`. Invoked from `gatherDischargeNoteSourceData` line 376 and from `getDischargePainTimeline` action.
- **[src/lib/claude/pain-trajectory-validator.ts](src/lib/claude/pain-trajectory-validator.ts)**: post-generation consistency check. Regex `/(\d{1,2}(?:-\d{1,2})?)\/10(?!\d|\/)/g` scans `subjective`, `objective_vitals`, `assessment`, `prognosis`. Verifies (a) every `N/10` in those four sections matches an expected trajectory value; (b) `objective_vitals/subjective/assessment/prognosis` each contain the verbatim discharge clause; (c) `subjective` contains the verbatim `arrowChain`. Returns `{ warnings[], dischargeReadingsFound[] }`. **Non-fatal** — warnings logged + embedded in `raw_ai_response.trajectory_warnings`. Called from discharge-notes.ts:797 (full gen) and discharge-notes.ts:1169 (section regen). **Not called for procedure or initial visit notes.**
- **[src/lib/claude/pain-observations.ts](src/lib/claude/pain-observations.ts)**: `buildPainObservations({ ptExtraction, pmExtraction, chiroExtraction })` — extracts per-source `PainObservation[]`, sorted chronologically. Passed to discharge generator as sidecar (`subjective` may cite if 2+ observations exist; never substitutes for arrow chain).

### Plan Alignment — Procedure Note's QC Layer

- **[src/lib/procedures/compute-plan-alignment.ts](src/lib/procedures/compute-plan-alignment.ts)** + tests at `compute-plan-alignment.test.ts`. Computed in `gatherProcedureNoteSourceData` lines 435–450, written to `procedure_notes.plan_alignment_status` at generation success (lines 695–730). Status `'unplanned'` blocks `finalizeProcedureNote` until `acknowledgePlanDeviation()` writes `plan_deviation_acknowledged_at` timestamp. This is the **only deterministic cross-document gate that hard-blocks finalization on a procedure note**.

### Persistence Schema — Status & Audit Columns

| Table | Status enum | Audit columns |
|---|---|---|
| `procedure_notes` | `'generating'\|'draft'\|'finalized'\|'failed'` | `raw_ai_response`, `source_data_hash`, `ai_model`, `generation_attempts`, `generation_error`, `sections_done/total`, `tone_hint`, `plan_alignment_status`, `plan_deviation_acknowledged_at`, `finalized_by_user_id`, `finalized_at`, `document_id` |
| `discharge_notes` | same 4 | same audit + `discharge_pain_estimate_min/max`, `discharge_pain_estimated`, `pain_trajectory_text`, vitals columns |
| `initial_visit_notes` | same 4 | same audit + `visit_type` (`'initial_visit'\|'pain_evaluation_visit'`), `visit_date`, `provider_intake jsonb`, `rom_data jsonb` |
| `case_summaries` | `review_status: 'pending_review'\|'approved'\|'edited'\|'rejected'`, `generation_status: 'pending'\|'processing'\|'completed'\|'failed'` | `provider_overrides jsonb`, `reviewed_by_user_id`, `reviewed_at`, `generated_at`, `source_data_hash`, `ai_confidence`, `extraction_notes` |
| All extractions (mri, chiro, pm, pt, ortho, ct, x-ray) | `review_status` (same 4 as case_summaries) | `provider_overrides jsonb`, `reviewed_by_user_id`, `reviewed_at` |

**Asymmetry**: `case_summaries` and the 7 extraction tables have a **review queue** (pending_review → approved/edited/rejected). Note tables (`procedure_notes`, `discharge_notes`, `initial_visit_notes`) have **only a finalize gate** (`'draft' → 'finalized'`); no `'reviewed'` intermediate state, no `reviewed_by_user_id`, no `reviewed_at`. Provider edits to a draft note are saved via `save*Note` actions but not tracked as a discrete review event.

### Cross-Note Context Loading (Forward Flow)

| Reader | Reads | Purpose |
|---|---|---|
| Procedure note generation | `initial_visit_notes` finalized (`past_medical_history`, `social_history`, `treatment_plan`) | PMH/social history sections + plan alignment input |
| Procedure note generation | All prior `procedure_notes` finalized (`subjective`, `assessment_summary`, `procedure_injection`, `assessment_and_plan`, `prognosis`) | Continuity context |
| Procedure note generation | `case_summaries` approved/edited (`suggested_diagnoses`) | DIAGNOSTIC-SUPPORT RULE |
| Discharge note generation | All `procedures` + their `vital_signs` | Pain trajectory build |
| Discharge note generation | `initial_visit_notes` finalized | Baseline `chief_complaint`, `physical_exam`, `diagnoses`, `treatment_plan` |
| Discharge note generation | `case_summaries` approved/edited | DIAGNOSTIC-SUPPORT RULE 7-filter |
| Pain-evaluation IV generation | `initial_visit_notes` (visit_type='initial_visit', finalized) | Prior visit anchor + NUMERIC-ANCHOR rule |
| Pain-evaluation IV generation | `case_summaries` approved/edited | Imaging context |

**No reverse / lateral flow exists**: an already-finalized procedure note is never re-checked against a later finalized procedure note or discharge note. There is no "after discharge generation, validate that the IV's `prognosis` is still consistent" step. The trajectory validator is the only post-gen verifier and it lives entirely inside discharge generation.

### Existing Surfaces That Could Host QC

- **`raw_ai_response jsonb`**: every note table already stores the model's full output + (for discharge) `trajectory_warnings`, `discharge_readings_found`. Suitable read-only audit blob.
- **`source_data_hash text`**: every note + summary table has it. `checkSummaryStaleness` already uses it for case_summaries; same pattern is set up but not surfaced for notes.
- **`raw_ai_response.trajectory_warnings`**: discharge editor does not currently render these warnings to the user; they are persisted but invisible. Confirmed by reading [src/components/discharge/discharge-note-editor.tsx](src/components/discharge/discharge-note-editor.tsx) — no consumer of `raw_ai_response.trajectory_warnings`.
- **Section regen**: every note has `regenerate{X}Section` server action + per-section `Textarea` in editor. Fine-grained re-generation already wired.
- **Generation lock**: [src/lib/supabase/generation-lock.ts](src/lib/supabase/generation-lock.ts) — already serializes overlapping generations.
- **`tone_hint` persistence**: every note row stores tone_hint across regenerations. Same column shape could carry QC notes if extended.
- **`documents.status`**: values `'pending_review'` and `'reviewed'` exist; `mri-extractions.ts` already syncs document status on extraction approval. Notes' generated PDFs are inserted but the `documents.status` flow is not wired from notes.
- **Case-level timeline**: [src/components/timeline/case-timeline.tsx](src/components/timeline/case-timeline.tsx) renders `TimelineEvent[]` from `getTimelineEvents(caseId)` (status_change, document_added, procedure, invoice_*). Does **not** currently include note-level events; could be extended.
- **Case status state machine**: [src/actions/case-status.ts](src/actions/case-status.ts) — `case_status_history` table is append-only; `updateCaseStatus` validates allowed transitions via `CASE_STATUS_TRANSITIONS` map.

### What Does Not Exist

- No `quality_*`, `qc_*`, `verified_*`, `is_signed`, `signed_at`, `locked_at`, `approved_by` columns on any note table.
- No `'reviewed'` status on `procedure_notes`, `discharge_notes`, `initial_visit_notes` (only on extractions and `documents`).
- No model-graded eval / rubric / scoring file under `src/lib/`.
- No cross-note consistency checker (the only post-gen check is discharge's intra-note trajectory validator).
- No review queue page, no notification surface.
- No per-section edit history / diff log — `save*Note` updates the row directly, no audit trail of what changed.
- No `src/lib/qc/` or equivalent directory.

## Code References

- [src/lib/claude/client.ts:109](src/lib/claude/client.ts) — `stop_reason === 'max_tokens'` short-circuit, only universal post-gen check
- [src/lib/claude/pain-trajectory-validator.ts:62](src/lib/claude/pain-trajectory-validator.ts) — `validateDischargeTrajectoryConsistency`, only cross-section consistency check
- [src/actions/discharge-notes.ts:797-816](src/actions/discharge-notes.ts) — call site, warnings folded into `raw_ai_response`
- [src/actions/discharge-notes.ts:927](src/actions/discharge-notes.ts) — `pain_score_max` finalize gate
- [src/actions/procedure-notes.ts:810-818](src/actions/procedure-notes.ts) — `plan_alignment_status === 'unplanned'` finalize gate
- [src/actions/procedure-notes.ts:568](src/actions/procedure-notes.ts) — `acquireGenerationLock` call
- [src/actions/case-summaries.ts:244](src/actions/case-summaries.ts) — `checkSummaryStaleness` source-hash compare (only stale-detector wired)
- [src/actions/case-summaries.ts:267](src/actions/case-summaries.ts) — `saveCaseSummaryEdits` (`review_status: 'edited'`) — only review-status-on-edit pattern in repo
- [supabase/migrations/006_case_summaries.sql:22-31](supabase/migrations/006_case_summaries.sql) — `review_status` + `generation_status` enums
- [supabase/migrations/015_procedure_notes.sql:34-35](supabase/migrations/015_procedure_notes.sql) — `procedure_notes.status` 4-value enum
- [supabase/migrations/016_discharge_notes.sql:27-28](supabase/migrations/016_discharge_notes.sql) — `discharge_notes.status` 4-value enum
- [supabase/migrations/20260309194935_replace_initial_visit_notes_15_sections.sql:38-39](supabase/migrations/20260309194935_replace_initial_visit_notes_15_sections.sql) — `initial_visit_notes.status` 4-value enum
- [supabase/migrations/20260414_initial_visit_date_order.sql](supabase/migrations/20260414_initial_visit_date_order.sql) — DB-level chronology trigger
- [src/components/timeline/case-timeline.tsx](src/components/timeline/case-timeline.tsx) — case activity log component
- [src/lib/procedures/compute-plan-alignment.ts](src/lib/procedures/compute-plan-alignment.ts) — deterministic plan-alignment computation
- [src/lib/supabase/generation-lock.ts](src/lib/supabase/generation-lock.ts) — overlap protection

## Architecture Documentation

**Pipeline shape** (uniform across all 3 notes + summary):
```
form input
  → server action (gather*SourceData with parallel Supabase queries)
  → deterministic pre-gen computations (pain tone signals, plan alignment, trajectory builder)
  → callClaudeTool (zod retry × api retry × backoff)
  → [discharge only] post-gen validateDischargeTrajectoryConsistency
  → DB write: status='draft' + raw_ai_response + source_data_hash + sections + ai_model
  → revalidatePath
  → [later] finalize action: PDF render + Storage upload + documents row + status='finalized'
```

**Status state machine** (per note):
```
(no row) → 'generating' → 'draft' → 'finalized'
                       ↘  'failed' ↗  ↑
                                      ↓ (unfinalize)
                                   'draft'
```
There is **no** `'reviewed'` or `'signed'` state on note rows. Provider review is implicit in editing the draft + clicking Finalize.

**Cross-document signal flow**:
```
extractions (mri/chiro/pm/pt/ortho/ct/xray)  ──review_status──┐
                                                              ↓
                                                       case_summaries
                                                       (suggested_diagnoses
                                                        with confidence +
                                                        downgrade_to)
                                                              │
                ┌─────────────────────────────────────────────┼───────────────────┐
                ↓                                             ↓                   ↓
    initial_visit_notes (initial)            procedure_notes (per procedure)    discharge_notes
                │                                   ↑                                ↑
                └──finalized ──────────────────────┘                                │
                                ↓                                                    │
                                └──── all prior procedure_notes finalized + IV ─────┘
                                            + all procedures' vital_signs
```

**QC verification points that exist today**:
1. Pre-gen: prerequisites check (IV finalized for procedure/discharge), trajectory anchor present (discharge), case not closed.
2. During gen: `stop_reason='max_tokens'` short-circuit; Zod parse retry; API retry+backoff; live `sections_done` progress.
3. Post-gen (discharge only): `validateDischargeTrajectoryConsistency` warnings folded into `raw_ai_response`.
4. Pre-finalize: `plan_alignment_status` ack (procedure); `pain_score_max` non-null (discharge); IV-date-order trigger (DB-level).
5. Finalize: PDF rendered + uploaded + `documents` row inserted + `status='finalized'` + `finalized_by_user_id` recorded.

**QC verification points that do not exist** (gaps as observed, not as recommendations): no rubric scoring, no model-graded eval, no per-section edit audit, no cross-note consistency checker spanning multiple notes, no review queue UI, no `'reviewed'` intermediate status, no QC notes column, no warnings-surfaced-to-user UI on discharge editor for the trajectory validator output.

## Related Research

- [thoughts/shared/research/2026-04-21-discharge-pain-timeline-precision.md](thoughts/shared/research/2026-04-21-discharge-pain-timeline-precision.md)
- [thoughts/shared/research/2026-04-21-procedure-technique-treatment-plan-consistency.md](thoughts/shared/research/2026-04-21-procedure-technique-treatment-plan-consistency.md)
- [thoughts/shared/research/2026-04-21-pm-diagnosis-mri-exam-support-flow.md](thoughts/shared/research/2026-04-21-pm-diagnosis-mri-exam-support-flow.md)
- [thoughts/shared/research/2026-04-22-initial-visit-tone-direction-sections-edit.md](thoughts/shared/research/2026-04-22-initial-visit-tone-direction-sections-edit.md)
- [thoughts/shared/research/2026-04-22-unfinalize-document-repository-impact.md](thoughts/shared/research/2026-04-22-unfinalize-document-repository-impact.md)
- [thoughts/shared/research/2026-04-23-lapi-pm-report-zod-failure.md](thoughts/shared/research/2026-04-23-lapi-pm-report-zod-failure.md)
- [thoughts/shared/research/2026-04-27-discharge-pain-rate-on-regenerate.md](thoughts/shared/research/2026-04-27-discharge-pain-rate-on-regenerate.md)

## Open Questions

- Does "PI" in the user's question refer to **P**rocedure-**I**njection (the PRP series), the full Procedure→Initial-visit→Discharge chain, or "**P**erformance **I**mprovement" (regulatory QC sense)? The codebase has no file named PI; treating it here as the case-scoped chain.
- Are `raw_ai_response.trajectory_warnings` ever surfaced to a UI today? Editor read suggests no — but a search for `trajectory_warnings` consumer was not exhaustive.
- Is the `documents.status` `'pending_review' → 'reviewed'` flow active for note-generated documents, or only for uploaded extraction documents? Code paths show extraction-upload sync; note-finalize PDF inserts were not confirmed to set/transition `documents.status`.

---

## Follow-up Research 2026-04-28T21:42Z — Note-Generation Quality (Real PI Workflow)

User clarified: question = **quality of note generation**. Real PI workflow = **Initial Visit → Order Imaging → Pain Evaluation → Procedures → Discharge**. Re-mapped accordingly.

### Workflow Step Map (5 generative pipelines)

| Step | Generator | Model | maxTokens | Tool name | Sections |
|---|---|---|---|---|---|
| 1. Initial Visit | [src/lib/claude/generate-initial-visit.ts](src/lib/claude/generate-initial-visit.ts) | claude-opus-4-6 | 16384 | generate_initial_visit_note | 16 |
| 2. Order Imaging | [src/lib/claude/generate-clinical-orders.ts](src/lib/claude/generate-clinical-orders.ts) | claude-sonnet-4-6 | 4096 | imaging_order / chiropractic_order | structured |
| 3. Pain Evaluation | [src/lib/claude/generate-initial-visit.ts](src/lib/claude/generate-initial-visit.ts) (same generator, `visitType='pain_evaluation_visit'`) | claude-opus-4-6 | 16384 | generate_initial_visit_note | 16 |
| 4. Procedure (per session) | [src/lib/claude/generate-procedure-note.ts](src/lib/claude/generate-procedure-note.ts) | claude-opus-4-6 | 16384 | generate_procedure_note | 20 |
| 5. Discharge | [src/lib/claude/generate-discharge-note.ts](src/lib/claude/generate-discharge-note.ts) | claude-opus-4-6 | 16384 | generate_discharge_note | 12 |

Section regen for steps 1, 3, 4, 5 uses `claude-opus-4-6` at maxTokens 4096 with same gather + tone_hint thread.

### Step 2: Imaging Order — Detailed Map

[src/actions/clinical-orders.ts](src/actions/clinical-orders.ts) exports: `generateClinicalOrder(caseId, visitType, orderType)` (line 101), `getClinicalOrders(caseId, visitType)` (line 250), `finalizeClinicalOrder(orderId, caseId)` (line 282), `deleteClinicalOrder(orderId, caseId)` (line 413).

Source data ([src/actions/clinical-orders.ts:12-97](src/actions/clinical-orders.ts)): only IV note row (`diagnoses`, `chief_complaint`, `treatment_plan`, `visit_date`, status in `['finalized','draft']`), `provider_profiles`, `clinic_settings`. **No** case_summary, **no** extractions, **no** prior procedures. Early-return if `diagnoses` null (lines 43-45).

Status enum ([supabase/migrations/20260326_provider_intake_and_clinical_orders.sql](supabase/migrations/20260326_provider_intake_and_clinical_orders.sql) line 14): `'draft'|'generating'|'completed'|'failed'` (note: `'completed'`, not `'finalized'` like the notes — different enum).

`order_type` CHECK: `'imaging'|'chiropractic_therapy'|'physical_therapy'|'pain_management_referral'|'orthopedic_referral'`. Only first two have generators in `generate-clinical-orders.ts`; other three values exist in the enum without code.

Quality rules in prompt: minimal. Imaging system prompt ([generate-clinical-orders.ts:18](src/lib/claude/generate-clinical-orders.ts)): "Do NOT add imaging for regions not referenced in the clinical data." Chiro: "Do NOT recommend treatments for regions not mentioned in the diagnoses." No pain-tone signals, no plan alignment, no trajectory, no deterministic pre-computations.

**Downstream impact**: zero. `clinical_orders` table is never read by any later note generator. Confirmed via grep — no import of clinical-orders in procedure-notes.ts, discharge-notes.ts, or initial-visit-notes.ts.

### Internal Quality Rules Per Generator (named rules in system prompts)

#### Initial Visit ([generate-initial-visit.ts](src/lib/claude/generate-initial-visit.ts))
- `=== NULL-CONTRACT FOR INITIAL VISIT (ABSOLUTE) ===` (lines 151-158): caseSummary/pmExtraction/priorVisitData null by contract; no MRI/CT references; no radiculopathy ICD-10; imaging "ordered only, results pending."
- `DIAGNOSTIC-SUPPORT RULE (MANDATORY)` initial-visit version (lines 190-199): M54.5 specificity (default M54.50), M79.1 redundancy guard, radiculopathy code prohibition (M54.12, M54.17, M50.1X, M51.1X) at first visit.
- `DIAGNOSTIC-SUPPORT RULE (MANDATORY)` pain-evaluation version (lines 300-322): filters A-F including myelopathy filter (UMN signs), radiculopathy filter (region-matched objective findings with named tests), `imaging_support`/`exam_support` provenance filter on pmExtraction.
- `DOWNGRADE-TO HONOR RULE` (line 302).
- `NUMERIC-ANCHOR (MANDATORY when priorVisitData.vitalSigns.pain_score_max is non-null)` (lines 263-267): required framing thresholds (≥3 = "meaningfully decreased", ≤2 = "similar but modestly reduced", ≥2 rise = "increased").
- `NO UNNECESSARY BRACKETS` (lines 53-57).
- `SCOPE` (line 59): no expansion beyond regions in source data.

#### Procedure ([generate-procedure-note.ts:197-684](src/lib/claude/generate-procedure-note.ts))
- `NO CLONE RULE` (lines 216-221): sentence-order/structure variation across procedure-mechanics sections.
- `MISSING-VITALS BRANCH` (lines 223-237): substitute phrase mandate when paintoneLabel='missing_vitals'.
- `PAIN TONE MATRIX — TWO-SIGNAL` (lines 239-272): 9-cell vsBaseline × vsPrevious matrix; FORBIDDEN cells when vsPrevious=worsened.
- `SERIES VOLATILITY` (lines 274-289): mid-series fluctuation acknowledgement when 'mixed_with_regression'.
- `PRIOR PROCEDURE NOTES CONTEXT` (lines 291-306): 5 prior fields, never copy verbatim.
- `PLAN-COHERENCE RULE` (lines 308-330): branches on planAlignment.status.
- `INTAKE ANCHOR` (lines 362-368), `SERIES-TOTAL RULE` (372-373), `INTERVAL-RESPONSE NARRATIVE` (374-381), `PRE-PROCEDURE SAFETY CHECKLIST` (382-384), `INTERVAL-CHANGE RULE` (421), `MINIMUM INTERVAL-CHANGE FLOOR` (428), `FORBIDDEN PHRASES` for improved (426), `DATA-NULL RULE` (492-521), `TARGET-COHERENCE RULE` (461-464, 533-537), `MULTI-LEVEL JUSTIFICATION` (468), `PRIMARY PAIN GENERATOR` (470-471), `MULTI-SITE JUSTIFICATION` (472), `MINOR-PATIENT CONSENT BRANCH` (480-487), `ALTERNATIVES-DISCUSSED RULE` (484-487), `PER-SITE VOLUME ALLOCATION RULE` (523-529), `SOURCE PRECEDENCE RULE` (571-581: procedureRecord.diagnoses authoritative, pmSupplementaryDiagnoses advisory), `CODING FRAMEWORK RULE` (583-589: TRAUMATIC vs DEGENERATIVE-WITH-SUPERIMPOSED-TRAUMA), `DOWNGRADE-TO HONOR RULE` (591), filters A-E (593-611), `RADICULAR-PROSE CONSTRAINT` (442), `RESPONSE-CALIBRATED FOLLOW-UP` (555-559), forbidden phrases blocks (501, 668, 677).

#### Discharge ([generate-discharge-note.ts:203-451](src/lib/claude/generate-discharge-note.ts))
- `DETERMINISTIC PAIN TRAJECTORY (HIGHEST PRIORITY)` (lines 228-255): verbatim render of `painTrajectoryText` + `dischargeVisitPainDisplay`, character-for-character.
- `SUPPLEMENTARY PAIN OBSERVATIONS (CONDITIONAL)` (lines 241-253): sidecar; never substitutes for arrow chain.
- `PAIN TRAJECTORY (LEGACY NUMERIC FALLBACK)` (lines 259-287): -2 rule + FINAL-INTERVAL REGRESSION OVERRIDE.
- `BASELINE DATA-GAP OVERRIDE` (lines 289-302).
- `PAIN TONE MATRIX — FINAL-INTERVAL SIGNAL` (lines 304-332): 9-row matrix + MINIMAL-IMPROVEMENT TIER.
- `SERIES VOLATILITY` (lines 336-353).
- `DIAGNOSTIC-SUPPORT RULE` (lines 404-427): 7 filters A-G — external-cause omission, myelopathy, radiculopathy, "A"-suffix sprain prohibition (prefer D/S), M79.1 redundancy, M54.5 specificity, symptom-resolution check.
- `DOWNGRADE-TO HONOR RULE` (line 406).

### Pre-Generation Deterministic Computations (per step)

**Computed in action layer before Claude call**, then injected into the prompt as fields the LLM must honor:

| Computation | File | Used by |
|---|---|---|
| `computePainToneLabel(current, ref, context)` | [src/lib/claude/pain-tone.ts:54](src/lib/claude/pain-tone.ts) | procedure (`vsBaseline`, `vsPrevious`), discharge (`overallPainTrend`) |
| `computeSeriesVolatility(painSeries)` | [pain-tone.ts:116](src/lib/claude/pain-tone.ts) | procedure, discharge |
| `deriveChiroProgress(functionalOutcomes)` | [pain-tone.ts:144](src/lib/claude/pain-tone.ts) | procedure |
| `computePlanAlignment(...)` | [src/lib/procedures/compute-plan-alignment.ts:294](src/lib/procedures/compute-plan-alignment.ts) | procedure (writes `plan_alignment_status` to row) |
| `buildDischargePainTrajectory(input)` | [src/lib/claude/pain-trajectory.ts:125](src/lib/claude/pain-trajectory.ts) | discharge (produces `arrowChain`, `dischargeDisplay`, `dischargeEstimated`) |
| `buildPainObservations(...)` | [src/lib/claude/pain-observations.ts:161](src/lib/claude/pain-observations.ts) | discharge (sidecar) |
| `pmSupplementaryDiagnoses` dedup | [src/actions/procedure-notes.ts:405-427](src/actions/procedure-notes.ts) | procedure |
| `computeAgeAtDate(DOB, eventDate)` | (utility) | IV, procedure, discharge |

IV-initial uses none of pain-tone / trajectory / volatility (NULL-CONTRACT). IV-pain-evaluation uses NUMERIC-ANCHOR computation against prior-IV `pain_score_max` only. Clinical orders uses none.

### Chain-Forward Inputs Per Generator

| Reader → | Reads | Notes |
|---|---|---|
| **Imaging Order** | IV note row (`diagnoses`, `chief_complaint`, `treatment_plan`, `visit_date`) | Only step 1 feeds step 2 |
| **Pain Evaluation IV** | Finalized initial IV (`chief_complaint`, `physical_exam`, `imaging_findings`, `medical_necessity`, `diagnoses`, `treatment_plan`, `prognosis`, `provider_intake`, `rom_data`, `visit_date`, `finalized_at`) + pre-finalization `vital_signs` row + `case_summaries` (approved/edited) + `pain_management_extractions` (approved/edited) | Triple chain: IV + summary + extractions. Step 2 (orders) NOT read |
| **Procedure** | Finalized IV (`past_medical_history`, `social_history`, `treatment_plan`) + all prior finalized procedure_notes (5 sections: `subjective`, `assessment_summary`, `procedure_injection`, `assessment_and_plan`, `prognosis`) + PM extraction (with `provider_overrides` merge) + MRI extractions + case_summary `suggested_diagnoses` + chiro `functional_outcomes` + intake `vital_signs` + own `procedureRecord.diagnoses` (authoritative) | Step 3 (pain eval) NOT read; only step 1 IV. Step 2 orders NOT read |
| **Discharge** | All `procedures[]` + per-procedure `vital_signs` + finalized IV `chief_complaint`/`physical_exam`/`diagnoses`/`treatment_plan` + case_summary (approved/edited) + PM extraction (overrides merge) + MRI all (approved/edited) + PT extraction + chiro discharge_summary + intake `vital_signs` + provider-entered discharge vitals on `discharge_notes` row | Reads step 1 IV, step 4 procedures + procedure vitals. Step 2 orders + step 3 pain eval IV NOT read directly (pain-eval IV row is also a `initial_visit_notes` row — only `visit_type='initial_visit'` finalized is queried) |

**Notable gaps in chain forwarding**:
- Procedure does not read pain-evaluation IV row (only initial IV).
- Discharge does not read pain-evaluation IV row (only initial IV).
- Nothing reads clinical_orders.
- No generator reads any prior-step's `raw_ai_response` for cross-step LLM-output consistency.

### Post-Generation Verification — Confirmed Single Surface

[src/lib/claude/pain-trajectory-validator.ts:62](src/lib/claude/pain-trajectory-validator.ts) `validateDischargeTrajectoryConsistency`:

- `TRAJECTORY_SECTIONS` ([validator:22-27](src/lib/claude/pain-trajectory-validator.ts)): `subjective`, `objective_vitals`, `assessment`, `prognosis`.
- Regex ([validator:20](src/lib/claude/pain-trajectory-validator.ts)): `/(\d{1,2}(?:-\d{1,2})?)\/10(?!\d|\/)/g`.
- 4 checks: out-of-trajectory pain values; discharge endpoint in `objective_vitals`; discharge endpoint in subjective/assessment/prognosis; verbatim arrow chain in `subjective`.
- Sinks: `console.warn` ([discharge-notes.ts:798-804](src/actions/discharge-notes.ts)) + embedded in `raw_ai_response.trajectory_warnings` + `raw_ai_response.discharge_readings_found` ([discharge-notes.ts:810-811](src/actions/discharge-notes.ts)).
- Section regen also runs validator ([discharge-notes.ts:1098-1177](src/actions/discharge-notes.ts)) but does **not** persist warnings on regen update ([line 1181](src/actions/discharge-notes.ts) update payload omits `raw_ai_response`).
- **No UI consumer**: discharge editor never reads `raw_ai_response.trajectory_warnings`.

Survey of `src/lib/claude/` and `src/actions/` for `validate*` / `verify*` / `check*Consistency`: only this file. No cross-step or cross-note validators exist for IV, pain-eval IV, procedure, or clinical orders.

`checkSummaryStaleness` ([case-summaries.ts:244-263](src/actions/case-summaries.ts)) is a pre-gen drift check, not post-gen.

### Source-Hash Drift — Confirmed Asymmetry

`source_data_hash text` is **written** on every generation by all four note types + summaries. SHA-256 over `JSON.stringify(inputData)`:
- [src/actions/initial-visit-notes.ts:32-35](src/actions/initial-visit-notes.ts), written line 528
- [src/actions/procedure-notes.ts:28-31](src/actions/procedure-notes.ts), written line 722
- [src/actions/discharge-notes.ts:31-34](src/actions/discharge-notes.ts), written lines 671, 840
- [src/actions/case-summaries.ts:12-15](src/actions/case-summaries.ts), written line 213

`source_data_hash` is **compared** for staleness in **only one place**: `checkSummaryStaleness` for case_summaries. Notes never compare. The drift signal is captured but unused for IV/procedure/discharge.

### Edit/Regen Channel — Quality Surfaces Already Wired

All three note types have per-section regen actions that gather **fresh** source data (i.e., upstream changes propagate at regen time):
- [src/actions/initial-visit-notes.ts:798](src/actions/initial-visit-notes.ts) `regenerateNoteSection` — passes `otherSections` for prose-vs-diagnosis consistency.
- [src/actions/procedure-notes.ts:1018](src/actions/procedure-notes.ts) `regenerateProcedureNoteSectionAction` — passes `otherSections` context.
- [src/actions/discharge-notes.ts:1038](src/actions/discharge-notes.ts) `regenerateDischargeNoteSectionAction` — re-runs trajectory validator on merged note + atomically refreshes `discharge_pain_estimate_*`, `pain_trajectory_text` columns.

`tone_hint text` persists on each note row, threads through regen unchanged unless overridden. Read in user-message tail block (not system prompt). All system prompts include `PROVIDER TONE/DIRECTION HINT` rule explicitly stating tone_hint does NOT override clinical facts, mandatory numeric rules, or formatting.

`provider_intake jsonb` on `initial_visit_notes` — read at [initial-visit-notes.ts:148-153](src/actions/initial-visit-notes.ts), [317-318](src/actions/initial-visit-notes.ts) — listed as PRIMARY source in IV system prompt (`=== PROVIDER INTAKE DATA ===` lines 72-80) overriding `caseSummary` when both populated.

`pain_management_extractions.provider_overrides` jsonb — applied with overrides-first precedence in **all three** consuming generators:
- [initial-visit-notes.ts:212-219](src/actions/initial-visit-notes.ts) (pain-evaluation only)
- [procedure-notes.ts:378-396](src/actions/procedure-notes.ts)
- [discharge-notes.ts:477-491](src/actions/discharge-notes.ts)

Other extractions (`mri_extractions`, `pt_extractions`, `chiro_extractions`) have `provider_overrides` columns but generator gather functions do **not** merge them — read raw columns directly from approved/edited rows.

### `raw_ai_response` Audit Blob — Per-Step Content

| Note | Content | File:line |
|---|---|---|
| Initial Visit | `result.rawResponse \|\| null` (raw Anthropic tool-use response) | [initial-visit-notes.ts:525](src/actions/initial-visit-notes.ts) |
| Procedure | `result.rawResponse \|\| null` | [procedure-notes.ts:719](src/actions/procedure-notes.ts) |
| Clinical Orders | `result.rawResponse` cast to `Record<string,unknown>` | [clinical-orders.ts:232](src/actions/clinical-orders.ts) |
| Discharge | **Wrapped object**: `{ raw, trajectory_warnings, discharge_readings_found, pain_trajectory_text, discharge_visit_pain_display, discharge_visit_pain_estimated }` | [discharge-notes.ts:809-816, 834](src/actions/discharge-notes.ts) |

Discharge is the only note type whose `raw_ai_response` carries post-gen verifier output alongside the LLM payload.

### Quality Surfaces Summary (Step-by-Step PI Workflow)

| Step | Pre-gen rules | Pre-gen deterministic computations | Post-gen verifier | Drift hash compared? | Audit blob extras |
|---|---|---|---|---|---|
| 1. IV | NULL-CONTRACT, DIAGNOSTIC-SUPPORT (initial), NO BRACKETS, SCOPE | none | none | no | none |
| 2. Imaging Order | scope rule only | none | none | n/a | none |
| 3. Pain Eval | DIAGNOSTIC-SUPPORT (pain-eval, 6 filters), DOWNGRADE-TO, NUMERIC-ANCHOR | NUMERIC-ANCHOR threshold | none | no | none |
| 4. Procedure | 20+ named rules (NO CLONE, MISSING-VITALS, PAIN TONE MATRIX, SERIES VOLATILITY, PLAN-COHERENCE, source precedence, coding framework, filters A-E, etc.) | pain tone signals, series volatility, chiro progress, plan alignment, intake anchor | none | no | none. Plan deviation gate at finalize |
| 5. Discharge | 7+ named rules including DETERMINISTIC PAIN TRAJECTORY, BASELINE DATA-GAP, PAIN TONE MATRIX, SERIES VOLATILITY, 7-filter DIAGNOSTIC-SUPPORT | overall pain trend, series volatility, trajectory builder (arrow chain, endpoint), pain observations | `validateDischargeTrajectoryConsistency` (4 checks; warnings non-fatal, embedded in raw_ai_response, no UI) | no | trajectory_warnings, discharge_readings_found, pain_trajectory_text, discharge_visit_pain_display, discharge_visit_pain_estimated |

### Quality Surfaces That Could Host Verification (Existing Infra Only — No Recommendation)

- `source_data_hash` columns on all 3 note tables — written but never compared for IV/procedure/discharge. The pattern from `checkSummaryStaleness` is portable.
- `raw_ai_response` is jsonb on every note — discharge already proves the wrap pattern works for embedding verifier output.
- Section regen actions already gather fresh upstream data — verifier could run in the regen path.
- Per-section regen + tone_hint thread + provider_overrides merges are the existing manual-correction channels.
- Pain-tone / series-volatility / plan-alignment / trajectory-builder are pure functions with tests; suitable for cross-step consistency checks.
- No verifier exists for IV ↔ pain-evaluation IV diagnosis consistency, IV plan ↔ procedure record alignment, procedure ICD-10 progression ↔ MRI findings, or discharge diagnoses ↔ procedure history. All inputs to such checks already flow through the gather functions.
