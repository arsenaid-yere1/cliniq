---
date: 2026-04-21
author: arsenaid
status: in-progress
topic: Discharge pain-timeline precision — Phase 3a (R9 + R6)
depends_on:
  - thoughts/shared/research/2026-04-21-discharge-pain-timeline-precision.md
  - thoughts/shared/plans/2026-04-21-discharge-pain-timeline-phase1.md
tags: [plan, discharge-notes, pain-timeline, time-axis, extraction-merge]
---

# Plan: Discharge pain-timeline precision — Phase 3a

## Goal

Raise the signal density of the discharge pain timeline without new migrations or form changes. Two independent sub-goals:

1. **R9** — annotate the arrow-chain with time-axis labels so pacing is visible.
2. **R6** — merge PT, PM, and chiro report pain observations into the timeline as read-only annotations, so intermediate readings captured in rehab notes surface alongside injection-visit pain.

## Non-goals

Deferred to later phases:
- **R4** (pain_context + pain_reading_phase enums) — requires migration + forms.
- **R5** (post-procedure pain capture) — requires migration + forms.
- **R10-widget** (structured pain timeline UI panel) — requires UX design.

## Scope — R9

### What

The current arrow-chain looks like:

```
8/10 at initial evaluation, 7/10 → 4/10 across the injection series, 2/10 at today's discharge evaluation
```

With R9 it becomes:

```
8/10 at initial evaluation (day 0), 7/10 → 4/10 across the injection series (day 14 → day 42), 2/10 at today's discharge evaluation (day 56)
```

"Day N" = integer days since the earliest anchor date (intake if present, else first-procedure, else null). When no anchor date is derivable, the segment is rendered without a day label (graceful degrade).

### How

- Add a helper `computeDayOffsets(entries, anchorDate)` in `pain-trajectory.ts` that returns each entry annotated with `dayOffset: number | null`.
- Pick anchor date:
  - Intake entry date when present.
  - Otherwise the first procedure date.
  - Otherwise null (no time-axis — arrow chain renders as today without day labels).
- Extend arrow-chain rendering to interleave `(day N)` per segment:
  - Single-entry segments (intake, discharge) get a trailing `(day N)`.
  - Multi-entry procedure segments get `(day N → day M)` for their start/end days when 2+ entries.
- Days computed from ISO date strings (truncate times, UTC-safe).

### Tests

- empty trajectory → no day labels.
- intake + 2 procs + discharge → correct offsets.
- intake null but procedure dates present → anchor = first procedure (day 0 on procedure 1).
- only discharge entry → no day label (no anchor date).
- procedures list ascending, intake before first proc, discharge date unknown → procedure days from intake.
- malformed date string → dayOffset null, no crash.

## Scope — R6

### What

Surface intermediate pain observations from PT, PM, and chiro extractions to the LLM as a structured sidecar array. The LLM can weave them into the subjective narrative ("between procedures 2 and 3 the PT note reports pain levels of 5/10 at rest and 7/10 with activity") but they do NOT alter the deterministic arrow chain.

### How

`gatherDischargeNoteSourceData` already fetches `ptRes`, `pmRes`, `chiroRes`, `caseSummaryRes`. Extract pain observations from each:

- **PT** — `ptRes.data.outcome_measures` contains a `pain_ratings` object with `at_rest`, `with_activity`, `worst`, `best` (per `src/lib/validations/pt-extraction.ts`). The PT extraction does NOT have a per-report date on that field — use the extraction `created_at` timestamp as the date.
- **PM** — `pmRes.data.chief_complaints[].pain_rating_min/max` per complaint. Date = PM extraction `created_at`.
- **Chiro** — `chiroRes.data.functional_outcomes.pain_levels[]` already carries `{ date, scale, score, max_score, context }` per entry — use those directly.
- **Case summary** — `caseSummaryRes.data.symptoms_timeline.pain_levels[]` if structured. Skip when free-text.

Normalize each into a `PainObservation`:

```ts
interface PainObservation {
  date: string | null        // ISO yyyy-mm-dd or ISO datetime
  source: 'pt' | 'pm' | 'chiro' | 'case_summary'
  label: string              // e.g. "PT at rest", "PM chief complaint: cervical", "chiro cervical"
  min: number | null
  max: number | null
  scale: 'nrs10' | 'vas100' | 'other'   // keep raw number + explicit scale
  context: string | null     // original annotation string from source
}
```

Add `painObservations: PainObservation[]` to `DischargeNoteInputData` chronologically ordered. The LLM receives this as a sidecar and is instructed:
- These are **supplementary** observations — use them to enrich narrative color, not to override the deterministic arrow chain.
- Do NOT substitute a PT number for a procedure number in the subjective pain-progression sentence.
- May cite in the subjective second paragraph ("rehabilitation records between sessions documented pain of X/10 at rest and Y/10 with activity") when at least two observations exist.
- Must preserve scale labels when citing (e.g. "X/10 NRS" or "X/100 VAS"), never convert silently.

### Tests

- Empty extractions → `painObservations = []`.
- PT only with `at_rest = 5`, `with_activity = 7` → two entries or one combined entry? **Decision:** one entry with min=5, max=7, label="PT" for brevity.
- PM with 2 complaints with distinct ratings → 2 entries, labels include complaint site.
- Chiro with 3 pain_levels entries → 3 entries, dates preserved.
- Mixed: PT + PM + chiro → merged + sorted by date ascending.
- Date-normalization: entries without dates go at the END (stable sort) so date-bearing entries lead.

## Prompt changes

1. Replace the existing arrow-chain instruction in `generate-discharge-note.ts` with the R9-extended format (include day labels when present).
2. Add a new `=== SUPPLEMENTARY PAIN OBSERVATIONS (CONDITIONAL) ===` block that:
   - Describes the `painObservations` sidecar.
   - Explicitly forbids using them to override the deterministic arrow chain.
   - Grants permission to cite them in the subjective second paragraph.

## Persistence

No new DB columns. `pain_trajectory_text` already persisted; it will carry the R9-extended format automatically.

## Risk / Rollback

- R9 is additive in the output string. When the anchor date is null, it degrades to pre-R9 behavior. Low risk.
- R6 is a sidecar input. LLM can ignore it and behavior matches current. Low risk.

## Success criteria

- Generated arrow chains include `(day N)` annotations when an anchor date is derivable.
- `raw_ai_response` diagnostics include the `painObservations` count.
- Existing discharge-note tests still pass.
- New tests pass.

## Task breakdown

1. R9 `computeDayOffsets` + arrow chain formatting + tests.
2. R6 `painObservations` extractor + tests + sidecar wiring.
3. Prompt updates.
4. Typecheck + vitest.
5. Commit + push.
