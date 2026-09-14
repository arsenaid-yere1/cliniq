# Visit note factor hints Implementation Plan

## Overview

Implement the approved intake form concept: editable body-region suggestions, region-specific factor chips, free-text entry, expandable complaint summaries, and visible save feedback. The user approved the visual on 2026-09-14. Implementation completed on 2026-09-14; live-app acceptance checks remain as described below.

Research: `thoughts/shared/research/2026-09-14-visit-note-factor-hints.md`.
Visual reference: `/Users/macbookpro/.codex/visualizations/2026/09/14/01a0a1ac-c8c4-7cb2-9518-a6be30743f70/visit-intake-form.html`. Treat it as the interaction/layout direction, not production logic or complete clinical field coverage.

## Current State

- `src/components/clinical/initial-visit-editor.tsx`, `ChiefComplaintsCard` (line 611): a React Hook Form field array, free-text body region, static factor placeholders, add/remove, sleep disturbance, additional notes, and explicit section save.
- `src/lib/validations/initial-visit-note.ts`, `chiefComplaintEntrySchema`: body region and both factor fields are strings. Severity uses separate nullable numeric minimum/maximum values. Pattern and radiation are separate fields.
- `src/components/clinical/intake-draft-context.tsx`, `useIntakeSectionSave`: validates, saves the selected section, resets on success, retains failed edits, and exposes `isDirty`, `isSaving`, `error`, and `hasSaved`.
- The outer `InitialVisitEditor` mounts independent visit-type instances/providers. Both visit types expose complaints before generation; only Initial Visit exposes complaint editing after generation. Preserve these boundaries.
- Dirty intake is flushed before generation. Draft regeneration/finalization is guarded while intake is dirty or saving. The new controls must participate in that same form state.
- `src/components/ui/form.tsx` supplies label/description/control IDs through `FormField`, `FormItem`, `FormControl`, and `FormDescription`.
- `src/lib/clinical/anatomic-normalization.ts`, `normalizeRegion`: existing clinical aliases include neck/cervical and low back/lumbar. Its substring matching is broader than appropriate for a single-region suggestion UI; do not use it to guess a region from arbitrary prose.
- `package.json` provides Vitest and ESLint; `vitest.config.ts` defaults to node, with component tests opting into jsdom.

## Desired End State

### Region and side

1. Keep Body Region directly editable and immediately committed to its existing string form field. Add a native datalist using the existing `Input`, with common labels and alias text; custom entries remain valid. This avoids a new dependency and retains direct typing. Verify native suggestions in the real browser, because jsdom cannot exercise that popup.
2. Initial targeted regions are **Neck, Lower back, Shoulder, Knee**, matching the approved concept. Include explicit alias-valued datalist options such as Cervical spine and Lumbar spine as well as canonical values; do not depend on browsers searching option labels. Typed aliases drive the same examples. Other text, blank text, and unsupported regions use explicitly labeled **General examples**.
3. Preserve arbitrary existing region strings exactly on mount, save, and tab switches. Region selection changes only the region field, never factor text.
4. Side options are Not specified, Left, Right, and Both sides. Store explicit choices using the current convention in `body_region` (e.g. `Left Shoulder`, `Bilateral Knee`), not a new property. Unlike the illustration, do not add a separate Midline value: it remains valid as custom region wording.
5. For recognized single-region entries only, derive the side selector from an anchored laterality prefix. Changing a suggestion preserves that prefix; changing Side replaces/removes only that prefix. Disable Side for blank/custom/multiple-region text and explain “Include side in the region text.” Do not rewrite custom prose or infer laterality from an incidental word.
6. Construct datalist option values with the currently explicit side prefix (e.g. `Left Knee` while Left is selected). The input remains the full stored region string: a normal input change always writes exactly what the user typed/selected, with no attempt to distinguish browser suggestion selection from typing. Deleting a prefix manually clears Side. Side remains derived from the current value, not a second persisted or stale local state.

### Factor selection

