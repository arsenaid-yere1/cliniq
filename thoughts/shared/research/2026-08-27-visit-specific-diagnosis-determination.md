# Visit-specific diagnosis determination

## Research question

How are diagnoses currently determined for a visit, where can diagnoses from the case summary or earlier visits by other clinicians enter, and how should the system be improved so the diagnosis list is specific to the current encounter?

## Summary

The repository has three materially different behaviors:

1. A true `initial_visit` is already isolated. Its action intentionally supplies `null` for the case summary, PM extraction, and prior visit, and its prompt says diagnoses must come from the current examination and mechanism of injury.
2. A `pain_evaluation_visit` is not encounter- or provider-isolated. It receives a case-wide summary, the latest approved/edited PM extraction, and the finalized initial visit. The prompt explicitly names case-summary and PM diagnoses as candidates and allows PM examination findings to support a current diagnosis.
3. A `pain_follow_up` sends the model the current encounter plus the latest completed encounter, the previous episode discharge, and every performed procedure (including diagnoses) in the episode. It has no diagnosis source-precedence rule, no visit-support rule, and no deterministic diagnosis pool.

Procedure notes are better constrained: the provider-committed `procedureRecord.diagnoses` list is primary, PM-only diagnoses are supplementary under a high evidence bar, case-summary diagnoses are advisory, and prompt Filter (E) requires support in this visit. However, this remains mostly prompt enforcement rather than a deterministic output boundary. Procedure diagnosis suggestions are also assembled case-wide before the provider records the procedure.

The central architectural gap is that diagnosis output is generally a free-text LLM section derived from a broad JSON context. There is no shared, typed, encounter-specific diagnosis candidate set with provenance, current-visit evidence, clinician ownership, and a deterministic allow/deny result.

## Detailed findings

### Initial visit and pain evaluation

The UI supplies the explicit visit type to generation from `InitialVisitNotePane.runGenerate()` (`src/components/clinical/initial-visit-editor.tsx:331-342`). The action resolves and gathers the note by `(case_id, visit_type)` (`src/actions/initial-visit-notes.ts:349-371`).

`gatherSourceData()` gates broad imaging context with `visitType === 'pain_evaluation_visit'` (`src/actions/initial-visit-notes.ts:64-80`). Therefore:

- `initial_visit`: case summary, PM extraction, and prior visit are not loaded.
- `pain_evaluation_visit`: the action loads the finalized initial visit, including diagnoses, by case and visit type but not provider (`src/actions/initial-visit-notes.ts:81-92`); the completed case summary, including `suggested_diagnoses`, by case (`:94-103`); and the most recent approved/edited PM extraction by case, without encounter or provider linkage (`:105-115`).

The current intake is scoped by `(case_id, visit_type)` (`src/actions/initial-visit-notes.ts:154-160`). In contrast, current vital signs are simply the latest non-procedure vitals for the case, not an encounter-bound row (`:144-152`). Provider identity comes from `cases.assigned_provider_id`, not the encounter (`:189-199`).

Provider overrides replace raw PM diagnoses and examination data (`src/actions/initial-visit-notes.ts:210-226`). The final input includes prior-visit diagnoses (`:256-269`), case-summary suggested diagnoses (`:295-302`), and PM diagnoses (`:320-326`).

The generator correctly declares a null contract for `initial_visit` and says all coding is based on current examination and mechanism (`src/lib/claude/generate-initial-visit.ts:149-160`). For `pain_evaluation_visit`, however, it instructs the model to cross-reference case-summary diagnoses (`:291-305`) and permits objective support from either this visit's intake or PM extraction (`:309-327`). That makes an earlier or other-clinician PM finding valid support for the current visit under the present prompt.

The result contract is only `diagnoses: string` (`src/lib/claude/generate-initial-visit.ts:421-424`). Generation shallow-curates and serializes the full input (`:582-600`), and the action saves the returned diagnosis text directly (`src/actions/initial-visit-notes.ts:496-502, 560-586`). Narrative validation does not validate diagnosis provenance.

### Why case-summary diagnoses are inherently broad

Case-summary gathering reads approved clinical sources across the case: MRI, chiropractic, PM, PT, orthopedic, CT, and X-ray records (`src/actions/case-summaries.ts:17-108`). The summary prompt explicitly synthesizes and cross-references diagnoses across sources (`src/lib/claude/generate-summary.ts:5-40`). `caseSummary.suggested_diagnoses` is therefore a case-level evidence map, not a finding made at the current visit.

### Pain follow-up

The pain-follow-up action loads:

- the current `pain_follow_up` encounter (`src/actions/pain-follow-up-notes.ts:22-27`);
- every other encounter in the episode, from which `selectLatestCompletedEncounter()` chooses one (`:28-33, 59`);
- all performed procedures in the episode, including their diagnoses (`:34-35, 61`);
- the prior episode's finalized discharge narrative (`:37-47`).

