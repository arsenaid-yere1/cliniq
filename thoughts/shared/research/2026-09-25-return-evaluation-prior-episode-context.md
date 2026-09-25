# Return evaluation context from prior Episodes

## Research question
Does a new Episode's Pain Management (pain evaluation) note account for visits from previous Episodes?

## Summary
No direct previous-Episode visit history is loaded into the generator. Current Episode intake and evaluation vitals are isolated correctly. Shared case summary, approved imaging and the latest reviewed pain-management extraction still supply case-level background, which can contain historical information. This does not amount to an explicit history of prior Episode visits, procedures, discharge or treatment outcomes.

## Data flow and references
- `src/actions/initial-visit-notes.ts:105`, `gatherSourceData`: the only prior-note query selects finalized `initial_visit` rows in `sourceEpisodeId` (lines 122–132). It does not select previous Episode pain evaluations, follow-up notes, performed procedures or discharge notes.
- Return Episodes are pain-evaluation-only, so normally have no `initial_visit` row. The query consequently yields no row, and `priorVisitData` is null (construction near line 339).
- Current vitals are filtered by selected Episode and, for return Episodes, pain-evaluation encounter type (lines 162–172). Intake uses selected Episode and visit type (lines 174–180).
- Shared case summary includes prior_treatment and symptoms_timeline; approved imaging and latest reviewed pain-management extraction remain case-scoped (lines 140–160 and 211–230). Provider intake can also manually document history. No automatic prior-Episode visit chronology is assembled.
- `src/lib/claude/generate-initial-visit.ts:280` explicitly instructs the model to produce a standalone evaluation without interval comparisons when priorVisitData is null. The prompt labels null as no prior Initial Visit on the case, although the loader now means none in the selected Episode.
- Generation, regeneration, save validation and finalization share this loader; isolation is not limited to the first generation.

## Existing tests
`src/actions/__tests__/evaluation-episode-isolation.test.ts:75` (test named "generates from this episode intake/vitals without a prior episode Initial Visit") asserts priorVisitData is null despite an older finalized Initial Visit fixture. It also ensures a later follow-up's vitals are excluded.

## Historical context
Episode isolation was introduced in deployed commit 313adc1. It prevents old records being selected as the current evaluation but does not provide a separate read-only cross-Episode history input.

## Verification and open questions
Static source and regression-test inspection only; no patient data or generated note was inspected, no application code changed, and no Node process was started for tests. Shared summaries/extractions may incidentally contain earlier history; the actual historical detail available in a particular patient note depends on those records and entered intake. "Pain Management note" is interpreted as the new Episode's pain-evaluation note.