1. Keep the labels Aggravating Factors and Alleviating Factors accessible; add “Worse with” / “Better with” as visible leading wording. Keep both textareas available and editable.
2. Display “Examples—select only what the patient reports.” Show the first three suggestions per factor group; each group has its own More/Fewer examples control. Opening/collapsing suggestions does not dirty or save the form.
3. Suggestions are unselected on empty fields. Selecting appends a semicolon-delimited example. Clicking a selected chip removes only its exact standalone segment. Never perform substring replacement in clinical prose, split on commas, or rewrite unrelated whitespace/newlines.
4. Use the current string as the source of truth. Identify standalone semicolon-delimited segments by trimmed, case-insensitive equality; do not infer selection from sentences such as “rest did not help”. Unit-test span-based edits rather than normalizing and rejoining the entire string. On removal, remove the matching span and one adjacent separator; preserve all other characters. If legacy duplicate standalone segments exist, remove the first match per click and remain selected until no match remains.
5. If a manually edited segment no longer equals a chip label, treat it as custom text. That chip becomes unselected; clicking it appends a new explicit example rather than erasing the edited sentence.
6. None reported and Not assessed are explicit whole-field choices, never defaults. If the field is empty or already exactly one of those statuses, selecting a status sets/toggles it directly. If other text exists, show an inline “Replace current text with ‘None reported’?” (or Not assessed) with Replace and Cancel. Nothing changes until Replace. Keep a one-step Undo using the pre-replacement string; invalidate Undo after any subsequent factor edit (typing or chips), save/reset, or region change. Cancel a pending replacement on external value/region changes; Replace must never apply to a stale snapshot. Selecting a normal example replaces an exact whole-field status, but does not strip status-like words from custom prose.
7. A region change refreshes examples and preserves the complete factor strings. Reset each More/Fewer control to its collapsed state. If factors already contain text, show a quiet helper: “Existing factors kept—review for this region.” This is informational, not a new validation gate.

### Complaint cards and saves

1. Extract the card into a dedicated component. Retain pain character, both numeric severity inputs, persistent/intermittent pattern, radiation, sleep disturbance, and additional notes. The visual’s combined severity input and abbreviated card are not the data contract.
2. Each row has a keyboard-operable expand/collapse button and compact summary of current region, character, severity range, and entered factors. Empty values display “Not entered”, never “None”. Show a neutral “Complaint N”, not an inferred “Complete” or “Saved” status.
3. Start existing rows expanded; allow manual collapse. Add Complaint appends the current blank template, expands the new row, and focuses its region input. Do not automatically collapse another unfinished row. Keep field controllers mounted when collapsed, using `hidden` on the content and stable field-array keys.
4. Removing a row must not move its selection, side, disclosure, or undo state to another row. After deletion focus a surviving row toggle or Add Complaint. After a successful form reset regenerates row IDs, it is acceptable for rows to expand and transient Undo to clear; all saved values must remain correct.
5. Show section status: Saving… while saving; an inline error on failure; Unsaved changes when dirty; Saved after a successful save or when initialized from stored intake; otherwise Not saved yet. Use `role="status"` for status and `role="alert"` for save errors. Never infer a successful write solely from `!isDirty`.
6. Preserve the existing Save Chief Complaints and page-level Save intake and generate actions. Do not add another Generate button inside the card. Do not add autosave.
7. Respect `isLocked` and provider-wide `busy`: native fields and custom Select controls, chip actions, side changes, add/remove, and replacement confirmation must all be disabled. A surrounding native disabled fieldset alone does not reliably disable portaled controls; pass disabled explicitly to Select and handlers. Read-only disclosure can remain available.

### Initial example catalog

Use only optional interview examples from the approved visual, with no diagnosis, treatment recommendation, dosing, or assumed finding. Order below defines the initial three chips.

| Region | Worse with | Better with |
| --- | --- | --- |
| Neck | Turning the head; Looking down; Prolonged desk work; Driving; Sleeping position | Rest; Changing position; Heat; Ice |
| Lower back | Prolonged sitting; Bending; Lifting; Standing; Walking | Rest; Changing position; Lying down; Heat |
| Shoulder | Reaching overhead; Lifting; Lying on that side; Reaching behind | Rest; Supporting the arm; Ice; Changing position |
| Knee | Stairs; Squatting; Prolonged standing; Walking | Rest; Sitting; Ice; Elevation |
| General | Activity; Prolonged positioning; Movement | Rest; Changing position; Heat; Ice |

No examples enter the chart unless selected/typed. Display copy must frame all items as patient-reported factors, not advice. Expanding the region/content catalog is separate future work.

## Key Discoveries