The encounter provider is loaded correctly for display (`src/actions/pain-follow-up-notes.ts:49-53`), but source selection is not filtered to that provider.

`PainFollowUpSourceData` exposes all of these broad sources (`src/lib/claude/generate-pain-follow-up.ts:8-15`). The system prompt only enforces telehealth examination boundaries (`:17-25`). The tool asks for a free-text diagnosis section and diagnosis arrays on recommendations (`:27-45`) but defines no candidate pool, provenance hierarchy, current-visit support test, or restriction against inheriting procedure diagnoses (`:76-95`).

This is the largest unguarded route for diagnoses from prior visits or other clinicians to appear in the current note.

### Procedure visit

Procedure-note gathering retrieves the current procedure and current procedure vitals, but also the latest PM extraction and completed case summary by case (`src/actions/procedure-notes.ts:39-140`). Prior procedures are narrowed to the current `procedure_series_id` when one exists, but not to the performing provider (`:164-168`). Prior finalized procedure-note excerpts include `assessment_and_plan`, which can contain diagnoses (`:173-216, 503-517`).

The prompt encourages diagnostic continuity from prior notes (`src/lib/claude/generate-procedure-note.ts:334-349`). Its diagnosis rules are nevertheless the strongest current pattern:

- provider-committed `procedureRecord.diagnoses` is primary;
- `pmSupplementaryDiagnoses` is advisory and requires confirmed imaging, objective examination support, and relevance to this procedure;
- `caseSummary.suggested_diagnoses` is a third advisory source and cannot add a code by itself (`src/lib/claude/generate-procedure-note.ts:637-649`);
- Filter (E) requires current-visit symptom/ROS/exam support (`:672-678`).

Before the procedure is recorded, however, `getCaseDiagnoses()` merges the latest case-wide PM diagnoses with a preferred initial/pain-evaluation diagnosis list (`src/actions/procedures.ts:179-269`). High-evidence PM codes and clinician-note codes may be prechecked in the form (`src/components/procedures/record-procedure-dialog.tsx:221-248`). These queries are case-scoped rather than episode-, encounter-, or provider-scoped.

### Context curation

`curateInputDataForPrompt()` drops only empty top-level fields and summarizes only prior procedure-note section bodies (`src/lib/claude/context-bundle.ts:1-10, 68-99`). It does not remove nested diagnoses from a case summary, PM extraction, prior visit, latest encounter, prior discharge, or procedure record. Context curation reduces size and cloning risk; it is not a clinical-source boundary.

## Current data flow

```text
case/episode records
  -> action gathers current + historical/case-wide sources
  -> shallow context curation
  -> entire labeled JSON payload sent to Claude
  -> Claude chooses diagnoses under visit-specific prompt rules (if any)
  -> Zod validates shape, not diagnosis provenance
  -> free-text diagnosis section is persisted
```

For pain evaluation and pain follow-up, the LLM is therefore both evidence reader and final diagnosis selector. Broad context remains visible even when a prompt says it should be secondary.

## Recommended target design

### 1. Make the current encounter the only diagnosis authority

Introduce an encounter-bound structured field, for example `visit_diagnoses`, containing the provider's selected codes for that encounter. Each item should carry at least:

- `icd10_code` and description;
- `encounter_id`, `episode_id`, and `provider_id`;
- status such as `selected`, `ruled_out`, or `historical_only`;
- evidence references to current encounter fields (complaint, ROS, exam, imaging reviewed today);
- provenance (`provider_selected`, `suggested_from_history`, `suggested_from_imaging`).

The generated diagnosis section should be rendered from provider-selected/current-encounter items. Historical diagnoses should be available as suggestions, not candidates the model may silently promote.

### 2. Build a deterministic visit diagnosis pool before generation

Follow the procedure-note and discharge-pool patterns, but tighten them:

- Primary: diagnoses explicitly selected on the current encounter/procedure.
- Secondary suggestions: historical/case-summary/PM codes, each labeled with source provider, source encounter/date, and evidence.
- Promotion rule: a secondary code can enter the current pool only through an explicit provider selection, or through a narrowly defined deterministic rule followed by provider confirmation.
- Exclude by default: diagnoses supported only by prior-visit symptoms/exam, records from another provider, another episode, or unrelated body regions.

Pass the model an authoritative `visitDiagnosisPool` and omit raw diagnosis arrays from caseSummary, prior visits, procedures, and PM context. If broad clinical history is still needed for narrative, provide it with diagnosis-bearing fields redacted or moved into a clearly `historicalDiagnoses` block that the prompt forbids emitting.

### 3. Scope every source query

