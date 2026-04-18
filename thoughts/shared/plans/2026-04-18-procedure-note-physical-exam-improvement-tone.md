# PRP Procedure Note — Physical Examination Improvement Tone Implementation Plan

## Overview

Extend the PRP Procedure Note AI prompt so that `objective_physical_exam` (section 8) reflects the patient's interval improvement trajectory instead of regenerating the initial pain-management physical exam verbatim on every session. The change is prompt-only — wire the already-available `paintoneLabel` and `chiroProgress` signals into section 8's instruction text with a "do not copy-paste baseline findings" rule, parallel reference examples per branch, and unit tests that lock the new prompt behavior.

## Current State Analysis

- [`SYSTEM_PROMPT` at `generate-procedure-note.ts:105-227`](src/lib/claude/generate-procedure-note.ts#L105-L227) already branches four sections on `paintoneLabel` — `subjective`, `review_of_systems`, `assessment_summary`, `prognosis`. Section 8 (`objective_physical_exam`) is a single-line directive with no tone branching:

  ```
  8. objective_physical_exam (~1 page):
  Inspection, Palpation, ROM (by spine region), Neurological Examination (Motor/Sensory/Reflexes),
  Straight Leg Raise if applicable, Gait Assessment. Populate from PM extraction physical_exam JSONB.
  Reference: "Inspection: The patient exhibits normal posture but demonstrates guarded movements..."
  ```

  The reference example is baseline-leaning ("guarded movements") and is the only example the model sees for every session regardless of trajectory.
- The input payload already carries everything the prompt would need to branch: `paintoneLabel` ([generate-procedure-note.ts:69](src/lib/claude/generate-procedure-note.ts#L69)), `chiroProgress` ([generate-procedure-note.ts:70](src/lib/claude/generate-procedure-note.ts#L70)), and `priorProcedures[]` with per-procedure pain scores ([generate-procedure-note.ts:63-68](src/lib/claude/generate-procedure-note.ts#L63-L68)).
- `pmExtraction.physical_exam` is the single physical-exam source the generator sees ([procedure-notes.ts:65-73](src/actions/procedure-notes.ts#L65-L73), `limit 1`). The same JSONB blob is supplied for every procedure in a case, so absent any "interpret in light of the trajectory" instruction the model emits near-duplicate prose across sessions.
- The recently-merged plan at [thoughts/shared/plans/2026-04-18-procedure-note-pain-tone-improvements.md](thoughts/shared/plans/2026-04-18-procedure-note-pain-tone-improvements.md) (status: FIXED) established the prompt-branching pattern and the computed `paintoneLabel` / `chiroProgress` helpers in [pain-tone.ts](src/lib/claude/pain-tone.ts). This plan reuses that infrastructure without changing the data layer.
- `regenerateProcedureNoteSection` at [generate-procedure-note.ts:326-355](src/lib/claude/generate-procedure-note.ts#L326-L355) re-uses the full `SYSTEM_PROMPT`. Any change to section 8's instruction text automatically takes effect for single-section regeneration as well.
- Test infrastructure exists at [generate-procedure-note.test.ts](src/lib/claude/__tests__/generate-procedure-note.test.ts) and uses the `emptyInput` fixture with `paintoneLabel: 'baseline'`. The test mocks `callClaudeTool` so prompt content can be asserted by inspecting `opts.system`.

## Desired End State

Generating (or regenerating) the `objective_physical_exam` section for any procedure:

1. Section 8's instruction block explicitly treats `pmExtraction.physical_exam` as a **starting reference**, not a verbatim source to paste.
2. The model is told that for repeat procedures (`paintoneLabel ∈ {'improved', 'stable', 'worsened'}`) it must **shift findings in the direction of the pain delta** rather than repeat the baseline exam, and must explicitly call unchanged regions "stable" or "unchanged" rather than silently repeating prior language.
3. Three parallel reference examples — one for `baseline`, one for `improved`, one for `stable`-or-`worsened` — sit beneath the instruction so the model has concrete exemplars for each branch.
4. `chiroProgress` is accepted as an optional secondary signal for physical-exam mobility / gait language when it aligns with `paintoneLabel`, with the same "pain data takes precedence" override already used in `subjective`.
5. `objective_vitals` (section 7) is **unchanged** — its content is numeric and trajectory-neutral.
6. Unit tests assert (a) the system prompt contains the new branching directives and examples, and (b) the four `paintoneLabel` values each make it into the user-message payload unchanged so the model can read them.

### Verification

- Session #2 of a case whose pain went 7→3 produces a physical-exam section that describes reduced tenderness / improved ROM / resolved guarding rather than repeating Session #1's "guarded movements, restricted ROM" baseline.
- Session #2 of a case whose pain went 7→8 produces a physical-exam section that reads as persistent / ongoing restriction (not artificially softened).
- Session #1 (`paintoneLabel="baseline"`) produces the same kind of physical-exam section the generator emits today — no behavior change for first injections.
- A case with an approved chiro extraction whose `progress_status="improving"` and `paintoneLabel="improved"` may show a mobility/gait phrase citing chiropractic progress; when the two conflict, the chiro signal is dropped.
- Existing `generate-procedure-note.test.ts` cases still pass; new tests covering prompt content and payload threading pass.

### Key Discoveries

- The `ProcedureNoteInputData` shape already has the inputs this change needs ([generate-procedure-note.ts:69-70](src/lib/claude/generate-procedure-note.ts#L69-L70)); no action-layer change is required.
- The pattern for prompt branching is already established in [L128-L144](src/lib/claude/generate-procedure-note.ts#L128-L144) (`subjective`), [L163-L165](src/lib/claude/generate-procedure-note.ts#L163-L165) (`review_of_systems`), [L175-L178](src/lib/claude/generate-procedure-note.ts#L175-L178) (`assessment_summary`), [L217-L220](src/lib/claude/generate-procedure-note.ts#L217-L220) (`prognosis`). The new section-8 block will mirror that structure.
- Section 7 (`objective_vitals`) is numeric and deliberately out of scope — injecting improvement language into a vitals bullet list would be cosmetic at best and invite hallucinated BP/HR deltas at worst.
- Per-section regeneration ([generate-procedure-note.ts:326-355](src/lib/claude/generate-procedure-note.ts#L326-L355)) reuses the same `SYSTEM_PROMPT`, so regenerating just the physical-exam section picks up the new branches automatically.

## What We're NOT Doing

- No change to the data layer: `ProcedureNoteInputData` keeps its current shape; `gatherProcedureNoteSourceData` in [procedure-notes.ts](src/actions/procedure-notes.ts) is untouched.
- No new database fields or migrations; no new Supabase queries; no changes to `pain_management_extractions` or `vital_signs`.
- No change to any other prompt section — `subjective`, `review_of_systems`, `assessment_summary`, `prognosis`, `objective_vitals`, or any of the procedure-procedural sections (preparation, PRP prep, anesthesia, injection, post-care).
- No change to the Discharge Note or Initial Visit generators — their prompts already have appropriate tone handling.
- No change to the `procedure_notes` table schema, the validation schema in [src/lib/validations/procedure-note.ts](src/lib/validations/procedure-note.ts), the editor UI, or the PDF template.
- No change to the `callClaudeTool` client, model selection, or tool definition.

## Implementation Approach

This is a two-phase plan: the prompt change itself (Phase 1) and lockdown tests (Phase 2). The split exists because the prompt text is the whole behavior change — if the tests are co-authored with the prompt change in the same commit, there is no independent verification that the new instruction text is actually reaching the model. Writing the prompt in Phase 1, then writing tests in Phase 2 that assert specific substrings of the prompt and specific payload threading, prevents accidental regression if the prompt is later edited (e.g., whitespace/copyedit changes that silently drop a branch directive).

The core directive for section 8 is deliberately prescriptive (stance "b" from the design discussion): it calls `pmExtraction.physical_exam` a **starting reference** rather than a source, and it explicitly forbids verbatim repetition of baseline findings across repeat procedures. Unchanged regions must be explicitly labeled "stable" or "unchanged" rather than silently copied. This is the same framing used by the Discharge Note's `objective_cervical` / `objective_lumbar` ("Emphasize improvement from baseline") but applied with all four `paintoneLabel` branches rather than the single improvement direction that the Discharge Note assumes.

---

## Phase 1: Rewrite Section 8 (`objective_physical_exam`) with Tone Branching

### Overview

Replace the three-line instruction at [generate-procedure-note.ts:171-173](src/lib/claude/generate-procedure-note.ts#L171-L173) with a branched block that: (a) keeps the current baseline behavior when `paintoneLabel="baseline"`, (b) forbids copy-paste and requires finding-shift for repeat procedures, (c) offers three parallel reference examples, (d) accepts `chiroProgress` as an optional secondary signal with the same precedence rule already used in `subjective`.

### Changes Required

#### 1. Section 8 prompt block

**File**: `src/lib/claude/generate-procedure-note.ts`
**Changes**: Replace lines 171-173 with the branched instruction below. Do not change any surrounding whitespace or section numbering.

Current text to replace (three lines starting at 171):

```
8. objective_physical_exam (~1 page):
Inspection, Palpation, ROM (by spine region), Neurological Examination (Motor/Sensory/Reflexes), Straight Leg Raise if applicable, Gait Assessment. Populate from PM extraction physical_exam JSONB.
Reference: "Inspection: The patient exhibits normal posture but demonstrates guarded movements..."
```

New text:

```
8. objective_physical_exam (~1 page):
Inspection, Palpation, ROM (by spine region), Neurological Examination (Motor/Sensory/Reflexes), Straight Leg Raise if applicable, Gait Assessment.

SOURCE: Treat pmExtraction.physical_exam as a STARTING REFERENCE describing the patient's baseline exam at intake — NOT as a source to paste verbatim. The output for this procedure must reflect the patient's current state on procedureRecord.procedure_date, informed by the paintoneLabel.

INTERVAL-CHANGE RULE (MANDATORY when paintoneLabel is "improved", "stable", or "worsened"): Do NOT reproduce the baseline pmExtraction findings word-for-word. For each region present in the baseline exam, shift the description in the direction of the pain delta and label any region whose findings have not meaningfully changed as "stable" or "unchanged since the prior injection" — do not silently repeat prior language. Do not invent new anatomic regions that are not present in pmExtraction; the scope of the exam is bounded by what was captured at intake.

TONE BY paintoneLabel:
• "baseline" (first injection or no prior pain recorded) — render the exam from pmExtraction.physical_exam without interval-change commentary. Use the baseline reference example below.
• "improved" (current pain ≥2 points lower than prior) — describe reduced tenderness, improved ROM, resolved or reduced guarding, and mention the improvement is since the prior injection. Replace baseline language like "guarded movements" / "significantly restricted ROM" / "marked tenderness" with "residual" / "minimal" / "improved from prior" wording where supported by the pain delta.
• "stable" (within ±1 point of prior) — describe findings as largely unchanged from the prior injection; you may use "persistent at a similar level" or "without meaningful interval change" framing. Do not artificially soften or harden findings.
• "worsened" (current pain ≥2 points higher than prior) — describe persistent or increased tenderness, restricted ROM, or continued guarding; characterize findings as ongoing or progressive despite the prior injection.

SECONDARY SIGNAL (optional): If the top-level "chiroProgress" field is non-null AND aligns with paintoneLabel (improving↔improved, worsening↔worsened, stable/plateauing↔stable), you MAY include a single mobility/gait phrase reflecting chiropractic progress (e.g., "gait has become less antalgic with concurrent chiropractic care"). Do NOT cite chiroProgress when it conflicts with the pain data — pain data takes precedence.

DO NOT fabricate specific measurements (ROM degrees, reflex grades, dermatomal findings) that are not in pmExtraction; describe changes qualitatively. Use brackets "[not assessed]" only for data that requires in-person examination and is genuinely absent.

Reference (paintoneLabel="baseline"): "Inspection: The patient exhibits normal posture but demonstrates guarded movements of the lumbar spine. Palpation reveals tenderness over the bilateral lumbar paraspinals with associated muscle spasm. Range of motion is restricted in flexion and extension, reproducing the patient's axial pain at end range. Neurological examination demonstrates 5/5 strength in bilateral lower extremities, intact sensation to light touch, and symmetric 2+ reflexes. Straight-leg raise is positive on the right at 45 degrees. Gait is mildly antalgic."
Reference (paintoneLabel="improved"): "Inspection: Posture is improved with reduced guarding compared to the prior injection. Palpation reveals residual mild tenderness over the lumbar paraspinals with decreased muscle spasm. Range of motion is improved in flexion and extension, with only mild discomfort at end range. Neurological examination is unchanged: 5/5 strength in bilateral lower extremities, intact sensation, and symmetric 2+ reflexes. Straight-leg raise is now negative bilaterally. Gait is less antalgic than at the prior visit."
Reference (paintoneLabel="stable" or "worsened"): "Inspection: The patient continues to demonstrate guarded movements of the lumbar spine, without meaningful interval change. Palpation reveals persistent tenderness over the bilateral lumbar paraspinals with ongoing muscle spasm. Range of motion remains restricted in flexion and extension, reproducing axial pain at end range. Neurological examination is stable: 5/5 strength, intact sensation, symmetric reflexes. Straight-leg raise remains positive on the right. Gait is unchanged, mildly antalgic."
```

Notes on the replacement:
- The instruction length increases from 3 lines to ~25 lines — within the prompt's overall length budget (the current prompt is ~230 lines; adding ~22 is a ~10% increase, well within Sonnet's input budget, and sections 1, 6, 9, 19 already carry comparable branch text).
- The baseline reference example is kept in structure (same anatomic regions as the old "guarded movements" example) and expanded to a full-paragraph form that matches the `~1 page` length target. The old partial example ("guarded movements...") was a truncation; the new one is the first full version.
- The "SECONDARY SIGNAL" paragraph intentionally mirrors the wording in `subjective` ([generate-procedure-note.ts:137-138](src/lib/claude/generate-procedure-note.ts#L137-L138)) so the model recognizes the same pattern.

#### 2. No change to section 7 (`objective_vitals`)

**File**: `src/lib/claude/generate-procedure-note.ts`
**Changes**: None. Confirmed out of scope — vitals are numeric and trajectory-neutral.

#### 3. No change to the tool schema or per-section regeneration wrapper

**File**: `src/lib/claude/generate-procedure-note.ts`
**Changes**: None. The `PROCEDURE_NOTE_TOOL` tool definition ([L229-L279](src/lib/claude/generate-procedure-note.ts#L229-L279)) already exposes `objective_physical_exam` as a string field. `regenerateProcedureNoteSection` ([L326-L355](src/lib/claude/generate-procedure-note.ts#L326-L355)) reuses the same `SYSTEM_PROMPT` and will pick up the new branches automatically for single-section regeneration.

### Success Criteria

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit`
- [x] Linting passes: `npm run lint` (ignoring the pre-existing `patients.test.ts` error flagged in the prior plan's Phase 1)
- [x] Existing procedure-note tests pass: `npx vitest run src/lib/claude/__tests__/generate-procedure-note.test.ts` (2/2)
- [x] Full Claude-layer suite still green: `npx vitest run src/lib/claude/__tests__/` (57/57)

#### Manual Verification:
- [ ] Open the file and confirm the new section 8 block is ~25 lines, starts at what was previously line 171, and ends immediately before the `9. assessment_summary` heading.
- [ ] Confirm section 7 (`objective_vitals`) is unchanged.
- [ ] Confirm no other section's instruction text was altered.
- [ ] Spot-check by generating a procedure note in staging on a multi-procedure case where the pain clearly dropped (`paintoneLabel` will compute to `improved`) and confirm the physical-exam section reads as reduced-findings rather than as a copy of the prior session.
- [ ] Spot-check a first-injection case (`paintoneLabel="baseline"`) and confirm the physical-exam section content is equivalent to what today's generator produces — no regression in baseline output.
- [ ] Spot-check a case where the chiro extraction's `progress_status` conflicts with the pain trend and confirm no chiropractic phrase is added to the physical exam.

**Implementation Note**: After Phase 1's automated checks pass, pause for user confirmation that the manual spot-checks on staging cases look correct before starting Phase 2. Phase 2 is test-only; it does not change generator behavior.

---

## Phase 2: Prompt-Content and Payload-Threading Tests

### Overview

Add targeted tests to [src/lib/claude/__tests__/generate-procedure-note.test.ts](src/lib/claude/__tests__/generate-procedure-note.test.ts) that (a) assert the new branching directives and reference examples are present in the system prompt, and (b) assert each of the four `paintoneLabel` values and the `chiroProgress` enum members are threaded into the user-message payload unchanged. These tests lock down the new behavior against future copyediting regressions.

### Changes Required

#### 1. Extend existing test file with prompt-content assertions

**File**: `src/lib/claude/__tests__/generate-procedure-note.test.ts`
**Changes**: Add a new `describe` block after the existing two blocks. Do not modify the existing `emptyInput` fixture or the existing tests.

```ts
describe('SYSTEM_PROMPT — objective_physical_exam branching', () => {
  beforeEach(() => vi.clearAllMocks())

  async function capturePrompt(input: ProcedureNoteInputData): Promise<string> {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(input)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    return opts.system as string
  }

  it('includes the STARTING REFERENCE rule for pmExtraction.physical_exam', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('STARTING REFERENCE')
    expect(system).toContain('NOT as a source to paste verbatim')
  })

  it('includes the MANDATORY interval-change rule for repeat procedures', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('INTERVAL-CHANGE RULE')
    expect(system).toContain('Do NOT reproduce the baseline pmExtraction findings word-for-word')
    expect(system).toContain('stable')
    expect(system).toContain('unchanged since the prior injection')
  })

  it('includes all four paintoneLabel tone branches for the physical exam', async () => {
    const system = await capturePrompt(emptyInput)
    // Each branch must be described by name in the TONE BY paintoneLabel block
    expect(system).toMatch(/"baseline".*first injection or no prior pain recorded/s)
    expect(system).toMatch(/"improved".*current pain ≥2 points lower than prior/s)
    expect(system).toMatch(/"stable".*within ±1 point of prior/s)
    expect(system).toMatch(/"worsened".*current pain ≥2 points higher than prior/s)
  })

  it('includes three parallel reference examples for baseline / improved / stable-or-worsened', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('Reference (paintoneLabel="baseline")')
    expect(system).toContain('Reference (paintoneLabel="improved")')
    expect(system).toContain('Reference (paintoneLabel="stable" or "worsened")')
  })

  it('includes the chiroProgress secondary-signal rule with pain-data precedence', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('SECONDARY SIGNAL')
    expect(system).toContain('chiroProgress')
    expect(system).toContain('pain data takes precedence')
  })

  it('forbids fabricating specific measurements not in pmExtraction', async () => {
    const system = await capturePrompt(emptyInput)
    expect(system).toContain('DO NOT fabricate specific measurements')
  })

  it('does not add tone branching to objective_vitals (section 7)', async () => {
    const system = await capturePrompt(emptyInput)
    // Section 7's instruction should still be numeric-only: look for the exact
    // known phrasing and assert no paintoneLabel reference appears between
    // section 7's heading and section 8's heading.
    const s7Start = system.indexOf('7. objective_vitals')
    const s8Start = system.indexOf('8. objective_physical_exam')
    expect(s7Start).toBeGreaterThan(0)
    expect(s8Start).toBeGreaterThan(s7Start)
    const s7Block = system.slice(s7Start, s8Start)
    expect(s7Block).not.toContain('paintoneLabel')
    expect(s7Block).not.toContain('INTERVAL-CHANGE')
  })
})

describe('generateProcedureNoteFromData — paintoneLabel and chiroProgress threading', () => {
  beforeEach(() => vi.clearAllMocks())

  async function captureUserPayload(input: ProcedureNoteInputData): Promise<string> {
    ;(callClaudeTool as unknown as Mock).mockResolvedValue({ data: {}, rawResponse: {} })
    await generateProcedureNoteFromData(input)
    const opts = (callClaudeTool as unknown as Mock).mock.calls[0][0]
    return opts.messages[0].content as string
  }

  it.each(['baseline', 'improved', 'stable', 'worsened'] as const)(
    'threads paintoneLabel="%s" into the user payload',
    async (label) => {
      const payload = await captureUserPayload({ ...emptyInput, paintoneLabel: label })
      expect(payload).toContain(`"paintoneLabel": "${label}"`)
    },
  )

  it.each(['improving', 'stable', 'plateauing', 'worsening'] as const)(
    'threads chiroProgress="%s" into the user payload',
    async (progress) => {
      const payload = await captureUserPayload({ ...emptyInput, chiroProgress: progress })
      expect(payload).toContain(`"chiroProgress": "${progress}"`)
    },
  )

  it('threads chiroProgress=null into the user payload as JSON null', async () => {
    const payload = await captureUserPayload({ ...emptyInput, chiroProgress: null })
    expect(payload).toContain('"chiroProgress": null')
  })
})
```

Notes on the test additions:
- The `capturePrompt` and `captureUserPayload` helpers deliberately stay local to the new `describe` blocks so the existing tests are not forced into a shared helper refactor.
- The prompt-content tests assert specific substrings (not a full-prompt snapshot) so that unrelated copyedits to other sections do not cause false failures.
- The section-7 test is the guardrail for the "do not accidentally start branching vitals" decision — it fails loudly if a future edit introduces `paintoneLabel` into section 7.
- The `it.each` paintoneLabel / chiroProgress tests verify that the existing JSON.stringify-based user-message construction ([generate-procedure-note.ts:296-298](src/lib/claude/generate-procedure-note.ts#L296-L298)) renders these fields visibly so Claude can read and branch on them.

### Success Criteria

#### Automated Verification:
- [x] New tests pass: `npx vitest run src/lib/claude/__tests__/generate-procedure-note.test.ts` (18/18; 16 new + 2 existing)
- [x] Existing tests in the same file still pass (no regressions)
- [x] Full Claude-layer suite still green: `npx vitest run src/lib/claude/__tests__/` (73/73)
- [x] Type checking passes: `npx tsc --noEmit`
- [x] Linting passes on the modified test file (scoped run acceptable): `npm run lint -- src/lib/claude/__tests__/generate-procedure-note.test.ts`

#### Manual Verification:
- [x] Inspect the failing output if any assertion fails to confirm the failure reflects a real prompt-content drift and not a test typo. (All assertions passed first try after the ES2017 regex-flag fix; no manual action required.)

---

## Testing Strategy

### Unit Tests
- Assert the new section-8 instruction text contains the STARTING REFERENCE rule, the MANDATORY interval-change rule, all four `paintoneLabel` branches, three reference examples, the chiroProgress secondary-signal rule, and the no-fabrication directive.
- Assert section 7 (`objective_vitals`) does not contain any tone-branching keywords — this is the guardrail against accidental scope creep.
- Assert each of the four `paintoneLabel` values and the four `chiroProgress` enum values (plus `null`) thread into the user-message payload as visible JSON fields.

### Integration Tests
- None added. The existing `generate-procedure-note.test.ts` top-level test (`calls callClaudeTool with Sonnet 4.6 and the procedure note tool`) remains the integration-level smoke test. No action-layer tests are added because the data layer is untouched.

### Manual Testing Steps
1. On a staging case with one finalized procedure whose max pain was 7/10 and a current procedure with max pain 3/10, generate the procedure note and confirm the `objective_physical_exam` section (a) does not quote verbatim from the prior session's findings, (b) uses at least one of the words "residual", "improved", "reduced", "minimal", or "less antalgic", and (c) does not use "guarded movements" or "markedly restricted" unless the pmExtraction baseline specifically contained that language AND the branch is `baseline` or `stable`/`worsened`.
2. On a staging case with pain going 5→7, generate the procedure note and confirm the physical-exam section describes findings as ongoing/persistent/unchanged rather than improved.
3. On a staging case with pain going 6→6 or 6→7 (stable), generate the procedure note and confirm the physical-exam section reads as "unchanged" / "persistent at a similar level" rather than either improved or worsened.
4. On a staging case with a first-only procedure (baseline), generate the procedure note and confirm the physical-exam section matches what today's generator produces — i.e., no regression for first injections.
5. On a staging case with an approved chiro extraction whose `progress_status="improving"` and pain trend improved, confirm a single mobility/gait phrase citing chiropractic progress may appear; disable the chiro extraction (or use a case with `progress_status="worsening"` against an improved pain trend) and confirm no chiropractic phrase appears.
6. Regenerate just the physical-exam section via the per-section regeneration flow ([procedure-notes.ts:686-733](src/actions/procedure-notes.ts#L686-L733)) and confirm the output honors the same tone branching — this verifies the suffixed system prompt used by `regenerateProcedureNoteSection` picks up the new block.

## Performance Considerations

- Prompt length grows by ~22 lines (~1.5 KB of text). No measurable impact on Sonnet 4.6 input token count at the scale of this prompt. No change to the number of Anthropic API calls, tool definitions, or per-request token budget.
- No additional Supabase queries, no additional network round-trips, no schema changes.

## Migration Notes

- No database migrations.
- No backwards-compatibility shim required — the input-data shape is unchanged; only the prompt text that consumes existing fields is edited.
- Finalized procedure notes are not regenerated. Only new generations or explicit regenerations pick up the new section-8 tone branching. This matches the behavior of the prior pain-tone-improvements plan and reflects the policy that signed-off clinical output is immutable.
- If a finalized note is later unfinalized and regenerated ([procedure-notes.ts:596-620](src/actions/procedure-notes.ts#L596-L620)), it will pick up the new tone branching on the next generation — expected behavior.

## References

- Research: [thoughts/shared/research/2026-04-18-prp-procedure-physical-exam-improvement-tone.md](thoughts/shared/research/2026-04-18-prp-procedure-physical-exam-improvement-tone.md)
- Prior plan establishing the `paintoneLabel` branching pattern: [thoughts/shared/plans/2026-04-18-procedure-note-pain-tone-improvements.md](thoughts/shared/plans/2026-04-18-procedure-note-pain-tone-improvements.md)
- Current procedure-note prompt: [src/lib/claude/generate-procedure-note.ts:105-227](src/lib/claude/generate-procedure-note.ts#L105-L227)
- Section 8 current text (to replace): [src/lib/claude/generate-procedure-note.ts:171-173](src/lib/claude/generate-procedure-note.ts#L171-L173)
- Pattern reference — `subjective` 4-way branching: [src/lib/claude/generate-procedure-note.ts:128-144](src/lib/claude/generate-procedure-note.ts#L128-L144)
- Pattern reference — `review_of_systems` 2-way branching: [src/lib/claude/generate-procedure-note.ts:163-165](src/lib/claude/generate-procedure-note.ts#L163-L165)
- Pattern reference — Discharge Note objective-section improvement framing: [src/lib/claude/generate-discharge-note.ts:167-181](src/lib/claude/generate-discharge-note.ts#L167-L181)
- Pain-tone helpers: [src/lib/claude/pain-tone.ts](src/lib/claude/pain-tone.ts)
- Test file to extend: [src/lib/claude/__tests__/generate-procedure-note.test.ts](src/lib/claude/__tests__/generate-procedure-note.test.ts)