- Display state and saved values must be separate: chip selection derives from each textarea; More/Fewer and collapse remain local UI state.
- The existing save hook already exposes the status fields needed; no shared-hook rewrite is required.
- The broad `normalizeRegion` function can match one region in multi-region prose. Use a strict finite alias lookup for the four hint groups instead: trim/collapse whitespace for lookup only, remove one recognized anchored side prefix, then exact-match aliases (including singular/plural Shoulder/Knee). Neck aliases: neck, cervical, cervical spine, c-spine. Lower-back aliases: low back, lower back, lumbar, lumbar spine, l-spine, lumbosacral. Unknown and compound values use General. These UI aliases are intentionally narrower than clinical inference.
- Current values remain useful to existing consumers because the saved structure stays unchanged. No hint IDs, UI state, or generated defaults go into provider intake.

## What We Are Not Doing

- Database migrations, schema changes, new libraries, changes to generation prompts, or patient-data migrations.
- Expanding editing to new visit types/states; changing finalized-note presentation.
- Altering psychological assessment, procedure parsing, clinical anatomy inference, or intake concurrency behavior.
- Automatically inserting examples on region selection, generating factors with AI, or marking a complaint clinically complete.
- Replacing separate severity fields, removing existing fields, autosaving, or changing page navigation.

## Implementation Approach

Three phases: pure presentation helpers, isolated complaint UI, then editor integration/regression verification. Keep new files within clinical UI/library ownership. Source edits occur only in implementation, after this planning task.

## Phase 1: Region catalog and safe text operations

### Files and changes

- **New** `src/lib/clinical/complaint-factor-hints.ts`: readonly catalog and strict lookup; region suggestion labels; lossless side-prefix read/replace helpers limited to recognized inputs. Do not import procedure-specific parsing or change shared anatomy normalization.
- **New** `src/lib/clinical/complaint-factor-text.ts`: pure helpers to detect exact standalone examples and append/remove one segment without rewriting prose; classify exact whole-field statuses. Replacement confirmation/Undo belongs in the UI.
- **New** tests alongside these under `src/lib/clinical/__tests__/complaint-factor-hints.test.ts` and `complaint-factor-text.test.ts`.

### Automated verification

`npm test -- src/lib/clinical/__tests__/complaint-factor-hints.test.ts src/lib/clinical/__tests__/complaint-factor-text.test.ts`

Cover case/whitespace/aliases, Lt./Rt./L/R/Both/Bilateral prefixes, supported plurals, blank/custom/multiple-region fallback; preservation of input on lookup; explicit side replacement/removal; no substring false positives. Cover empty text, additions, removal at each segment position, semicolons/commas/newlines, duplicates, negated prose, manual edits, exact statuses, and byte-for-byte preservation of unrelated text. Test that catalogs contain no duplicate labels within a group.

### Manual verification

Review catalog and helper contracts against this plan. No UI exists yet; no manual browser result should be claimed.

## Phase 2: Reusable complaint card UI

### Files and changes

- **New** `src/components/clinical/chief-complaints-card.tsx`: move `ChiefComplaintsCard` into this file, exporting it with explicit `caseId`, `visitType`, `initialIntake`, `isLocked` props. Keep its form schema shape and single `useIntakeSectionSave` registration. Define a row component in the same file to use `useWatch` for that row and maintain stable local disclosure state.
- **New** `src/components/clinical/complaint-factor-field.tsx`: a field presentation component rendered inside the parent `FormField` callback. It owns `FormItem`, `FormLabel`, sibling suggestion buttons, `FormControl` wrapping the actual Textarea, and `FormDescription`. It accepts the field binding (`value/onChange/onBlur/name/ref`), label, suggestions, region key, and disabled state. It manages independently expandable examples and whole-field replacement/Undo. Do not wrap the whole component in another `FormControl`; generated IDs and ref must reach the actual textarea.
- Use current Button/Input/Select/Textarea/Form primitives and existing Tailwind conventions. Native datalist IDs use `useId` so two visit instances and multiple rows cannot collide. Collapse uses a native button with `aria-expanded`/`aria-controls` and a mounted hidden content region; delete is a separate button.
- Include responsive wrapping, visible focus, descriptive delete names, exact field labels, and section save feedback. Route all persisted changes through field `onChange` or `setValue` with `shouldDirty: true`; presentation controls never call those APIs.
- **New** `src/components/clinical/__tests__/chief-complaints-card.test.tsx` using jsdom, React Testing Library, `userEvent`, and a real `IntakeDraftProvider` with mocked save action.

### Automated verification

`npm test -- src/components/clinical/__tests__/chief-complaints-card.test.tsx`