Where the schema permits, diagnosis-related source reads should bind to `encounter_id` first, then `episode_id`, then provider. Specific current gaps are:

- pain evaluation: case summary, PM extraction, prior initial visit, vitals, and provider identity;
- pain follow-up: latest completed encounter and performed procedure diagnoses;
- procedure suggestions: latest PM/IVN diagnosis merge;
- prior procedure narrative: series-filtered but not provider-filtered.

Not all historical context should be removed. The distinction should be explicit: history may inform reasoning, but it must not establish a diagnosis for today's encounter without current evidence and provider adoption.

### 4. Separate evidence use from code emission

Case-summary and earlier-clinician data can remain useful for:

- imaging previously obtained and reviewed today;
- longitudinal symptom history;
- differential diagnoses;
- prior treatment response.

They should not directly populate today's diagnosis list. A code based on historical imaging should require a current marker such as `reviewed_at_encounter_id`, plus current symptom-region correlation. A diagnosis based on another clinician's exam should remain `historical_only` unless the current provider confirms it.

### 5. Add deterministic post-generation validation

Before save/finalize, parse emitted codes and compare them with the authoritative pool. Reject or flag:

- a code absent from the pool;
- a code whose only evidence belongs to another encounter/provider;
- a region not documented today;
- a symptom diagnosis contradicted as resolved today;
- a recommendation diagnosis absent from the note's allowed pool.

The existing ICD-10 rewrite utilities and QC validators demonstrate the right pure-function/test style (`src/lib/icd10/diagnosis-rewrite.ts`, `src/lib/qc/diagnosis-validators.ts`), but they currently enforce coding-chain rules, not encounter provenance.

## Suggested implementation order

1. Pain follow-up first: it has no diagnosis-source contract and sends all episode procedures to the model.
2. Pain evaluation second: replace case-summary/PM diagnosis candidates with encounter-selected codes; retain imaging/history as labeled evidence.
3. Procedure generation third: convert its prompt-only current-visit Filter (E) and source precedence into a deterministic pool/validator, and provider-scope suggestions.
4. Leave discharge course-wide by design, but keep its pool explicitly separate from visit diagnosis logic.

## Existing tests

- `src/lib/claude/__tests__/generate-initial-visit.test.ts:124-213` asserts initial/pain-evaluation prompt contracts and payload presence.
- `src/lib/claude/__tests__/generate-procedure-note.test.ts:419-519, 575-577, 749-756` asserts source precedence and current-visit prompt clauses. These are prompt-text tests, not output/provenance tests.
- `src/lib/claude/__tests__/generate-pain-follow-up.test.ts:15-97` tests routing, telehealth safeguards, regeneration, and UUID normalization; it has no diagnosis-selection coverage.
- `src/lib/icd10/__tests__/diagnosis-rewrite.test.ts:13-117` thoroughly covers deterministic external-cause and encounter-suffix rewrites.
- `src/lib/qc/__tests__/diagnosis-validators.test.ts:112-319` covers coding-chain validation but not current-visit evidence or source clinician.
- `src/lib/claude/__tests__/context-bundle.test.ts:4-34` covers shallow context retention/removal, not nested diagnosis redaction.

## Test gaps to close

- A diagnosis from case summary only cannot enter a pain-evaluation diagnosis list.
- A procedure diagnosis from an earlier encounter cannot enter a pain follow-up unless the current provider selects it.
- A diagnosis documented only by a different provider remains historical.
- A current-visit body region and evidence can promote a historical suggestion after provider confirmation.
- Regenerating only the diagnosis section cannot recover disallowed codes from other note sections or raw context.
- Finalization rejects diagnosis codes not present in the encounter's authoritative pool.

## Historical context

The repository has progressively strengthened procedure-note diagnosis rules with source precedence, evidence tags, current-visit Filter (E), and deterministic ICD-10 rewriting. Research documents such as `thoughts/shared/research/2026-04-20-pm-notes-diagnosis-generation.md`, `2026-04-28-clinical-note-qc-pi-workflow.md`, and `2026-04-29-qc-rule1-specificity-monotonicity.md` describe that evolution. The current gap is not lack of prompt detail; it is the absence of the same deterministic boundary in pain evaluations and follow-ups.

## Open questions

1. Should a clinician be allowed to adopt a prior provider's diagnosis with one confirmation click, or must current evidence be entered first?
2. Does `clinical_encounters` need a dedicated structured diagnosis field, or should diagnoses live in a normalized child table with provenance rows?
3. Should historical imaging count as current-visit evidence only when the clinician explicitly marks it reviewed today?
4. For shared-care episodes, should continuity follow provider, specialty, procedure series, or an explicit care-team relationship?
5. Is the intended scope only pain follow-ups, or should pain evaluations and procedure-record defaults be changed in the same project?
