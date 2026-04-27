# Discharge Pain Rate on Section Regenerate — Fix Plan

## Overview

Thread provider-entered discharge-visit vitals into the per-section regenerate path so the discharge pain endpoint and persisted audit columns match what the full-generation path and the Pain Timeline read path already produce.

## Current State Analysis

`gatherDischargeNoteSourceData` ([src/actions/discharge-notes.ts:37-42](src/actions/discharge-notes.ts#L37-L42)) accepts an optional 4th `dischargeVitals` argument that defaults to `null`. Three call sites:

1. **`generateDischargeNote`** ([src/actions/discharge-notes.ts:608-627](src/actions/discharge-notes.ts#L608-L627)) — builds `preservedVitals` from the existing `discharge_notes` row and passes it.
2. **`regenerateDischargeNoteSectionAction`** ([src/actions/discharge-notes.ts:1037-1062](src/actions/discharge-notes.ts#L1037-L1062)) — fetches the note via `select('*')` (line 1049-1055), then calls the gatherer with **only 3 args** at line 1061. `dischargeVitals` defaults to `null`.
3. **`getDischargePainTimeline`** ([src/actions/discharge-notes.ts:1382-1400](src/actions/discharge-notes.ts#L1382-L1400)) — builds `preservedVitals` from the existing row and passes it.

When `dischargeVitals` is `null`, `buildDischargePainTrajectory` ([src/lib/claude/pain-trajectory.ts:154-200](src/lib/claude/pain-trajectory.ts#L154-L200)) skips the verbatim-provider branch and falls through to either latest-procedure verbatim (when `overallPainTrend ∈ {stable, worsened}` or `finalIntervalWorsened`) or latest-procedure-minus-2 (estimated). Wrong endpoint flows into:

- The LLM prompt (`inputData.dischargeVisitPainDisplay`, `painTrajectoryText`, `dischargeVisitPainEstimated`) used by the regenerate tool call ([src/lib/claude/generate-discharge-note.ts:521-569](src/lib/claude/generate-discharge-note.ts#L521-L569))
- Persisted audit columns at [src/actions/discharge-notes.ts:1162-1168](src/actions/discharge-notes.ts#L1162-L1168) — `discharge_pain_estimate_min`, `discharge_pain_estimate_max`, `discharge_pain_estimated`, `pain_trajectory_text`

The validator at line 1148 cannot detect the mismatch because it builds its trajectory shape from the same erroneous `inputData`.

## Desired End State

After fix, regenerating any section of a discharge note that has provider-entered `pain_score_min`/`pain_score_max` produces:

- LLM prompt grounded against the provider-entered discharge pain (not latest-procedure or latest-minus-2)
- Persisted `discharge_pain_estimate_min/max` matching `discharge_notes.pain_score_min/max`
- `discharge_pain_estimated = false`
- `pain_trajectory_text` arrow chain ending at the provider-entered value

Verification: regenerate a section on a draft note that has discharge vitals entered, then re-fetch the row — `discharge_pain_estimate_max === pain_score_max` and `discharge_pain_estimated === false`. Behavior matches `generateDischargeNote` and `getDischargePainTimeline` for the same row.

### Key Discoveries:
- Pattern for extracting `preservedVitals` is already duplicated identically at [src/actions/discharge-notes.ts:608-619](src/actions/discharge-notes.ts#L608-L619) and [src/actions/discharge-notes.ts:1382-1393](src/actions/discharge-notes.ts#L1382-L1393)
- The note row in `regenerateDischargeNoteSectionAction` is fetched with `select('*')` at line 1049-1055, so all vitals columns are already present on `note` — no extra query needed
- `DischargeNoteInputData['dischargeVitals']` shape: `{ bp_systolic, bp_diastolic, heart_rate, respiratory_rate, temperature_f, spo2_percent, pain_score_min, pain_score_max } | null`
- Existing test file `src/lib/claude/__tests__/generate-discharge-note.test.ts` covers `regenerateDischargeNoteSection` LLM call shape but does not cover the action-level wiring of `dischargeVitals` into the gatherer

## What We're NOT Doing

- Not extracting a shared `extractPreservedVitalsFromRow` helper. Three sites with ~12 duplicated lines is below the abstraction threshold and out of scope for a bug fix.
- Not changing `gatherDischargeNoteSourceData`'s signature or default value. Default-`null` is correct for callers that have no row yet (none today, but the contract stays open).
- Not adding a defensive validator check that compares `inputData.dischargeVisitPainDisplay` against the row's `pain_score_min/max`. Open question in research doc; separate scope.
- Not touching `procedure-notes.ts` or `initial-visit-notes.ts` regenerate flows — they have no `dischargeVitals` analog.
- Not modifying the trajectory builder, prompt, or persisted-column schema.

## Implementation Approach

Single-file change. Mirror the `preservedVitals` assembly already used by `generateDischargeNote` inside `regenerateDischargeNoteSectionAction`, then thread it as the 4th arg to `gatherDischargeNoteSourceData`. Add one targeted action-level test.

## Phase 1: Wire `preservedVitals` Into Section Regenerate

### Overview
Build `preservedVitals` from the already-fetched `note` row, pass to the gatherer, and verify with a test.

### Changes Required:

#### 1. `regenerateDischargeNoteSectionAction` — assemble + pass `preservedVitals`
**File**: `src/actions/discharge-notes.ts`
**Changes**: After the existing `note` fetch (line 1049-1057), before the gatherer call (line 1061), assemble `preservedVitals` from `note` columns and pass as the 4th argument. Mirror the shape used at lines 608-619.

```typescript
// After existing note fetch + visitDate derivation (lines 1057-1060):
const preservedVitals: DischargeNoteInputData['dischargeVitals'] = {
  bp_systolic: note.bp_systolic,
  bp_diastolic: note.bp_diastolic,
  heart_rate: note.heart_rate,
  respiratory_rate: note.respiratory_rate,
  temperature_f: note.temperature_f,
  spo2_percent: note.spo2_percent,
  pain_score_min: note.pain_score_min,
  pain_score_max: note.pain_score_max,
}

const { data: inputData, error: gatherError } = await gatherDischargeNoteSourceData(
  supabase,
  caseId,
  visitDate,
  preservedVitals,
)
```

Notes:
- `note` is fetched via `select('*')` so all eight columns are guaranteed present.
- The row always exists at this point (the `if (fetchError || !note) return ...` guard at line 1057 short-circuits otherwise), so `preservedVitals` is unconditionally constructed — matching the conditional-then-unconditional pattern already used at lines 608-619 (where `existingNote` may be null).
- Type alias `DischargeNoteInputData` already imported at line 10. No new imports needed.

#### 2. Action-level regression test
**File**: `src/actions/__tests__/discharge-notes-regenerate.test.ts` (new)
**Changes**: New unit test that verifies the wiring without touching Supabase or Claude. Uses `vi.mock` against `@/lib/supabase/server`, `@/lib/claude/generate-discharge-note`, and the trajectory module so the assertion reduces to "did `gatherDischargeNoteSourceData` produce a non-null `dischargeVitals` on `inputData` when the row has `pain_score_max`".

The lightest defensible test stub asserts the persisted `discharge_pain_estimated` column gets set to `false` (the verbatim-provider branch) when the fetched row has a provider-entered `pain_score_max`. Mock the supabase client to return a stub row, mock the AI call to return canned section text, then capture the `update` payload sent to `discharge_notes` and assert:

- `discharge_pain_estimated === false`
- `discharge_pain_estimate_max === <provider value>`

```typescript
// Skeleton — full implementation follows existing test patterns in
// src/lib/claude/__tests__/generate-discharge-note.test.ts for vi.mock
// shape and the captured-call assertion style.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/claude/generate-discharge-note', async () => {
  const actual = await vi.importActual<object>('@/lib/claude/generate-discharge-note')
  return {
    ...actual,
    regenerateDischargeNoteSection: vi.fn(async () => ({ data: 'regen text', rawResponse: {} })),
  }
})

describe('regenerateDischargeNoteSectionAction — discharge vitals wiring', () => {
  beforeEach(() => vi.clearAllMocks())

  it('persists provider-entered discharge pain (not -2 estimate) on regenerate', async () => {
    // Stub supabase client: note row with pain_score_max=2 + at least one
    // procedure with pain_score_max=6 so the -2 fallback would yield 4 if
    // dischargeVitals were dropped.
    // Capture the .update() payload to assert
    //   discharge_pain_estimate_max === 2
    //   discharge_pain_estimated === false
    // ...
  })
})
```

### Success Criteria:

#### Automated Verification:
- [x] Type check passes: `npx tsc --noEmit`
- [x] Lint passes: `npm run lint`
- [x] Unit + integration tests pass: `npm run test`
- [x] New regression test passes: `npm run test -- discharge-notes-regenerate`
- [x] Existing discharge-note tests still pass: `npm run test -- generate-discharge-note`

#### Manual Verification:
- [ ] On a draft discharge note, enter Discharge Vitals with a pain score (e.g. 1/10)
- [ ] Click regenerate on any section that mentions discharge pain (Subjective, Assessment, Prognosis)
- [ ] Inspect the persisted row in Supabase: `discharge_pain_estimate_max` equals the entered value, `discharge_pain_estimated = false`, `pain_trajectory_text` ends with the entered value
- [ ] Inspect the regenerated section prose: cites the entered discharge value, not "latest minus 2"
- [ ] Pain Timeline widget on the editor still shows the same entered value (no regression in the read path)
- [ ] Regenerate a section on a draft that has NO discharge vitals entered → behavior unchanged: -2 estimate or stable/worsened verbatim depending on `overallPainTrend`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation that the manual testing was successful before considering the fix complete.

---

## Testing Strategy

### Unit Tests:
- New action-level test in `src/actions/__tests__/discharge-notes-regenerate.test.ts` covers the wiring fix. Stubs Supabase to return a row with `pain_score_max` set, asserts the persisted `discharge_pain_estimated === false` and `discharge_pain_estimate_max` matches the row.
- Existing tests in `src/lib/claude/__tests__/generate-discharge-note.test.ts` continue to cover the LLM-call shape (`regenerateDischargeNoteSection` with various `dischargeVitals` states on `inputData`).

### Integration Tests:
- Manual flow above doubles as the integration check. No automated end-to-end harness exists in the repo for the discharge-note pipeline.

### Manual Testing Steps:
1. Open a case with at least one finalized procedure that has procedure-day vitals (`vital_signs.pain_score_max` non-null).
2. Navigate to the Discharge tab.
3. Generate the discharge note (full generation) without entering discharge vitals first. Confirm `discharge_pain_estimated = true` on the row and prose cites latest-minus-2.
4. Enter discharge vitals (Discharge Vitals card → pain score).
5. Click regenerate on the Subjective section.
6. Re-fetch the row and confirm `discharge_pain_estimated = false`, `discharge_pain_estimate_max` equals the entered value, and the regenerated Subjective section cites the entered value.
7. Repeat step 5-6 for Assessment and Prognosis sections.
8. Verify the Pain Timeline widget continues to render the same entered value (read path was already correct; this confirms no regression).

## Performance Considerations

None. No additional queries — `note` is already fetched via `select('*')`. No additional rows touched.

## Migration Notes

None. No schema or data migration. Existing rows that were generated through the broken regenerate path will continue to display whatever was last persisted until the user regenerates again post-fix; a subsequent regeneration writes the correct values.

## References

- Research doc: `thoughts/shared/research/2026-04-27-discharge-pain-rate-on-regenerate.md`
- Phase-1 trajectory builder design: `thoughts/shared/research/2026-04-21-discharge-pain-timeline-precision.md`
- Trajectory builder implementation plan: `thoughts/shared/plans/2026-04-21-discharge-pain-timeline-phase1.md`
- Bug location: `src/actions/discharge-notes.ts:1061`
- Reference correct call: `src/actions/discharge-notes.ts:608-627`
- Reference read-path correct call: `src/actions/discharge-notes.ts:1382-1400`
- Trajectory endpoint priority: `src/lib/claude/pain-trajectory.ts:154-200`
