---
date: 2026-04-21
author: arsenaid
status: in-progress
topic: Discharge pain-timeline precision — Phase 1
depends_on: thoughts/shared/research/2026-04-21-discharge-pain-timeline-precision.md
tags: [plan, discharge-notes, pain-timeline, trajectory-builder]
---

# Plan: Discharge pain-timeline precision — Phase 1

## Goal

Remove the two biggest sources of numeric imprecision in the discharge-note pain timeline:
1. LLM hand-assembling the arrow chain from JSON.
2. LLM applying the `-2` fabrication rule to estimate the discharge-visit pain endpoint.

Phase-1 strategy: compute the trajectory string + discharge endpoint deterministically in TypeScript and pass them to the LLM as verbatim strings. Also gate generation on provider-entered discharge-visit pain (was only gated at finalize).

## Scope

In:
- **R1**: deterministic trajectory builder in TS; new migration column `discharge_pain_estimate`; prompt instructs LLM to use `painTrajectoryText` verbatim.
- **R2-A (softened)**: if `dischargeVitals.pain_score_max == null`, the `-2` fallback path is still taken, BUT the computed endpoint is returned as a structured field and stamped on the row. Block finalize already exists. Also block **generation** when latest-procedure pain is also null (no anchor for -2 rule).
- **R10 (partial)**: post-generation numeric consistency validator — parse LLM output for pain numbers and log warnings when they diverge from the computed timeline. Warnings surface in `raw_ai_response` diagnostics; hard-block not added yet.

Out (Phase 2/3):
- Changing tone thresholds.
- New reading-context columns.
- Pre/post procedure readings.
- PT/PM/chiro timeline merging.
- Intake-vs-first-procedure split baseline.
- Time-axis labels (day N).
- Editor timeline widget.

## Design

### 1. New module: `src/lib/claude/pain-trajectory.ts`

Pure functions, no I/O:

```ts
export type TimelineSource = 'procedure' | 'discharge_vitals' | 'discharge_estimate'

export interface TimelineEntry {
  date: string | null           // ISO YYYY-MM-DD; null for discharge estimate without date
  label: string                 // human label: "initial evaluation", "procedure 1", "discharge visit"
  min: number | null
  max: number | null
  source: TimelineSource
  estimated: boolean
}

export interface DischargePainTrajectory {
  entries: TimelineEntry[]      // chronological
  arrowChain: string            // "8/10 → 6/10 → 4/10 → 3/10 at injection series, 1/10 at today's discharge visit"
  baselineDisplay: string | null // e.g. "7/10" or "7-8/10" or null when baseline missing
  dischargeDisplay: string | null // e.g. "1/10" or null when unknown
  dischargeEntry: TimelineEntry | null
  dischargeEstimated: boolean   // true when the -2 rule produced the endpoint
}

export function formatPainValue(min: number | null, max: number | null): string | null
export function estimateDischargeFromLatest(latestMax: number | null, latestMin: number | null): { min: number | null; max: number | null } // applies -2 rule with floor-at-0
export function buildDischargePainTrajectory(input: {
  procedures: Array<{ procedure_date: string; procedure_number: number; pain_score_min: number | null; pain_score_max: number | null }>
  latestVitals: { pain_score_min: number | null; pain_score_max: number | null } | null
  dischargeVitals: { pain_score_min: number | null; pain_score_max: number | null } | null
  baselinePain: { procedure_date: string; pain_score_min: number | null; pain_score_max: number | null } | null
  overallPainTrend: 'baseline' | 'improved' | 'stable' | 'worsened'
  finalIntervalWorsened: boolean
}): DischargePainTrajectory
```

Estimate rule (mirrors existing prompt rule exactly):
- `dischargeVitals` non-null → use verbatim.
- else if `finalIntervalWorsened` (vsPrevious === 'worsened') → use `latestVitals` verbatim (suppresses -2).
- else if `overallPainTrend` ∈ {'stable','worsened'} → use `latestVitals` verbatim (no fabrication on non-improving series).
- else if `latestVitals.pain_score_max != null` → apply `-2` with floor-at-0 to both min (if present) and max; flag `dischargeEstimated: true`.
- else → null (no anchor).

