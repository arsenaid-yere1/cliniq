---
date: 2026-04-27T08:07:37-0700
researcher: arsenaid
git_commit: 4a6582c90e0726e1d53315144d2215d883764d0f
branch: main
repository: cliniq
topic: "Why discharge pain rate is picked up incorrectly when regenerating sections"
tags: [research, codebase, discharge-note, pain-trajectory, regenerate-section]
status: complete
last_updated: 2026-04-27
last_updated_by: arsenaid
---

# Research: Why discharge pain rate is picked up incorrectly when regenerating sections

**Date**: 2026-04-27T08:07:37-0700
**Researcher**: arsenaid
**Git Commit**: 4a6582c90e0726e1d53315144d2215d883764d0f
**Branch**: main
**Repository**: cliniq

## Research Question

Why is the discharge pain rate (provider-entered "discharge-visit pain score") picked up incorrectly when an individual section of a discharge note is regenerated?

## Summary

The full-note generation path and the per-section regeneration path both call the same source-data gatherer, `gatherDischargeNoteSourceData`, but they invoke it with **different argument sets**.

- Full generation ([src/actions/discharge-notes.ts:622-627](src/actions/discharge-notes.ts#L622-L627)) passes the `preservedVitals` payload (read off the existing `discharge_notes` row, including `pain_score_min` / `pain_score_max`) as the fourth `dischargeVitals` argument.
- Section regeneration ([src/actions/discharge-notes.ts:1061](src/actions/discharge-notes.ts#L1061)) calls the gatherer with only three arguments — `(supabase, caseId, visitDate)` — leaving the fourth parameter to default to `null`.

`gatherDischargeNoteSourceData` ([src/actions/discharge-notes.ts:37-42](src/actions/discharge-notes.ts#L37-L42)) types its `dischargeVitals` parameter as `DischargeNoteInputData['dischargeVitals'] = null`, so omission is silently coerced to `null`. The gathered `inputData.dischargeVitals` is then forwarded to `buildDischargePainTrajectory` ([src/actions/discharge-notes.ts:375-389](src/actions/discharge-notes.ts#L375-L389)).

Inside `buildDischargePainTrajectory` ([src/lib/claude/pain-trajectory.ts:154-200](src/lib/claude/pain-trajectory.ts#L154-L200)) the discharge endpoint priority order is:

1. `dischargeVitals` non-null → use those values verbatim, `estimated: false`
2. else `latestVitals` with `finalIntervalWorsened` or `overallPainTrend ∈ {stable, worsened}` → use latest procedure vitals verbatim
3. else `latestVitals` minus 2 (floored at 0) → estimated discharge endpoint
4. else null

Because regeneration drops branch (1), the trajectory builder falls through to branch (2) or (3) — i.e. it uses the most recent procedure's `pain_score_max`, optionally minus 2, instead of the provider-entered discharge pain. The regenerated section text is grounded against this wrong endpoint, and the audit columns on the row are simultaneously overwritten with the wrong values.

The mismatch is **regenerate-only**. The Pain Timeline widget's read path (`getDischargePainTimeline` at [src/actions/discharge-notes.ts:1395-1400](src/actions/discharge-notes.ts#L1395-L1400)) does pass `preservedVitals`, so the UI display matches the provider entry while the regenerated note prose does not.

## Detailed Findings

### Where discharge pain rate is captured

**Provider-entered discharge-visit pain** lives on the `discharge_notes` table, columns `pain_score_min` and `pain_score_max`. It is written by `saveDischargeVitals` ([src/actions/discharge-notes.ts:1252-1299](src/actions/discharge-notes.ts#L1252-L1299)), which validates with `dischargeNoteVitalsSchema` ([src/lib/validations/discharge-note.ts](src/lib/validations/discharge-note.ts)) and either updates the active row or creates a pre-generation draft row holding only those vitals.

**Procedure-day pain** lives on the `vital_signs` table keyed by `procedure_id`, with the same `pain_score_min` / `pain_score_max` columns ([src/actions/discharge-notes.ts:183-199](src/actions/discharge-notes.ts#L183-L199)).

**Intake (pre-procedure) pain** lives on `vital_signs` rows where `procedure_id IS NULL`, queried at [src/actions/discharge-notes.ts:145-153](src/actions/discharge-notes.ts#L145-L153) and assembled into `intakePain` at [src/actions/discharge-notes.ts:262-272](src/actions/discharge-notes.ts#L262-L272).

### The full-generation path

`generateDischargeNote` ([src/actions/discharge-notes.ts:552-847](src/actions/discharge-notes.ts#L552-L847)):

1. Reads the existing `discharge_notes` row and assembles `preservedVitals` from columns `bp_*`, `heart_rate`, `respiratory_rate`, `temperature_f`, `spo2_percent`, `pain_score_min`, `pain_score_max` ([src/actions/discharge-notes.ts:608-619](src/actions/discharge-notes.ts#L608-L619)).
2. Calls `gatherDischargeNoteSourceData(supabase, caseId, effectiveVisitDate, preservedVitals)` ([src/actions/discharge-notes.ts:622-627](src/actions/discharge-notes.ts#L622-L627)).
3. The gatherer plumbs `preservedVitals` into the trajectory builder via `dischargeVitals`, so the discharge endpoint resolves to branch (1) of the priority order — provider value verbatim, `estimated: false`.
4. The persisted row is updated with `discharge_pain_estimate_min/max`, `discharge_pain_estimated`, `pain_trajectory_text`, etc. ([src/actions/discharge-notes.ts:837-841](src/actions/discharge-notes.ts#L837-L841)).

### The section-regeneration path

`regenerateDischargeNoteSectionAction` ([src/actions/discharge-notes.ts:1037-1176](src/actions/discharge-notes.ts#L1037-L1176)):

1. Fetches the current draft note via `select('*')` — so it has the row, including `pain_score_min/max` ([src/actions/discharge-notes.ts:1049-1055](src/actions/discharge-notes.ts#L1049-L1055)).
2. Calls `gatherDischargeNoteSourceData(supabase, caseId, visitDate)` — **three args only** ([src/actions/discharge-notes.ts:1061](src/actions/discharge-notes.ts#L1061)). The fourth `dischargeVitals` parameter defaults to `null`.
3. Inside the gatherer, `dischargeVitals: null` flows straight to `buildDischargePainTrajectory(... dischargeVitals: null ...)` ([src/actions/discharge-notes.ts:382-383](src/actions/discharge-notes.ts#L382-L383)).
4. The trajectory builder skips branch (1) and selects either branch (2) verbatim-latest or branch (3) latest-minus-2-estimated based on `overallPainTrend` and `finalIntervalWorsened`.
5. The regenerated section text is sent to Claude with the (wrong) endpoint encoded in `inputData.dischargeVisitPainDisplay`, `inputData.painTrajectoryText`, `inputData.dischargeVisitPainEstimated`.
6. The note row's audit columns are overwritten with the recomputed (wrong) values: `discharge_pain_estimate_min`, `discharge_pain_estimate_max`, `discharge_pain_estimated`, `pain_trajectory_text` ([src/actions/discharge-notes.ts:1162-1168](src/actions/discharge-notes.ts#L1162-L1168)).

The validator at [src/actions/discharge-notes.ts:1148](src/actions/discharge-notes.ts#L1148) is run, but it validates the regenerated section against the trajectory built from `inputData` (which already has the wrong endpoint), so it does not catch the mismatch — both inputs are derived from the same erroneous source.

### How this surfaces in the LLM prompt

`generate-discharge-note.ts`'s prompt and tool schemas read from `DischargeNoteInputData.dischargeVisitPainDisplay`, `painTrajectoryText`, `dischargePainEstimateMin/Max`, and `dischargeVisitPainEstimated`. The reference paragraph at [src/lib/claude/generate-discharge-note.ts:425-426](src/lib/claude/generate-discharge-note.ts#L425-L426) explicitly tells the model to cite the numeric pain delta from baseline to the discharge-visit reading, defaulting to "2 points below `latestVitals.pain_score_max`" — exactly the synthesized number that surfaces when `dischargeVitals` is missing.

The regenerate path's system suffix ([src/lib/claude/generate-discharge-note.ts:548](src/lib/claude/generate-discharge-note.ts#L548)) and tool definition ([src/lib/claude/generate-discharge-note.ts:521-538](src/lib/claude/generate-discharge-note.ts#L521-L538)) are independent of the trajectory plumbing — they consume whatever `dischargeVisitPainDisplay` is on `inputData`, so the prompt itself has no special-case handling for regenerate.

### Read paths that DO preserve the value

`getDischargePainTimeline` ([src/actions/discharge-notes.ts:1355-1432](src/actions/discharge-notes.ts#L1355-L1432)) — the read used by the Pain Timeline widget on the discharge editor — explicitly assembles `preservedVitals` from the existing row ([src/actions/discharge-notes.ts:1382-1393](src/actions/discharge-notes.ts#L1382-L1393)) and passes it as the fourth argument to `gatherDischargeNoteSourceData` ([src/actions/discharge-notes.ts:1395-1400](src/actions/discharge-notes.ts#L1395-L1400)). The widget therefore renders the provider-entered discharge pain correctly even when, on the same row, the persisted `pain_trajectory_text` and the regenerated section prose have been overwritten with the latest-minus-2 fabrication.

### Database schema reference

The `discharge_notes` columns involved:

- `pain_score_min`, `pain_score_max` — provider-entered discharge-visit pain (mirrors `vital_signs` shape).
- `discharge_pain_estimate_min`, `discharge_pain_estimate_max` — endpoint computed by `buildDischargePainTrajectory` and persisted for audit.
- `discharge_pain_estimated` — boolean indicating whether the endpoint was synthesized via the -2 rule (true) or read verbatim (false).
- `pain_trajectory_text` — arrow-chain string persisted alongside the note.

Migrations: [supabase/migrations/20260421_discharge_notes_vitals.sql](supabase/migrations/20260421_discharge_notes_vitals.sql), [supabase/migrations/20260426_discharge_notes_pain_trajectory.sql](supabase/migrations/20260426_discharge_notes_pain_trajectory.sql), [supabase/migrations/028_vital_signs_pain_score.sql](supabase/migrations/028_vital_signs_pain_score.sql), [supabase/migrations/20260427_vital_signs_pain_score_semantics.sql](supabase/migrations/20260427_vital_signs_pain_score_semantics.sql).

## Code References

- `src/actions/discharge-notes.ts:37-42` — `gatherDischargeNoteSourceData` signature; `dischargeVitals` param defaults to `null`
- `src/actions/discharge-notes.ts:608-627` — Full-generation path: builds `preservedVitals` and passes it as 4th arg
- `src/actions/discharge-notes.ts:1037-1062` — `regenerateDischargeNoteSectionAction` entry; **calls gatherer with only 3 args at line 1061**
- `src/actions/discharge-notes.ts:1162-1168` — Regenerate persists recomputed audit columns back to the row
- `src/actions/discharge-notes.ts:1355-1400` — `getDischargePainTimeline` read path: passes `preservedVitals` correctly
- `src/lib/claude/pain-trajectory.ts:154-200` — `buildDischargePainTrajectory` endpoint priority: dischargeVitals → latestVitals (suppression) → latest-minus-2
- `src/lib/claude/pain-trajectory.ts:62` — `BuildTrajectoryInput.dischargeVitals` typing
- `src/lib/claude/generate-discharge-note.ts:425-426` — Prompt reference paragraph naming the -2 rule
- `src/lib/claude/generate-discharge-note.ts:521-569` — `regenerate_section` tool definition and `regenerateDischargeNoteSection` Claude call
- `src/components/discharge/discharge-note-editor.tsx:532-537` — Client-side `regenerateDischargeNoteSectionAction` invocation

## Architecture Documentation

Discharge note generation has two write paths and one read path that all consume the same source-data gatherer:

- **Write — full generate** (`generateDischargeNote`): assembles `preservedVitals` from `discharge_notes` and threads them as `dischargeVitals` into `buildDischargePainTrajectory`.
- **Write — section regenerate** (`regenerateDischargeNoteSectionAction`): invokes the gatherer without `preservedVitals`, so `dischargeVitals` resolves to `null`.
- **Read — pain timeline widget** (`getDischargePainTimeline`): assembles `preservedVitals` from `discharge_notes` and threads them in.

The trajectory builder is pure and deterministic. Its endpoint resolution is fully controlled by which of `dischargeVitals` / `latestVitals` / `overallPainTrend` / `finalIntervalWorsened` the caller supplies. There is no hidden DB read inside the builder that would recover the missing value.

The `regenerate_section` tool used at [src/lib/claude/generate-discharge-note.ts:521-538](src/lib/claude/generate-discharge-note.ts#L521-L538) takes the same `inputData` payload as full generation, so anything the caller plumbs (or fails to plumb) in `inputData.dischargeVisitPainDisplay` etc. drives the LLM's pain numerics.

The same discharge-note generation pattern is mirrored in `procedure-notes.ts` (regenerate at [src/actions/procedure-notes.ts:1017-1056](src/actions/procedure-notes.ts#L1017-L1056)) and `initial-visit-notes.ts` (regenerate at [src/actions/initial-visit-notes.ts:798-869](src/actions/initial-visit-notes.ts#L798-L869)). Those flows do not have an analog of `dischargeVitals` (no provider-entered "today's pain" input separate from procedure vitals), so the equivalent regression does not apply there.

## Related Research

- [thoughts/shared/research/2026-04-21-discharge-pain-timeline-precision.md](thoughts/shared/research/2026-04-21-discharge-pain-timeline-precision.md) — Phase 1 design that moved the arrow-chain assembly and -2 rule from the LLM prompt into TypeScript via `buildDischargePainTrajectory`.
- [thoughts/shared/plans/2026-04-21-discharge-pain-timeline-phase1.md](thoughts/shared/plans/2026-04-21-discharge-pain-timeline-phase1.md) — Implementation plan for the deterministic trajectory builder.
- [thoughts/shared/research/2026-04-19-tone-direction-for-procedure-and-discharge-notes.md](thoughts/shared/research/2026-04-19-tone-direction-for-procedure-and-discharge-notes.md) — Background on the shared regenerate wiring for tone hint and visit date.

## Open Questions

- Whether `getDischargePainTimeline` and `regenerateDischargeNoteSectionAction` should share a single helper that derives `preservedVitals` from the `discharge_notes` row, since both already perform the same lookup (the regenerate action selects the row at line 1049 but never extracts the vitals into the `dischargeVitals` shape).
- Whether the validator at `validateDischargeTrajectoryConsistency` could detect the regenerate-vs-row mismatch by comparing `inputData.dischargeVisitPainDisplay` against the row's `pain_score_min/max` independently of the trajectory build.
