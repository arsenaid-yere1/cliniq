# Complaint-matched Exam Findings

## Research question

Where would a button in Initial Visit / Pain Evaluation Visit → Exam Findings create examination areas matching Chief Complaints, and how does the current implementation support editable examples contextualized by the complained area's pain level?

Scope: current-state research and requested integration recommendations. No application code changed.

## Summary

- Both visit types already share `ExamFindingsCard`; one integration can support both while retaining separate encounter data.
- The card currently adds regions manually. It does not read Chief Complaints or their pain levels.
- There are already 102 example templates across 22 anatomical groups. Selection depends on field and region, never pain severity.
- Chief Complaints captures nullable `severity_min` and `severity_max` per area. There is no existing rule in this feature for choosing one score or mapping scores to example findings.
- The critical integration gap is live draft access: complaints and examination findings use separate forms, and their shared context coordinates saving without exposing field values.

## Current components and data flow

### Encounter ownership and tab placement

`src/components/clinical/initial-visit-editor.tsx:247` force-mounts each visit-type tab. Each has its own `IntakeDraftProvider` at line 248 and its own editor instance. `InitialVisitEditorInner` derives `parsedIntake` from the supplied intake or note at line 366. The pre-generation branch begins at line 403; it mounts `ChiefComplaintsCard` at line 454 and `ExamFindingsCard` at line 469 with the same persisted intake object and current visit type.

The editable intake tabs belong to the pre-generation workflow. Generated drafts and finalized notes use separate views. `src/components/clinical/__tests__/psychological-visit-editor.test.tsx:191` explicitly verifies that exam intake is not added to generated notes.

### Chief Complaints

`src/components/clinical/chief-complaints-card.tsx:28` initializes a local form for `chief_complaints`. Each row captures `body_region`, character, severity range, pattern, radiation, and aggravating/alleviating factors. Lines 145–149 render the severity inputs.

`src/lib/validations/initial-visit-note.ts:125` defines `chiefComplaintEntrySchema`: both severity bounds are nullable integers from 0 through 10. This schema does not enforce minimum ≤ maximum. Side is embedded in the free-text `body_region`, not stored as a separate property.

`src/lib/clinical/complaint-factor-hints.ts:86` recognizes exact aliases after stripping a leading side and optional trailing `pain`. `setComplaintSide` at line 98 preserves the base text. Composite/custom regions remain free text.

### Examination regions

`src/components/clinical/exam-findings-card.tsx:17` is the shared card. It initializes only `exam_findings` at line 21 and uses `useFieldArray` for regions. The existing `add()` function appends a named row at line 39 with blank palpation, null additional findings, and null muscle-spasm assessment. The button is at line 74, beneath the Examination Regions list.

`src/lib/validations/initial-visit-note.ts:168` defines each region as `{ region, palpation_findings, muscle_spasm, additional_findings }`. No pain score or complaint identifier is stored in that row. Defaults at the end of the file contain zero examination regions.

The disabled boundary at `exam-findings-card.tsx:25` combines case lock, current save, and shared intake busy state. Existing rows support editing, independent expansion, removal, nullable assessment, and explicit saving.

### Example catalog and insertion

`src/lib/clinical/exam-finding-examples.ts:8` defines 102 templates; line 113 begins 22 region groups. `getExamRegion` at line 282 recognizes exact aliases and leading side prefixes. Unlike the complaint helper, it does not strip a trailing `pain`. Thus `Left knee pain` can select complaint hints but cannot directly select knee exam examples. Ambiguous text such as `neck and shoulder` is not split into anatomical regions.

`getExamExamples(field, rawRegion, generic)` at line 289 selects and orders examples by field and anatomy. Its signature and `ExamExample` type contain no severity input or severity bands. Current examples include tenderness, movement observations, inspection, function, neurological assessment, and named special tests.

`src/components/clinical/exam-finding-field.tsx:20` renders chips, expandable search, completion forms, and editable text. `completeExamExample` at `exam-finding-examples.ts:334` requires missing details before insertion. A preview does not write the finding. Inserted text supports conflict replacement and Undo. The UI explicitly says to use observed findings; this is existing product behavior, not a new clinical rule proposed by this research.