Arrow chain rules:
- If `entries.length < 2` → return empty string (caller can skip the sentence).
- Skip entries where both min and max are null (gap) but mark gap: the entry is omitted from the arrow sequence, but if total non-null entries < 2 the chain still goes empty.
- Format: `"A/10 → B/10 → C/10 across the injection series, D/10 at today's discharge evaluation"` when an estimated/dischargeEntry exists, else `"A/10 → B/10 → C/10 across the injection series"`.
- Range rendering: `"X-Y/10"` when min != max and both present; `"X/10"` when equal or only max present.

### 2. Wire into `DischargeNoteInputData`

Add two top-level fields:
- `painTrajectoryText: string | null` — the arrow chain; LLM must render **verbatim** when non-null.
- `dischargeVisitPainDisplay: string | null` — the discharge endpoint string (e.g. `"1/10"` or `"0-1/10"`).
- `dischargeVisitPainEstimated: boolean` — audit flag.

Keep existing fields for back-compat; prompt will instruct preferential use of the new fields.

### 3. Migration: `supabase/migrations/20260426_discharge_notes_pain_trajectory.sql`

```sql
alter table public.discharge_notes
  add column discharge_pain_estimate_min integer check (discharge_pain_estimate_min >= 0 and discharge_pain_estimate_min <= 10),
  add column discharge_pain_estimate_max integer check (discharge_pain_estimate_max >= 0 and discharge_pain_estimate_max <= 10),
  add column discharge_pain_estimated boolean not null default false,
  add column pain_trajectory_text text;

comment on column public.discharge_notes.discharge_pain_estimate_min is
  'Computed discharge-visit pain lower bound (from dischargeVitals when provided, else -2 rule from latest procedure vitals). Persisted for audit/defensibility.';
comment on column public.discharge_notes.discharge_pain_estimate_max is
  'Computed discharge-visit pain upper bound. Symmetric with discharge_pain_estimate_min.';
comment on column public.discharge_notes.discharge_pain_estimated is
  'True when endpoint was fabricated via -2 rule. False when dischargeVitals.pain_score_max was provider-entered.';
comment on column public.discharge_notes.pain_trajectory_text is
  'Deterministically built arrow chain (e.g. "8/10 → 6/10 → 4/10 across the injection series, 1/10 at today\''s discharge evaluation"). The LLM must render this verbatim in subjective/assessment/prognosis.';
```

### 4. Prompt changes — `generate-discharge-note.ts`

- Extend `DischargeNoteInputData` interface with the three new top-level fields.
- Add a new **`=== PAIN TRAJECTORY TEXT (VERBATIM) ===`** block at the top of PAIN TRAJECTORY section stating:
  - If `painTrajectoryText` is non-null, it MUST appear verbatim inside the subjective paragraph that discusses pain progression. Do NOT paraphrase the arrow chain. Do NOT recompute the numbers. Do NOT extend the chain with additional procedures.
  - If `dischargeVisitPainDisplay` is non-null, it MUST be used verbatim as the discharge-visit pain number in subjective, assessment, prognosis, and as the Pain bullet in objective_vitals.
  - The block supersedes the numeric-arithmetic rules in the existing `=== PAIN TRAJECTORY ===` section when both are non-null. Existing blocks still govern **narrative tone** (stable/worsened overrides, volatility, mixed framing).
- Existing `-2` rule prose remains as fallback documentation but is prefixed with "Legacy fallback (only applies when `painTrajectoryText`/`dischargeVisitPainDisplay` are null)".

### 5. Generation-time gate — `discharge-notes.ts`

