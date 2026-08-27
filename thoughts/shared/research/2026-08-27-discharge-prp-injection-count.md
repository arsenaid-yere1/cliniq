# Discharge PRP injection count

## Research question

How is the PRP injection count in generated Discharge notes derived today, and why does it reflect procedure sessions rather than target areas?

## Summary

There is no deterministic `injectionCount` field or TypeScript calculation in the Discharge-note pipeline. The generator receives a `procedures` array with one item per `procedures` database row (a treatment session). Each item contains a nested structured `sites` array representing the target areas treated during that session. The prompt repeatedly describes the outer `procedures[]` array as the injection series and asks the model to narrate each procedure, but it never defines an injection count from the nested sites. Consequently, when generated prose states a number of PRP injections, that number is an LLM inference from the number of outer procedure/session records, not a count computed from target areas.

The target-area information needed for a different count is already present in the prompt payload as `procedures[].sites[]`. Under the current data model, the direct target-area occurrence count would be the sum of `sites.length` across the relevant PRP procedure records. This formula is an interpretation of the requested target-area semantics; it is not implemented today.

## Detailed findings

### Source query and session-level array

`gatherDischargeNoteSourceData` queries `procedures` for the selected care episode, ordered chronologically. It does not aggregate or flatten sites. Each database procedure row becomes exactly one entry in the local `procedures` array (`src/actions/discharge-notes.ts:121-126`, `src/actions/discharge-notes.ts:267-281`).

This means:

- `procedures.length` represents the number of procedure records/sessions.
- `procedures[n].sites.length` represents the number of structured target-area entries recorded during that session.
- A session treating three target areas remains one outer `procedures[]` entry with three nested `sites[]` entries.

The procedure write path confirms that `sites` is the structured source of truth and that the legacy `injection_site` string is only a comma-joined denormalization (`src/actions/procedures.ts:125-132`).

### Structured target areas

Each site has a label, laterality, volume, and imaging-confirmation value (`src/lib/procedures/sites-helpers.ts:3-11`). `parseSitesJsonb` validates each stored site and returns the valid site entries (`src/lib/procedures/sites-helpers.ts:94-104`). Invalid or legacy-missing `sites` data becomes an empty array; the parser does not fall back to splitting `injection_site`.

The Discharge input type preserves the same nesting: `procedures[]`, each with its own `sites[]` (`src/lib/claude/generate-discharge-note.ts:35-49`). The gathered array is passed into the final input unchanged (`src/actions/discharge-notes.ts:501-517`).

### Where the apparent count is derived

No source symbol computes a PRP injection total for Discharge notes. There is no `injectionCount`, `targetAreaCount`, or equivalent value in `DischargeNoteInputData`.

Instead, the full nested payload is serialized into the LLM user message. The context curator only removes empty top-level values and does not reshape or flatten `procedures` (`src/lib/claude/context-bundle.ts:66-97`; `src/lib/claude/generate-discharge-note.ts:536-553`). Section regeneration uses the same full aggregated payload (`src/lib/claude/generate-discharge-note.ts:581-612`).

The system prompt semantically equates outer procedure records with injections:

- It calls `procedures[]` “every procedure” and describes each element as a pre-injection encounter (`src/lib/claude/generate-discharge-note.ts:282-288`).
- It instructs the subjective section to narrate the full series when `procedures[]` has at least three entries (`src/lib/claude/generate-discharge-note.ts:404-407`).
- It asks for treatment sites, but supplies no rule that a nested site equals one injection (`src/lib/claude/generate-discharge-note.ts:406`).

Therefore the observed session-based number is model-derived rather than explicitly calculated. The outer array provides an obvious count and the prompt labels those entries as the injection series; the nested target areas are available but have no counting instruction.

### Related deterministic logic

The pain trajectory deliberately maps one point per procedure record and uses `procedure_number`, date, and pain values only (`src/actions/discharge-notes.ts:443-457`). This session-based behavior is correct for visit-level pain measurements, but it reinforces that the outer array represents sessions rather than individual target-area injections. It does not calculate the narrative injection count.

### Procedure-type scope

The Discharge source query is scoped to the care episode but does not select or filter on `procedure_type` (`src/actions/discharge-notes.ts:121-126`). Thus the outer `procedures[]` payload can include every live procedure record in the episode, not only PRP records. The prompt is specifically framed as a PRP discharge note. Whether mixed procedure types occur in a discharge episode was not established from static code inspection.

## Execution/data flow

1. PRP recording stores one `procedures` row for the session and stores all target areas in that row's `sites` JSON array.
2. Discharge gathering fetches all live procedure rows in the selected episode.
3. Each procedure row becomes one `procedures[]` entry; `sites[]` remains nested.
4. The whole structure is serialized into the model prompt.
5. The prompt calls the outer procedure sequence the injection series but provides no target-area counting contract.
6. Any injection total in generated prose is produced by the model, with the outer array/session count as the strongest counting cue.

## Existing tests

`src/lib/claude/__tests__/generate-discharge-note.test.ts` verifies model/tool wiring, prompt guardrails, pain signals, and payload threading. Its shared input has `procedures: []` (`src/lib/claude/__tests__/generate-discharge-note.test.ts:14-20`). There is no test with one session and multiple `sites`, and no assertion for a PRP injection or target-area count.

`src/actions/__tests__/discharge-notes-regenerate.test.ts` includes a single procedure with `sites: []` for discharge-vitals wiring. It does not exercise injection counting.

## Historical context

Commit `3349ded4` introduced structured `sites[]` on procedure records and threaded it into the Discharge payload. Before that commit, Discharge inputs exposed one legacy `injection_site` and laterality value per procedure. The commit added the nested site data but did not add a derived target-area count or a prompt rule for counting sites. The original session-oriented prompt predates that structured-sites change.

## Open questions

- Should a `bilateral` site entry count as one target-area entry (the stored row) or two anatomical injections?
- Should repeated treatment of the same target area in separate sessions count once per occurrence or once as a unique anatomical area across the full series?
- Should only `procedure_type = 'prp'` contribute, especially in episodes that also contain BOTOX or other procedure types?
- How should legacy records with a populated `injection_site` but an empty/invalid `sites` array be counted?
