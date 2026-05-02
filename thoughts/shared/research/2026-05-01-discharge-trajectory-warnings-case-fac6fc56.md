---
date: 2026-05-01T16:53:05-0700
researcher: arsenaid
git_commit: 362c7725fb2df7acaa910b631d78c286628e8b30
branch: main
repository: cliniq
topic: "Discharge trajectory_warnings flagged for case fac6fc56-681e-4aba-ac68-bdb819102e27 — pain 5/10 not on chain 2-5 → 4-5 → 3-5 → 3-5"
tags: [research, codebase, discharge, pain-trajectory, qc-review, raw-ai-response]
status: complete
last_updated: 2026-05-01
last_updated_by: arsenaid
---

# Research: Discharge trajectory_warnings flagged for case fac6fc56-681e-4aba-ac68-bdb819102e27

**Date**: 2026-05-01T16:53:05-0700
**Researcher**: arsenaid
**Git Commit**: 362c7725fb2df7acaa910b631d78c286628e8b30
**Branch**: main
**Repository**: cliniq

## Research Question
Help find this issue for case ID `fac6fc56-681e-4aba-ac68-bdb819102e27`: discharge subjective contains a pain value (`5/10`) that is not part of the deterministic trajectory chain (`2-5 → 4-5 → 3-5 → 3-5`). This was flagged in `raw_ai_response.trajectory_warnings` and must be reconciled before finalization.

## Summary

The warning originates from a deterministic post-generation validator in [src/lib/claude/pain-trajectory-validator.ts](src/lib/claude/pain-trajectory-validator.ts). It runs after every discharge note generation and section regen, scans the four "trajectory sections" (`subjective`, `objective_vitals`, `assessment`, `prognosis`) for any `\d{1,2}(?:-\d{1,2})?/10` substring, and flags every reading that is not in the set of expected values built from the TS-assembled `DischargePainTrajectory`.

For this case, the expected set comes from the four procedure entries `2-5`, `4-5`, `3-5`, `3-5` (plus whatever `baselineDisplay` and `dischargeDisplay` resolve to). A flat `5/10` is not in that set — `5` matches no entry. Either:

1. The LLM emitted a stray `5/10` in the subjective when it should have rendered a range (`2-5`, `4-5`, `3-5`) verbatim from `painTrajectoryText`, or
2. `dischargeDisplay` (the trailing endpoint) is not actually `5/10` — so `5` is genuinely off-chain.