Assert per-row region examples, fallback, unselected defaults, toggling to/from exact text, preservation of custom text, manual edits reflected in chips, independent More/Fewer groups, preservation on region change, side serialization, disabled custom Side, replacement Cancel/Replace/Undo and Undo invalidation, dirty flags only for data edits, collapsed mounted fields, add/focus/delete identity, lock/busy disabling, success/error status and retries. Assert submitted payload includes all original fields and only chosen examples. Re-render/reset with saved strings and verify chip state reconstructs correctly without metadata.

### Manual verification

Once integrated in Phase 3, compare desktop/narrow layouts to the approved concept. Phase 2 alone does not require a temporary production route or a separate component-preview dependency.

## Phase 3: Editor integration and regression checks

### Files and changes

- `src/components/clinical/initial-visit-editor.tsx`: import extracted `ChiefComplaintsCard`, remove its old inline definition, leave both pre-generation mounts and Initial Visit draft mount unchanged. Keep other intake-card props and helpers used elsewhere. Do not duplicate draft providers or move shared generation actions.
- `src/components/clinical/__tests__/psychological-visit-editor.test.tsx`: retain existing tests and add integration cases selecting chips in multiple complaints/visit types, switching tabs, then generating. Use role/label queries scoped to the visible visit/complaint. Verify selected strings reach `saveProviderIntake` before generation, untouched fields stay empty, and failed save blocks generation with edits retained.
- Update that suite's existing Body Region query from `getByRole('textbox', { name: 'Body Region' })` to `getByRole('combobox', { name: 'Body Region' })`: an input with a datalist has the combobox role. Preserve the save-before-generate assertion; do not weaken it to bypass an accessibility mismatch.
- Add an Initial Visit draft fixture to that integration suite: editing a factor blocks regenerate/finalize until saved; saved values restore correct chips. Verify Pain Evaluation draft does not gain a complaints tab and finalized view does not gain an editor.

### Automated verification

Run the new helper/component tests and the existing schema/integration/persistence suites together:

```sh
npm test -- src/lib/clinical/__tests__/complaint-factor-hints.test.ts src/lib/clinical/__tests__/complaint-factor-text.test.ts src/components/clinical/__tests__/chief-complaints-card.test.tsx src/components/clinical/__tests__/psychological-visit-editor.test.tsx src/lib/validations/__tests__/initial-visit-note.test.ts src/actions/__tests__/psychological-intake.test.ts
npm run lint -- src/lib/clinical/complaint-factor-hints.ts src/lib/clinical/complaint-factor-text.ts src/lib/clinical/__tests__/complaint-factor-hints.test.ts src/lib/clinical/__tests__/complaint-factor-text.test.ts src/components/clinical/chief-complaints-card.tsx src/components/clinical/complaint-factor-field.tsx src/components/clinical/__tests__/chief-complaints-card.test.tsx src/components/clinical/__tests__/psychological-visit-editor.test.tsx src/components/clinical/initial-visit-editor.tsx
npx tsc --noEmit
git diff --check
```

No dedicated formatting script is configured; match nearby style and use ESLint/diff whitespace checks. Report failures and distinguish pre-existing diagnostics rather than repairing unrelated code. Broaden tests if shared behavior must change; database reset/tests are unnecessary for the planned UI-only change.

### Manual verification

Use synthetic intake data in the existing Visit notes page:

- Initial Visit and Pain Evaluation before generation: four recognized regions, aliases, custom/blank regions; both side and typed prefixes; no automatic findings.
- Two complaints: type custom prose, select/remove examples, change region, collapse/expand, remove first row, verify second row values/focus remain correct.
- Keyboard-only input, native datalist selection, chips, disclosure, Replace/Cancel/Undo; verify Tab/Enter/Space behavior, label associations, and no accidental submit. Native popup remains optional: direct text entry must always work.
- Save/reload, slow/failed save, tab switching and save-before-generate; verify no silent data loss. Do not trigger a paid AI generation solely to test transport when the mocked integration proves it; actual generation is optional and must be reported separately.
- Initial Visit generated draft: factors can be edited, intake guards remain; finalized/locked states cannot mutate.
- 360px and desktop, light/dark appearance, long custom text, wrapped chips, touch targets around 44px, no clipped actions or horizontal overflow.

## Risks and rollback considerations

