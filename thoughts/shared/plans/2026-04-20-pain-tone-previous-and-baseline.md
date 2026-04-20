# Pain-Tone: Add Per-Interval Signal Alongside Series Baseline — Implementation Plan

## Overview

Currently `paintoneLabel` (procedure note) and `overallPainTrend` (discharge note) compare pain against the FIRST procedure's `pain_score_max` — the series baseline. That captures cumulative progress but hides intra-series regression. This plan adds a second signal, `priorPainTone`, comparing current pain to the IMMEDIATELY PREVIOUS procedure, and exposes both to Claude.

## Current State Analysis

- `computePainToneLabel(current, reference)` at [src/lib/claude/pain-tone.ts:19-28](src/lib/claude/pain-tone.ts#L19-L28) returns `'baseline' | 'improved' | 'stable' | 'worsened'`. Thresholds: delta ≤ −3 → improved; delta ≥ 2 → worsened.
- Procedure note passes series-baseline (first procedure) as reference ([src/actions/procedure-notes.ts:220-225](src/actions/procedure-notes.ts#L220-L225)).
- Discharge note passes series-baseline via `baselinePain.pain_score_max` ([src/actions/discharge-notes.ts:219-222](src/actions/discharge-notes.ts#L219-L222)).
- `priorProcedureRows` is sorted ascending ([src/actions/procedure-notes.ts:89-95](src/actions/procedure-notes.ts#L89-L95)) — index 0 is baseline, index N-1 is the most recent prior. The previous-session data is already in-memory; simply not used.
- Comment at [src/actions/procedure-notes.ts:213-219](src/actions/procedure-notes.ts#L213-L219) documents the baseline-first design decision.
- `PainToneLabel` type explicitly chosen so "improved" requires ≥3-point drop — prevents forcing improved tone on 9→7 cases where exam still reads severe ([pain-tone.ts:11-17](src/lib/claude/pain-tone.ts#L11-L17)).

### Key Discoveries

- Prompt at [src/lib/claude/generate-procedure-note.ts:105-403](src/lib/claude/generate-procedure-note.ts#L105-L403) has a dedicated `paintoneLabel` branching section. Adding a second signal means expanding that branching logic in prose, not just data.
- Prior tone-direction plan ([thoughts/shared/plans/2026-04-19-tone-direction-for-procedure-and-discharge-notes.md](2026-04-19-tone-direction-for-procedure-and-discharge-notes.md)) explicitly calls out that tone hints must not override "automated pain-trend branching". This plan adds another automated input to that branching.
- Clinical interpretation: 9 → 7 → 5 → 3 is "improved overall and improved this session". 9 → 7 → 5 → 7 is "improved overall but regressed this session" — current prompt sees only "improved" (still 9→7 vs baseline) and misses the regression.

## Desired End State

1. `PainToneSignals` type: `{ vsBaseline: PainToneLabel, vsPrevious: PainToneLabel | null }` — `null` on `vsPrevious` when there is no prior procedure (current is #1).
2. `ProcedureNoteInputData.paintoneLabel` replaced by `paintoneSignals: PainToneSignals`.
3. `DischargeNoteInputData.overallPainTrend` replaced by `painTrendSignals: PainToneSignals` (with `vsPrevious` comparing last procedure to second-to-last, meaningful only when ≥2 procedures).
4. System prompts updated: branching logic describes four cases combining the two signals.
5. Existing tests updated; new tests added for (baseline=improved, previous=worsened), (baseline=stable, previous=improved), etc.
6. `computePainToneLabel` function unchanged — only callers change.

**Verification**: Case with pain trajectory 9→6→4→6 produces a procedure note that describes overall improvement AND flags current-session regression, rather than asserting monotone improvement.

## What We're NOT Doing

- Not changing thresholds in `computePainToneLabel`.
- Not adding a third signal (e.g., moving average).
- Not changing `chiroProgress` or any other automated tone signal.
- Not touching tone hint feature.
- Not changing `pain_score_min` handling — both signals use `pain_score_max` for consistency with current behavior.
- Not exposing these signals in UI — they're internal AI inputs only.
- Not modifying initial visit generation (no "prior" concept per this note type).

## Implementation Approach

Three phases: type + computation (Phase 1), prompt updates (Phase 2), tests (Phase 3). No DB migration.

---

## Phase 1: Types and Gatherer Wiring

### Changes Required

#### 1. Add type definitions

**File**: `src/lib/claude/pain-tone.ts`
**Changes**: Append:

```ts
export type PainToneSignals = {
  vsBaseline: PainToneLabel
  vsPrevious: PainToneLabel | null
}
```

#### 2. Procedure note — emit `paintoneSignals`

**File**: `src/lib/claude/generate-procedure-note.ts`
**Changes**: Replace the `paintoneLabel: PainToneLabel` field on `ProcedureNoteInputData` with `paintoneSignals: PainToneSignals`. Update all internal references.

**File**: `src/actions/procedure-notes.ts` ([line 213-225](src/actions/procedure-notes.ts#L213-L225))
**Changes**: Replace:

```ts
paintoneLabel: computePainToneLabel(
  vitalsRes.data?.pain_score_max ?? null,
  priorProcedureRows.length > 0
    ? priorVitalsByProcedureId.get(priorProcedureRows[0].id)?.pain_score_max ?? null
    : null,
),
```

With:

```ts
paintoneSignals: {
  vsBaseline: computePainToneLabel(
    vitalsRes.data?.pain_score_max ?? null,
    priorProcedureRows.length > 0
      ? priorVitalsByProcedureId.get(priorProcedureRows[0].id)?.pain_score_max ?? null
      : null,
  ),
  vsPrevious: priorProcedureRows.length > 0
    ? computePainToneLabel(
        vitalsRes.data?.pain_score_max ?? null,
        priorVitalsByProcedureId.get(priorProcedureRows[priorProcedureRows.length - 1].id)?.pain_score_max ?? null,
      )
    : null,
},
```

#### 3. Discharge note — emit `painTrendSignals`

**File**: `src/lib/claude/generate-discharge-note.ts`
**Changes**: Replace `overallPainTrend: PainToneLabel` field on `DischargeNoteInputData` with `painTrendSignals: PainToneSignals`.

**File**: `src/actions/discharge-notes.ts` ([line 219-222](src/actions/discharge-notes.ts#L219-L222))
**Changes**: Replace current `overallPainTrend` computation with:

```ts
painTrendSignals: {
  vsBaseline: computePainToneLabel(latestVitals?.pain_score_max ?? null, baselinePain?.pain_score_max ?? null),
  vsPrevious: secondToLastVitals != null
    ? computePainToneLabel(latestVitals?.pain_score_max ?? null, secondToLastVitals.pain_score_max ?? null)
    : null,
},
```

Where `secondToLastVitals` is derived from the all-procedures + all-vitals assembly. The existing gatherer already loads all vitals per procedure in chronological order — pick index `length - 2`.

### Success Criteria

#### Automated Verification
- [ ] Type check: `npx tsc --noEmit`
- [ ] Existing procedure-note and discharge-note unit tests updated to match new field name — must compile and pass.

---

## Phase 2: Prompt Updates

### Changes Required

#### 1. Procedure note prompt

**File**: `src/lib/claude/generate-procedure-note.ts`
**Changes**: Find the existing `paintoneLabel` branching block in `SYSTEM_PROMPT`. Replace with a two-signal branching block:

```
## Pain Tone Branching

You receive `paintoneSignals`:
- `vsBaseline`: current pain vs the series baseline (first procedure in this case). Reflects cumulative progress.
- `vsPrevious`: current pain vs the immediately previous procedure. Reflects per-session change. `null` when this is procedure #1.

Interpretation matrix:

| vsBaseline | vsPrevious | Narrative tone |
|---|---|---|
| improved   | improved   | Strong positive — cumulative + continuing gains. |
| improved   | stable     | Positive — durable gains, plateau at good level. |
| improved   | worsened   | Mixed — acknowledge interim regression but emphasize overall trajectory. Do NOT assert overall decline. |
| stable     | improved   | Early positive shift — cautiously optimistic. |
| stable     | stable     | Plateau language — discuss options. |
| stable     | worsened   | Concerning — flag regression from recent baseline. |
| worsened   | improved   | Complex — partial recovery from setback, overall still above baseline. |
| worsened   | stable     | Persistent elevation above baseline. |
| worsened   | worsened   | Clear decline — document, consider plan revisit. |
| any        | null       | First procedure. Use `vsBaseline='baseline'` framing — no prior comparison. |

Never assert "pain improved" when `vsPrevious = worsened` even if `vsBaseline = improved`. Always acknowledge the session-level direction.
```

#### 2. Discharge note prompt

**File**: `src/lib/claude/generate-discharge-note.ts`
**Changes**: Similar matrix block tailored to discharge voice. Discharge is retrospective, so matrix entries emphasize "overall treatment outcome" (baseline) and "stability at discharge" (previous → current).

### Success Criteria

#### Manual Verification
- [ ] Seed case with vitals 9, 6, 4, 6. Generate procedure #4. Expect: narrative flags session-level regression while acknowledging overall improvement.
- [ ] Seed case with vitals 9, 7, 5, 3. Generate procedure #4. Expect: unambiguous positive narrative.
- [ ] Seed case with vitals 9, 7. Generate procedure #2. Expect: baseline comparison framing; `vsPrevious` is also "improved" (from 9 → 7 is not ≥3 drop, actually "stable" per thresholds — confirm test data).

---

## Phase 3: Tests

### Unit Tests

**File**: `src/lib/claude/__tests__/generate-procedure-note.test.ts`
- Test: payload serializes both signals correctly.
- Test: procedure #1 emits `vsPrevious: null`.

**File**: `src/actions/__tests__/procedure-notes.test.ts` (or equivalent)
- Test: gatherer computes `vsPrevious` using `priorProcedureRows[length-1]` vitals.
- Test: zero priors → `vsPrevious: null`, `vsBaseline: 'baseline'`.
- Test: one prior → both signals point at the same pain score (baseline == previous).
- Test: three priors → `vsBaseline` uses index 0, `vsPrevious` uses index 2.

**File**: `src/actions/__tests__/discharge-notes.test.ts`
- Same pattern for `painTrendSignals`.

### Manual Testing Steps

1. Generate procedure notes on a synthetic case with vitals `9, 6, 4, 6`. Inspect the resulting `subjective` and `assessment_and_plan` sections of procedure #4. Confirm they don't flatly assert improvement.
2. Generate discharge note on same case. Confirm discharge narrative captures overall improvement without hiding the final session regression.
3. Regenerate just the `assessment_and_plan` section on procedure #4. Confirm section regen also sees both signals.

## Performance Considerations

- Zero additional DB queries — data already in-memory.
- Input tokens: ~30 extra tokens for the signals object. Output: negligible.

## Migration Notes

- No DB migration.
- Existing rows unchanged.
- Rollback: revert generator and action edits; `computePainToneLabel` signature preserved.
- Breaking change inside the Claude `inputData` shape — if any external consumer depends on `paintoneLabel` field name, update them. Grep confirms only `generate-procedure-note.ts` and `procedure-notes.ts` reference it.

## References

- Pain-tone module: [src/lib/claude/pain-tone.ts](src/lib/claude/pain-tone.ts)
- Research: [thoughts/shared/research/2026-04-20-ai-chat-isolation-per-notes-session.md](../research/2026-04-20-ai-chat-isolation-per-notes-session.md)
- Related: [thoughts/shared/plans/2026-04-19-tone-direction-for-procedure-and-discharge-notes.md](2026-04-19-tone-direction-for-procedure-and-discharge-notes.md)
