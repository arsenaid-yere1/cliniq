---
date: 2026-04-21T11:58:39-07:00
researcher: arsenaid
git_commit: 4f83eb01abede075f3e5df13d6d8a2c98cea9684
branch: main
repository: cliniq
topic: "Pain-score timeline precision in Discharge notes"
tags: [research, discharge-notes, pain-tone, pain-timeline, claude-prompt, clinical]
status: complete
last_updated: 2026-04-21
last_updated_by: arsenaid
---

# Research: Pain-score timeline precision in Discharge notes — recommendations for improvements

**Date**: 2026-04-21T11:58:39-07:00
**Researcher**: arsenaid
**Git Commit**: 4f83eb01abede075f3e5df13d6d8a2c98cea9684
**Branch**: main
**Repository**: cliniq

## Research Question

Recommend improvements for the Pain-score timeline in Discharge notes, which can be imprecise.

---

## Summary

Discharge pain-timeline rendering leans on **one structured anchor per procedure** ([vital_signs.pain_score_min/max](supabase/migrations/028_vital_signs_pain_score.sql)), a **`latest − 2` prompt-level fabrication rule** for the discharge-visit endpoint, plus three derived tone signals (`vsBaseline`, `vsPrevious`, `seriesVolatility`) computed in [discharge-notes.ts:269-292](src/actions/discharge-notes.ts#L269-L292) from the first + last + penultimate + full series. The LLM then renders an arrow-chain prose summary by hand from the JSON payload ([generate-discharge-note.ts:184](src/lib/claude/generate-discharge-note.ts#L184)).

Five mechanical sources of imprecision exist:

1. **Single-reading-per-procedure** captured pre-injection; no post-procedure reading, no distinction between at-rest / with-activity / worst / best.
2. **`−2` fabrication rule** is uniform, ungrounded, and explicitly overrides the "don't invent pain numbers" rule.
3. **LLM assembles the arrow-chain in prose** from JSON — no structured, validated timeline string.
4. **Parallel pain data from PT, PM, and chiro extractions is ignored** by discharge generation even though the fields exist and are populated.
5. **Tone thresholds are step-functions** (≥3 = improved; ≥+2 = worsened; else stable), so a 2-point clinically-meaningful drop on NRS reads as "stable" in narrative.

Ten ranked recommendations appear at the bottom.

---

## Detailed Findings

### 1. Data model — what is actually stored

| Table | Pain columns | Constraint | Source |
|---|---|---|---|
| `vital_signs` | `pain_score_min`, `pain_score_max` | `0..10`, nullable, no default | [028_vital_signs_pain_score.sql](supabase/migrations/028_vital_signs_pain_score.sql) |
| `discharge_notes` | `pain_score_min`, `pain_score_max` | `0..10`, nullable, no default | [20260421_discharge_notes_vitals.sql:14-15](supabase/migrations/20260421_discharge_notes_vitals.sql#L14-L15) |
| `pt_extractions` | `pain_ratings` JSONB (`at_rest`, `with_activity`, `worst`, `best`) | nullable numbers | [012_pt_extractions.sql](supabase/migrations/012_pt_extractions.sql) |
| `pain_management_extractions` | `chief_complaints[].pain_rating_min/max` | per complaint | [011_pain_management_extractions.sql](supabase/migrations/011_pain_management_extractions.sql) |
| `chiro_extractions` | `functional_outcomes.pain_levels[]` (date, scale, score, max_score, context) | array | [extract-chiro.ts](src/lib/claude/extract-chiro.ts) |
| `case_summaries` | `symptoms_timeline.pain_levels[]` | array | [generate-summary.ts](src/lib/claude/generate-summary.ts) |

Only `vital_signs` and `discharge_notes` feed the discharge-note generator.

Neither `vital_signs` nor `discharge_notes` store:
- time-of-day of reading,
- context (at-rest / with-activity / worst-24h / current),
- pre- vs. post-procedure reading flag,
- confidence / verbal-vs-numeric source flag.

### 2. Timeline assembly — [discharge-notes.ts:141-292](src/actions/discharge-notes.ts#L141-L292)

- All `vital_signs` rows for the case fetched in one batched query keyed on `procedure_id` ([141-165](src/actions/discharge-notes.ts#L141-L165)).
- `procedures[]` built in ascending `procedure_date` order, each entry stamped with `pain_score_min/max` or `null` when the vitals row is missing ([167-181](src/actions/discharge-notes.ts#L167-L181)).
- `latestVitals` = last procedure's vitals row (= **pre-final-injection** reading, not post-injection, not discharge-visit).
- `baselinePain` = first procedure's vitals row (= pre-first-injection reading, **not** intake reading).
- `initialVisitBaseline.chief_complaint` = free-text narrative from the intake note; prompt tells LLM to scrape a pain descriptor from it when `baselinePain` is missing.
- `painTrendSignals.vsBaseline` = `computePainToneLabel(last, first, context)` — 5-way label.
- `painTrendSignals.vsPrevious` = `computePainToneLabel(last, prev, context)` where `prev` is found by a **backward walk** from index `length-2` skipping nulls ([248-267](src/actions/discharge-notes.ts#L248-L267)).
- `seriesVolatility` = `computeSeriesVolatility(procedures.map(p => p.pain_score_max))` — any null collapses to `'insufficient_data'` ([290-292](src/actions/discharge-notes.ts#L290-L292)).
- `overallPainTrend` = `vsBaseline` with `'missing_vitals'` folded to `'baseline'` ([321-323](src/actions/discharge-notes.ts#L321-L323)).

### 3. Tone computation — [pain-tone.ts:44-55](src/lib/claude/pain-tone.ts#L44-L55)

```ts
if (context === 'prior_missing_vitals') return 'missing_vitals'
if (currentPainMax == null || referencePainMax == null) return 'baseline'
const delta = currentPainMax - referencePainMax
if (delta <= -3) return 'improved'
if (delta >= 2) return 'worsened'
return 'stable'
```

Asymmetric on purpose (≥3 drop = improved; ≥+2 rise = worsened). Documented reason: a 2-point drop on high-severity baseline (9→7) "still leaves the patient in moderate-severe pain." Effect: a 7→5 or 5→3 drop (2 points; MCID on NRS ≈ 2) is classified **stable**.

`computeSeriesVolatility` ([102-128](src/lib/claude/pain-tone.ts#L102-L128)) returns `insufficient_data` on *any* null — no partial-window analysis.

### 4. Prompt rendering — [generate-discharge-note.ts:145-350](src/lib/claude/generate-discharge-note.ts#L145-L350)

The LLM receives `JSON.stringify(inputData, null, 2)` as the user message ([396](src/lib/claude/generate-discharge-note.ts#L396)). It must:
- Render an arrow chain like `"8/10 → 6/10 → 4/10 → 3/10 across the injection series, and has further improved to 1/10 at today's discharge evaluation"` ([184](src/lib/claude/generate-discharge-note.ts#L184)).
- Apply the **−2 default rule** ([183](src/lib/claude/generate-discharge-note.ts#L183)): "render a discharge-visit pain reading that is **2 points BELOW** `latestVitals.pain_score_max` by default, floored at 0. A 1-point drop is ONLY permitted when a 2-point drop would go below 0…"
- Respect 7 interacting override blocks: `dischargeVitals` priority, baseline data-gap override, pain-tone matrix (10 rows), series-volatility, final-interval regression override, provider tone hint, stable/worsened no-fabrication.

Assembly of the arrow chain and the floor math are entirely LLM-executed; nothing in the pipeline validates the numbers in the output prose match the structured inputs.

### 5. Editor + finalize gate — [discharge-note-editor.tsx:516, 824-835, 860-898](src/components/discharge/discharge-note-editor.tsx)

- Finalize button blocked when `discharge_notes.pain_score_max == null` ([516](src/components/discharge/discharge-note-editor.tsx#L516)).
- `DischargeVitalsCard` seeds from `note > defaultVitals > null` where `defaultVitals` = last procedure's vitals ([824-835](src/components/discharge/discharge-note-editor.tsx#L824-L835)).
- After generation, all 12 sections are plain `<Textarea>` ([606-610](src/components/discharge/discharge-note-editor.tsx#L606-L610)); no structured pain-timeline widget, no cross-section numeric consistency check.
- Finalized view renders sections as `whitespace-pre-wrap` paragraphs ([772](src/components/discharge/discharge-note-editor.tsx#L772)).

### 6. Parallel pain data NOT wired into discharge generation

`DischargeNoteInputData` includes `ptExtraction`, `pmExtraction`, `chiroExtraction`, `caseSummary` — but their **pain-specific fields** are stripped during gathering:
- `ptExtraction.outcome_measures` passed as opaque JSONB, not decomposed into the `pain_ratings` four-tuple ([pt-extraction.ts](src/lib/validations/pt-extraction.ts)).
- `pmExtraction.chief_complaints[].pain_rating_min/max` passed as opaque JSONB; LLM is not told these exist as per-complaint pain ratings.
- `chiroExtraction.functional_outcomes` passed opaque; no pain_levels timeline surfaced.

The LLM therefore builds its arrow chain only from the `procedures[]` list, even when PT notes contain intermediate readings taken *between* injections.

---

## Code References

- [src/actions/discharge-notes.ts:56-61](src/actions/discharge-notes.ts#L56-L61) — procedures query (ascending by date)
- [src/actions/discharge-notes.ts:141-165](src/actions/discharge-notes.ts#L141-L165) — batched vitals fetch
- [src/actions/discharge-notes.ts:167-181](src/actions/discharge-notes.ts#L167-L181) — per-procedure entry assembly (null passthrough)
- [src/actions/discharge-notes.ts:199-208](src/actions/discharge-notes.ts#L199-L208) — baselinePain = first procedure
- [src/actions/discharge-notes.ts:225-282](src/actions/discharge-notes.ts#L225-L282) — tone-signal computation + backward walk
- [src/actions/discharge-notes.ts:290-292](src/actions/discharge-notes.ts#L290-L292) — seriesVolatility (any-null → insufficient)
- [src/actions/discharge-notes.ts:321-323](src/actions/discharge-notes.ts#L321-L323) — overallPainTrend folding
- [src/lib/claude/pain-tone.ts:44-55](src/lib/claude/pain-tone.ts#L44-L55) — thresholds (≤-3 / ≥+2 / stable)
- [src/lib/claude/pain-tone.ts:102-128](src/lib/claude/pain-tone.ts#L102-L128) — volatility classification
- [src/lib/claude/generate-discharge-note.ts:168-233](src/lib/claude/generate-discharge-note.ts#L168-L233) — PAIN TRAJECTORY + BASELINE GAP + TONE MATRIX prompt blocks
- [src/lib/claude/generate-discharge-note.ts:396](src/lib/claude/generate-discharge-note.ts#L396) — user message = raw JSON stringify
- [src/components/discharge/discharge-note-editor.tsx:516](src/components/discharge/discharge-note-editor.tsx#L516) — finalize gate on pain_score_max
- [src/components/discharge/discharge-note-editor.tsx:824-835](src/components/discharge/discharge-note-editor.tsx#L824-L835) — vitals seed precedence
- [supabase/migrations/028_vital_signs_pain_score.sql](supabase/migrations/028_vital_signs_pain_score.sql) — vital_signs pain columns
- [supabase/migrations/20260421_discharge_notes_vitals.sql](supabase/migrations/20260421_discharge_notes_vitals.sql) — discharge vitals columns

---

## Imprecision Root Causes — ranked

| # | Cause | Blast radius | Where it lives |
|---|---|---|---|
| 1 | `−2` fabrication rule for discharge-visit reading | EVERY discharge note without `dischargeVitals` | Prompt only ([generate-discharge-note.ts:183](src/lib/claude/generate-discharge-note.ts#L183)) |
| 2 | LLM manually assembles the arrow-chain prose from JSON | All multi-procedure discharge notes | Prompt only ([generate-discharge-note.ts:184](src/lib/claude/generate-discharge-note.ts#L184)) |
| 3 | Single reading per procedure, context-free (no at-rest / with-activity / pre-post) | All procedures | DB schema ([028_vital_signs_pain_score.sql](supabase/migrations/028_vital_signs_pain_score.sql)) |
| 4 | PT / PM / chiro pain timelines not surfaced as structured inputs | Any case with intermediate PT/PM/chiro readings | `gatherDischargeNoteSourceData` ([discharge-notes.ts:38-116](src/actions/discharge-notes.ts#L38-L116)) |
| 5 | `seriesVolatility` collapses to `insufficient_data` on any null | Any case with a missed vitals row | [pain-tone.ts:106](src/lib/claude/pain-tone.ts#L106) |
| 6 | Tone thresholds snap a 2-point drop to `stable` (swallows MCID) | Mid-severity improvers (7→5, 5→3) | [pain-tone.ts:52-54](src/lib/claude/pain-tone.ts#L52-L54) |
| 7 | `baselinePain = first procedure pain`, not intake pain | Cases where intake pain differs materially from pre-first-procedure | [discharge-notes.ts:199-208](src/actions/discharge-notes.ts#L199-L208) |
| 8 | No time-axis / interval spacing passed to LLM | Long-gap series | `DischargeNoteInputData` ([generate-discharge-note.ts:30-39](src/lib/claude/generate-discharge-note.ts#L30-L39)) |
| 9 | Discharge reading never persisted as structured numeric field when fabricated | All `−2`-rule cases | Data model + generator return shape |
| 10 | No cross-section numeric consistency check after LLM output | All notes | No validator exists |

---

## Recommendations — ranked

### R1 — Deterministically compute the arrow-chain + discharge endpoint in TS, not prompt
**Problem:** #1, #2, #9. **Change:** In `gatherDischargeNoteSourceData`, build `painTimeline: Array<{ date, label, min, max, kind: 'procedure' | 'discharge' }>` and a `painTrajectoryText` string (e.g. `"8/10 → 6/10 → 4/10 → 3/10 at procedures, 1/10 at discharge"`) in TypeScript. Compute the `−2` floor-at-0 math in TS, not in prompt. Pass both into `DischargeNoteInputData` and instruct the LLM to **use `painTrajectoryText` verbatim** in subjective/assessment/prognosis. Persist the computed `discharge_pain_estimate` in `discharge_notes` as a new structured column so the value survives edits. Removes the biggest class of LLM arithmetic error.
**Files:** [discharge-notes.ts:167-292](src/actions/discharge-notes.ts#L167-L292), [generate-discharge-note.ts:168-191](src/lib/claude/generate-discharge-note.ts#L168-L191), new migration.

### R2 — Replace the uniform `−2` rule with an evidence-aware estimate or REQUIRE provider entry
**Problem:** #1. **Option A (safer):** Make `dischargeVitals.pain_score_max` **required** at finalize (already blocks on null at [editor:516](src/components/discharge/discharge-note-editor.tsx#L516); extend to make the field mandatory at note-generation time, not just finalize — so the LLM never has to fabricate). **Option B (intermediate):** Replace flat `−2` with `max(0, latestMax − clamp(latestMax * 0.3, 1, 2))` or a table (`10→8`, `7→5`, `3→1`, `1→0`) and document evidence basis. **Option C:** Gate the fabrication on a confidence flag (e.g. require provider to tick "estimate per standard post-PRP improvement" at generation). Current approach is a defensibility liability in deposition because the prompt literally says "the ONE exception to the don't invent numbers rule."
**Files:** [generate-discharge-note.ts:183-188](src/lib/claude/generate-discharge-note.ts#L183-L188), [discharge-note-editor.tsx:516](src/components/discharge/discharge-note-editor.tsx#L516).

### R3 — Tighten tone thresholds to clinical MCID; reduce step-function narrative flattening
**Problem:** #6. **Change:** In [pain-tone.ts:44-55](src/lib/claude/pain-tone.ts#L44-L55), split `improved` into `minimally_improved` (≤-2) and `improved` (≤-4 or ≥30% reduction); extend the tone matrix rows accordingly. MCID on NRS = 2 points (or 30%) — current ≤-3 threshold treats MCID-level improvement as "stable" and loses narrative credit for real gains. Update the 10-row matrix block in the prompt ([generate-discharge-note.ts:218-229](src/lib/claude/generate-discharge-note.ts#L218-L229)).
**Files:** [pain-tone.ts:44-55](src/lib/claude/pain-tone.ts#L44-L55), [generate-discharge-note.ts:218-229](src/lib/claude/generate-discharge-note.ts#L218-L229).

### R4 — Capture reading **context** on every pain entry  *(RESOLVED by convention, not implementation — 2026-04-21)*
**Problem:** #3. **Resolution:** rather than add enum columns, the clinic locked a single convention: every NRS pain reading is the patient's CURRENT pain at time of vitals capture during the encounter. Phase semantic (pre-injection vs follow-up vs intake) is encoded by the table + relationship: procedure-linked `vital_signs` rows are pre-injection by the record-procedure dialog label (see migration `20260427_vital_signs_pain_score_semantics.sql`); non-procedure `vital_signs` rows are intake; `discharge_notes` pain columns are the discharge follow-up reading. PT/PM/chiro sidecar observations continue to carry their own at-rest / with-activity / worst / best labels because those sources natively distinguish them. The discharge-note prompt includes a PAIN CONTEXT CONVENTION block forbidding the LLM from inventing "at rest" or "with activity" qualifiers on non-sidecar readings.

### R5 — Allow two readings per procedure: pre- and post-injection
**Problem:** #3. **Migration:** `vital_signs_post_procedure` linked 1:1 to `procedures` (or add `pain_score_min_post`, `pain_score_max_post` columns to `vital_signs`). Gives the timeline a proper same-day delta and removes the need for the `−2` fabrication because the last measured post-procedure reading becomes the last real data point. Likely obsoletes R2 entirely.
**Files:** new migration, [record-procedure-dialog.tsx](src/components/procedures/record-procedure-dialog.tsx), [discharge-notes.ts:167-181](src/actions/discharge-notes.ts#L167-L181).

### R6 — Fold PT / PM / chiro intermediate pain readings into the discharge timeline
**Problem:** #4. **Change:** Extend `gatherDischargeNoteSourceData` ([discharge-notes.ts:38-116](src/actions/discharge-notes.ts#L38-L116)) to merge:
- `pt_extractions.pain_ratings` (at-rest/with-activity/worst/best) stamped with the PT report date,
- `pain_management_extractions.chief_complaints[].pain_rating_min/max` stamped with PM report date,
- `chiro_extractions.functional_outcomes.pain_levels[]` entries.

Into a unified chronological `painObservations[]` array passed separately from `procedures[]`, with `source` tags. The LLM then has real inter-injection data instead of interpolating. Structured timeline widget (R10) becomes more informative too.

### R7 — Replace `insufficient_data` collapse with gap-aware volatility
**Problem:** #5. **Change:** In [pain-tone.ts:102-128](src/lib/claude/pain-tone.ts#L102-L128), scan with null-skipping. Return `mixed_with_regression` if any non-null → non-null delta is ≥+2, `monotone_*` based on surviving deltas, `insufficient_data` only when fewer than 2 non-null entries exist. One missed vitals row shouldn't erase the volatility signal for a 6-procedure series.

### R8 — Decouple `baselinePain` from first-procedure vitals
**Problem:** #7. **Change:** Introduce a distinct `intakePain` derived from `initial_visit_notes` vitals (that table has intake `pain_score_min/max` — [initial-visit-note.ts](src/lib/validations/initial-visit-note.ts)) and pass BOTH `intakePain` and `firstProcedurePain` to the LLM. Prompt language already conflates "initial evaluation" with "first procedure" (see [generate-discharge-note.ts:184, 276](src/lib/claude/generate-discharge-note.ts#L184) which talks about "initial evaluation" while using first-procedure vitals). Two anchors, two narratives, zero conflation.

### R9 — Add a time-axis annotation to the timeline
**Problem:** #8. **Change:** When R1 builds `painTrajectoryText`, include interval labels:
`"8/10 (day 0) → 6/10 (day 14) → 4/10 (day 35) → 3/10 (day 56), 1/10 at discharge follow-up (day 70)"`.
Gives the LLM and reviewing reader calibrated pacing, and lets prognosis language condition on "rapid" vs "gradual" improvement honestly.

### R10 — Render a structured pain-timeline widget in the editor
**Problem:** #10 + UX. **Change:** Replace raw `<Textarea>` for subjective/objective_vitals/assessment/prognosis with a read-only **Pain Timeline panel** above the textareas, rendering the deterministic `painTimeline[]` from R1 as a mini-chart or table. Add a post-generation validator that parses the LLM's arrow-chain out of `subjective`/`assessment`/`prognosis` and flags any mismatch with the structured timeline (toast a warning on save). Catches LLM drift in edits.
**Files:** [discharge-note-editor.tsx:562-619](src/components/discharge/discharge-note-editor.tsx#L562-L619).

---

## Suggested sequencing

Phase 1 (defensibility — biggest risk reduction, smallest change):
R1 + R2-Option-A (make discharge vitals required) + R10-validator.

Phase 2 (signal quality):
R3 + R7 + R8.

Phase 3 (data capture):
R4 + R5 + R6 + R9.

Phase 1 alone removes the `−2` fabrication risk and prevents LLM arithmetic errors in the arrow chain without any migration.

---

## Related Research

- [thoughts/shared/plans/2026-04-20-discharge-trajectory-hardening.md](thoughts/shared/plans/2026-04-20-discharge-trajectory-hardening.md) — hardening the −2 rule + trajectory
- [thoughts/shared/plans/2026-04-20-pain-tone-data-completeness.md](thoughts/shared/plans/2026-04-20-pain-tone-data-completeness.md) — missing pain_score_max handling
- [thoughts/shared/plans/2026-04-20-pain-tone-previous-and-baseline.md](thoughts/shared/plans/2026-04-20-pain-tone-previous-and-baseline.md) — baseline vs previous anchor logic
- [thoughts/shared/plans/2026-04-20-intake-pain-handoff.md](thoughts/shared/plans/2026-04-20-intake-pain-handoff.md) — intake pain handoff (direct predecessor to R8)
- [thoughts/shared/research/2026-04-19-tone-direction-for-procedure-and-discharge-notes.md](thoughts/shared/research/2026-04-19-tone-direction-for-procedure-and-discharge-notes.md) — tone direction research
- [thoughts/shared/research/2026-04-18-procedure-note-pain-persistence-tone.md](thoughts/shared/research/2026-04-18-procedure-note-pain-persistence-tone.md) — pain persistence tone

## Open Questions

- Is `dischargeVitals.pain_score_max` reliably captured in practice today, or is the `−2` path the common case? (Usage data would pick between R2-A and R2-B.)
- Is there clinical agreement that a post-PRP 2-point drop between final injection and follow-up is reproducible enough to defend in deposition, or is it clinic-custom? (Governs whether R2-B can keep any fabrication at all.)
- Do PT / PM / chiro reports in practice contain pain readings during the PRP series, or only pre-treatment? (Determines payoff of R6.)
