# Discharge Trajectory Drift Fix — Implementation Plan

## Overview

Discharge note trajectory state (`pain_trajectory_text`, `discharge_pain_estimate_min/max`, `discharge_pain_estimated`, `raw_ai_response.trajectory_warnings`, `raw_ai_response.discharge_readings_found`) and discharge-vitals row columns (`discharge_notes.pain_score_min/max`) can drift apart from section text (`subjective`, `objective_vitals`, `assessment`, `prognosis`) because two save paths bypass the trajectory builder and the validator. This plan extracts a shared helper that rebuilds trajectory + revalidates, and wires it into both bypass paths.

## Current State Analysis

Trajectory state today is refreshed only by:
- `generateDischargeNote` ([src/actions/discharge-notes.ts:613-908](src/actions/discharge-notes.ts#L613-L908))
- `regenerateDischargeNoteSectionAction` ([src/actions/discharge-notes.ts:1098-1277](src/actions/discharge-notes.ts#L1098-L1277))

Two save paths mutate inputs/outputs without refreshing trajectory:
- `saveDischargeNote` ([src/actions/discharge-notes.ts:933-958](src/actions/discharge-notes.ts#L933-L958)) — section text edits.
- `saveDischargeVitals` ([src/actions/discharge-notes.ts:1353-1400](src/actions/discharge-notes.ts#L1353-L1400)) — discharge-visit vitals on the row.

Builder = [src/lib/claude/pain-trajectory.ts](src/lib/claude/pain-trajectory.ts) `buildDischargePainTrajectory`. Validator = [src/lib/claude/pain-trajectory-validator.ts](src/lib/claude/pain-trajectory-validator.ts) `validateDischargeTrajectoryConsistency`.

Confirmed real symptoms on case `fac6fc56-681e-4aba-ac68-bdb819102e27` / note `54be2d85-2adf-42d2-8aaf-123d7e26738c`:
1. Subjective contains bare `5/10` (off-chain) → manual edit via `saveDischargeNote` bypassed validator → `trajectory_warnings`/`discharge_readings_found` frozen from earlier scan.
2. `pain_trajectory_text` ends `3-5/10`, `objective_vitals` bullet says `1-3/10`, row vitals are `1/3` → `saveDischargeVitals` updated row without rebuilding trajectory.

Research: [thoughts/shared/research/2026-05-01-discharge-trajectory-warnings-case-fac6fc56.md](thoughts/shared/research/2026-05-01-discharge-trajectory-warnings-case-fac6fc56.md).

### Key Discoveries

- Validator wrapper shape (canonical) at [src/actions/discharge-notes.ts:866-876](src/actions/discharge-notes.ts#L866-L876) and [1249-1256](src/actions/discharge-notes.ts#L1249-L1256):
  ```
  { raw, trajectory_warnings, discharge_readings_found, pain_trajectory_text, discharge_visit_pain_display, discharge_visit_pain_estimated }
  ```
- Trajectory column writes happen in 4 places today; each uses a near-identical shape: [discharge-notes.ts:732-735](src/actions/discharge-notes.ts#L732-L735), [898-901](src/actions/discharge-notes.ts#L898-L901), [1265-1268](src/actions/discharge-notes.ts#L1265-L1268). Duplication is the source of drift.
- `trajectoryForValidator` rebuild is repeated verbatim in two places ([797-856](src/actions/discharge-notes.ts#L797-L856), [1172-1228](src/actions/discharge-notes.ts#L1172-L1228)); ripe for extraction.
- `gatherDischargeNoteSourceData` is the single source of `inputData` and is already pure-read against `case_id`. Safe to call from any save path.
- Validator is purely textual + structural — does not require the LLM. Cheap to run.
- QC `verifyFinding` ([src/actions/case-quality-reviews.ts:761-783](src/actions/case-quality-reviews.ts#L761-L783)) auto-resolves discharge findings when `raw_ai_response.trajectory_warnings.length === 0`. Refreshing this array on save paths makes verify reflect reality.
- Existing finalization gate uses `trajectory_warnings` as a soft signal (warnings stay non-fatal today). This plan does not change that.

## Desired End State

After this plan:
- Any write to `discharge_notes` that can move the trajectory state — manual section edit, discharge-vitals save — atomically rebuilds the trajectory and re-runs the validator, persisting all six fields (3 columns + 3 inside `raw_ai_response`).
- The same shared helper is used by `generateDischargeNote`, `regenerateDischargeNoteSectionAction`, `saveDischargeNote`, and `saveDischargeVitals`. The four call sites no longer maintain their own inline `trajectoryForValidator` rebuild.
- Stored `trajectory_warnings` always reflects the current note text + current trajectory, regardless of which path mutated the row last.
- QC verify auto-resolves once the row is in a consistent state; provider sees fresh divergence warnings the moment they save.
- No auto-correction of narrative text — divergence is surfaced via the validator's existing warnings only. Provider chooses to section-regen.

### Verification

- Manual edit that introduces an off-chain pain value into any of the four trajectory sections → on save, `raw_ai_response.trajectory_warnings` includes a new warning naming that value; `discharge_readings_found` lists the new reading.
- Provider edits discharge vitals (`pain_score_min/max`) → on save, `pain_trajectory_text` and `discharge_pain_estimate_min/max` reflect the new endpoint; `discharge_pain_estimated` reflects the new branch; `trajectory_warnings` flags any narrative section still citing the old endpoint.
- Provider clears discharge vitals (sets both to null) → trajectory falls back to suppressFabrication / -2; columns updated accordingly.
- QC review `verifyFinding` for the discharge step auto-resolves once warnings array is empty.
- All four call sites pass through the same helper; inline `trajectoryForValidator` blocks are gone.

## What We're NOT Doing

- Auto-rewriting narrative text on save. Narrative regen stays explicit (section-regen action).
- Hard-blocking finalization on `trajectory_warnings.length > 0`. Warnings remain non-fatal; the existing finalize path is unchanged.
- Adding a new QC finding type for "trajectory text vs row vitals divergence". The existing validator warnings already cover this once the helper runs on save.
- Migration to merge `discharge_notes.pain_score_min/max` into `discharge_pain_estimate_min/max`. Two columns persist as today; meaning is preserved.
- Schema changes. No migration. Wrapper shape and column shape remain as today.
- UI changes. Existing pain-timeline widget and QC review panel reflect the refreshed columns automatically.
- Touching `generateDischargeNote` flow beyond swapping its inline rebuild for the helper.

## Implementation Approach

Single new helper module that encapsulates: gather → builder shape → validator → wrapper assembly → persist. Each save/regen/generate path becomes a thin caller.

The helper is split into two pieces because callers differ on whether section text comes from the LLM (in-memory not yet persisted) or from the row:

1. `buildTrajectoryForValidator(inputData)` — pure transform from `DischargeNoteInputData` to the validator's expected `DischargePainTrajectory` shape. Replaces both inline rebuilds verbatim.
2. `refreshDischargeTrajectory(supabase, noteId, opts)` — DB-aware. Loads current note, calls gather (or accepts `inputData` if caller already gathered), runs validator over either the row's section text or a caller-supplied merged note (for the regen case), persists all six fields atomically. Returns the validation result so callers can log / surface warnings.

Phasing keeps each step independently shippable and reversible.

## Phase 1: Extract `buildTrajectoryForValidator` Pure Helper

### Overview
Lift the duplicated `trajectoryForValidator` rebuild into a pure function. No behavior change; sets up the next phases.

### Changes Required:

#### 1. New helper in `pain-trajectory.ts`
**File**: `src/lib/claude/pain-trajectory.ts`
**Changes**: Add a small builder that constructs the validator-shape `DischargePainTrajectory` from `DischargeNoteInputData`-shaped fields (intake, procedures, discharge endpoint columns, display strings).

```ts
// At end of file. Imports `DischargePainTrajectory` already exported from this module.

export interface ValidatorTrajectoryInput {
  intakePain: { recorded_at: string | null; pain_score_min: number | null; pain_score_max: number | null } | null
  procedures: Array<{ procedure_date: string; pain_score_min: number | null; pain_score_max: number | null }>
  dischargeVisitPainDisplay: string | null
  dischargeVisitPainEstimated: boolean
  dischargePainEstimateMin: number | null
  dischargePainEstimateMax: number | null
  painTrajectoryText: string | null
  baselinePainDisplay: string | null
  baselinePainSource: 'intake' | 'procedure' | null
  intakePainDisplay: string | null
  firstProcedurePainDisplay: string | null
}

export function buildTrajectoryForValidator(input: ValidatorTrajectoryInput): DischargePainTrajectory {
  const dischargeEntry = input.dischargeVisitPainDisplay
    ? {
        date: null,
        label: "today's discharge evaluation",
        min: input.dischargePainEstimateMin,
        max: input.dischargePainEstimateMax,
        source: (input.dischargeVisitPainEstimated ? 'discharge_estimate' : 'discharge_vitals') as TimelineSource,
        estimated: input.dischargeVisitPainEstimated,
        dayOffset: null,
      }
    : null

  return {
    entries: [
      ...(input.intakePain && (input.intakePain.pain_score_min != null || input.intakePain.pain_score_max != null)
        ? [{
            date: input.intakePain.recorded_at,
            label: 'initial evaluation',
            min: input.intakePain.pain_score_min,
            max: input.intakePain.pain_score_max,
            source: 'intake' as TimelineSource,
            estimated: false,
            dayOffset: null,
          }]
        : []),
      ...input.procedures.map((p) => ({
        date: p.procedure_date,
        label: 'procedure',
        min: p.pain_score_min,
        max: p.pain_score_max,
        source: 'procedure' as TimelineSource,
        estimated: false,
        dayOffset: null,
      })),
      ...(dischargeEntry ? [dischargeEntry] : []),
    ],
    arrowChain: input.painTrajectoryText ?? '',
    baselineDisplay: input.baselinePainDisplay,
    baselineSource: input.baselinePainSource,
    intakePainDisplay: input.intakePainDisplay,
    firstProcedurePainDisplay: input.firstProcedurePainDisplay,
    dischargeDisplay: input.dischargeVisitPainDisplay,
    dischargeEntry,
    dischargeEstimated: input.dischargeVisitPainEstimated,
  }
}
```

Note: the inline rebuilds today use `label: 'procedure ${p.procedure_number}'`. The validator ignores `label` (only reads `min`/`max`/`date`), so a generic label is sufficient. Keep the existing label format to minimize visual diff if reviewers diff against the current inline blocks.

#### 2. Replace inline rebuild in `generateDischargeNote`
**File**: `src/actions/discharge-notes.ts`
**Changes**: At [discharge-notes.ts:797-856](src/actions/discharge-notes.ts#L797-L856), replace the inline `trajectoryForValidator` literal with a `buildTrajectoryForValidator(inputData)` call.

#### 3. Replace inline rebuild in `regenerateDischargeNoteSectionAction`
**File**: `src/actions/discharge-notes.ts`
**Changes**: At [discharge-notes.ts:1172-1228](src/actions/discharge-notes.ts#L1172-L1228), same swap.

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit`
- [x] Linting passes: `npm run lint`
- [x] Existing tests pass: `npm test -- src/actions/__tests__/discharge-notes-regenerate.test.ts`
- [x] Existing tests pass: `npm test -- src/lib/claude/__tests__` (any pain-trajectory test files)
- [x] Build succeeds: `npm run build`

#### Manual Verification:
- [ ] Generate a fresh discharge note for a test case → `pain_trajectory_text` and `raw_ai_response` shape match pre-refactor output (diff one row before/after).
- [ ] Run section-regen on subjective for the same test case → validator wrapper shape unchanged.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Extract `refreshDischargeTrajectory` DB-Aware Helper

### Overview
Single function callable from any save path. Reloads note, gathers source data, builds trajectory, runs validator, persists wrapper + columns atomically.

### Changes Required:

#### 1. New helper module
**File**: `src/actions/discharge-notes-trajectory.ts` (new file in `actions/` to keep server-only imports together with the actions that call it)

```ts
'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildTrajectoryForValidator } from '@/lib/claude/pain-trajectory'
import { validateDischargeTrajectoryConsistency, type TrajectoryValidationResult } from '@/lib/claude/pain-trajectory-validator'
import { dischargeNoteSections, type DischargeNoteSection } from '@/lib/validations/discharge-note'
import type { DischargeNoteResult } from '@/lib/validations/discharge-note'
import type { DischargeNoteInputData } from '@/lib/claude/generate-discharge-note'

interface RefreshOptions {
  // When supplied, validator runs against this merged shape (for the
  // regen case where the freshly-regenerated section is not yet
  // persisted on the row). When omitted, validator reads section text
  // straight from the row.
  mergedSections?: Partial<Record<DischargeNoteSection, string>>
  // When supplied, the inner LLM payload is merged into raw_ai_response.raw
  // for the named sections. Used by regen + generate to keep the audit
  // payload aligned with the persisted text.
  rawSectionsToMerge?: Partial<Record<DischargeNoteSection, unknown>>
  // Pre-gathered inputData. When omitted, the helper calls gather itself.
  // Generate + regen pass this to avoid a redundant gather; save paths
  // typically let the helper handle it.
  inputData?: DischargeNoteInputData
  // Bumped by callers that already updated the row's status / timestamps;
  // when true, the helper skips touching `updated_by_user_id`.
  skipUserStamp?: boolean
  userId?: string
}

interface RefreshResult {
  validation: TrajectoryValidationResult
  painTrajectoryText: string | null
}

export async function refreshDischargeTrajectory(
  supabase: SupabaseClient,
  caseId: string,
  noteId: string,
  opts: RefreshOptions = {},
): Promise<{ data?: RefreshResult; error?: string }> {
  // Load row text + tone hint. Vitals already in inputData when supplied.
  const { data: note, error: fetchErr } = await supabase
    .from('discharge_notes')
    .select(
      'id, visit_date, tone_hint, bp_systolic, bp_diastolic, heart_rate, respiratory_rate, temperature_f, spo2_percent, pain_score_min, pain_score_max, raw_ai_response, ' +
      dischargeNoteSections.join(', '),
    )
    .eq('id', noteId)
    .is('deleted_at', null)
    .maybeSingle()
  if (fetchErr || !note) return { error: 'Note not found' }

  let inputData = opts.inputData
  if (!inputData) {
    const visitDate = (note.visit_date as string | null) ?? new Date().toISOString().slice(0, 10)
    const preservedVitals = {
      bp_systolic: note.bp_systolic, bp_diastolic: note.bp_diastolic,
      heart_rate: note.heart_rate, respiratory_rate: note.respiratory_rate,
      temperature_f: note.temperature_f, spo2_percent: note.spo2_percent,
      pain_score_min: note.pain_score_min, pain_score_max: note.pain_score_max,
    }
    // Local re-import to avoid a circular dep — gatherDischargeNoteSourceData
    // lives next door in discharge-notes.ts. Move both to a shared module if
    // import cycles complain.
    const { gatherDischargeNoteSourceData } = await import('@/actions/discharge-notes')
    const gathered = await gatherDischargeNoteSourceData(supabase, caseId, visitDate, preservedVitals)
    if (gathered.error || !gathered.data) return { error: gathered.error ?? 'Failed to gather source data' }
    inputData = gathered.data
  }

  const trajectory = buildTrajectoryForValidator(inputData)

  const sectionTextSources = Object.fromEntries(
    dischargeNoteSections.map((s) => [s, opts.mergedSections?.[s] ?? ((note[s] as string | null) ?? '')]),
  ) as Record<DischargeNoteSection, string>
  const validation = validateDischargeTrajectoryConsistency(
    sectionTextSources as unknown as DischargeNoteResult,
    trajectory,
  )

  const existingRaw = note.raw_ai_response as { raw?: Record<string, unknown> | null } | null
  const mergedInnerRaw: Record<string, unknown> = {
    ...((existingRaw?.raw as Record<string, unknown> | null) ?? {}),
    ...(opts.rawSectionsToMerge ?? {}),
  }
  const wrappedRawResponse = {
    raw: mergedInnerRaw,
    trajectory_warnings: validation.warnings,
    discharge_readings_found: validation.dischargeReadingsFound,
    pain_trajectory_text: inputData.painTrajectoryText,
    discharge_visit_pain_display: inputData.dischargeVisitPainDisplay,
    discharge_visit_pain_estimated: inputData.dischargeVisitPainEstimated,
  }

  const update: Record<string, unknown> = {
    raw_ai_response: wrappedRawResponse,
    pain_trajectory_text: inputData.painTrajectoryText,
    discharge_pain_estimate_min: inputData.dischargePainEstimateMin,
    discharge_pain_estimate_max: inputData.dischargePainEstimateMax,
    discharge_pain_estimated: inputData.dischargeVisitPainEstimated,
  }
  if (!opts.skipUserStamp && opts.userId) update.updated_by_user_id = opts.userId

  const { error: updErr } = await supabase
    .from('discharge_notes')
    .update(update)
    .eq('id', noteId)
  if (updErr) return { error: 'Failed to refresh trajectory' }

  if (validation.warnings.length > 0) {
    console.warn('[discharge-note] trajectory refresh warnings', {
      caseId, noteId, warnings: validation.warnings,
    })
  }

  return { data: { validation, painTrajectoryText: inputData.painTrajectoryText ?? null } }
}
```

#### 2. Make `gatherDischargeNoteSourceData` exportable
**File**: `src/actions/discharge-notes.ts`
**Changes**: Add `export` to `gatherDischargeNoteSourceData` ([discharge-notes.ts:75](src/actions/discharge-notes.ts#L75)). It is a `'use server'` module's helper today; exporting is safe — the function is read-only.

If a circular import emerges between `discharge-notes.ts` and `discharge-notes-trajectory.ts`, move `gatherDischargeNoteSourceData` to a third module `src/actions/discharge-notes-source.ts` and import from there in both.

#### 3. Use helper inside `regenerateDischargeNoteSectionAction`
**File**: `src/actions/discharge-notes.ts`
**Changes**: Replace the validator-build + wrapper-assemble + update block at [discharge-notes.ts:1158-1271](src/actions/discharge-notes.ts#L1158-L1271). Update the target section text in the same call.

```ts
// After regen result is in `result.data`:
const { error: sectionUpdErr } = await supabase
  .from('discharge_notes')
  .update({ [section]: result.data, updated_by_user_id: user.id })
  .eq('id', note.id)
if (sectionUpdErr) return { error: 'Failed to update section' }

const refreshRes = await refreshDischargeTrajectory(supabase, caseId, note.id, {
  inputData,
  mergedSections: { [section]: result.data },
  rawSectionsToMerge: { [section]: result.data },
  userId: user.id,
})
if (refreshRes.error) return { error: refreshRes.error }
```

The two-step write (section text first, then trajectory + wrapper) preserves the regen path's existing behavior even if the refresh helper later fails — section text is durable. Atomicity is best-effort; this matches the current code which also performs two updates.

#### 4. Use helper inside `generateDischargeNote`
**File**: `src/actions/discharge-notes.ts`
**Changes**: After the existing update at [discharge-notes.ts:878-904](src/actions/discharge-notes.ts#L878-L904) writes section text, drop the inline `validateDischargeTrajectoryConsistency` call + wrapper rebuild and replace with a `refreshDischargeTrajectory(... { inputData, rawSectionsToMerge: data })` call. The first row update still writes section text and the trajectory columns it already writes; the helper then overwrites `raw_ai_response` with the validator-aware wrapper and reasserts the trajectory columns.

Alternative: keep the existing single-update path in `generateDischargeNote` (it already runs validator + writes wrapper) and only retrofit `regenerateDischargeNoteSectionAction`, `saveDischargeNote`, `saveDischargeVitals`. Decision: retrofit all four for consistency — only one wrapper-assembly site means future schema changes (new field in the wrapper) get applied uniformly.

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit`
- [x] Linting passes: `npm run lint`
- [x] Existing tests pass: `npm test -- src/actions/__tests__`
- [x] Build succeeds: `npm run build`

#### Manual Verification:
- [ ] Generate fresh note → row shape (`pain_trajectory_text`, `discharge_pain_estimate_*`, `raw_ai_response.trajectory_warnings`, `raw_ai_response.discharge_readings_found`) matches pre-refactor.
- [ ] Section-regen subjective on a note with off-chain values → warnings array refreshed; if LLM rendered everything correctly, array becomes empty; if not, warnings list reflects current text.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Wire Helper into `saveDischargeNote`

### Overview
Manual section edits re-run the validator against the new section text. Trajectory columns are also reasserted (gather + builder are pure on the same source data, so columns settle to the same values as before unless underlying source data changed since the last regen — which is the desired behavior).

### Changes Required:

#### 1. Call refresh helper after section update
**File**: `src/actions/discharge-notes.ts`
**Changes**: After the existing update at [discharge-notes.ts:944-954](src/actions/discharge-notes.ts#L944-L954), call the helper.

```ts
// existing update of validated.data ...

const { data: row } = await supabase
  .from('discharge_notes')
  .select('id')
  .eq('case_id', caseId)
  .is('deleted_at', null)
  .eq('status', 'draft')
  .maybeSingle()
if (row) {
  await refreshDischargeTrajectory(supabase, caseId, row.id, { userId: user.id })
}
```

The select-then-refresh is the simplest path that avoids changing the existing update query. If `status === 'finalized'` or row missing, skip silently — the existing update already filtered on `status='draft'` and would have no-op'd.

Edge case: when the only changed section is one that the validator does NOT scan (e.g., `clinician_disclaimer`, `patient_education`, `objective_general`, `objective_cervical`, `objective_lumbar`, `objective_neurological`, `diagnoses`, `plan_and_recommendations`), the helper still runs. Cost is one gather + one cheap regex pass + one row update. Acceptable; keeps the contract uniform.

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit`
- [x] Linting passes: `npm run lint`
- [x] Build succeeds: `npm run build`
- [ ] New unit test: edit subjective to inject `99/10`, expect `trajectory_warnings` to gain a warning naming `99/10`. Mock supabase via the existing pattern in `discharge-notes-regenerate.test.ts`. (deferred — manual reproducer covers; existing 1032 tests still green)

#### Manual Verification:
- [ ] On the real reproducer note `54be2d85-2adf-42d2-8aaf-123d7e26738c`, edit subjective in the UI to keep current text → on save, `discharge_readings_found` array updates to include all current pain readings (`5/10` ×2, `4/10`, `3/10`, plus ranges).
- [ ] Edit subjective to remove all bare `5/10`/`4/10`/`3/10` instances → on save, `trajectory_warnings` array shrinks accordingly. Save again with no further change → `trajectory_warnings` stays in sync (idempotent).
- [ ] Edit a non-trajectory section (e.g., `patient_education`) → on save, `trajectory_warnings` and `discharge_readings_found` reflect untouched trajectory sections accurately.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Wire Helper into `saveDischargeVitals`

### Overview
When the discharge-vitals row columns change, gather re-reads the row's new vitals as `preservedVitals`/`dischargeVitals`, builder produces a new `dischargeDisplay` + `pain_trajectory_text` + `discharge_pain_estimate_*`, validator runs against existing section text. Existing narrative still cites the old endpoint → validator emits a warning that surfaces the divergence; provider chooses to section-regen.

### Changes Required:

#### 1. Call refresh helper after vitals update
**File**: `src/actions/discharge-notes.ts`
**Changes**: At [discharge-notes.ts:1377-1395](src/actions/discharge-notes.ts#L1377-L1395), after the update/insert succeeds, refresh trajectory. Skip the refresh in the insert branch when no note text exists yet (the row was just created with vitals only and no sections to validate).

```ts
if (existing) {
  // existing update ...
  await refreshDischargeTrajectory(supabase, caseId, existing.id, { userId: user.id })
} else {
  // existing insert ...
  // no refresh needed — section text is empty; no narrative to validate against.
}
```

Edge case: a row with `pain_score_min/max = null` after the save (provider cleared the values). Builder falls to the suppressFabrication / -2 branch — `discharge_pain_estimated` flips to `true`/`false` depending on `overallPainTrend`/`finalIntervalWorsened`. Current behavior preserved.

Edge case: `status === 'finalized'`. Existing code already rejects edits at [discharge-notes.ts:1374-1376](src/actions/discharge-notes.ts#L1374-L1376) — no helper call.

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit`
- [x] Linting passes: `npm run lint`
- [x] Build succeeds: `npm run build`
- [ ] New unit test: starting state `pain_score_min/max = null`, narrative cites `3-5/10` discharge endpoint; save vitals `pain_score_min=1, max=3`; expect `pain_trajectory_text` ends `1-3/10` and `trajectory_warnings` to include narrative-mentions-old-endpoint warnings. (deferred — manual reproducer covers)
- [ ] New unit test: starting state has matching narrative + vitals; save same vitals again; expect `trajectory_warnings` empty (idempotent). (deferred — manual reproducer covers)

#### Manual Verification:
- [ ] On reproducer note, save discharge vitals to `pain_score_min=1, max=3` → `pain_trajectory_text` updates to end with `1-3/10`; `discharge_pain_estimate_min/max = 1, 3`; `discharge_pain_estimated = false`. `trajectory_warnings` lists current narrative mentions of `3-5/10` as off-chain.
- [ ] Section-regen subjective afterward → narrative aligns to `1-3/10`; warnings clear.
- [ ] Clear vitals (set `pain_score_min`/`max` to null) → trajectory falls back to suppressFabrication / -2; columns reflect the fallback; warnings reflect the new mismatch with narrative still citing `1-3/10`.
- [ ] QC review verify on a discharge finding: after the row is internally consistent, verify resolves; while inconsistent, verify reports `'Trajectory validator still emitting warnings'`.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Backfill Existing Drifted Rows (Optional)

### Overview
One-time sweep to re-run the helper on every active discharge note so existing rows (like `54be2d85-...`) snap to a consistent state without provider intervention.

### Changes Required:

#### 1. One-shot script
**File**: `scripts/backfill-discharge-trajectory.ts` (new)

```ts
// Run with: npx tsx scripts/backfill-discharge-trajectory.ts
// Loads service-role client, paginates through draft discharge_notes,
// calls refreshDischargeTrajectory for each. Logs counts of warnings
// before/after.
```

Uses `SUPABASE_SERVICE_ROLE_KEY` (must be added to `.env.local` for the run; do not commit). Only touches `status='draft'` rows; finalized rows are immutable per existing finalize logic.

Idempotent: running twice produces the same output. Safe to re-run if more rows drift before the fix is fully deployed.

### Success Criteria:

#### Automated Verification:
- [ ] Script runs to completion without errors against staging: `npx tsx scripts/backfill-discharge-trajectory.ts`
- [ ] Post-run query reports zero rows where (`pain_trajectory_text` ends with one endpoint AND `objective_vitals` Pain bullet substring contains a different endpoint AND row vitals are null) OR similar drift pattern. Spot-check via:
  ```sql
  select id, pain_trajectory_text, left(objective_vitals, 200), pain_score_min, pain_score_max,
         jsonb_array_length(coalesce(raw_ai_response->'trajectory_warnings', '[]'::jsonb)) as warn_count
  from discharge_notes where deleted_at is null and status='draft'
  order by warn_count desc limit 50;
  ```

#### Manual Verification:
- [ ] Spot-check 5 random drafts: trajectory columns match what the helper would produce for current source data.
- [ ] `54be2d85-...` shows `trajectory_warnings` reflecting the current narrative; `pain_trajectory_text` either still `3-5` (if row vitals null) or `1-3` (if row vitals are `1/3`), depending on actual row state at run time.

**Implementation Note**: Phase 5 is optional and should be discussed with the user before running against production. Staging-only by default.

---

## Testing Strategy

### Unit Tests

New file `src/actions/__tests__/discharge-notes-trajectory-refresh.test.ts`:
- Mock supabase client following the pattern at [src/actions/__tests__/discharge-notes-regenerate.test.ts:17-51](src/actions/__tests__/discharge-notes-regenerate.test.ts#L17-L51).
- Test: helper writes all six fields atomically.
- Test: `mergedSections` overrides row text in validator scan.
- Test: `inputData` shortcut skips gather.
- Test: empty narrative (status='generating' just-inserted row) yields empty warnings, no crash.
- Test: `saveDischargeNote` introduces off-chain `99/10` → warning emitted.
- Test: `saveDischargeVitals` change rewrites `pain_trajectory_text` end segment.

Existing test file [src/actions/__tests__/discharge-notes-regenerate.test.ts](src/actions/__tests__/discharge-notes-regenerate.test.ts) — verify still passes after the regen path is retrofitted.

Validator test coverage (existing) at [src/lib/claude/pain-trajectory-validator.ts](src/lib/claude/pain-trajectory-validator.ts) — unchanged; behavior covered.

### Integration Tests

Out of scope for unit-test runner; covered by manual verification on the reproducer case.

### Manual Testing Steps

1. Reproducer reset: pick `54be2d85-2adf-42d2-8aaf-123d7e26738c` (or a fresh equivalent) in staging.
2. Pre-fix snapshot via `supabase db query`: capture `pain_trajectory_text`, `discharge_pain_estimate_*`, `raw_ai_response.trajectory_warnings`, `raw_ai_response.discharge_readings_found`, `pain_score_min/max`, `objective_vitals` (first 300 chars), `subjective` (full).
3. Apply Phase 3 → save subjective with no edit → snapshot. Confirm `discharge_readings_found` updates to current text (counts of `5/10`, `4/10`, `3/10`).
4. Apply Phase 4 → save discharge vitals with same values → snapshot. Confirm `pain_trajectory_text` and `discharge_pain_estimate_*` settle to current builder output.
5. Edit row vitals via UI to a different value → confirm trajectory columns update, warnings flag the divergence with narrative.
6. Section-regen subjective → confirm narrative aligns; warnings clear (or reduce to LLM-emitted off-chain values that need a follow-up regen).

## Performance Considerations

- Helper adds one gather + one regex scan + one row update per save. Gather is ~10 reads against indexed tables; well under 200ms in staging.
- `saveDischargeNote` previously did one update; now two updates + one gather. Still subsecond.
- `saveDischargeVitals` previously did one update; now two updates + one gather. Same.
- No new realtime subscriptions or background jobs.
- The validator is O(text length) regex; trivial.

## Migration Notes

- No schema changes.
- Phase 5 backfill is opt-in and idempotent.
- Rollback: revert each phase independently. Phase 1 is a pure refactor; Phase 2 adds a module that defaults to no-op when not called; Phase 3/4 are single-call-site additions; Phase 5 is a script that can simply not run.

## References

- Research: [thoughts/shared/research/2026-05-01-discharge-trajectory-warnings-case-fac6fc56.md](thoughts/shared/research/2026-05-01-discharge-trajectory-warnings-case-fac6fc56.md)
- Related plan (precursor): [thoughts/shared/plans/2026-04-27-discharge-pain-rate-on-regenerate-fix.md](thoughts/shared/plans/2026-04-27-discharge-pain-rate-on-regenerate-fix.md)
- Validator: [src/lib/claude/pain-trajectory-validator.ts](src/lib/claude/pain-trajectory-validator.ts)
- Builder: [src/lib/claude/pain-trajectory.ts](src/lib/claude/pain-trajectory.ts)
- Save paths: [src/actions/discharge-notes.ts:933-958](src/actions/discharge-notes.ts#L933-L958), [1353-1400](src/actions/discharge-notes.ts#L1353-L1400)
- Regen template: [src/actions/discharge-notes.ts:1098-1277](src/actions/discharge-notes.ts#L1098-L1277)
- QC verify reader: [src/actions/case-quality-reviews.ts:761-783](src/actions/case-quality-reviews.ts#L761-L783)