In `generateDischargeNote`, after `gatherDischargeNoteSourceData` succeeds, if `painTrajectoryText == null` AND `dischargeVisitPainDisplay == null`, return an error: "Cannot generate: no pain data is available. Enter discharge-visit pain under Discharge Vitals, or ensure at least one procedure has a recorded pain score."

This keeps the no-anchor case from silently producing qualitative-only notes.

### 6. Persist trajectory + endpoint on generate

`generateDischargeNote` writes:
- `discharge_pain_estimate_min/max` = the parsed numeric endpoint from the trajectory builder
- `discharge_pain_estimated` = `dischargeEstimated`
- `pain_trajectory_text` = the arrow chain

Before the status='generating' insert AND on success write.

### 7. Post-generation numeric validator — `src/lib/claude/pain-trajectory-validator.ts`

```ts
export interface TrajectoryValidationResult {
  warnings: string[]            // non-fatal; logged to raw_ai_response
  dischargeReadingsFound: Array<{ section: string; value: string }>
}
export function validateDischargeTrajectoryConsistency(
  result: DischargeNoteResult,
  trajectory: DischargePainTrajectory,
): TrajectoryValidationResult
```

Rules:
- Extract every `N/10` or `N-M/10` substring from subjective/assessment/prognosis/objective_vitals.
- Warn when a value in subjective appears that is NOT in `trajectory.entries` AND NOT `dischargeDisplay`.
- Warn when `dischargeVisitPainDisplay` is non-null but does not appear in subjective, assessment, or prognosis.
- Warn when `objective_vitals` Pain bullet does not match `dischargeDisplay` (when non-null).

Warnings piped through `raw_ai_response` JSON as `{ trajectory_warnings: [...] }`. No hard block.

### 8. Tests

New files:
- `src/lib/claude/__tests__/pain-trajectory.test.ts` — 12+ cases covering:
  - empty procedures, single procedure, many procedures, missing vitals in middle
  - dischargeVitals present → used verbatim
  - finalIntervalWorsened → suppresses -2
  - overallPainTrend = stable/worsened → suppresses -2
  - normal -2 rule (7 → 5, 3 → 1, 2 → 0, 1 → 0, 0 → 0)
  - range preservation (7-8 → 5-6, 1-2 → 0-0)
- `src/lib/claude/__tests__/pain-trajectory-validator.test.ts` — 6+ cases covering:
  - clean note → no warnings
  - fabricated baseline number in subjective → warning
  - missing dischargeDisplay in subjective → warning
  - Pain bullet mismatch → warning

Update `src/lib/claude/__tests__/generate-discharge-note.test.ts` to cover the new input fields if it tests the prompt; otherwise leave.

## Risk / Rollback

- Migration is additive (new nullable columns + one boolean default false). Rollback = drop columns.
- If trajectory builder breaks, `painTrajectoryText = null` keeps the old prompt path live (legacy fallback).
- Generation-time gate is new — may surface cases that currently generate qualitatively. Acceptable: qualitative-only discharge notes are exactly the defensibility risk we are removing.

## Success criteria

- Discharge notes for cases with procedure pain data render the arrow chain literally from the TS-built string.
- The discharge-visit pain number in prose matches the persisted `discharge_pain_estimate_*` columns.
- Validator warnings appear on `raw_ai_response` for any LLM drift.
- All existing discharge-note tests still pass; new tests pass.

## Task breakdown

1. Create `pain-trajectory.ts` + unit tests.
2. Write migration SQL.
3. Extend `DischargeNoteInputData` + `gatherDischargeNoteSourceData` to build and pass the three new fields.
4. Update prompt system text in `generate-discharge-note.ts`.
5. Add generation-time gate + persist the new columns in `generateDischargeNote` (and `regenerateDischargeNoteSection` for consistency).
6. Create `pain-trajectory-validator.ts` + unit tests; call after `generateDischargeNoteFromData` and stash warnings into `raw_ai_response`.
7. `npm run test` + `npx tsc --noEmit` (or `npm run build` check via `tsc`).