- **Prose mutation:** naive splitting/rejoining or substring removal can damage clinical wording. Pure span-based helper tests are a release requirement.
- **Status replacement:** requires explicit Replace and reversible Undo; do not copy the prototype’s immediate overwrite behavior.
- **Field-array reset:** successful saves can recreate row IDs. Derive clinical state from saved strings and deliberately clear transient UI state rather than attaching it to row index.
- **Misclassification:** strict hint lookup and General fallback prevent guessing from compound/free-form anatomy. Catalog scope is four regions initially.
- **Locking:** explicitly disable custom controls and test handlers, including portaled Select choices.
- **Regression surface:** extraction touches a large editor; change only the complaint definition/import and verified integration points.
- Rollback is a UI/helper revert. Persisted values remain valid strings for the previous editor, including explicit status text and conventional side prefixes. No migration or data rollback is required.

## Completion criteria

- [x] Approved interaction is available at all existing complaint-editor mounts.
- [x] All existing complaint data fields remain editable and saved unchanged unless the user edits them.
- [x] Regions/aliases change examples without adding findings or clearing factors.
- [x] Chips and statuses have tested, non-destructive text behavior.
- [x] Row lifecycle, visit isolation, locked states, save errors and generation guards pass regression checks.
- [x] Relevant tests, scoped lint, type check and diff checks pass, or pre-existing blockers are precisely documented.
- [ ] Keyboard/mobile/light/dark browser review completed and reported separately from automated checks.
- [x] Final diff contains only scoped implementation/tests/documentation.

## Planning validation

At planning time, the current complaint component, save hook, schema, form primitives, relevant tests and test configuration were re-read. The research run passed 15 tests in the note-schema and visit-editor suites. These were historical baseline results; implementation verification is recorded below.

## Implementation results — 2026-09-14

- Phase 1 complete: catalog, exact region aliases, side helpers, lossless factor segment operations, and tests. Initial phase run: 33 tests passed; final helper coverage includes three additional custom-input/prototype-key regression cases.
- Phase 2 complete: extracted card, field presentation, row lifecycle, replacement/Undo, and save feedback. Component suite: 10 tests passed.
- Phase 3 complete: existing mounts use the new card; tests cover multiple complaints and visit types, failed flush, generated-draft guards, and finalized boundaries.
- Final targeted run: **7 files, 90 tests passed**. Includes all six planned suites plus the existing visit-editor regeneration suite.
- Scoped `npm run lint -- <all nine changed/new source and test files>` passed. `npx tsc --noEmit` passed. `git diff --check` passed. No formatting script is configured.
- Additional `visit-editor-save-finalize.test.tsx` suite: **18 failures**, reproduced with the original HEAD editor through an isolated Vitest transform (no working source replacement). Initial/pain-evaluation cases fail on duplicate tone placeholders in force-mounted tabs; discharge cases also fail their existing save/tone assertions. These are pre-existing and remain outside this change. The regeneration suite and new factor/draft-guard tests pass.

### Browser verification and remaining acceptance

Checked the actual new component in an isolated localhost preview using synthetic data, mocked save actions, and the application stylesheet. The preview lived outside the repository and introduced no production route. Verified region-change preservation, selected chips, explicit Replace/Undo, save/reset feedback, and dark 360px wrapping (document width 360px; no horizontal overflow). Desktop layout was also inspected. Closed the preview and stopped its server after testing.

The available app tab was the deployed application, not this working tree. No patient chart was edited and no live generation was run. Native datalist options are present, but selecting the browser-owned suggestion popup was not conclusively verified in the embedded browser. Live-app save/reload, native autocomplete acceptance, and user acceptance of keyboard/touch behavior remain pending. The manual checkbox stays unchecked per the implementation skill's instruction, “Do not mark manual verification complete without user confirmation.” This does not block the completed local implementation.

### Deviations

No production design or data-contract deviations. Browser checks used a temporary isolated component harness rather than an authenticated patient page. The mockup's destructive status overwrite was replaced with the planned confirmation/Undo behavior; original severity/radiation/pattern fields were retained as planned.

## Production deployment — 2026-09-14

Deployed on the user's explicit request using the existing linked Vercel project. Deployment snapshot contained HEAD (`b3a349b`) plus the nine verified intake source/test files; unrelated untracked documents and local environment files were excluded.

- Deployment: `dpl_J9RZMaF4q8rVDu8GgxVYaTubsZ5x`
- Production: https://cliniq-nine.vercel.app
- Immutable deployment: https://cliniq-9g423xyir-arsens-projects-630b84fe.vercel.app
- `vercel deploy --prod --yes`: succeeded; production build and TypeScript checks passed; Vercel reports READY and assigned the production alias.
- Post-deploy HTTP check: `/login` returned 200 on the production alias.
- No patient records modified during verification. Authenticated clinical workflow acceptance remains separate from deployment/build/HTTP verification.