### Saving and draft sharing

`src/components/clinical/intake-draft-context.tsx:10` registers `{ dirty, saving, save }` per section. It exposes aggregate status and sequential `flush`, but no current complaint values.

`useIntakeSectionSave` at line 75 reads its own form, builds the intake payload, and calls `saveProviderIntake(caseId, visitType, full, section)`. It resets the saved local form and retains errors for retry. Server/database merge internals were outside this focused research.

Current flow:

1. Persisted visit-specific intake initializes separate complaint and exam forms.
2. Complaint edits stay in the complaint form until saved; mounted tabs preserve local changes.
3. Exam regions and selected findings stay in the exam form until saved.
4. The shared context can flush dirty sections before note generation; it does not transfer complaint values to the exam form.

## Requested integration recommendations

These are proposed behavior, not already implemented functionality.

1. Put **Generate areas from Chief Complaints** beside **Add Exam Region** in the shared card.
2. Expose the current complaint draft within the existing visit-scoped provider or parent. Reading only `initialIntake` would miss unsaved complaint edits.
3. Append missing regions while preserving existing findings. Match supported aliases with laterality; do not merge left and right. Keep unknown/custom regions editable. Define handling for composite region text explicitly.
4. Reuse the existing example controls. Carry the complaint's severity range as context for example selection; leave examples editable and explicitly inserted, consistent with current behavior.
5. Retain the current save/lock boundaries and visit isolation. Existing region strings and finding fields can represent this minimal interaction without a schema change; that is an implementation inference, not verified implementation.

## Decisions not established by existing code

- How a minimum/maximum pain range selects examples: maximum, separate range, or another defined rule.
- Which example wording belongs to each pain band; the current catalog has no such mapping.
- Handling missing, zero, reversed, or overlapping severity ranges.
- How repeated complaints for the same side/area combine their severity context.
- Whether a second button click adds only missing areas or also refreshes displayed suggestions. Preserving entered findings is the recommended default.

## Tests and verification

Ran:

```sh
npm test -- src/components/clinical/__tests__/exam-findings-card.test.tsx src/components/clinical/__tests__/exam-finding-field.test.tsx src/components/clinical/__tests__/chief-complaints-card.test.tsx src/lib/clinical/__tests__/exam-finding-examples.test.ts
```

Result: **4 files, 171 tests passed**. Current coverage includes region mapping, template completion, editable insertion, conflict handling/Undo, lock behavior, save retry, and separate visit-type save payloads. No existing test exercises complaint-driven region generation because that behavior is absent.

Future behavioral coverage should include unsaved complaint edits, duplicate clicks, aliases and laterality, missing pain bounds, preservation of existing findings, and independent Initial Visit / Pain Evaluation drafts.

`git diff --check` passed before writing this document. No application lint/type-check or browser verification was performed for this research-only task. Tests use mocked save actions; they do not prove persistence or clinical correctness of any proposed severity-based wording.

## Historical context and Graphify

`git log -- src/components/clinical/exam-findings-card.tsx` identifies `eba1e09` (`feat: add exam findings examples`). `thoughts/shared/research/2026-09-17-exam-findings-apparent-revert.md` records the prior deployment/source mismatch and subsequent restoration. Its deployment statements are historical; this task did not inspect current production.

The entire repository Graphify index was refreshed first: all code was re-extracted (including 117 SQL files after adding a temporary SQL parser), and all 103 changed documents were indexed. Result: 5,025 nodes, 11,042 relationships, 405 communities. Full detail is in `graphify-out/graph.json`; the HTML uses a community overview because the graph exceeds 5,000 nodes.

The initial graph query used vocabulary-confirmed terms `exam findings complaints pain initial visit examples region severity intake`. Its broad traversal found 560 nodes and was truncated; conclusions above were verified from source rather than inferred from the graph alone.

Final graph diagnostics found no missing/dangling endpoints or self-loops. Raw code extraction reported unresolved endpoints, duplicate/self-loop edges, and same-endpoint collapse risk; these limitations are retained in `graphify-out/EXTRACTION_DIAGNOSTICS.json`. Twelve configuration/fixture JSON files yielded no named entities. Agent token usage was unavailable and was not estimated.
