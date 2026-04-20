# Pain-Tone Data Completeness Surfacing — Implementation Plan

## Overview

Currently `computePainToneLabel` returns `'baseline'` when either side is null ([src/lib/claude/pain-tone.ts:19-28](src/lib/claude/pain-tone.ts#L19-L28)). This serves double duty: it flags the genuine "first in series, no prior" case AND the "prior exists but pain vitals missing" case. The AI cannot tell them apart, so it defaults to baseline framing even when a prior procedure is documented but lacks vitals. The resulting note describes the visit as if it were the first in the series — inaccurate.

Addresses research gap 3 from [thoughts/shared/research/2026-04-20-ai-chat-isolation-per-notes-session.md](../research/2026-04-20-ai-chat-isolation-per-notes-session.md) follow-up audit.

## Current State Analysis

- `PainToneLabel = 'baseline' | 'improved' | 'stable' | 'worsened'` at [src/lib/claude/pain-tone.ts:1](src/lib/claude/pain-tone.ts#L1).
- Callers both compute labels via `computePainToneLabel`:
  - Procedure ([src/actions/procedure-notes.ts:194-198](src/actions/procedure-notes.ts#L194-L198)) passes `priorProcedureRows[0]?.pain_score_max`, which is `null` when the row has no vitals.
  - Discharge ([src/actions/discharge-notes.ts:220-235](src/actions/discharge-notes.ts#L220-L235)) passes `baselinePain?.pain_score_max`.
- No log, no warning, no UI badge when prior-procedure vitals are missing. The only trace is that the note reads as "baseline" despite priors existing.

### Key Discoveries

- `priorVitalsByProcedureId.get(id)` returns `undefined` when the join yields no vitals row. Silent fallthrough into `pain_score_max: null`.
- `priorProcedureRows` is not empty — procedure history is known. The gap is strictly the `vital_signs` row.
- Equivalent pattern in discharge: `vitalsByProcedureId.get(p.id)` at [src/actions/discharge-notes.ts:167-181](src/actions/discharge-notes.ts#L167-L181) assigns `null` silently.
- This is a data-quality issue, not an AI-prompt issue. Preferred fix is to distinguish the two null causes at the gatherer layer and surface the distinction to both the prompt and (optionally) a log line.

## Desired End State

1. New `PainToneLabel` variant: `'no_prior' | 'missing_vitals' | 'baseline' | 'improved' | 'stable' | 'worsened'`. The old `'baseline'` is repurposed to mean genuine first-in-series. `'no_prior'` is an alias reserved for explicit semantic clarity (optional — may collapse back to `'baseline'` if consensus is it reads cleaner).
2. `computePainToneLabel(current, reference, opts)` where `opts.referenceContext: 'no_prior' | 'prior_with_vitals' | 'prior_missing_vitals'`. Gatherer classifies and passes the context.
3. When context is `'prior_missing_vitals'`, the function returns `'missing_vitals'` regardless of current pain value. Prompt branches handle this as "do not assert comparison; flag data gap".
4. Gatherer logs at WARN level when it encounters `prior_missing_vitals`: `console.warn('[pain-tone] prior procedure missing vitals', { caseId, procedureId })`. Not user-visible but captured in Vercel logs.
5. System prompts: new branch — "when paintoneLabel = 'missing_vitals', do NOT cite a numeric delta; describe current pain and note that prior-session pain data is unavailable. Use neutral framing — symptoms remain as currently reported; numeric comparison deferred for lack of prior measurement."
6. Existing `'baseline'` / `'improved'` / `'stable'` / `'worsened'` branches unchanged for all cases where vitals are present.

**Verification**: A case with one prior procedure whose `vital_signs` row is missing generates a procedure-note subjective that does NOT use "baseline" framing (which would imply first-in-series) and does NOT fabricate a numeric comparison. Narrative flags the missing data.

## What We're NOT Doing

- Not adding a UI badge or warning to the note editor. The AI-layer change is sufficient for the defensibility concern; UI is a separate feature.
- Not backfilling missing `vital_signs` rows. Data migration is a separate operational task.
- Not failing generation on missing vitals. The note still generates; it just describes the state honestly.
- Not changing `chiroProgress` or any other tone signal.
- Not changing initial-visit generation — initial visits have no prior-comparison semantic.

## Implementation Approach

Three phases. Phase 1 extends the pain-tone helper. Phase 2 wires callers. Phase 3 prompts and tests.

---

## Phase 1: Helper Extension

### Changes Required

#### 1. Extend `PainToneLabel` and `computePainToneLabel`

**File**: `src/lib/claude/pain-tone.ts`
**Changes**:

```ts
export type PainToneLabel =
  | 'baseline'        // first in series, no prior procedure exists
  | 'missing_vitals'  // prior procedure exists but pain_score_max is null
  | 'improved'
  | 'stable'
  | 'worsened'

export type PainToneContext = 'no_prior' | 'prior_with_vitals' | 'prior_missing_vitals'

export function computePainToneLabel(
  currentPainMax: number | null,
  referencePainMax: number | null,
  context: PainToneContext = 'no_prior', // default preserves legacy behavior
): PainToneLabel {
  if (context === 'prior_missing_vitals') return 'missing_vitals'
  if (currentPainMax == null || referencePainMax == null) return 'baseline'
  const delta = currentPainMax - referencePainMax
  if (delta <= -3) return 'improved'
  if (delta >= 2) return 'worsened'
  return 'stable'
}
```

Default `context = 'no_prior'` keeps existing call sites compiling with legacy behavior (current null → baseline).

#### 2. Update `PainToneSignals` semantics — no type change

**Comment only** in pain-tone.ts: note that `vsBaseline` and `vsPrevious` may now return `'missing_vitals'` when the respective reference pain is absent from an existing prior procedure row.

### Success Criteria

#### Automated Verification
- [ ] Unit tests:
  - `computePainToneLabel(5, 8, 'prior_with_vitals')` → `'improved'` (8 → 5 is -3).
  - `computePainToneLabel(5, null, 'prior_missing_vitals')` → `'missing_vitals'`.
  - `computePainToneLabel(5, null, 'no_prior')` → `'baseline'`.
  - `computePainToneLabel(5, null)` → `'baseline'` (default context).

---

## Phase 2: Caller Wiring

### Changes Required

#### 1. Procedure gatherer

**File**: `src/actions/procedure-notes.ts`
**Changes**: Where `paintoneVsBaseline` is computed (around [line 194-198](src/actions/procedure-notes.ts#L194-L198)), classify context:

```ts
const baselineVitalsRow = priorProcedureRows.length > 0
  ? priorVitalsByProcedureId.get(priorProcedureRows[0].id)
  : undefined

const baselineContext: PainToneContext =
  priorProcedureRows.length === 0
    ? 'no_prior'
    : baselineVitalsRow?.pain_score_max == null
      ? 'prior_missing_vitals'
      : 'prior_with_vitals'

if (baselineContext === 'prior_missing_vitals') {
  console.warn('[pain-tone] prior procedure missing vitals for baseline anchor', {
    caseId,
    procedureId,
    baselineProcedureId: priorProcedureRows[0].id,
  })
}

const paintoneVsBaseline = computePainToneLabel(
  vitalsRes.data?.pain_score_max ?? null,
  baselineVitalsRow?.pain_score_max ?? null,
  baselineContext,
)
```

Same treatment for `vsPrevious`: classify `priorProcedureRows[length-1]` vitals presence and pass context.

#### 2. Discharge gatherer

**File**: `src/actions/discharge-notes.ts`
**Changes**: Same pattern for `painTrendSignals.vsBaseline` (against `baselinePain`) and `vsPrevious` (against `secondToLastVitals`). Log warning when applicable.

### Success Criteria

#### Automated Verification
- [ ] Gatherer tests: missing-vitals case surfaces as `paintoneLabel = 'missing_vitals'` with a `console.warn` side-effect (assert via spy).

---

## Phase 3: Prompt Wiring + Tests

### Changes Required

#### 1. Procedure prompt

**File**: `src/lib/claude/generate-procedure-note.ts`
**Changes**: Add a new branch to the `paintoneLabel` branching — wherever the four labels are enumerated (TONE BY paintoneLabel in objective_physical_exam, tone branching in subjective, RESPONSE-CALIBRATED FOLLOW-UP, FORBIDDEN PHRASES), extend:

```
• "missing_vitals" — a prior procedure exists on the chart but its pain_score_max is null. Do NOT cite a numeric delta. Do NOT assert "baseline"/"first injection" framing. Use neutral wording: "Pain at the prior injection visit was not recorded; today pain is rated X/10" (or omit the "compared to prior" clause entirely when pain_score_max is also null this visit). Flag the data gap plainly — "prior-session pain measurement was not recorded" — rather than describing the patient as first-in-series.
```

Apply to every section that currently branches on `paintoneLabel`:
- subjective (TRAJECTORY rule, INTERVAL-RESPONSE NARRATIVE)
- review_of_systems
- objective_physical_exam (TONE BY paintoneLabel, FORBIDDEN PHRASES list gains no new entry but note applies)
- assessment_summary
- procedure_followup (RESPONSE-CALIBRATED FOLLOW-UP)
- prognosis

#### 2. Discharge prompt

**File**: `src/lib/claude/generate-discharge-note.ts`
**Changes**: Extend PAIN TRAJECTORY and PAIN TONE MATRIX to handle `'missing_vitals'` on either signal. Discharge is less forgiving — missing baseline means the whole "numeric baseline → discharge delta" claim cannot be made. Branch:

```
BASELINE DATA-GAP OVERRIDE (MANDATORY): When painTrendSignals.vsBaseline = "missing_vitals", the series-wide numeric delta cannot be cited. Subjective, assessment, and prognosis must describe the clinical course qualitatively. Do NOT fabricate a baseline number. Use phrasing such as: "baseline pain measurement was not recorded at the first procedure; qualitative improvement is described based on [other source, e.g., chief_complaint narrative, PT outcome measures]".
```

#### 3. Test coverage

**Files**: `src/lib/claude/__tests__/pain-tone.test.ts`, `src/lib/claude/__tests__/generate-procedure-note.test.ts`, `src/lib/claude/__tests__/generate-discharge-note.test.ts`
**Changes**:
- Pain-tone: all four context × null permutations tested.
- Procedure: system prompt contains `missing_vitals` branch across every listed section. Fixture extended to test `paintoneLabel: 'missing_vitals'`.
- Discharge: system prompt contains `BASELINE DATA-GAP OVERRIDE`.

## Performance Considerations

Zero additional queries. Only extra work is the context classification and optional log line.

## Migration Notes

- No DB migration.
- No env changes.
- Breaking change: `PainToneLabel` gains a new union member. Any exhaustive switch over the type elsewhere will need a case. Grep for `PainToneLabel` to find consumers before merging.
- Rollback: revert helper, gatherer, and prompt edits. No data written is affected.

## References

- Helper: [src/lib/claude/pain-tone.ts](src/lib/claude/pain-tone.ts)
- Procedure gatherer: [src/actions/procedure-notes.ts](src/actions/procedure-notes.ts)
- Discharge gatherer: [src/actions/discharge-notes.ts](src/actions/discharge-notes.ts)
- Research: [thoughts/shared/research/2026-04-20-ai-chat-isolation-per-notes-session.md](../research/2026-04-20-ai-chat-isolation-per-notes-session.md)
