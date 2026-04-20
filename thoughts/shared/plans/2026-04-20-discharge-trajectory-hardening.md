# Discharge Trajectory Hardening — Implementation Plan

## Overview

Two defensibility gaps in discharge-note generation:
1. The `-2` default rule (discharge-visit pain = `latestVitals.pain_score_max - 2`, floored at 0) fabricates a numeric pain endpoint when `dischargeVitals` is null. Currently suppressed only on `overallPainTrend = "stable" | "worsened"`. When `vsBaseline = "improved"` but `vsPrevious = "worsened"` (mixed case introduced by 2026-04-20 pain-signal matrix), the rule still fires — producing an optimistic number after a documented final-interval regression.
2. Mid-series regression is invisible. `painTrendSignals.vsPrevious` only compares last-to-second-to-last procedure. A dip between procedure 1 and 2 followed by recovery at procedure 3 ends discharge with `vsBaseline = "improved"`, `vsPrevious = "improved"` — both green — hiding the mid-course instability that a reviewer-doctor or opposing expert would flag.

Addresses research gaps 2 and 4 from [thoughts/shared/research/2026-04-20-ai-chat-isolation-per-notes-session.md](../research/2026-04-20-ai-chat-isolation-per-notes-session.md) follow-up audit.

## Current State Analysis

