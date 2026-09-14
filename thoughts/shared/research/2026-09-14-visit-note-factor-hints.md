# Visit note aggravating/alleviating factor hints

Date: 2026-09-14
Scope: Current-state research for the requested region-dependent hints feature. No application changes made.

## Research question

How does Visit notes capture body regions and aggravating/alleviating factors, how do those values reach generated notes, and what existing components support adding contextual examples?

## Summary

`ChiefComplaintsCard` owns all three fields. Body Region is currently a free-text input, not a selector. The two factor textareas contain static example placeholders shared by every complaint. No region-dependent hint lookup or example selection behavior exists in this component.

## Detailed findings

### Editor and encounter boundaries

- `src/components/clinical/initial-visit-editor.tsx:213`: `InitialVisitEditor` creates independent Initial Visit and Pain Evaluation Visit instances, each with its own `IntakeDraftProvider`.
- `src/components/clinical/initial-visit-editor.tsx:611`: `ChiefComplaintsCard` initializes React Hook Form from saved chief complaints or `defaultProviderIntake`, with a `useFieldArray` for complaint rows.
- `src/components/clinical/initial-visit-editor.tsx:647`: Body Region binds directly to `chief_complaints.complaints[index].body_region`; placeholder is “e.g., Neck, Lower Back”. There is no canonical region list in this card.
- `src/components/clinical/initial-visit-editor.tsx:705`: Aggravating Factors is a string textarea with examples “prolonged sitting, bending, lifting”.
- `src/components/clinical/initial-visit-editor.tsx:711`: Alleviating Factors is a string textarea with examples “rest, OTC medications, ice”. These are UI examples, not prefilled patient findings.
- `src/components/clinical/initial-visit-editor.tsx:720`: Adding a complaint creates empty region and factor strings. Rows use the field-array ID as their React key.
- Before generation, both visit types display this card. In `DraftEditor`, the Chief Complaints tab/card is limited to Initial Visit (`:1552`, `:1655`). Finalized notes render narrative rather than the complaint editor.

### Data contract and save flow

- `src/lib/validations/initial-visit-note.ts:124`: `chiefComplaintEntrySchema` defines `body_region`, `aggravating_factors`, and `alleviating_factors` as strings. `chiefComplaintsSchema` wraps an array of entries, sleep disturbance, and additional notes.
- `src/lib/validations/initial-visit-note.ts:195`: `defaultProviderIntake` starts with one blank complaint. Neither a hint identifier nor selected example list is stored.
- `src/components/clinical/intake-draft-context.tsx:77`: `useIntakeSectionSave` obtains form values and calls `saveProviderIntake` for the selected section. Successful saves reset the form to those values; failures retain input.
- `src/actions/initial-visit-notes.ts:1221`: `saveProviderIntake` authenticates, checks case/note editability, loads the current visit-type row, merges the selected section with stored intake, and validates the result. Existing rows use an optimistic version check; missing rows create a draft. The stored field is `provider_intake` on `initial_visit_notes`.
- `src/components/clinical/initial-visit-editor.tsx:344`: generation flushes dirty intake before calling the generation action. `DraftEditor.handleRegenerate` prevents regeneration while intake is dirty or saving.

### Generation consumption

- `src/actions/initial-visit-notes.ts:274`: collected note input includes the saved provider intake.
- `src/lib/claude/generate-initial-visit.ts:77`: the prompt explicitly makes provider intake the primary source of complaint regions, pain characteristics, severity, radiation, and factors. Provider intake takes precedence over case-summary data for overlapping fields.
- Therefore, actual factor text entered and saved by the clinician is source material for generation. Display-only placeholders are not form values and are not sent as patient findings.

### Comparable existing pieces

- `VitalSignsCard` in `src/components/clinical/initial-visit-editor.tsx` uses persistent `FormDescription` helper text below inputs. This is an existing alternative to examples that disappear when a field contains text.
- `src/components/ui/tooltip.tsx` and `src/components/ui/popover.tsx` supply Radix-based help primitives, but neither is used by `ChiefComplaintsCard`.
- `src/lib/procedures/parse-body-region.ts:6`: `parseBodyRegion` extracts common laterality prefixes and title-cases free text. It is an injection-site parser, not a canonical anatomy or factor-hint mapping; it does not map “Neck” to “Cervical Spine”.

## Execution flow

Body region and factor text → complaint-row form state → selected-section save → validated provider intake for this visit type → generation input → Chief Complaint narrative.

Opening the form only shows static placeholders. There is currently no branch in this flow that derives examples from the body region.

## Existing tests and verification

- `src/components/clinical/__tests__/psychological-visit-editor.test.tsx`: tests visit-tab isolation, preservation of edits, dirty chief-complaint saves before generation, failed-validation behavior, and vitals flushing.
- `src/lib/validations/__tests__/initial-visit-note.test.ts`: tests note section schemas and vital-sign validation. It does not test a region-dependent hint catalog.
- `src/actions/__tests__/psychological-intake.test.ts`: existing persistence coverage includes section merging, encounter isolation, and concurrent-update errors.
- Executed `npm test -- src/lib/validations/__tests__/initial-visit-note.test.ts src/components/clinical/__tests__/psychological-visit-editor.test.tsx`: **2 files, 15 tests passed**.
- Reviewed source and repository history with `rg`, file reads, and `git log`. No browser verification performed. Lint/type checks were not run because this task adds documentation only.

## Historical context and research limits

Recent editor history includes `c73116e` (psychological assessment intake), `fabba99` (stale-version finalization fix), and `61b6725` (visit treatment-plan decisions). The current intake/draft coordination is relevant to any future interaction that modifies complaint values.

The existing Graphify graph identifies `ChiefComplaintsCard` in the editor but reports an older line location (L642 versus current L611). The graph query ran using its installed Python interpreter because the CLI was not on PATH. Current source was used for the findings above.

## Open product questions for implementation

1. Does “selected body region” mean retaining free text with recognized aliases, or introducing a region selector?
2. Should hints be display-only examples or explicitly clickable additions to factor text?
3. Which regions and clinical example wording should the first version cover, and what should appear for blank or unrecognized regions?

Inference: display-only hints can fit the existing string fields without changing the stored intake contract. This is an implementation implication, not implemented or verified behavior. Any future clickable examples must distinguish user-selected findings from mere displayed examples.