The warning is non-fatal. It is stashed in `discharge_notes.raw_ai_response.trajectory_warnings` for QC review. The QC review panel surfaces it as a discharge-step finding, and `verifyFinding` in [src/actions/case-quality-reviews.ts:761-783](src/actions/case-quality-reviews.ts#L761-L783) re-checks `raw_ai_response.trajectory_warnings.length` to mark it resolved — so a regen that produces no warnings clears it automatically.

## Detailed Findings

### Validator that emits the warning

[src/lib/claude/pain-trajectory-validator.ts](src/lib/claude/pain-trajectory-validator.ts) — sole producer of the `trajectory_warnings` strings.

- Pain regex: `/(\d{1,2}(?:-\d{1,2})?)\/10(?!\d|\/)/g` ([validator:20](src/lib/claude/pain-trajectory-validator.ts#L20)). Matches both single (`5/10`) and range (`2-5/10`) readings; negative-lookahead avoids dates like `05/10/2025`.
- Sections scanned: `subjective`, `objective_vitals`, `assessment`, `prognosis` ([validator:22-27](src/lib/claude/pain-trajectory-validator.ts#L22-L27)).
- Expected set built by `collectExpectedValues` ([validator:43-60](src/lib/claude/pain-trajectory-validator.ts#L43-L60)):
  - For each timeline entry: if `min === max` adds `${max}`; if both present adds `${min}-${max}` (e.g. `2-5`); else the lone bound.
  - Adds normalized `baselineDisplay` and `dischargeDisplay` (with `/10` stripped).
- Mismatch warning ([validator:83-87](src/lib/claude/pain-trajectory-validator.ts#L83-L87)):
  > `Section "subjective" contains pain value 5/10 that is not in the deterministic trajectory (expected one of: ...).`
- Additional discharge-endpoint checks ([validator:91-107](src/lib/claude/pain-trajectory-validator.ts#L91-L107)) flag missing endpoint clauses in `objective_vitals`, `subjective`, `assessment`, `prognosis`.
- Verbatim arrow-chain check ([validator:109-113](src/lib/claude/pain-trajectory-validator.ts#L109-L113)) flags when the LLM paraphrased instead of pasting `painTrajectoryText`.

The four-procedure chain `2-5 → 4-5 → 3-5 → 3-5` in the user's report is a `painTrajectoryText` segment built from procedure entries with `(min, max)` pairs `(2,5)`, `(4,5)`, `(3,5)`, `(3,5)`.

### Trajectory builder (source of the expected set)

[src/lib/claude/pain-trajectory.ts](src/lib/claude/pain-trajectory.ts) — pure TS builder, no I/O.

- `buildDischargePainTrajectory` ([pain-trajectory.ts:125-333](src/lib/claude/pain-trajectory.ts#L125-L333)) assembles `entries[]` (intake → procedures → discharge endpoint), `arrowChain` (the `painTrajectoryText` rendered with optional date annotations and the `at initial evaluation` / `across the injection series` / `at today's discharge evaluation` lead-ins), and the `baselineDisplay`/`dischargeDisplay` strings.
- Discharge endpoint priority ([pain-trajectory.ts:148-200](src/lib/claude/pain-trajectory.ts#L148-L200)):
  1. `dischargeVitals` non-null → verbatim, not estimated.
  2. `finalIntervalWorsened` OR `overallPainTrend ∈ {stable, worsened}` → latest procedure verbatim, not estimated (suppresses `-2`).
  3. else → latest procedure `-2` floor 0, marked estimated.
- The procedure entries that make up the `2-5 → 4-5 → 3-5 → 3-5` segment come from `procedures[]` with `(pain_score_min, pain_score_max)` taken straight off `procedure_notes` rows.

### Where the validator runs and persists the wrapped response

[src/actions/discharge-notes.ts](src/actions/discharge-notes.ts):

- Initial generate path: validator invocation at [discharge-notes.ts:797-857](src/actions/discharge-notes.ts#L797-L857). Wraps result into `raw_ai_response`:
  ```
  { raw, trajectory_warnings, discharge_readings_found, pain_trajectory_text, discharge_visit_pain_display, discharge_visit_pain_estimated }
  ```
  ([discharge-notes.ts:866-876](src/actions/discharge-notes.ts#L866-L876)). Persisted via `update().eq('id', record.id)` at [discharge-notes.ts:878-904](src/actions/discharge-notes.ts#L878-L904).
- Section regen path: re-runs validator against the merged note at [discharge-notes.ts:1158-1268](src/actions/discharge-notes.ts#L1158-L1268). Refreshes `trajectory_warnings` and the persisted trajectory columns atomically — even sections that did not change are re-checked because the deterministic chain may have shifted (new vitals, new procedure).
- Trajectory builder is called from `gatherDischargeNoteSourceData` at [discharge-notes.ts:413-427](src/actions/discharge-notes.ts#L413-L427) and the resulting fields land on `inputData` ([discharge-notes.ts:501-510](src/actions/discharge-notes.ts#L501-L510)).

### Where pain numbers are injected into the prompt

[src/lib/claude/generate-discharge-note.ts](src/lib/claude/generate-discharge-note.ts):

- L121-L264 declare the verbatim-rendering contract with the LLM:
  > "If `painTrajectoryText` is non-null, it MUST appear verbatim inside the subjective pain-progression sentence. Do NOT paraphrase, reorder, or re-number the chain."
- The LLM is told not to inject PT/PM/chiro readings into the arrow chain ([generate-discharge-note.ts:259](src/lib/claude/generate-discharge-note.ts#L259)).
- Legacy numeric path is gated to `painTrajectoryText == null && dischargeVisitPainDisplay == null` ([generate-discharge-note.ts:264-268](src/lib/claude/generate-discharge-note.ts#L264-L268)).

### Persisted columns on `discharge_notes`

[supabase/migrations/20260426_discharge_notes_pain_trajectory.sql](supabase/migrations/20260426_discharge_notes_pain_trajectory.sql) adds:
- `pain_trajectory_text text` — comment: "deterministic arrow chain the LLM must render verbatim".

[src/types/database.ts:838,884,930](src/types/database.ts#L838) declares the column on the row/insert/update shapes.

Other persisted trajectory columns referenced in the regen / generate updates: `discharge_pain_estimate_min`, `discharge_pain_estimate_max`, `discharge_pain_estimated` ([discharge-notes.ts:898-901](src/actions/discharge-notes.ts#L898-L901)).

### How QC review surfaces the warning

[src/actions/case-quality-reviews.ts](src/actions/case-quality-reviews.ts):

- L88: the gather query selects `pain_trajectory_text` and `raw_ai_response` from `discharge_notes`.
- L685: comment block explicitly maps `'discharge'` step findings to `discharge_notes.raw_ai_response.trajectory_warnings`.
- L761-L783: `verifyFinding(caseId, findingHash)` for `step === 'discharge'` reads `raw_ai_response.trajectory_warnings`. If the array is empty → `resolved = true`. If non-empty → `reason = 'Trajectory validator still emitting warnings'`.

[src/components/clinical/qc-review-panel.tsx:46-49](src/components/clinical/qc-review-panel.tsx#L46-L49) — Verify button is gated to `step ∈ {procedure, discharge}` because those are the only steps with deterministic audit columns.

### Read-only timeline widget

[src/components/discharge/pain-timeline-table.tsx](src/components/discharge/pain-timeline-table.tsx) renders the same `DischargePainTrajectory` payload returned by the regen endpoint ([discharge-notes.ts:1453-1527](src/actions/discharge-notes.ts#L1453-L1527)). The widget is read-only and explicitly labeled "deterministic trajectory" ([pain-timeline-table.tsx:102-121](src/components/discharge/pain-timeline-table.tsx#L102-L121)).

### Tests covering this path

- [src/actions/__tests__/discharge-notes-regenerate.test.ts](src/actions/__tests__/discharge-notes-regenerate.test.ts) — mocks `buildDischargePainTrajectory` and asserts the dischargeVitals-vs-estimate behavior the validator depends on.

## Code References

- `src/lib/claude/pain-trajectory-validator.ts:20` — pain regex
- `src/lib/claude/pain-trajectory-validator.ts:43-60` — `collectExpectedValues` (defines what counts as on-chain)
- `src/lib/claude/pain-trajectory-validator.ts:78-89` — section scan + mismatch warning emission
- `src/lib/claude/pain-trajectory-validator.ts:91-113` — endpoint + verbatim-arrow-chain checks
- `src/lib/claude/pain-trajectory.ts:125-333` — `buildDischargePainTrajectory`
- `src/lib/claude/pain-trajectory.ts:148-200` — discharge-endpoint priority rules
- `src/actions/discharge-notes.ts:413-427` — builder invocation in gather
- `src/actions/discharge-notes.ts:797-857` — validator call (initial generate)
- `src/actions/discharge-notes.ts:866-904` — `raw_ai_response` wrap + persist (initial)
- `src/actions/discharge-notes.ts:1158-1268` — validator call + persist (section regen)
- `src/actions/case-quality-reviews.ts:761-783` — discharge `verifyFinding` reads `raw_ai_response.trajectory_warnings`
- `src/components/clinical/qc-review-panel.tsx:46-49` — Verify gating
- `src/components/discharge/pain-timeline-table.tsx:76-121` — read-only timeline widget
- `supabase/migrations/20260426_discharge_notes_pain_trajectory.sql:20-38` — `pain_trajectory_text` column

## Architecture Documentation

The discharge pain trajectory is a "Phase 1 precision" pipeline: arrow-chain assembly and the `-2` discharge-endpoint estimate moved out of the LLM prompt and into TypeScript. The flow is:

1. `gatherDischargeNoteSourceData` calls `buildDischargePainTrajectory` with `procedures[]`, `latestVitals`, `dischargeVitals`, `baselinePain`, `intakePain`, `overallPainTrend`, `finalIntervalWorsened`, `visitDate`.
2. The builder returns `arrowChain` (= `painTrajectoryText`) + `dischargeDisplay` + `baselineDisplay` + `entries[]`.
3. The prompt instructs the LLM to render `painTrajectoryText` verbatim and never re-derive numbers.
4. After generation, `validateDischargeTrajectoryConsistency` greps every `\d/10` reading out of the four "trajectory sections", compares against the expected set, and emits non-fatal warnings.
5. Warnings live on `discharge_notes.raw_ai_response.trajectory_warnings` (a JSON column).
6. QC review reads them, presents them as findings on the discharge step, and `verifyFinding` re-checks the array on regen to auto-resolve.

The two-table contract: structured trajectory state lives on dedicated columns (`pain_trajectory_text`, `discharge_pain_estimate_min/max`, `discharge_pain_estimated`); the validator's transient observations live inside `raw_ai_response`. Section regen rewrites both atomically.

## Related Research

- [thoughts/shared/research/2026-04-27-discharge-pain-rate-on-regenerate.md](thoughts/shared/research/2026-04-27-discharge-pain-rate-on-regenerate.md) — earlier context on regen + pain rate behavior

## DB Inspection (case fac6fc56)

Run via `supabase db query --linked` against ClinIQ project (ref `glnuoiqbhcldvyjwzmru`).

**Discharge note row:** `id = 54be2d85-2adf-42d2-8aaf-123d7e26738c`

**Persisted trajectory state:**
- `pain_trajectory_text`: `"2-5/10 at initial evaluation (02/11/2026), 4-5/10 → 3-5/10 across the injection series (02/14/2026 – 03/04/2026), 3-5/10 at today's discharge evaluation (03/20/2026)"`
- `discharge_pain_estimate_min = 3`, `discharge_pain_estimate_max = 5`, `discharge_pain_estimated = false` (verbatim from `dischargeVitals` or worsened-suppression branch).
- Procedures: 2 entries (`4-5`, `3-5`); intake: `2-5`; discharge endpoint: `3-5`.

**`raw_ai_response.trajectory_warnings`:**
```
[
  "Section \"subjective\" contains pain value 5/10 that is not in the deterministic trajectory (expected one of: 2-5/10, 4-5/10, 3-5/10, 1-3/10)."
]
```

**`raw_ai_response.discharge_readings_found`:** 14 entries: `2-5, 4-5, 3-5, 1-3, 4-5, 1-3, 5, 4-5` in subjective; `1-3` in objective_vitals; `2-5, 1-3, 4-5` in assessment; `2-5, 1-3` in prognosis.

(`1-3/10` shows up because earlier prompt iterations / source data populated a `1-3` range somewhere — added to expected set via `entries[]`. Confirmed not problematic.)

**Actual subjective text (current state) contains:** `2× 5/10`, `1× 4/10`, `1× 3/10`, plus the legitimate ranges. Counts:
```
1 2-5/10
2 3-5/10
1 3/10
2 4-5/10
1 4/10
2 5/10
```

**Discrepancy:** validator's `discharge_readings_found` records ONE `5/10` and ZERO `4/10`/`3/10`, but current subjective contains TWO `5/10`, ONE `4/10`, ONE `3/10`. Persisted readings are stale relative to current text.

## Root Cause

`saveDischargeNote` ([src/actions/discharge-notes.ts:933-958](src/actions/discharge-notes.ts#L933-L958)) — the manual inline-edit path — updates `subjective` (and other sections) directly via Supabase update, bypassing `validateDischargeTrajectoryConsistency`. It does not:
- Re-scan section text for off-chain pain values
- Refresh `raw_ai_response.trajectory_warnings`
- Refresh `raw_ai_response.discharge_readings_found`

Only the LLM paths refresh validator state:
- `generateDischargeNote` ([discharge-notes.ts:797-857](src/actions/discharge-notes.ts#L797-L857))
- `regenerateDischargeNoteSectionAction` ([discharge-notes.ts:1158-1271](src/actions/discharge-notes.ts#L1158-L1271))

Likely sequence for this case:
1. LLM generated subjective with one bare `5/10` → validator emitted warning + `discharge_readings_found` recorded one `5` reading.
2. Provider manually edited subjective via the editor (e.g. expanded a sentence about peak/lower pain bounds, headaches at "5/10") → `saveDischargeNote` persisted new text.
3. `trajectory_warnings` and `discharge_readings_found` frozen from step 1; new off-chain values (`4/10`, `3/10`, additional `5/10`) never scanned.
4. `finalizeDischargeNote` (or the QC review verify) sees the stale warning array, refuses to clear, blocking finalization.

## Reconcile Options for This Case

1. **Section-regen subjective** ([components/discharge/discharge-note-editor.tsx:516-540](src/components/discharge/discharge-note-editor.tsx#L516-L540) → `regenerateDischargeNoteSectionAction`). Re-runs validator on merged note. If the LLM rewrites subjective without bare `5/10`/`4/10`/`3/10`, warnings clear; QC `verifyFinding` auto-resolves at [src/actions/case-quality-reviews.ts:761-783](src/actions/case-quality-reviews.ts#L761-L783).
2. **Manual edit + regen** — provider edits subjective to use only on-chain ranges (`2-5`, `4-5`, `3-5`, `1-3`), then triggers any section regen to refresh validator state. Note: pure manual edit alone won't clear warnings (see root cause).
3. **Backend fix** (out-of-scope for this research) — extend `saveDischargeNote` to re-run validator on the edited sections and refresh `raw_ai_response.trajectory_warnings` + `discharge_readings_found`. Mirrors the pattern in section-regen.

## Follow-up Issue: Internal Endpoint Contradiction (3-5 vs 1-3)

User-reported second symptom: `pain_trajectory_text` and `subjective` narrate discharge `3-5/10`; `objective_vitals` Pain bullet shows `1-3/10`; `discharge_notes.pain_score_max = 3`.

### DB evidence

| Source | Value |
|---|---|
| `pain_trajectory_text` | ends with `3-5/10 at today's discharge evaluation (03/20/2026)` |
| `discharge_pain_estimate_min/max` | `3 / 5` |
| `discharge_pain_estimated` | `false` |
| `objective_vitals` Pain bullet | `• Pain: 1-3/10` |
| `discharge_notes.pain_score_min / pain_score_max` | `1 / 3` (provider-entered discharge-visit reading) |
| `vital_signs` (intake, `procedure_id IS NULL`) | `2-5` |
| `vital_signs` (proc 1) | `4-5` |
| `vital_signs` (proc 2) | `3-5` |

### Mechanism

`discharge_notes` carries its own discharge-visit vitals columns (`pain_score_min`, `pain_score_max`, BP/HR/RR/Temp/SpO2). These are written by `saveDischargeVitals` ([src/actions/discharge-notes.ts:1353-1400](src/actions/discharge-notes.ts#L1353-L1400)) directly to the row. They are passed back into the trajectory builder as `dischargeVitals` (via `preservedVitals`) on the next generate or section-regen ([discharge-notes.ts:669-688](src/actions/discharge-notes.ts#L669-L688)).

`buildDischargePainTrajectory` ([src/lib/claude/pain-trajectory.ts:157-200](src/lib/claude/pain-trajectory.ts#L157-L200)) treats `dischargeVitals` as present iff `pain_score_min != null || pain_score_max != null`. When that branch fires it sets `dischargeDisplay` to a range built from those bounds. When it does NOT fire, the suppressFabrication / -2 branches pull from `latestVitals` (last procedure's `vital_signs`).

Persisted columns:
- `pain_trajectory_text`, `discharge_pain_estimate_min/max`, `discharge_pain_estimated` are written ONLY by initial generate ([discharge-notes.ts:732-735](src/actions/discharge-notes.ts#L732-L735), [898-901](src/actions/discharge-notes.ts#L898-L901)) and section-regen ([1265-1268](src/actions/discharge-notes.ts#L1265-L1268)). Both run the builder.
- `discharge_notes.pain_score_min/max` are written by `saveDischargeVitals` AND copied verbatim by generate insert ([discharge-notes.ts:730-731](src/actions/discharge-notes.ts#L730-L731)). They are NOT updated by section-regen.
- Section text (`subjective`, `objective_vitals`, ...) is written by the LLM at generate time, by section-regen for the targeted section, or by `saveDischargeNote` (manual editor) for any section. `saveDischargeNote` does NOT touch trajectory columns.

So the row carries two parallel sources of truth for the discharge endpoint:
- The textual narrative + `pain_trajectory_text` (driven by builder, frozen at last generate/regen).
- The structured discharge-vitals columns (driven by `saveDischargeVitals`, freely editable).

When the two diverge, the prompt's verbatim contract no longer holds and `objective_vitals` (which the LLM was told at gen-time to render from `dischargeVitals`/`dischargeVisitPainDisplay`) ends up citing one endpoint while `pain_trajectory_text` and the rest of the narrative cite another.

### Most plausible sequence for this row

1. Initial generation ran at a time when `dischargeVitals.pain_score_min/max` were NULL on the row (or unset). Builder fell to the suppressFabrication branch (overallPainTrend stable/worsened OR finalIntervalWorsened) and rendered the last procedure verbatim. Result: `pain_trajectory_text` ends `3-5/10`; `discharge_pain_estimate_min/max = 3,5`; `discharge_pain_estimated = false`. Subjective/assessment/prognosis cite `3-5/10` as the discharge endpoint.
2. Provider entered discharge vitals `pain_score_min=1, pain_score_max=3` via `saveDischargeVitals` AFTER generation. Row now carries `1/3`.
3. The `objective_vitals` bullet was edited to `1-3/10` — either by manual `saveDischargeNote` edit, or by a section-regen that picked up the new vitals (regen-of-objective-vitals would have ALSO refreshed `pain_trajectory_text` to `1-3` and `discharge_pain_estimate` to `1,3`, which did not happen here, so manual edit is the more consistent reading).
4. No regen ran after the vitals change, so `pain_trajectory_text` and `discharge_pain_estimate_min/max` were never recomputed.
5. The `1-3/10` reading also appears in subjective, assessment, prognosis (per `discharge_readings_found`) — likely from the same manual editing pass.

Because the validator's "expected set" includes `1-3/10` in the persisted warning message, the validator's last run must have observed `1-3` as part of the trajectory (entries OR `dischargeDisplay`). That is consistent with at least one earlier generate/regen having had `dischargeVitals = (1,3)`. The current row state therefore represents at least two distinct generation events with diverging vitals state, with manual edits in between.

### Code references

- Discharge-note row vitals columns + save action: [src/actions/discharge-notes.ts:1334-1400](src/actions/discharge-notes.ts#L1334-L1400)
- preservedVitals → builder: [src/actions/discharge-notes.ts:669-688](src/actions/discharge-notes.ts#L669-L688)
- Builder branch selection (`hasDischargeVitals`): [src/lib/claude/pain-trajectory.ts:157-200](src/lib/claude/pain-trajectory.ts#L157-L200)
- Prompt contract — Pain bullet from `dischargeVitals`/`dischargeVisitPainDisplay`: [src/lib/claude/generate-discharge-note.ts:242](src/lib/claude/generate-discharge-note.ts#L242), [282](src/lib/claude/generate-discharge-note.ts#L282), [290](src/lib/claude/generate-discharge-note.ts#L290), [388-391](src/lib/claude/generate-discharge-note.ts#L388-L391)

### Reconcile options

1. **Section-regen any section** (e.g. subjective). Gather will read current `discharge_notes.pain_score_min/max = 1,3` as `preservedVitals`/`dischargeVitals`, builder produces `dischargeDisplay = 1-3/10`, regen path rewrites `pain_trajectory_text` and `discharge_pain_estimate_min/max` to `1,3`. Validator re-runs on merged note; remaining bare-value warnings refresh.
2. **Decide which endpoint is correct first.** If the provider's clinical reading is `1-3`, regen will align everything to `1-3`. If the discharge-vitals row was entered in error and the actual reading should be `3-5`, clear `pain_score_min/max` on the row via `saveDischargeVitals` then regen — builder will fall back to suppressFabrication / -2 and produce a `3-5` chain.
3. **Backend fix** (out-of-scope for this research): treat divergence between `pain_trajectory_text` discharge endpoint and `discharge_notes.pain_score_min/max` as a generation-time / save-time consistency check; either auto-rebuild trajectory on `saveDischargeVitals` or surface the divergence as a QC finding distinct from the off-chain warning.

## Open Questions

- None blocking for this case. Both reported issues (off-chain `5/10` and `3-5` vs `1-3` endpoint divergence) trace to the same architectural gap: trajectory state and section text can drift independently because `saveDischargeNote` and `saveDischargeVitals` do not re-run the trajectory builder or validator. The fix is a section-regen for now; a more durable fix is to wire validator re-runs into both save paths.
