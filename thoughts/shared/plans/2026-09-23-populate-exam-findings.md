# Populate Exam Findings Implementation Plan

## Overview

Add one Generate Example Findings button that applies editable example paragraphs directly to the existing exam form for both pre-generation visit types. No preview modal or intermediate chip workflow.

## Current State

ExamFindingsCard owns an exam-only form. The separate ChiefComplaintsCard form shares a visit-scoped IntakeDraftProvider, which currently registers save callbacks but not readers. The existing exam catalog provides anatomy normalization and site information. Regional fields are palpation text, additional text, and nullable spasm assessment; general appearance and neurological notes are global text fields.

## Desired End State

On click, read live complaint values, including unsaved changes. Populate empty General Appearance and regional palpation/additional fields, appending missing regions. Preserve existing text and all spasm/neurological assessments. Keep the standard Save Exam Findings action and dirty/flush behavior. Show concise example-review guidance next to the button.

## Key Discoveries

- `src/components/clinical/intake-draft-context.tsx`: optional section readers can reuse the existing visit-specific registration without a second state store or editor changes.
- `src/components/clinical/exam-findings-card.tsx`: use setValue for existing rows to preserve row identity and append for new rows.
- `src/lib/clinical/exam-finding-examples.ts`: getExamRegion recognizes aliases and sides but does not remove trailing pain. Normalize that suffix locally for complaint matching.
- `src/lib/validations/initial-visit-note.ts`: complaint severity is a nullable integer range; exam rows need no schema changes.

## What We Are Not Doing

No server/AI calls, schema migrations, automatic saving, deployment, or changes to generated/finalized note availability. No automatic spasm assessments, measured ROM, or special-test outcomes. The user's subsequent request adds an editable Neurological Notes example when that field is empty.

## Implementation Approach

Use deterministic illustrative wording. For valid scores use the highest available bound (duplicate same-area complaints use the highest score); template bands are 1–3 mild, 4–6 moderate, 7–10 marked. These are example wording choices, not clinical inference rules. Zero or missing scores create the area with blank findings rather than asserting normal findings. Invalid/out-of-range/reversed ranges block population with actionable feedback. General text uses the highest available score. Preserve side and canonicalize known anatomy; preserve custom region names and use generic local prose. Blank complaints are ignored. Duplicate clicks and aliases must not duplicate areas. Do not merge distinct laterality.

## Phase 1: Pure paragraph helper

### Files and changes

- Add `src/lib/clinical/populate-exam-findings.ts` for complaint normalization, severity-context validation, example generation, and immutable fill-empty merging.
- Add `src/lib/clinical/__tests__/populate-exam-findings.test.ts` for anatomy/side matching, severity bands, null/zero/reversed inputs, preservation, custom regions, and idempotence.

### Automated verification

Run the new helper tests. Assert no spasm or neurological assessment is generated and input objects remain unchanged.

### Manual verification

Review representative GENERAL/cervical/lumbar strings and placement in the existing data structure.

## Phase 2: Form action and live draft reader

### Files and changes

- Extend optional draft registration in `src/components/clinical/intake-draft-context.tsx` with a read callback and a stable readSection accessor. Existing manual registrations remain compatible.
- Add the button and feedback to `src/components/clinical/exam-findings-card.tsx`; validate current complaints with chiefComplaintsSchema, fallback to initial data only if there is no mounted draft reader. Update changed leaf values with shouldDirty and append new regions with existing focus conventions.
- Extend `src/components/clinical/__tests__/exam-findings-card.test.tsx` and `src/components/clinical/__tests__/psychological-visit-editor.test.tsx` for direct population, preservation, repeated clicks, empty/invalid input, lock/save boundaries, live unsaved changes after multiple edits, visit isolation, and flush-before-generation.

### Automated verification

Run helper/component/editor regression tests, existing intake consumers, TypeScript, ESLint on changed source/tests, and git diff --check. No formatter script exists; follow local file formatting and lint.

### Manual verification

Inspect direct placement and button semantics via rendered component tests. Authenticated browser verification depends on a available local synthetic session; report honestly if not performed.

## Risks and rollback considerations

Examples must be visibly identified as examples and editable. Preserve entered clinical text; do not silently replace it. Reader callbacks must read current values without depending on dirty-state changes. Rollback removes the button/helper/reader; persisted content remains ordinary existing intake strings.

## Completion criteria

