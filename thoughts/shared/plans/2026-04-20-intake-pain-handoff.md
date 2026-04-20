# Intake Pain Handoff Across Note Types — Implementation Plan

## Overview

Propagate intake-era pain measurement (from `vital_signs` where `procedure_id IS NULL`) into downstream AI generators so procedure notes and pain-evaluation follow-up visits can anchor numeric pain trajectory to the true pre-treatment starting point. Currently procedure notes treat `priorProcedures[0]` as the series baseline, which mislabels the first-procedure note and loses the intake→procedure-1 delta. Pain-evaluation follow-up visits receive prior-visit narrative text but not numeric pain, so they cannot write "pain decreased from 8/10 at initial evaluation to 6/10 today".

Addresses research gaps 1 and 5 from [thoughts/shared/research/2026-04-20-ai-chat-isolation-per-notes-session.md](../research/2026-04-20-ai-chat-isolation-per-notes-session.md) follow-up audit.

## Current State Analysis

- Intake vitals stored in `vital_signs` with `procedure_id IS NULL`, keyed by `case_id`. Read by initial-visit gatherer at [src/actions/initial-visit-notes.ts:110-118](src/actions/initial-visit-notes.ts#L110-L118) for the current initial visit.
- Pain-evaluation follow-up pulls prior finalized initial-visit text at [src/actions/initial-visit-notes.ts:66-76](src/actions/initial-visit-notes.ts#L66-L76) and maps it to `priorVisitData` at [src/actions/initial-visit-notes.ts:169-184](src/actions/initial-visit-notes.ts#L169-L184). No `vital_signs` rows are pulled for the prior visit.
- Procedure gatherer at [src/actions/procedure-notes.ts:89-95](src/actions/procedure-notes.ts#L89-L95) reads prior procedures only — no intake-era `vital_signs` row.
- `paintoneLabel` / `paintoneSignals` both use `priorProcedureRows[0]` as the anchor at [src/actions/procedure-notes.ts:194-198](src/actions/procedure-notes.ts#L194-L198). First procedure has no prior → "baseline". Intake pain is not considered.

### Key Discoveries

- `vital_signs` has `recorded_at` ordering; the intake row is identified by the procedure_id null filter plus most-recent ordering. Pattern already used at [src/actions/initial-visit-notes.ts:116](src/actions/initial-visit-notes.ts#L116).
- Recorded intake pain could be NULL (not required at intake). All consumers must treat it as optional.
- `computePainToneLabel` at [src/lib/claude/pain-tone.ts:19-28](src/lib/claude/pain-tone.ts#L19-L28) returns `'baseline'` when either side is null — this is the current fallback when `priorProcedureRows[0]` has no vitals; same null handling applies to intake-row absence.

## Desired End State

1. Procedure note `ProcedureNoteInputData` gains a new `intakePain: { recorded_at: string, pain_score_min: number | null, pain_score_max: number | null } | null` field.
2. Procedure gatherer reads the most-recent intake `vital_signs` row (procedure_id null) and passes it forward.
3. `paintoneSignals.vsBaseline` anchor selection: prefer `priorProcedureRows[0].pain_score_max` when present; fall back to `intakePain.pain_score_max` when no prior procedure exists. For procedure #1, this makes `vsBaseline` a real intake-vs-current comparison instead of "baseline".
4. Procedure note subjective prompt explicitly references `intakePain` as the pre-treatment anchor when available: "Pre-treatment pain at intake was X/10; today pain is Y/10."
5. Pain-evaluation follow-up visits gain a `priorVisitVitalSigns` field on `InitialVisitInputData` mirroring the prior finalized initial-visit's intake pain.
6. Pain-evaluation prompt gains a branching clause in physical_exam and prognosis: "when priorVisitVitalSigns is non-null and pain has decreased since, cite the numeric delta."
7. Fallback behavior: all new fields are nullable. When null, existing "baseline" branch continues unchanged.

**Verification**: Generate procedure #1 on a test case with intake pain = 8/10 and current procedure pain = 6/10. Subjective narrative should cite the 8→6 reduction instead of using the "first injection, baseline framing" branch.

## What We're NOT Doing

- Not changing `vital_signs` schema — no new columns, no new tables.
- Not backfilling data for existing cases that lack an intake vitals row. Missing intake pain remains null.
- Not changing initial-visit-note generation for `visit_type = 'initial_visit'`. The first initial visit is itself the intake event.
- Not changing discharge note logic. Discharge already has `baselinePain` from first procedure plus `initialVisitBaseline` narrative; adding intake pain to discharge input is out of scope unless the series skips procedures entirely (uncommon and not currently supported).
- Not surfacing a UI element for intake pain comparison — the change is purely in AI input enrichment and prompt branching.

## Implementation Approach

Three phases. Phase 1 adds fields and gatherer queries (no prompt changes). Phase 2 wires prompts. Phase 3 updates tests.

---

## Phase 1: Extend Input Types and Gatherer Queries

### Changes Required

#### 1. Procedure note input type

**File**: `src/lib/claude/generate-procedure-note.ts`
**Changes**: Add `intakePain` field to `ProcedureNoteInputData`:

```ts
intakePain: {
  recorded_at: string | null
  pain_score_min: number | null
  pain_score_max: number | null
} | null
```

#### 2. Procedure gatherer

**File**: `src/actions/procedure-notes.ts`
**Changes**: Add one parallel query to the `Promise.all` block at line 45. Pattern mirrors `initial-visit-notes.ts:110-118`:

```ts
supabase
  .from('vital_signs')
  .select('recorded_at, pain_score_min, pain_score_max')
  .eq('case_id', caseId)
  .is('procedure_id', null)
  .is('deleted_at', null)
  .order('recorded_at', { ascending: false })
  .limit(1)
  .maybeSingle(),
```

Capture as `intakeVitalsRes`. Map into the return block as `intakePain` (null when no row).

#### 3. Anchor selection update

**File**: `src/actions/procedure-notes.ts`
**Changes**: Update the `paintoneVsBaseline` computation:

```ts
const seriesBaselinePain =
  priorProcedureRows.length > 0
    ? priorVitalsByProcedureId.get(priorProcedureRows[0].id)?.pain_score_max ?? null
    : (intakeVitalsRes.data?.pain_score_max ?? null)

const paintoneVsBaseline = computePainToneLabel(
  vitalsRes.data?.pain_score_max ?? null,
  seriesBaselinePain,
)
```

Intake pain is used only when there are zero prior procedures. Once procedure #1 is completed, subsequent notes continue to use procedure #1 as the series anchor (unchanged).

#### 4. Initial-visit follow-up gatherer

**File**: `src/actions/initial-visit-notes.ts`
**Changes**: Expand the `priorVisitQuery` for `visit_type = 'pain_evaluation_visit'` to also fetch the prior visit's `vital_signs` row. Since `initial_visit_notes` does not carry vitals directly, this requires a second query keyed by the prior visit's `case_id` and `procedure_id IS NULL`, filtered to `recorded_at <= prior_visit.finalized_at` (to ensure the pain reading belongs to the intake encounter, not a later one).

Query sketch:

```ts
supabase
  .from('vital_signs')
  .select('recorded_at, pain_score_min, pain_score_max')
  .eq('case_id', caseId)
  .is('procedure_id', null)
  .is('deleted_at', null)
  .lte('recorded_at', priorVisitFinalizedAt)
  .order('recorded_at', { ascending: false })
  .limit(1)
  .maybeSingle()
```

Sequential after `priorVisitRes` (needs `finalized_at`). Add conditionally when `visitType === 'pain_evaluation_visit'` AND `priorVisitRes.data?.finalized_at` is non-null.

#### 5. `InitialVisitInputData` extension

**File**: `src/lib/claude/generate-initial-visit.ts`
**Changes**: Add to `priorVisitData`:

```ts
vitalSigns: {
  recorded_at: string | null
  pain_score_min: number | null
  pain_score_max: number | null
} | null
```

### Success Criteria

#### Automated Verification
- [ ] Type check: `npx tsc --noEmit`
- [ ] Unit tests pass: `npx vitest run src/lib/claude/__tests__/ src/actions/__tests__/`

---

## Phase 2: Prompt Wiring

### Changes Required

#### 1. Procedure subjective instructions

**File**: `src/lib/claude/generate-procedure-note.ts`
**Changes**: In the subjective section rules, add an INTAKE-ANCHOR clause directly after the existing TRAJECTORY rule:

```
INTAKE ANCHOR (MANDATORY when priorProcedures is empty AND intakePain.pain_score_max is non-null):
Cite the intake pain as the pre-treatment baseline for procedure #1. Example framing:
"Pre-treatment pain at the initial evaluation was X/10; today pain is Y/10." This grounds the first procedure's subjective narrative in the real intake measurement instead of treating procedure #1 as an isolated "baseline" event. The paintoneSignals.vsBaseline label correctly reflects this intake-vs-current comparison when priorProcedures is empty — apply the "improved" / "stable" / "worsened" branching accordingly.

When intakePain.pain_score_max is null AND priorProcedures is empty, the "baseline" branch applies as today.
```

#### 2. Pain-evaluation follow-up prompt

**File**: `src/lib/claude/generate-initial-visit.ts`
**Changes**: In the pain_evaluation_visit branch of the subjective, physical_exam, and prognosis sections, add a NUMERIC-ANCHOR clause: when `priorVisitData.vitalSigns.pain_score_max` is non-null, cite the interval pain delta ("pain has decreased from X/10 at initial evaluation to Y/10 today"). Pattern matches existing text-based interval phrasing rules in that section.

### Success Criteria

#### Manual Verification
- [ ] Seed test case with intake pain 8/10, generate procedure #1 at current pain 6/10. Subjective cites "pre-treatment pain at the initial evaluation was 8/10".
- [ ] Seed test case with intake pain null, generate procedure #1. Subjective uses existing "baseline" framing, no hallucinated intake number.
- [ ] Pain-evaluation follow-up on case with prior initial visit pain 8/10 and current pain 6/10. Subjective cites the 8 → 6 reduction.

---

## Phase 3: Tests

### Changes Required

#### 1. Procedure generator tests

**File**: `src/lib/claude/__tests__/generate-procedure-note.test.ts`
**Changes**: Add `intakePain: null` to `emptyInput` fixture. Add tests:
- `intakePain` is threaded into user payload.
- `paintoneSignals.vsBaseline` derived from `intakePain` when no priors and intake pain present.
- System prompt contains `INTAKE ANCHOR` block.

#### 2. Initial-visit generator tests

**File**: `src/lib/claude/__tests__/generate-initial-visit.test.ts`
**Changes**: Extend pain-evaluation-visit fixtures with `priorVisitData.vitalSigns`. Add test that `NUMERIC-ANCHOR` clause is present in the system prompt.

#### 3. Gatherer tests

**Files**: `src/actions/__tests__/procedure-notes.test.ts` (create if missing) and `src/actions/__tests__/initial-visit-notes.test.ts`
**Changes**: 
- Procedure: gatherer returns non-null `intakePain` when intake vitals row exists; returns null when absent.
- Initial-visit: pain-evaluation gatherer returns non-null `priorVisitData.vitalSigns` when the prior visit's finalized_at exists and an intake vitals row predates it; null otherwise.

## Performance Considerations

- Procedure gatherer: +1 parallel Supabase query. Single row, indexed by `case_id`. Negligible.
- Initial-visit follow-up gatherer: +1 sequential query (needs `finalized_at` from first query). Single row. <30ms local.

## Migration Notes

- No DB migration.
- No env changes.
- Rollback: revert gatherer + type + prompt edits. Existing data unaffected.

## References

- Research: [thoughts/shared/research/2026-04-20-ai-chat-isolation-per-notes-session.md](../research/2026-04-20-ai-chat-isolation-per-notes-session.md)
- Procedure gatherer: [src/actions/procedure-notes.ts:30-266](src/actions/procedure-notes.ts#L30-L266)
- Initial-visit gatherer: [src/actions/initial-visit-notes.ts:58-240](src/actions/initial-visit-notes.ts#L58-L240)
- Pain-tone helper: [src/lib/claude/pain-tone.ts](src/lib/claude/pain-tone.ts)
