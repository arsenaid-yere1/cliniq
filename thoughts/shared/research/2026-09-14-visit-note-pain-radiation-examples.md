# Visit Note pain radiation examples by body area

Date: 2026-09-14
Scope: Current-state research; no application changes.

## Research question

How do Visit Note forms let providers document pain radiation, and what currently supports seeing and adding examples based on the entered body area?

## Summary

The Chief Complaints form already pairs a free-text Body Region with a nullable free-text Radiates To field for every complaint. Its only radiation example is the static placeholder “e.g., left arm”. Entering a different area does not change that example. There is no radiation example catalog, selectable suggestion, or add-example action in this component. Providers can type radiation descriptions manually and save them as intake for note generation.

## Detailed findings by component

### Visit Note form and encounter boundaries

- `src/components/clinical/initial-visit-editor.tsx:213`, `InitialVisitEditor`: Initial Visit and Pain Evaluation Visit have separate editor instances and intake draft providers.
- `InitialVisitEditorInner`, same file at `:411` and `:457`: both visit types show `ChiefComplaintsCard` before generation.
- `ChiefComplaintsCard`, same file at `:611`: React Hook Form initializes from saved chief complaints or the default intake; `useFieldArray` owns individual complaint rows.
- At `:647`, Body Region is an unrestricted input with placeholder “e.g., Neck, Lower Back”. There is no area selector or region-dependent branch in this card.
- At `:698`, Radiates To binds to `chief_complaints.complaints.${index}.radiates_to`. Its placeholder is always “e.g., left arm”. Empty input becomes `null`; otherwise the entered string is retained. Changing Body Region does not clear or transform radiation text.
- At `:720`, Add Complaint appends a new blank complaint with `radiates_to: null`. It adds a complaint row, not a radiation example.
- At `:762`, Save Chief Complaints invokes the shared intake save hook.
- At `:1655`, the generated draft's Chief Complaints editor is limited to Initial Visit. Finalized notes display narrative rather than this structured complaint form.

### Data contract and persistence

- `src/lib/validations/initial-visit-note.ts:124`, `chiefComplaintEntrySchema`: `body_region` is a string and `radiates_to` is a nullable string. No region identifier, list of radiation destinations, or example selection metadata exists in this schema.
- Same file at `:195`, `defaultProviderIntake`: the first complaint has a blank body region and null radiation.
- `src/components/clinical/intake-draft-context.tsx:77`, `useIntakeSectionSave`: validates the form, gets values, and sends the selected section to `saveProviderIntake`. A successful save resets the form to its saved values; failure preserves input and shows an error.
- `src/actions/initial-visit-notes.ts:1221`, `saveProviderIntake`: loads the note for case and visit type, merges the selected section with stored intake, validates against `providerIntakeSchema`, and writes `initial_visit_notes.provider_intake`. Existing notes use status and update-time checks; new notes are created as drafts. Generating and finalized notes reject intake writes.

### Generation

- `src/lib/claude/generate-initial-visit.ts:77`: provider intake is identified as the primary source for complaint regions, character, severity, radiation, and factors; it takes precedence over overlapping case-summary data.
- Same file at `:107`: the Chief Complaint prompt requests radiation status for each complaint. This is narrative generation guidance, not a UI suggestion catalog.
- Same file at `:613`: curated case input is serialized into the generation request; regeneration likewise serializes input at `:691`.
- The static placeholder is not a form value and is not saved as a patient finding.

### Comparable existing code

- `src/components/visits/pain-follow-up-editor.tsx:340`: return-visit note sections render generic prose textareas (`:382`), without an area-dependent radiation control.
- `src/components/clinical/pm-extraction-form.tsx:289`: a separate Radiation input edits extracted chief complaints, with static placeholder “e.g. radiates to left arm”.
- `src/components/clinical/ortho-extraction-form.tsx:395`: a separate Radiation input edits extracted present complaints, with static placeholder “e.g. radiates down to hand”. Neither examined field offers selectable examples.
- `src/lib/procedures/parse-body-region.ts:6`, `parseBodyRegion`: parses laterality prefixes and title-cases an injection site. It does not supply radiation examples or canonical aliases such as Neck → Cervical Spine.

## Execution flow

Entered body area and radiation → independent complaint-row fields → Save Chief Complaints (or dirty-intake flush before generation) → selected-section merge and schema validation → saved provider intake for the visit type → generation input → Chief Complaint narrative.

There is currently no step that derives radiation suggestions from the entered area.

## Existing tests and verification

- `src/components/clinical/__tests__/psychological-visit-editor.test.tsx`: encounter/tab isolation, preservation of edits, dirty chief-complaint saves before generation, failed validation, and vitals flushing. It does not assert radiation suggestion behavior.
- `src/lib/validations/__tests__/initial-visit-note.test.ts`: section schemas and vitals validation; no radiation-specific or area-example coverage.
- `src/lib/claude/__tests__/generate-initial-visit.test.ts:177`: checks the prompt's requirement that subjective radiation alone is insufficient for radiculopathy; this is prompt coverage, not an example-selection test. This suite was inspected but not run in this task.
- Executed `npm test -- src/lib/validations/__tests__/initial-visit-note.test.ts src/components/clinical/__tests__/psychological-visit-editor.test.tsx`: **2 files, 15 tests passed**.
- Executed `git diff --check`: passed for tracked changes. Source searches and file reads verified the findings. No browser verification, lint, type check, or database tests were run for this documentation-only task.
- Graph lookup: `graphify query` was unavailable on PATH; running the query through the interpreter recorded in `graphify-out/.graphify_python` succeeded. It identified the editor and related extraction forms. The tool reported a skill/package version mismatch; current source, rather than graph line numbers, anchors this report.

## Historical context

- `thoughts/shared/research/2026-09-14-visit-note-factor-hints.md` documents the neighboring aggravating/alleviating factor fields and the same free-text area behavior. It is research, not an implemented hint system.
- `git log -4 --oneline -- src/components/clinical/initial-visit-editor.tsx` returned `c73116e` (psychological assessment intake), `fabba99` (stale-version finalization fix), `61b6725` (visit treatment-plan decisions), and `829899a` (case reactivation and note reset).

## Open product questions

1. Does “add examples” mean clicking supplied examples into the current complaint, or authoring reusable examples for future visits?
2. Which areas and wording should be supported, and how should free-text aliases, laterality, blank input, and unrecognized areas behave?
3. Can several examples be added to one complaint, and should addition append to or replace existing free text?
4. Is the scope the Initial Visit and Pain Evaluation intake forms, or also return visits and extraction-review forms?

Inference: inserting selected example text into the existing nullable string could preserve the current intake contract. A reusable provider-authored example library is a different capability; no such library was found in the examined radiation flow. Neither behavior is implemented by this research.