Both visit types populate their own current complaints directly into form fields, preserve existing entries, block invalid ranges, and pass focused tests/type checking/lint. No additional review workflow or automatic persistence is introduced.

## Verification Summary

Overall readiness: Ready. Source and test interfaces inspected; reader is optional to preserve vitals registration. Existing per-visit providers enforce isolation. Region updates must use setValue, not replace, to preserve row identity. Severity zero/missing is explicitly neutral and spasm/neurological values are untouched. No unresolved implementation decisions. Approve implementation.

## Implementation results

### Neurological Notes extension

User requested populating Neurological Notes as well. Fill an empty neurological field with the user's example style: motor and sensory examination grossly intact. Select upper/lower-extremity scope from recognized complaint anatomy and retain unilateral side when all complaints in that scope specify it. Merge bilateral or unspecified scope to avoid duplicate sentences. Use generic motor/sensory wording for other/custom anatomy. This is editable example wording, independent of pain intensity, not an inferred neurological assessment. Preserve any existing neurological text. No change to save behavior or database schema.

Verification before implementation: the existing nullable neurological_notes string supports the extension; the component needs an additional setValue alongside general_appearance. Extend helper tests for scope, side, missing/zero pain, and preservation; extend both-visit component tests for insertion, editing, repeated clicks, and saved payload.

Implemented and verified: the same button now fills empty Neurological Notes directly. Existing text and subsequent clinician edits survive repeated clicks. Upper/lower scope and unilateral side are covered by helper tests, and component tests verify the saved neurological value for both visit types. Focused helper/card/editor run: **3 files / 58 tests passed**. `npx tsc --noEmit`, ESLint on the four changed source/test files, and `git diff --check` passed. Reviewed the helper and form changes; no authenticated browser or deployment performed for this extension.

### Approved visual and phase completion

The user approved the editable form example on September 23, 2026 and requested proceeding with the plan and implementation. The existing local implementation was compared with that approved example and already matches its field placement and sample wording: GENERAL in General Appearance, regional tenderness in Palpation Findings, and movement/guarding prose in Additional Findings. The example uses bilateral cervical pain 6–8/10 and lumbar pain 4–6/10. The visualization is a focused illustration; the application retains its existing region-name inputs, example chips, and disclosure controls.

- [x] Phase 1: paragraph helper and unit tests.
- [x] Phase 2: direct form action, live draft reader, and component/editor regressions.
- [x] Automated checks passed on the current implementation (216 tests, TypeScript, ESLint, whitespace).
- [x] User approved the visual example.
- [ ] Authenticated browser acceptance against the running application (not performed).

The approval review required no further application changes. Automated suites were not repeated solely for this documentation update. Changes remain local and uncommitted; production deployment is outside this plan.

Both phases complete. The button applies General Appearance, regional Palpation Findings, and regional Additional Findings directly; no intermediate preview or save is triggered. Readers get current mounted form values even after a second edit while already dirty. Existing findings, muscle-spasm assessments, and neurological notes are preserved. No editor or schema changes were needed.

Automated checks:

```sh
npm test -- src/lib/clinical/__tests__/populate-exam-findings.test.ts src/lib/clinical/__tests__/exam-finding-examples.test.ts src/components/clinical/__tests__/exam-findings-card.test.tsx src/components/clinical/__tests__/exam-finding-field.test.tsx src/components/clinical/__tests__/chief-complaints-card.test.tsx src/components/clinical/__tests__/psychological-assessment-card.test.tsx src/components/clinical/__tests__/psychological-visit-editor.test.tsx
npx tsc --noEmit
npx eslint src/lib/clinical/populate-exam-findings.ts src/lib/clinical/__tests__/populate-exam-findings.test.ts src/components/clinical/intake-draft-context.tsx src/components/clinical/exam-findings-card.tsx src/components/clinical/__tests__/exam-findings-card.test.tsx src/components/clinical/__tests__/psychological-visit-editor.test.tsx
git diff --check
```

Results: 7 test files / 216 tests passed; TypeScript, changed-file ESLint, and whitespace checks passed. An earlier narrow pass had 49 passing tests before additional invalid-input and pending-save coverage. No formatter script exists.

Manual verification: reviewed the diff and representative generated strings. No authenticated browser workflow or production deployment performed. Component/editor tests use synthetic intake and mocked save actions; they verify placement and save ordering, not live database persistence or clinical validity of example prose.
