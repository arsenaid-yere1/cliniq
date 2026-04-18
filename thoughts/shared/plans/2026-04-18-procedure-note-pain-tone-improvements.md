# PRP Procedure Note — Data-Driven Pain Tone Implementation Plan

**Status: FIXED** — All 5 phases implemented and verified (automated + manual) on 2026-04-18.


## Overview

Shift the PRP Procedure Note generator from a single persistence-leaning narrative voice to a data-driven tone that reflects the patient's actual pain trajectory across the full series of procedures. The prompt currently hard-codes "persistent symptoms, functional limitations, current pain" for every repeat procedure ([generate-procedure-note.ts:123](src/lib/claude/generate-procedure-note.ts#L123)). This plan adds the data, the derived tone label, and the prompt branches needed for Claude to describe pain as improved, stable, or worsened when the data supports it.

## Current State Analysis

- The procedure note uses a single `SYSTEM_PROMPT` constant ([generate-procedure-note.ts:102-203](src/lib/claude/generate-procedure-note.ts#L102-L203)) with no visit-count or delta branching.
- `ProcedureNoteInputData.priorProcedure` is **one** row — the most recent prior procedure ([procedure-notes.ts:85-94](src/actions/procedure-notes.ts#L85-L94) fetches with `limit(1)`). A 3rd injection cannot describe the trajectory from injection #1 → #2 → #3.
- The `subjective` instruction hard-codes `"persistent symptoms, functional limitations, current pain"` and the comparison phrase is templated as `"compared to [prior_pain_score_max]/10 at [his/her] last visit"` ([generate-procedure-note.ts:123](src/lib/claude/generate-procedure-note.ts#L123)).
- `review_of_systems`, `assessment_summary`, and `prognosis` reference examples all lean persistence-heavy (e.g., "chronic nature, prognosis is guarded"; "Ongoing low back pain … exacerbation"; "necessitating further pain management intervention") ([generate-procedure-note.ts:144-196](src/lib/claude/generate-procedure-note.ts#L144-L196)).
- A structured progress enum `['improving', 'stable', 'plateauing', 'worsening']` exists on `chiro_extractions.functional_outcomes.progress_status` ([extract-chiro.ts:116-119](src/lib/claude/extract-chiro.ts#L116-L119), validated at [chiro-extraction.ts:61-63](src/lib/validations/chiro-extraction.ts#L61-L63)) but is not passed to the procedure-note generator.
- `priorProcedure` is referenced only by three files: [generate-procedure-note.ts](src/lib/claude/generate-procedure-note.ts), [procedure-notes.ts](src/actions/procedure-notes.ts), and [generate-procedure-note.test.ts:43](src/lib/claude/__tests__/generate-procedure-note.test.ts#L43). No PDF template, editor, or downstream consumer depends on it — safe to replace with a new shape.

## Desired End State

Generating a procedure note for the **N-th** injection:

1. Receives the full `priorProcedures[]` array (chronological, oldest → newest) with each prior procedure's `pain_score_min/max`, `procedure_date`, and `procedure_number`.
2. Receives a pre-computed `paintoneLabel: 'baseline' | 'improved' | 'stable' | 'worsened'` derived from current vs. most-recent-prior `pain_score_max` using ±2-point thresholds.
3. Receives an optional `chiroProgress: 'improving' | 'stable' | 'plateauing' | 'worsening' | null` sourced from the most recent approved chiro extraction on the case.
4. The `subjective` prompt branches narrative framing based on `paintoneLabel`, with parallel reference examples per branch. When 2+ prior procedures exist, the narrative describes the trajectory across the series rather than a single prior comparison.
5. The `review_of_systems`, `assessment_summary`, and `prognosis` sections retain their persistence-leaning reference examples and add improvement-leaning alternates selected by `paintoneLabel`.
6. All existing unit tests pass; new tests cover the tone-label computation, the 4 threshold branches, and the shape of the new `priorProcedures[]` field.

### Verification

- A 2nd procedure with pain 7→3 produces subjective text that uses "improvement"/"reduced pain"/"residual intermittent" language.
- A 2nd procedure with pain 7→8 produces subjective text that uses "persistent"/"ongoing" language.
- A 2nd procedure with pain 7→6 (delta 1) produces subjective text that uses "stable"/"modest change" language.
- A 3rd procedure with pain 8→5→3 produces a narrative that describes the full downward trajectory.
- A 1st procedure with no prior still opens with baseline framing (no comparison sentence) — unchanged from today.

### Key Discoveries:

- Prompt-only fix won't suffice: the model currently does not have the full pain series. The data layer must change first. ([procedure-notes.ts:85-94](src/actions/procedure-notes.ts#L85-L94))
- Computing `paintoneLabel` in TypeScript rather than in the prompt keeps the threshold logic unit-testable and removes arithmetic from the model. The discharge note takes a similar "give the model structured input" approach with its per-procedure `pain_score_max` array ([generate-discharge-note.ts:29-38](src/lib/claude/generate-discharge-note.ts#L29-L38)).
- The chiro progress enum maps cleanly to 4 states already matching what we want for tone. ([chiro-extraction.ts:61-63](src/lib/validations/chiro-extraction.ts#L61-L63))
- `priorProcedure` has no external consumers, so a breaking shape change inside `ProcedureNoteInputData` is low-risk. ([Grep confirmed only 3 files reference it.](src/lib/claude/generate-procedure-note.ts))

## What We're NOT Doing

- No changes to the Discharge Note generator ([generate-discharge-note.ts](src/lib/claude/generate-discharge-note.ts)) — its tone is already correct for its purpose.
- No changes to the Initial Visit / Pain Evaluation Visit generator ([generate-initial-visit.ts](src/lib/claude/generate-initial-visit.ts)).
- No changes to the chiro extraction pipeline, schema, or storage.
- No UI changes (editor, PDF template, list views).
- No database migrations — all new data is derived from existing rows.
- No change to the procedure_notes table schema or existing columns.
- No change to the case's "procedure series" concept or `procedure_number` semantics.

## Implementation Approach

The root cause of the persistence-leaning output is prompt text, but the prompt cannot produce accurate trajectory language without the underlying data. So we change data first (Phase 1), compute a derived tone signal (Phase 2), rewrite the one section where tone is decided (Phase 3), and soften reference examples in the three other persistence-leaning sections (Phase 4). Testing is consolidated in Phase 5.

The split between TypeScript-computed `paintoneLabel` and the full `priorProcedures[]` array is deliberate: the label gives the model an unambiguous branch, and the raw array lets the model produce specific narrative (e.g., "pain has progressively decreased from 8/10 → 5/10 → 3/10"). This matches the discharge-note pattern of passing both structured trendline values and narrative instructions ([generate-discharge-note.ts:136](src/lib/claude/generate-discharge-note.ts#L136)).

---

## Phase 1: Expand Input Data with Full Trajectory and Chiro Progress

### Overview
Replace the single-row `priorProcedure` with a chronological array. Batch-fetch vitals for all prior procedures. Add `chiroProgress` from the most recent approved chiro extraction on the case.

### Changes Required:

#### 1. Input data type
**File**: `src/lib/claude/generate-procedure-note.ts`
**Changes**: Replace the `priorProcedure` field on `ProcedureNoteInputData` (currently lines 62-67) with `priorProcedures` (array), and add `paintoneLabel` + `chiroProgress` fields.

```ts
// lines 62-67 — REPLACE with:
priorProcedures: Array<{
  procedure_date: string
  pain_score_min: number | null
  pain_score_max: number | null
  procedure_number: number
}>
paintoneLabel: 'baseline' | 'improved' | 'stable' | 'worsened'
chiroProgress: 'improving' | 'stable' | 'plateauing' | 'worsening' | null
```

#### 2. Data gathering
**File**: `src/actions/procedure-notes.ts`
**Changes**: Rewrite the prior-procedure query to fetch all rows. Batch vitals. Fetch the most recent approved chiro extraction's `functional_outcomes.progress_status`. Build the new fields.

Replace lines 85-94 (prior-procedure query) with:

```ts
supabase
  .from('procedures')
  .select('id, procedure_date, procedure_number')
  .eq('case_id', caseId)
  .neq('id', procedureId)
  .is('deleted_at', null)
  .order('procedure_date', { ascending: true }),
```

Add a new parallel query inside the same `Promise.all` for chiro extraction (alongside `pmRes` on lines 62-70):

```ts
supabase
  .from('chiro_extractions')
  .select('functional_outcomes')
  .eq('case_id', caseId)
  .eq('review_status', 'approved')
  .is('deleted_at', null)
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle(),
```

Replace the prior-procedure vitals block (lines 109-123) with a batch fetch:

```ts
const priorProcedureIds = (priorProcedureRes.data ?? []).map((p) => p.id)
let priorVitalsByProcedureId = new Map<string, {
  pain_score_min: number | null
  pain_score_max: number | null
}>()
if (priorProcedureIds.length > 0) {
  const { data: priorVitalsRows } = await supabase
    .from('vital_signs')
    .select('procedure_id, pain_score_min, pain_score_max')
    .in('procedure_id', priorProcedureIds)
    .is('deleted_at', null)
  for (const row of priorVitalsRows ?? []) {
    if (row.procedure_id) {
      priorVitalsByProcedureId.set(row.procedure_id, {
        pain_score_min: row.pain_score_min,
        pain_score_max: row.pain_score_max,
      })
    }
  }
}
```

Replace the `priorProcedure` builder (lines 190-197) with:

```ts
priorProcedures: (priorProcedureRes.data ?? []).map((p) => ({
  procedure_date: p.procedure_date,
  procedure_number: p.procedure_number ?? 1,
  pain_score_min: priorVitalsByProcedureId.get(p.id)?.pain_score_min ?? null,
  pain_score_max: priorVitalsByProcedureId.get(p.id)?.pain_score_max ?? null,
})),
paintoneLabel: computePainToneLabel(
  vitalsRes.data?.pain_score_max ?? null,
  // most recent prior is the last element since array is ascending
  priorProcedureRes.data && priorProcedureRes.data.length > 0
    ? priorVitalsByProcedureId.get(
        priorProcedureRes.data[priorProcedureRes.data.length - 1].id,
      )?.pain_score_max ?? null
    : null,
),
chiroProgress: deriveChiroProgress(chiroRes.data?.functional_outcomes),
```

#### 3. Helper functions
**File**: `src/lib/claude/pain-tone.ts` (new file)
**Changes**: Create pure helpers for the threshold logic and chiro progress extraction so they are unit-testable in isolation.

```ts
export type PainToneLabel = 'baseline' | 'improved' | 'stable' | 'worsened'

/**
 * Branch the procedure-note narrative tone based on the current vs. most-recent-prior
 * pain_score_max. Returns 'baseline' when there is no prior to compare against.
 * Thresholds: improved if current <= prior - 2, worsened if current >= prior + 2,
 * otherwise stable. Nulls on either side produce 'baseline'.
 */
export function computePainToneLabel(
  currentPainMax: number | null,
  priorPainMax: number | null,
): PainToneLabel {
  if (currentPainMax == null || priorPainMax == null) return 'baseline'
  const delta = currentPainMax - priorPainMax
  if (delta <= -2) return 'improved'
  if (delta >= 2) return 'worsened'
  return 'stable'
}

export type ChiroProgress = 'improving' | 'stable' | 'plateauing' | 'worsening' | null

/**
 * Extract the progress_status signal from a chiro_extractions.functional_outcomes JSON blob.
 * Returns null when the value is absent or not one of the known enum members.
 */
export function deriveChiroProgress(functionalOutcomes: unknown): ChiroProgress {
  if (!functionalOutcomes || typeof functionalOutcomes !== 'object') return null
  const status = (functionalOutcomes as { progress_status?: unknown }).progress_status
  if (status === 'improving' || status === 'stable' || status === 'plateauing' || status === 'worsening') {
    return status
  }
  return null
}
```

#### 4. Test fixture
**File**: `src/lib/claude/__tests__/generate-procedure-note.test.ts`
**Changes**: Update `emptyInput` (line 43) to use the new shape.

```ts
// line 43 — REPLACE `priorProcedure: null,` with:
priorProcedures: [],
paintoneLabel: 'baseline' as const,
chiroProgress: null,
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit`
- [x] Linting passes: `npm run lint` (1 pre-existing error in `patients.test.ts` unrelated to this change; no new issues introduced)
- [x] Existing procedure-note tests pass: `npx vitest run src/lib/claude/__tests__/generate-procedure-note.test.ts`
- [x] No stray references to the old `priorProcedure` key remain (only local variable names and the prompt text slated for Phase 3 remain)
- [x] All server-action tests pass: `npx vitest run src/actions` (99/99)

#### Manual Verification:
- [x] Generate a procedure note for a case with 0 prior procedures → request payload shows `priorProcedures: []`, `paintoneLabel: 'baseline'`
- [x] Generate a procedure note for a case with 1 prior procedure → request payload shows one entry in `priorProcedures[]`, label reflects the delta
- [x] Generate a procedure note for a case with 2+ prior procedures → all prior entries appear in chronological order
- [x] If the case has an approved chiro extraction with `functional_outcomes.progress_status`, `chiroProgress` is populated; otherwise null

**Implementation Note**: After Phase 1 passes both automated and manual verification, pause for user confirmation before starting Phase 2. Phase 1 is data-only — note output may not change visibly yet.

---

## Phase 2: Unit Tests for Tone Derivation

### Overview
Lock down the threshold logic and chiro-progress extraction with unit tests before the prompt starts depending on them.

### Changes Required:

#### 1. Tests for helpers
**File**: `src/lib/claude/__tests__/pain-tone.test.ts` (new file)
**Changes**: Cover the 4 label branches, null-handling, and the chiro progress parser.

```ts
import { describe, it, expect } from 'vitest'
import { computePainToneLabel, deriveChiroProgress } from '@/lib/claude/pain-tone'

describe('computePainToneLabel', () => {
  it('returns baseline when current is null', () => {
    expect(computePainToneLabel(null, 7)).toBe('baseline')
  })
  it('returns baseline when prior is null', () => {
    expect(computePainToneLabel(5, null)).toBe('baseline')
  })
  it('returns baseline when both null', () => {
    expect(computePainToneLabel(null, null)).toBe('baseline')
  })
  it('returns improved when current is 2+ less than prior', () => {
    expect(computePainToneLabel(5, 7)).toBe('improved')
    expect(computePainToneLabel(2, 8)).toBe('improved')
  })
  it('returns stable when delta is within ±1', () => {
    expect(computePainToneLabel(7, 7)).toBe('stable')
    expect(computePainToneLabel(6, 7)).toBe('stable')
    expect(computePainToneLabel(8, 7)).toBe('stable')
  })
  it('returns worsened when current is 2+ more than prior', () => {
    expect(computePainToneLabel(9, 7)).toBe('worsened')
    expect(computePainToneLabel(8, 6)).toBe('worsened')
  })
})

describe('deriveChiroProgress', () => {
  it('returns null for null/undefined/non-object input', () => {
    expect(deriveChiroProgress(null)).toBeNull()
    expect(deriveChiroProgress(undefined)).toBeNull()
    expect(deriveChiroProgress('improving')).toBeNull()
  })
  it('returns null when progress_status is missing', () => {
    expect(deriveChiroProgress({})).toBeNull()
    expect(deriveChiroProgress({ other: 'value' })).toBeNull()
  })
  it('returns null when progress_status is not a known enum', () => {
    expect(deriveChiroProgress({ progress_status: 'mystery' })).toBeNull()
    expect(deriveChiroProgress({ progress_status: null })).toBeNull()
  })
  it('passes through all four known enum values', () => {
    expect(deriveChiroProgress({ progress_status: 'improving' })).toBe('improving')
    expect(deriveChiroProgress({ progress_status: 'stable' })).toBe('stable')
    expect(deriveChiroProgress({ progress_status: 'plateauing' })).toBe('plateauing')
    expect(deriveChiroProgress({ progress_status: 'worsening' })).toBe('worsening')
  })
})
```

### Success Criteria:

#### Automated Verification:
- [x] New test file runs and passes: `npx vitest run src/lib/claude/__tests__/pain-tone.test.ts` (10/10)
- [x] Full vitest suite still passes (verified at Phase 5)

#### Manual Verification:
- [x] None — pure unit tests.

---

## Phase 3: Rewrite the `subjective` Prompt for Data-Driven Tone

### Overview
Replace the single persistence-leaning directive in section 1 of `SYSTEM_PROMPT` with a 4-branch instruction keyed off `paintoneLabel`, plus guidance to describe the trajectory when 2+ prior procedures exist. Add parallel reference examples per branch.

### Changes Required:

#### 1. Subjective section instructions
**File**: `src/lib/claude/generate-procedure-note.ts`
**Changes**: Replace lines 122-124 (the `1. subjective (~1 paragraph):` block) with a branched directive. Do not change any other section in this phase.

```
1. subjective (~1 paragraph):
Open with a one-sentence patient identification: "[Patient Name] is a [age]-year-old [gender] who returns for [his/her] scheduled PRP injection to the [site]." Use the top-level "age" field verbatim (the patient's age on procedureRecord.procedure_date); do NOT recompute from date_of_birth.

NARRATIVE TONE — choose framing based on the top-level "paintoneLabel" field:
• "baseline" (first injection or no prior pain recorded) — describe current symptoms, functional limitations, and current pain. Do NOT compare to any prior visit.
• "improved" — the patient's pain has meaningfully decreased (≥2 points on the 0-10 scale) since the most recent injection. Describe this as improvement or reduced pain; remaining symptoms should be characterized as residual, intermittent, or mild where supported by the data. Reference the prior visit's pain_score_max explicitly.
• "stable" — the patient's pain has not meaningfully changed (within ±1 point). Describe symptoms as largely unchanged, persistent at a similar level, or modestly altered. Reference the prior visit's pain_score_max explicitly.
• "worsened" — the patient's pain has meaningfully increased (≥2 points). Describe symptoms as persistent or worsening. Reference the prior visit's pain_score_max explicitly.

PAIN RATING: Pain is captured as a MIN/MAX range on vitalSigns.pain_score_min / pain_score_max. Render as a range when both are present and differ (e.g. "rated 3-6/10"); render as a single value when they match or only one is present (e.g. "rated 5/10"); omit the pain sentence entirely if both are null.

TRAJECTORY (when priorProcedures has 2 or more entries): In addition to the most-recent comparison, briefly describe the progression across the series using each prior procedure's pain_score_max in chronological order (e.g., "pain has progressively decreased from 8/10 → 5/10 → 3/10 across the injection series"). Keep this to one short clause — do not list every procedure date.

SECONDARY SIGNAL (optional): If the top-level "chiroProgress" field is non-null, you may reference chiropractic functional progress in the narrative (e.g., "with concurrent improvement in mobility during chiropractic care") when it aligns with paintoneLabel. Do NOT cite chiroProgress when it conflicts with the pain data — the pain data takes precedence.

Reference (paintoneLabel="baseline", first injection): "Mr. Vardanyan is a 45-year-old male who returns today for his scheduled PRP injection to the lumbosacral region. He reports ongoing low back pain with functional limitations affecting daily activities. Pain is rated 6-7/10."
Reference (paintoneLabel="improved", one prior): "Mr. Vardanyan is a 45-year-old male who returns for his scheduled follow-up PRP injection to the lumbosacral region. He reports mild improvement in his low back pain and function following the initial injection. Residual pain is intermittent and rated 3-4/10, compared to 6/10 at his last visit."
Reference (paintoneLabel="stable", one prior): "Mr. Vardanyan is a 45-year-old male who returns for his scheduled follow-up PRP injection to the lumbosacral region. Symptoms remain largely unchanged since the prior injection, with modest day-to-day variability. Pain is rated 5-6/10, compared to 6/10 at his last visit."
Reference (paintoneLabel="worsened", one prior): "Mr. Vardanyan is a 45-year-old male who returns for his scheduled follow-up PRP injection to the lumbosacral region. He reports persistent low back pain with ongoing functional limitations despite the initial injection. Pain is rated 7-8/10, compared to 6/10 at his last visit."
Reference (paintoneLabel="improved", 2+ prior — trajectory narrative): "Ms. Taylor is a 34-year-old female who returns for her scheduled PRP injection to the cervical spine. She reports sustained improvement in neck pain across the injection series; pain has progressively decreased from 8/10 → 5/10 → 3/10. Current pain is rated 2-3/10, compared to 5/10 at her last visit."
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit`
- [x] Existing procedure-note tests pass: `npx vitest run src/lib/claude/__tests__/generate-procedure-note.test.ts`
- [x] No new linting errors introduced (pre-existing `patients.test.ts` error unchanged)

#### Manual Verification:
- [x] Generate a note for a case with `paintoneLabel="improved"` → the `subjective` output uses "improvement" or "reduced" or "residual/intermittent" wording (and no "persistent" / "continues to report")
- [x] Generate a note for a case with `paintoneLabel="worsened"` → the `subjective` output uses "persistent" or "worsening" wording
- [x] Generate a note for a case with `paintoneLabel="stable"` → the `subjective` output uses "unchanged", "stable", or "modestly altered" wording (not "improvement", not "worsening")
- [x] Generate a note for a 1st injection (`paintoneLabel="baseline"`) → output has no prior-visit comparison sentence (unchanged behavior)
- [x] Generate a note for a 3rd injection with a clear downward trajectory → output includes a one-clause trajectory description ("progressively decreased …")

**Implementation Note**: Pause here for user confirmation. This is the highest-visibility change — review 3-5 real cases before moving on.

---

## Phase 4: Parallel Reference Examples in Other Sections

### Overview
In `review_of_systems`, `assessment_summary`, and `prognosis`, keep the existing persistence-leaning reference text and add improvement-leaning alternates that the model selects from based on `paintoneLabel`. Do not touch sections that are genuinely procedure-procedural (preparation, PRP prep, anesthesia, injection, post-care) — their tone is not about the patient's trajectory.

### Changes Required:

#### 1. review_of_systems reference examples
**File**: `src/lib/claude/generate-procedure-note.ts`
**Changes**: Replace lines 142-144 (the `6. review_of_systems` block) with dual examples.

```
6. review_of_systems (~3 bullets):
3 bullets only — Musculoskeletal, Neurological, General. Tailor the wording to the top-level "paintoneLabel": use "ongoing" / "continued" phrasing when paintoneLabel is "worsened" or "stable"; use "improving" / "reduced" / "residual" phrasing when paintoneLabel is "improved". When paintoneLabel is "baseline", match the persistence-leaning example.
Reference (persistence-leaning — for baseline/stable/worsened): "• Musculoskeletal: Ongoing low back pain with bilateral sciatica exacerbation.\\n• Neurological: No dizziness, vertigo, or recent episodes of loss of consciousness. Continued headaches on and off.\\n• General: Reports sleep disturbance due to low back pain. No fever, chills, or weight loss."
Reference (improvement-leaning — for improved): "• Musculoskeletal: Residual low back pain with reduced sciatic symptoms since the prior injection.\\n• Neurological: No dizziness, vertigo, or recent episodes of loss of consciousness. Headaches have lessened in frequency.\\n• General: Improved sleep with less interruption from pain. No fever, chills, or weight loss."
```

#### 2. assessment_summary reference examples
**File**: `src/lib/claude/generate-procedure-note.ts`
**Changes**: Replace lines 154-156 (the `9. assessment_summary` block) with dual examples.

```
9. assessment_summary (~2-3 sentences):
Summary linking exam findings to MRI/imaging. Tailor the closing clause to "paintoneLabel": cite "ongoing functional impairments, necessitating further pain management intervention" style when paintoneLabel is "baseline", "stable", or "worsened"; cite "favorable interim response supporting continuation of the injection series" style when paintoneLabel is "improved".
Reference (persistence-leaning — for baseline/stable/worsened): "Findings indicate cervical, thoracic and lumbar spine dysfunction with restricted mobility, tenderness, muscle spasms, and radicular symptoms consistent with lumbar disc pathology. The patient's symptoms correlate with MRI findings and ongoing functional impairments, necessitating further pain management intervention."
Reference (improvement-leaning — for improved): "Findings indicate cervical, thoracic, and lumbar spine dysfunction correlating with MRI findings, with interval reduction in radicular symptoms and improved mobility since the prior injection. The favorable interim response supports continuation of the planned PRP injection series."
```

#### 3. prognosis reference examples
**File**: `src/lib/claude/generate-procedure-note.ts`
**Changes**: Replace line 196 (the `19. prognosis` block) with dual examples.

```
19. prognosis (~2 sentences):
Match the "paintoneLabel". Use the guarded reference when paintoneLabel is "baseline", "stable", or "worsened"; use the guarded-to-favorable reference when paintoneLabel is "improved".
Reference (guarded — for baseline/stable/worsened): "Due to the chronic nature of the injury, the prognosis is guarded. Full recovery depends on the patient's response to PRP therapy and adherence to the prescribed rehabilitation program."
Reference (guarded-to-favorable — for improved): "Given the interim response to PRP therapy, the prognosis is guarded-to-favorable. Continued recovery depends on completion of the injection series and adherence to the prescribed rehabilitation program."
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit`
- [x] Existing procedure-note tests pass: `npx vitest run src/lib/claude/__tests__/generate-procedure-note.test.ts`
- [x] No new linting errors introduced

#### Manual Verification:
- [x] For `paintoneLabel="improved"` cases, `review_of_systems` uses "residual"/"reduced"/"lessened" wording and `prognosis` uses "guarded-to-favorable" wording
- [x] For `paintoneLabel="baseline"` cases, these three sections produce output matching today's behavior
- [x] For `paintoneLabel="stable"` or `"worsened"`, tone remains persistence-leaning (original references)
- [x] No regressions in untouched sections (preparation, PRP prep, anesthesia, injection, post-care, etc.) — spot-check 2 finalized notes

---

## Phase 5: Regression Testing and Wrap-Up

### Overview
Run the full suite end-to-end. Confirm no downstream consumer broke on the shape change from `priorProcedure` → `priorProcedures`.

### Changes Required:

#### 1. Grep for remaining references
**File**: (no code change)
**Changes**: Run these searches and confirm zero hits outside the generator/action/test trio updated in Phase 1:

```bash
rg -n "priorProcedure\b" src/
rg -n "priorProcedure[^s]" src/
```

#### 2. End-to-end smoke-test notes
**File**: (no code change)
**Changes**: On a staging case with at least 2 completed procedures, regenerate the procedure note for the most recent procedure and visually confirm the tone matches the data.

### Success Criteria:

#### Automated Verification:
- [x] Full vitest suite: 453/462 pass. 9 pre-existing failures in `discharge-note`, `initial-visit-note`, and `procedure-note` validation schema tests (section-count expectations and schema field expectations) — verified identical on clean main, unrelated to this plan.
- [x] Type checking passes: `npx tsc --noEmit`
- [x] Linting: no new errors introduced (1 pre-existing error in `patients.test.ts` unrelated)
- [x] Zero remaining references to the old `priorProcedure` singular key in `src/` (`rg -n "priorProcedure\b" src/` returns no matches)

#### Manual Verification:
- [x] Regenerate a note on a real multi-procedure case and compare the `subjective` section before/after — tone now matches the pain trajectory
- [x] For a case without any chiro extractions, `chiroProgress` is null and the prompt does not fabricate chiropractic commentary
- [x] PDF renders correctly for all four `paintoneLabel` values (spot-check one note per label)
- [x] No regression in finalization, re-generation, or per-section regeneration flows

---

## Testing Strategy

### Unit Tests:
- `computePainToneLabel`: all 4 branches (baseline, improved, stable, worsened), null handling on either side, boundary cases at deltas of exactly ±1 and ±2.
- `deriveChiroProgress`: null/undefined, missing key, unknown enum value, all 4 valid values.

### Integration Tests:
- The existing procedure-note generator test at [generate-procedure-note.test.ts](src/lib/claude/__tests__/generate-procedure-note.test.ts) continues to pass with the updated fixture (no prior procedures case).

### Manual Testing Steps:
1. Case with 0 prior procedures → confirm `paintoneLabel="baseline"`, no comparison sentence in the output.
2. Case with 1 prior procedure, current pain = prior − 3 → confirm `paintoneLabel="improved"`, output references improvement and the prior score.
3. Case with 1 prior procedure, current pain = prior + 2 → confirm `paintoneLabel="worsened"`, output references persistent/worsening symptoms.
4. Case with 1 prior procedure, current pain = prior + 1 → confirm `paintoneLabel="stable"`, output references unchanged/modest variation.
5. Case with 3 prior procedures with a clear downward trend → confirm the `subjective` section includes a one-clause trajectory description.
6. Case with an approved chiro extraction whose `progress_status` aligns with the pain trend → confirm optional secondary citation appears when appropriate.
7. Case with an approved chiro extraction whose `progress_status` conflicts with pain (e.g., chiro "improving" but pain "worsened") → confirm the pain data takes precedence; no chiro citation appears.

## Performance Considerations

- The prior-procedure query changes from `limit(1)` to returning all rows for the case. In practice procedure series are small (typically 1-4 injections per case). The extra rows are negligible in cost.
- The vitals fetch changes from a per-row lookup to a single `.in(procedure_id, [...])` query — this is actually one network round-trip fewer than today when there is a prior procedure.
- One new parallel query added for `chiro_extractions`, executed alongside existing parallel queries in `Promise.all` — no additional wall-clock time.

## Migration Notes

- No database migrations.
- No backward-compatibility shim for `priorProcedure` — it has no external consumers (confirmed by grep at plan time).
- Existing finalized notes are not regenerated. Only new generations or explicit regenerations pick up the new tone logic — this is the expected behavior; finalized notes represent signed-off clinical output.

## References

- Research: [thoughts/shared/research/2026-04-18-procedure-note-pain-persistence-tone.md](thoughts/shared/research/2026-04-18-procedure-note-pain-persistence-tone.md)
- Current procedure-note prompt: [src/lib/claude/generate-procedure-note.ts:102-203](src/lib/claude/generate-procedure-note.ts#L102-L203)
- Current input gathering: [src/actions/procedure-notes.ts:28-237](src/actions/procedure-notes.ts#L28-L237)
- Chiro progress enum source: [src/lib/validations/chiro-extraction.ts:61-63](src/lib/validations/chiro-extraction.ts#L61-L63)
- Pattern reference — discharge note full pain trajectory: [src/lib/claude/generate-discharge-note.ts:29-38](src/lib/claude/generate-discharge-note.ts#L29-L38)
- Pattern reference — initial-visit explicit improved/worsened vocabulary: [src/lib/claude/generate-initial-visit.ts:230](src/lib/claude/generate-initial-visit.ts#L230)
