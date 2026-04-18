---
date: 2026-04-18T14:45:54-0700
researcher: arsenaid
git_commit: 7aa8683734febf7fe35ab7975ed534497e95c6ee
branch: main
repository: cliniq
topic: "PRP procedure & discharge notes — how AI prompt templates handle improvement reporting in physical evaluation / movement sections"
tags: [research, codebase, procedure-notes, discharge-notes, prompts, physical-exam, ROM, claude]
status: complete
last_updated: 2026-04-18
last_updated_by: arsenaid
---

# Research: PRP procedure & discharge notes — how AI prompt templates handle improvement reporting in physical evaluation / movement sections

**Date**: 2026-04-18T14:45:54-0700
**Researcher**: arsenaid
**Git Commit**: 7aa8683734febf7fe35ab7975ed534497e95c6ee
**Branch**: main
**Repository**: cliniq

## Research Question
Check whether the AI prompt templates used to generate the attached PRP documents (Session #1, Session #2, Discharge) actually instruct the model to *apply* interval improvements to the objective physical examination (movement/ROM) and to the narrative — or whether they copy-paste/repeat baseline physical findings from session to session.

The three example PDFs map to the three Claude generators in `src/lib/claude/`:
- **PRP Injection Note – Session #1** → `generate-procedure-note.ts` (`paintoneLabel = "baseline"`)
- **PRP Injection Note – Session #2** → `generate-procedure-note.ts` (`paintoneLabel = "improved" | "stable" | "worsened"`)
- **PRP Discharge Note** → `generate-discharge-note.ts`

## Summary

Two of the three prompts *do* express an improvement axis; one of the two applies that axis to the physical-exam / movement description; the third (the per-session procedure note) does not.

1. **Procedure Note prompt (used for both Session #1 and Session #2 PDFs)** — [`generate-procedure-note.ts:105-227`](src/lib/claude/generate-procedure-note.ts#L105-L227). Has a four-way `paintoneLabel` branch (`baseline | improved | stable | worsened`) that is wired into the **`subjective`**, **`review_of_systems`**, **`assessment_summary`**, and **`prognosis`** sections. It is **NOT** wired into **`objective_physical_exam`** (`section 8`) or **`objective_vitals`**. Section 8's entire instruction is: *"Inspection, Palpation, ROM (by spine region), Neurological Examination (Motor/Sensory/Reflexes), Straight Leg Raise if applicable, Gait Assessment. Populate from PM extraction physical_exam JSONB."* ([line 171-173](src/lib/claude/generate-procedure-note.ts#L171-L173)). There is no instruction to soften findings when pain has improved, no reference to interval change in ROM, no comparison to the prior visit's exam. The input data also does not carry the previous procedure's physical-exam findings — `ProcedureNoteInputData` only exposes a single `pmExtraction` (the initial pain-management extraction) plus current and prior pain scores ([lines 16-103](src/lib/claude/generate-procedure-note.ts#L16-L103)).

   Consequence: across Session #1 and Session #2, the model is reading the **same** source `pmExtraction.physical_exam` JSONB and is told to "populate from" it with no interval-change directive. Tone in the narrative sections can diverge (and does — the attached Session #2 PDF correctly shifts to "slight improvement"), but the physical-exam prose is regenerated from a single static source each time, which is the structural reason those sections read like near-duplicates across sessions.

2. **Discharge Note prompt** — [`generate-discharge-note.ts:114-209`](src/lib/claude/generate-discharge-note.ts#L114-L209). Explicitly instructs improvement framing in the movement/exam sections: `objective_general` ("demonstrates improved posture and ease of movement compared to prior visits", [line 169](src/lib/claude/generate-discharge-note.ts#L169)), `objective_cervical` ("Emphasize improvement from baseline" + reference example uses "Range of motion is near full in all planes, with only mild end-range stiffness", [lines 171-173](src/lib/claude/generate-discharge-note.ts#L171-L173)), `objective_lumbar` ("Emphasize improvement", [line 175](src/lib/claude/generate-discharge-note.ts#L175-L177)), `objective_neurological` ("All should be normal/intact at discharge", [line 180](src/lib/claude/generate-discharge-note.ts#L180-L181)). It also carries both the `initialVisitBaseline.physical_exam` and `overallPainTrend` fields as input — so the model *has* a baseline to anchor "improved from" against ([lines 49-58](src/lib/claude/generate-discharge-note.ts#L49-L58)).

3. **Computed pain-trajectory label** — [`pain-tone.ts:3-12`](src/lib/claude/pain-tone.ts#L3-L12) — is the mechanism that converts prior-vs-current `pain_score_max` into `'baseline' | 'improved' | 'stable' | 'worsened'`. It is passed to the procedure-note prompt as `paintoneLabel` and to the discharge-note prompt as `overallPainTrend`. The procedure-note prompt references this field in four text sections but **not** in the physical-exam section.

The three attached PDFs are consistent with what the prompts specify: Session #1 and Session #2 share near-identical Objective / Physical Exam language with only minor wording variation, while the Discharge Note's objective section explicitly frames findings as improved from baseline.

## Detailed Findings

### 1. The PRP Procedure Note prompt — which sections are wired to `paintoneLabel`

**File**: [`src/lib/claude/generate-procedure-note.ts`](src/lib/claude/generate-procedure-note.ts)

The `SYSTEM_PROMPT` constant spans [lines 105-227](src/lib/claude/generate-procedure-note.ts#L105-L227) and defines 20 structured sections. A text search of the prompt for `paintoneLabel` shows it is referenced in exactly four sections:

| Section (prompt line)                                              | How `paintoneLabel` is used                                   |
|--------------------------------------------------------------------|----------------------------------------------------------------|
| `1. subjective` ([L128-L144](src/lib/claude/generate-procedure-note.ts#L128-L144)) | Four-way branch: `baseline` / `improved` / `stable` / `worsened`. Each branch has a reference example. For `improved`, the prompt explicitly bans "persistent" and "continues to report" and requires the word "residual / intermittent / mild". |
| `6. review_of_systems` ([L163-L165](src/lib/claude/generate-procedure-note.ts#L163-L165)) | Two-way branch: persistence-leaning for `baseline/stable/worsened`; improvement-leaning for `improved`. Example shows "Residual low back pain with reduced sciatic symptoms since the prior injection." |
| `9. assessment_summary` ([L175-L178](src/lib/claude/generate-procedure-note.ts#L175-L178)) | Two-way branch: persistence closing for `baseline/stable/worsened`; "favorable interim response supporting continuation of the injection series" for `improved`. |
| `19. prognosis` ([L217-L220](src/lib/claude/generate-procedure-note.ts#L217-L220)) | Two-way branch: "guarded" for `baseline/stable/worsened`; "guarded-to-favorable" for `improved`. |

Every *other* section — including all of the following — has **no** reference to `paintoneLabel`, `improvement`, `prior visit`, or `interval change`:

- `2. past_medical_history`
- `3. allergies`
- `4. current_medications`
- `5. social_history`
- `7. objective_vitals` ([L167-L169](src/lib/claude/generate-procedure-note.ts#L167-L169)) — instruction is "BP systolic/diastolic, HR, RR, Temp, SpO2, and current Pain as bullet list." No comparison clause.
- **`8. objective_physical_exam`** ([L171-L173](src/lib/claude/generate-procedure-note.ts#L171-L173)) — **the entire instruction**:

  > `8. objective_physical_exam (~1 page):`
  > `Inspection, Palpation, ROM (by spine region), Neurological Examination (Motor/Sensory/Reflexes), Straight Leg Raise if applicable, Gait Assessment. Populate from PM extraction physical_exam JSONB.`
  > `Reference: "Inspection: The patient exhibits normal posture but demonstrates guarded movements..."`

  There is no "If paintoneLabel is 'improved', describe improved ROM / reduced tenderness / resolved guarding" branch. The reference example itself reads as a baseline finding ("guarded movements").

- `10. procedure_indication` through `20. clinician_disclaimer` — none reference `paintoneLabel` or interval change, with the single exception of `16. procedure_followup` which mentions series position for scheduling purposes only.

### 2. Data passed to the Procedure Note prompt — what baseline exists to compare against

**File**: [`src/actions/procedure-notes.ts`](src/actions/procedure-notes.ts)

`gatherProcedureNoteSourceData` ([lines 29-258](src/actions/procedure-notes.ts#L29-L258)) fetches exactly one physical-exam source: the most-recent approved `pain_management_extractions` row for the case.

- Query at [L65-L73](src/actions/procedure-notes.ts#L65-L73): selects `physical_exam` from `pain_management_extractions`, filtered to `review_status = 'approved'`, ordered by `created_at DESC`, `limit 1`.
- This single JSONB blob is then threaded into `pmExtraction.physical_exam` on the input payload at [L220-L226](src/actions/procedure-notes.ts#L220-L226).

There is no per-procedure physical-exam capture. `vital_signs` is the only per-procedure record ([L51-L57](src/actions/procedure-notes.ts#L51-L57)), and it only contains numeric fields (BP, HR, RR, Temp, SpO₂, pain min/max). Prior procedures contribute pain scores only ([L120-L139](src/actions/procedure-notes.ts#L120-L139), [L207-L211](src/actions/procedure-notes.ts#L207-L211)).

Consequence: even if the prompt *did* instruct Claude to describe interval improvement in ROM, the input data does not carry an interval-change signal for the physical exam. The only data from which the model can infer improvement is `paintoneLabel` (pain-score delta) and `chiroProgress` ([L69-L70](src/lib/claude/generate-procedure-note.ts#L69-L70)).

### 3. The `paintoneLabel` computation

**File**: [`src/lib/claude/pain-tone.ts`](src/lib/claude/pain-tone.ts)

```ts
// pain-tone.ts:3-12
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
```

Invoked at [`procedure-notes.ts:212-217`](src/actions/procedure-notes.ts#L212-L217):

```ts
paintoneLabel: computePainToneLabel(
  vitalsRes.data?.pain_score_max ?? null,
  priorProcedureRows.length > 0
    ? priorVitalsByProcedureId.get(priorProcedureRows[priorProcedureRows.length - 1].id)?.pain_score_max ?? null
    : null,
),
```

The comparison is current procedure's max pain vs the **most recent** prior procedure's max pain. The function returns one of four labels, and that label is what the four `paintoneLabel`-aware sections in the prompt branch on.

### 4. The Discharge Note prompt — improvement framing applied to every objective/movement section

**File**: [`src/lib/claude/generate-discharge-note.ts`](src/lib/claude/generate-discharge-note.ts)

The Discharge prompt has a top-level `=== CONTEXT ===` block at [L134](src/lib/claude/generate-discharge-note.ts#L134):

> `This is a DISCHARGE note — the patient has COMPLETED their PRP treatment series and is being evaluated for discharge from active interventional pain management care. The tone should reflect completion, improvement, and forward-looking recommendations. Summarize the entire treatment course and outcomes.`

It then applies that frame to each objective section:

- `objective_general` ([L167-L169](src/lib/claude/generate-discharge-note.ts#L167-L169)): "Alert, oriented, cooperative, no acute distress. **Note improved posture and ease of movement compared to prior visits.**"
- `objective_cervical` ([L171-L173](src/lib/claude/generate-discharge-note.ts#L171-L173)): "Inspection, palpation (minimal residual findings), ROM (near full), negative provocative tests. **Emphasize improvement from baseline.**" Reference example describes "Range of motion is near full in all planes, with only mild end-range stiffness."
- `objective_lumbar` ([L175-L177](src/lib/claude/generate-discharge-note.ts#L175-L177)): "Same structure as cervical — inspection, palpation, ROM, SLR. **Emphasize improvement.**"
- `objective_neurological` ([L179-L181](src/lib/claude/generate-discharge-note.ts#L179-L181)): "Motor strength, sensation, reflexes, gait. **All should be normal/intact at discharge.**"
- `assessment` ([L187-L189](src/lib/claude/generate-discharge-note.ts#L187-L189)): REQUIRED numeric pain delta citation. "The patient demonstrates sustained clinical improvement following completion of a PRP treatment…"
- `prognosis` ([L201-L203](src/lib/claude/generate-discharge-note.ts#L201-L203)): "Favorable prognosis. Meaningful and sustained improvement…"

The prompt also carries a dedicated `=== PAIN TRAJECTORY (MANDATORY) ===` block ([L136-L152](src/lib/claude/generate-discharge-note.ts#L136-L152)) that requires explicit numeric narration of the downward pain trajectory from baseline through each procedure to the discharge visit.

### 5. Input data available to the Discharge Note prompt

`DischargeNoteInputData` ([lines 15-112](src/lib/claude/generate-discharge-note.ts#L15-L112)) carries — in contrast to the Procedure Note input — **multiple baseline anchors** for comparison:

- `baselinePain` — pain range at the first procedure ([L49-L53](src/lib/claude/generate-discharge-note.ts#L49-L53))
- `initialVisitBaseline.physical_exam` — the intake physical exam narrative ([L54-L57](src/lib/claude/generate-discharge-note.ts#L54-L57))
- `procedures[]` — every procedure with its own pain scores ([L29-L38](src/lib/claude/generate-discharge-note.ts#L29-L38))
- `overallPainTrend` — computed label ([L58](src/lib/claude/generate-discharge-note.ts#L58))
- `latestVitals` — the discharge-visit vital signs ([L39-L48](src/lib/claude/generate-discharge-note.ts#L39-L48))
- `ptExtraction`, `chiroExtraction.functional_outcomes` — functional progress sources ([L71-L96](src/lib/claude/generate-discharge-note.ts#L71-L96))

### 6. How the three attached PDFs line up with each prompt

**Session #1 PDF** (dated 11/24/2025, the baseline injection):
- Per the prompt's `paintoneLabel = "baseline"` branch ([L129](src/lib/claude/generate-procedure-note.ts#L129)), no interval comparison is generated — which matches the PDF's Pre-Procedure Assessment section (it compares to conservative care, not to a prior PRP visit).
- The PDF lacks a "Current Symptoms / Functional limitations" improvement delta because this is the first session.

**Session #2 PDF** (dated 01/08/2026, second injection):
- Pain drops from 5–7/10 → 4–5/10 — a delta of -2 on pain_score_max (7 → 5), which would compute to `paintoneLabel = "improved"`.
- Subjective section in the PDF reads "Following PRP Session #1 on 11/24/2025, the patient reports partial improvement in symptoms, with mild reduction in pain intensity and slight improvement in functional tolerance" — this matches the `improved` branch's reference at [L141](src/lib/claude/generate-procedure-note.ts#L141).
- HOWEVER: the PDF does not have a dedicated Objective / Physical Exam section like the Session #1 PDF does — it has Vital Signs and Pre-Procedure Assessment only. This is a known shape of the Session #2 template (no full PE section). So the copy-paste concern does not show up visibly in this specific Session #2 document because the section is absent, but the underlying prompt would copy-paste the same physical exam across sessions when both sessions have it.

**Discharge Note PDF** (dated 01/22/2026):
- Pain drops from 5–7/10 (Session #1 baseline) → 2–3/10 at discharge — `overallPainTrend = "improved"`.
- Objective sections in the PDF use explicit improvement phrasing: "mild residual paraspinal tenderness with improved muscular tone", "Range of motion is improved in flexion, extension, lateral bending, and rotation, with only mild discomfort at terminal endpoints", "decreased muscle spasm. Improved flexion and extension noted…" — these map directly to the prompt's "Emphasize improvement from baseline" directive for the cervical/lumbar sections.
- Assessment and Prognosis sections contain the required numeric framing ("clinically significant improvement following completion of PRP therapy, with measurable reduction in pain severity, improved spinal mobility, and enhanced functional capacity").

### 7. Per-section regeneration preserves the same prompt

`regenerateProcedureNoteSection` at [`generate-procedure-note.ts:326-355`](src/lib/claude/generate-procedure-note.ts#L326-L355) and `regenerateDischargeNoteSection` at [`generate-discharge-note.ts:292-321`](src/lib/claude/generate-discharge-note.ts#L292-L321) both reuse the full `SYSTEM_PROMPT` constant plus a short suffix scoping the model to a single section. This means that regenerating `objective_physical_exam` re-runs the same instruction without adding any improvement-aware guidance.

### 8. Related extraction with structured improvement data that is not wired in

[`extract-chiro.ts:118`](src/lib/claude/extract-chiro.ts#L118) defines a structured trajectory enum `['improving', 'stable', 'plateauing', 'worsening', 'null']`. This is read by `deriveChiroProgress` in [`pain-tone.ts:16-23`](src/lib/claude/pain-tone.ts#L16-L23) and passed into the procedure-note prompt as `chiroProgress` ([`generate-procedure-note.ts:70`](src/lib/claude/generate-procedure-note.ts#L70)).

The prompt references `chiroProgress` only as a "SECONDARY SIGNAL (optional)" for the `subjective` narrative ([L137-L138](src/lib/claude/generate-procedure-note.ts#L137-L138)) — it is not used in any objective/physical-exam section.

## Code References

- `src/lib/claude/generate-procedure-note.ts:105-227` — full PRP Procedure Note `SYSTEM_PROMPT`
- `src/lib/claude/generate-procedure-note.ts:128-144` — `subjective` section; four-way `paintoneLabel` branch with concrete reference examples
- `src/lib/claude/generate-procedure-note.ts:163-165` — `review_of_systems`; two-way branch on `paintoneLabel`
- `src/lib/claude/generate-procedure-note.ts:167-169` — `objective_vitals`; no `paintoneLabel` reference
- `src/lib/claude/generate-procedure-note.ts:171-173` — `objective_physical_exam`; single-sentence instruction with no `paintoneLabel`, no interval-change directive, reference example describes baseline findings
- `src/lib/claude/generate-procedure-note.ts:175-178` — `assessment_summary`; two-way branch on `paintoneLabel`
- `src/lib/claude/generate-procedure-note.ts:217-220` — `prognosis`; two-way branch on `paintoneLabel`
- `src/lib/claude/generate-procedure-note.ts:16-103` — `ProcedureNoteInputData` — exposes one `pmExtraction`, one prior-procedure pain delta, no prior physical-exam findings
- `src/actions/procedure-notes.ts:65-73` — query that selects the single most-recent approved pain-management extraction, used as the only physical-exam source
- `src/actions/procedure-notes.ts:207-217` — where `paintoneLabel` is computed and `priorProcedures` (pain scores only) is populated
- `src/lib/claude/pain-tone.ts:3-12` — `computePainToneLabel` (±2 threshold)
- `src/lib/claude/generate-discharge-note.ts:114-209` — full Discharge Note `SYSTEM_PROMPT`
- `src/lib/claude/generate-discharge-note.ts:134` — mandatory completion/improvement tone directive
- `src/lib/claude/generate-discharge-note.ts:136-152` — `=== PAIN TRAJECTORY (MANDATORY) ===` block requiring numeric delta narration
- `src/lib/claude/generate-discharge-note.ts:167-181` — every objective section (`general`, `cervical`, `lumbar`, `neurological`) instructs improvement framing
- `src/lib/claude/generate-discharge-note.ts:15-112` — `DischargeNoteInputData` — carries `baselinePain`, `initialVisitBaseline.physical_exam`, full `procedures[]` array, `overallPainTrend`
- `src/lib/claude/extract-chiro.ts:118` — structured trajectory enum, read by `deriveChiroProgress`

## Architecture Documentation

### Generator → Action → Prompt pipeline

Each clinical document type owns a single generator file under `src/lib/claude/` with:
1. An `InputData` TypeScript interface describing the shape of source data.
2. A `SYSTEM_PROMPT` string literal containing the full instructions and per-section reference examples.
3. A `Tool` definition enumerating structured-output field names for Anthropic tool-use.
4. A top-level `generate*FromData` function and a `regenerate*Section` function that re-use the same prompt.

Server actions under `src/actions/` (`procedure-notes.ts`, `discharge-notes.ts`) gather source data via parallel Supabase queries, compute derived labels (`paintoneLabel`, `overallPainTrend`, `chiroProgress`), and persist the tool result into a matching `*_notes` table. A `source_data_hash` is stored so regenerations can be detected.

### Where improvement framing is decided

For both procedure and discharge notes, improvement framing is decided **entirely inside the prompt string** via conditional branches keyed to a computed label (`paintoneLabel` / `overallPainTrend`). There is no post-processing layer that rewrites sections after generation. The granularity of "which sections get improvement framing" is therefore exactly "which sections mention the label in their instruction text."

For the Procedure Note prompt, four of twenty sections mention `paintoneLabel` (`subjective`, `review_of_systems`, `assessment_summary`, `prognosis`). The remaining sixteen — including `objective_physical_exam` and `objective_vitals` — do not.

For the Discharge Note prompt, every objective section mentions improvement framing directly, and `overallPainTrend` is additionally enforced by the dedicated `=== PAIN TRAJECTORY (MANDATORY) ===` block.

### Why repeat procedure notes can read as near-duplicates in the physical-exam section

Three compounding structural reasons:

1. **Single shared data source**: `pmExtraction.physical_exam` is the one physical-exam JSONB input, fetched via a `limit 1` query on the pain-management extractions table ([`procedure-notes.ts:65-73`](src/actions/procedure-notes.ts#L65-L73)). Session #1 and Session #2 receive the same blob.
2. **No per-procedure physical-exam capture**: the `procedures` and `vital_signs` tables carry no exam/ROM fields ([input shape at `generate-procedure-note.ts:29-62`](src/lib/claude/generate-procedure-note.ts#L29-L62)).
3. **No interval-change directive in the prompt**: section 8 says "Populate from PM extraction physical_exam JSONB" ([L172](src/lib/claude/generate-procedure-note.ts#L172)) with no "if improved…" branch analogous to the one in `subjective`.

## Related Research

- [thoughts/shared/research/2026-04-18-procedure-note-pain-persistence-tone.md](thoughts/shared/research/2026-04-18-procedure-note-pain-persistence-tone.md) — earlier research on where the "persistent symptoms" directive originates
- [thoughts/shared/plans/2026-04-18-procedure-note-pain-tone-improvements.md](thoughts/shared/plans/2026-04-18-procedure-note-pain-tone-improvements.md) — planning doc that introduced the current four-way `paintoneLabel` branching in `subjective` / `review_of_systems` / `assessment_summary` / `prognosis`
- [thoughts/shared/plans/2026-03-11-epic-4-story-4.3-generate-prp-procedure-note.md](thoughts/shared/plans/2026-03-11-epic-4-story-4.3-generate-prp-procedure-note.md) — original procedure-note generator plan
- [thoughts/shared/plans/2026-03-12-epic-5-story-5.1-generate-discharge-summary.md](thoughts/shared/plans/2026-03-12-epic-5-story-5.1-generate-discharge-summary.md) — original discharge-note generator plan

## Open Questions

1. The PRP Procedure Note prompt's `paintoneLabel` branches cover `subjective`, `review_of_systems`, `assessment_summary`, and `prognosis`, but not `objective_physical_exam` or `objective_vitals`. Documenting this asymmetry for reference — no change proposed.
2. `ProcedureNoteInputData` has no field carrying a prior procedure's physical-exam findings; `pmExtraction` is the only exam source and is shared across all procedures in a case. Documenting for reference — no change proposed.
3. The chiropractic `functional_outcomes` trajectory enum is wired into `chiroProgress` but is only referenced in the `subjective` narrative as an optional secondary signal. Documenting for reference — no change proposed.