- `-2` default rule documented at [src/lib/claude/generate-discharge-note.ts:165-174](src/lib/claude/generate-discharge-note.ts#L165-L174). Suppression clause at line 172 for stable/worsened.
- `painTrendSignals` computed at [src/actions/discharge-notes.ts:220-236](src/actions/discharge-notes.ts#L220-L236). `vsPrevious` anchors to `secondToLastVitals`.
- PAIN TONE MATRIX for discharge at [src/lib/claude/generate-discharge-note.ts:186-208](src/lib/claude/generate-discharge-note.ts#L186-L208). The `improved × worsened` row mandates mixed narrative but does NOT currently suppress `-2`. The closing clause explicitly preserves the `-2` rule for this case — intentional per Plan #2 but questionable: the defensibility argument (patient was worsening between injections) is stronger than the continuity argument (patient usually improves between last injection and discharge visit).

### Key Discoveries

- `procedures` array in `DischargeNoteInputData` ([src/lib/claude/generate-discharge-note.ts:29-38](src/lib/claude/generate-discharge-note.ts#L29-L38)) already carries full per-procedure pain scores. The data exists to compute mid-series volatility — only the signal is missing.
- `computePainToneLabel` thresholds at [src/lib/claude/pain-tone.ts:19-28](src/lib/claude/pain-tone.ts#L19-L28): improved at delta ≤ -3, worsened at delta ≥ 2.
- Provider can always enter `dischargeVitals` to bypass the `-2` rule ([src/actions/discharge-notes.ts:388-399](src/actions/discharge-notes.ts#L388-L399)). That's the preferred path. The fabrication risk is strictly when the provider skips entering discharge vitals.

## Desired End State

1. `-2` default rule suppressed whenever `painTrendSignals.vsPrevious = "worsened"`. Fall back to rendering `latestVitals.pain_score_max` directly (no fabricated improvement) and describe the discharge as "held at final-injection level" rather than continuing to drop.
2. New computed signal: `seriesVolatility: 'monotone_improved' | 'monotone_stable' | 'monotone_worsened' | 'mixed_with_regression' | 'insufficient_data'`. Derived from scanning the `procedures[]` pain-score series for any internal drop-and-recover pattern. `mixed_with_regression` means any intermediate procedure had pain_score_max ≥ 2 points above the previous procedure's pain_score_max.
3. New prompt clause: when `seriesVolatility = 'mixed_with_regression'`, assessment and prognosis MUST acknowledge the mid-course variability — "the treatment course included an interval fluctuation between procedures N and N+1 before subsequent stabilization" — even though final-interval and overall signals both read as improved.
4. `dischargeVitals` bypass unchanged: provider-entered discharge vitals override all defaults, as today.

**Verification**: Two test scenarios.
- Series 9 → 5 → 7 → 3 (mid-series regression, `dischargeVitals` null): subjective acknowledges the 5→7 regression, assessment cites `seriesVolatility = mixed_with_regression`, prognosis does NOT assert monotone improvement.
- Series 9 → 7 → 5 → 3 (monotone), `dischargeVitals` null, `vsPrevious = worsened` due to e.g. 3 → 5 at final: `-2` rule suppressed, discharge-visit pain rendered as 5/10 not 3/10, narrative acknowledges the final-interval rise.

## What We're NOT Doing

- Not changing `dischargeVitals` UI or prompting providers more aggressively to enter them. That's a separate UX concern.
- Not changing the `-2` magnitude (2 is domain-specific empirical choice, not a bug).
- Not adding `seriesVolatility` to procedure notes. Procedure notes see the volatility in real time via per-session signals; discharge is retrospective and needs the aggregate marker.
- Not escalating `vsPrevious = worsened` to auto-fail the generation. The note should generate; it should just describe honestly.
- Not adding a UI badge for volatility. Internal AI input only.
- Not changing case summary, initial visit, or procedure gatherers.

## Implementation Approach

Two phases. Phase 1 adds the `seriesVolatility` signal and the `-2` suppression logic. Phase 2 wires prompts and tests.

---

## Phase 1: Signal Computation + `-2` Suppression Logic

### Changes Required

#### 1. Add `seriesVolatility` type

**File**: `src/lib/claude/pain-tone.ts`
**Changes**: Append:

```ts
export type SeriesVolatility =
  | 'monotone_improved'       // strictly non-increasing pain (some deltas may be 0)
  | 'monotone_stable'         // within thresholds — no ≥3 drop, no ≥2 rise anywhere
  | 'monotone_worsened'       // strictly non-decreasing pain
  | 'mixed_with_regression'   // at least one intermediate delta ≥ +2
  | 'insufficient_data'       // fewer than 2 procedures OR any pain_score_max null

/**
 * Classifies a procedure pain-score series into a volatility label by scanning
 * all consecutive deltas. "mixed_with_regression" flags any intermediate ≥+2
 * jump — a signal that the series was not monotone even if endpoints suggest
 * improvement.
 */
export function computeSeriesVolatility(
  painSeries: Array<number | null>,
): SeriesVolatility {
  const clean = painSeries.filter((p): p is number => p != null)
  if (clean.length < 2 || clean.length !== painSeries.length) return 'insufficient_data'

  let hasRegression = false
  let allNonIncreasing = true
  let allNonDecreasing = true

  for (let i = 1; i < clean.length; i++) {
    const delta = clean[i] - clean[i - 1]
    if (delta >= 2) hasRegression = true
    if (delta > 0) allNonIncreasing = false
    if (delta < 0) allNonDecreasing = false
  }

  if (hasRegression) return 'mixed_with_regression'
  if (allNonIncreasing && !allNonDecreasing) return 'monotone_improved'
  if (allNonDecreasing && !allNonIncreasing) return 'monotone_worsened'
  return 'monotone_stable'
}
```

#### 2. Discharge input type

**File**: `src/lib/claude/generate-discharge-note.ts`
**Changes**: Add to `DischargeNoteInputData`:

```ts
seriesVolatility: SeriesVolatility
```

(Add import for `SeriesVolatility`.)

#### 3. Discharge gatherer

**File**: `src/actions/discharge-notes.ts`
**Changes**: After the `procedures` array is constructed (around [line 167-181](src/actions/discharge-notes.ts#L167-L181)), add:

```ts
const seriesVolatility = computeSeriesVolatility(
  procedures.map((p) => p.pain_score_max),
)
```

Pass `seriesVolatility` in the return object.

Import `computeSeriesVolatility` from `@/lib/claude/pain-tone`.

### Success Criteria

#### Automated Verification
- [ ] Unit test for `computeSeriesVolatility`:
  - `[]` → `insufficient_data`
  - `[5]` → `insufficient_data`
  - `[null, 5]` → `insufficient_data`
  - `[9, 7, 5, 3]` → `monotone_improved`
  - `[3, 5, 7, 9]` → `monotone_worsened`
  - `[5, 5, 5]` → `monotone_stable`
  - `[9, 5, 7, 3]` → `mixed_with_regression`
  - `[9, 7, 5, 3, 5]` → `mixed_with_regression` (the 3→5 rise trips it)
- [ ] Discharge gatherer test: `seriesVolatility` populated correctly for each pattern.

---

## Phase 2: Prompt Wiring

### Changes Required

#### 1. Suppress `-2` on `vsPrevious = worsened`

**File**: `src/lib/claude/generate-discharge-note.ts`
**Changes**: Update the PAIN TRAJECTORY block at lines 165-174. Add a new suppression clause:

```
FINAL-INTERVAL REGRESSION OVERRIDE (MANDATORY): When painTrendSignals.vsPrevious = "worsened" AND dischargeVitals is null, the -2 default rule is SUPPRESSED. Render the discharge-visit pain reading as latestVitals.pain_score_max directly (no -2 drop). Narrative framing: "pain at today's discharge evaluation is held at the final-injection level of X/10, following an interval rise from the penultimate injection." The patient did not demonstrate continued improvement between the final injection and discharge — do not fabricate one. All other PAIN TRAJECTORY rules continue to apply.
```

Update the matrix closing clause at [line 208](src/lib/claude/generate-discharge-note.ts#L208) to remove the sentence that preserves `-2` in this case (currently: "the -2 default rule still applies..."). Replace with: "The FINAL-INTERVAL REGRESSION OVERRIDE takes precedence over the -2 default rule for the improved × worsened case."

#### 2. `seriesVolatility` prompt clause

**File**: `src/lib/claude/generate-discharge-note.ts`
**Changes**: After the PAIN TONE MATRIX block (after line 208), add:

```
=== SERIES VOLATILITY (MANDATORY) ===

You are given a top-level "seriesVolatility" label summarizing the full procedure-series pain trajectory:
• "monotone_improved" — every consecutive pain_score_max is ≤ the previous. Standard favorable narrative.
• "monotone_stable" — no ≥3-point drop and no ≥2-point rise between any two consecutive procedures. Plateau narrative.
• "monotone_worsened" — every consecutive pain_score_max is ≥ the previous. Worsening narrative.
• "mixed_with_regression" — at least one intermediate procedure had a ≥+2 rise from the previous. Even if overallPainTrend and vsPrevious both read as "improved", the course was not monotone.
• "insufficient_data" — fewer than two procedures, or any pain_score_max is null. Do not cite volatility.

When seriesVolatility = "mixed_with_regression", the assessment and prognosis MUST acknowledge the mid-course variability using language such as: "The treatment course included an interval fluctuation between procedures N and M before subsequent stabilization." This applies regardless of the direction of overallPainTrend — a mixed series is not a monotone success story even when the endpoints are favorable.

When seriesVolatility = "monotone_improved", assessment and prognosis MAY use the standard monotone-improvement framing. Do NOT assert monotone improvement when the actual series was mixed.
```

### Success Criteria

#### Automated Verification
- [ ] Type check clean.
- [ ] Discharge generator tests updated:
  - System prompt contains `FINAL-INTERVAL REGRESSION OVERRIDE`.
  - System prompt contains `SERIES VOLATILITY` block with all five labels.
  - `seriesVolatility` threaded into user payload.

#### Manual Verification
- [ ] Test case: series 9 → 5 → 7 → 3, `dischargeVitals` null. Output:
  - `overallPainTrend = "improved"`, `vsPrevious = "improved"` (3 vs 7).
  - `seriesVolatility = "mixed_with_regression"`.
  - Assessment mentions the 5→7 fluctuation.
  - Prognosis does NOT assert monotone improvement.
- [ ] Test case: series 9 → 7 → 5 → 3, final-interval `vsPrevious = "worsened"` (3 vs 5 is actually improved — pick a case where last procedure is higher than second-to-last). Use series 9 → 7 → 3 → 5 instead (vsBaseline improved, vsPrevious worsened):
  - `overallPainTrend = "improved"`, `vsPrevious = "worsened"`, `seriesVolatility = "mixed_with_regression"` (also trips on the intermediate rise if any; here 3→5 is the only rise, at the end).
  - Discharge-visit pain rendered as 5/10 (no `-2` to 3/10).
  - Narrative explicitly flags the final-interval rise.

---

## Phase 3: Tests

### Changes Required

#### 1. `computeSeriesVolatility` unit tests

**File**: `src/lib/claude/__tests__/pain-tone.test.ts` (create if missing)
**Changes**: Cover the eight cases listed under Phase 1 Success Criteria.

#### 2. Discharge generator tests

**File**: `src/lib/claude/__tests__/generate-discharge-note.test.ts`
**Changes**:
- Add `seriesVolatility: 'insufficient_data'` to `emptyInput` fixture.
- Test: `seriesVolatility` threaded into payload.
- Test: system prompt contains `FINAL-INTERVAL REGRESSION OVERRIDE`.
- Test: system prompt contains `SERIES VOLATILITY` block.

#### 3. Discharge gatherer integration

Verify via dedicated gatherer tests OR by asserting against known input series that the computed label is correct.

## Performance Considerations

- `computeSeriesVolatility` is O(n) over at most 6-8 procedures per case. Trivial.
- No additional DB queries.

## Migration Notes

- No DB migration.
- No env changes.
- Rollback: revert pain-tone additions, gatherer fields, prompt edits.

## References

- Pain-tone helper: [src/lib/claude/pain-tone.ts](src/lib/claude/pain-tone.ts)
- Discharge generator: [src/lib/claude/generate-discharge-note.ts](src/lib/claude/generate-discharge-note.ts)
- Discharge gatherer: [src/actions/discharge-notes.ts](src/actions/discharge-notes.ts)
- PAIN TONE MATRIX plan: [thoughts/shared/plans/2026-04-20-pain-tone-previous-and-baseline.md](2026-04-20-pain-tone-previous-and-baseline.md)
- Research: [thoughts/shared/research/2026-04-20-ai-chat-isolation-per-notes-session.md](../research/2026-04-20-ai-chat-isolation-per-notes-session.md)
