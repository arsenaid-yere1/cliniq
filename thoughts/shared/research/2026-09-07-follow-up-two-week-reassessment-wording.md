# Follow-up two-week reassessment wording

## Research question

Where is follow-up interval wording generated and rendered, and does the current application consistently recommend reassessment in two weeks?

## Summary

The current behavior is split across two note workflows.

- PRP procedure-note generation explicitly uses a two-week return interval for baseline, stable, and improving response patterns. Its reference language says the patient will return in two weeks to assess response, or to reassess symptoms and function. A worsened response intentionally uses an earlier one-week re-evaluation. However, the same PRP prompt's `assessment_and_plan` example says “Reevaluate in 10-14 days,” so the note can contain two semantically similar but textually inconsistent intervals.
- Telehealth pain follow-up generation has no corresponding two-week rule. Both the narrative `follow_up` field and the structured recommendation's optional `suggested_timing` are unconstrained model-generated strings.
- The structured recommendation UI renders procedure type, sites, and rationale, but omits `suggested_timing`. The procedure-order creation payload also omits that field.
- Validation checks that `follow_up` is a string and that `suggested_timing`, when present, is a string. It does not enforce any interval or reassessment wording.
- The finalized follow-up PDF renders the saved `follow_up` narrative verbatim; structured procedure recommendations, including `suggested_timing`, are not rendered in the PDF.

Therefore, “reassessment in two weeks” is established wording in PRP procedure notes, but it is neither required nor visible end-to-end in the telehealth pain follow-up recommendation workflow.

## Current flow

1. `generatePainFollowUp` asks the model for a free-text `follow_up` section and structured `procedure_recommendations` (`src/lib/claude/generate-pain-follow-up.ts:17-45`). The prompt contains telehealth and conditional-recommendation safeguards, but no two-week timing instruction.
2. `painFollowUpNoteResultSchema` accepts any string for `follow_up`; `procedureRecommendationSchema` accepts an optional nullable string for `suggested_timing` (`src/lib/validations/pain-follow-up-note.ts:34-59`).
3. The server saves the generated note and structured recommendations without adding or normalizing timing (`src/actions/pain-follow-up-notes.ts:99-110`). Draft saves use the same schema and persist the submitted values (`src/actions/pain-follow-up-notes.ts:115-133`).
4. The editor exposes the narrative Follow-Up field as a normal editable text area (`src/components/visits/pain-follow-up-editor.tsx:190-323`).
5. The structured recommendation card shows type, sites, and rationale only (`src/components/visits/pain-follow-up-editor.tsx:326-354`). `suggested_timing` is not shown.
6. Creating a procedure order passes type, sites, diagnoses, rationale, relationship, and routine priority, but not `suggested_timing` (`src/components/procedures/procedure-order-dialog.tsx:29-42`).
7. Finalization maps the saved `follow_up` string into the PDF's Follow-Up section (`src/lib/pdf/render-pain-follow-up-pdf.ts:66-90`). The PDF template renders the section value without changing its wording (`src/lib/pdf/pain-follow-up-template.tsx:146-160`).

## Existing two-week wording

The PRP procedure-note prompt contains the established language:

- Baseline: return for follow-up in two weeks to assess response to the injection.
- Stable: return in two weeks to assess response and use the next visit as a treatment checkpoint.
- Improved: return in two weeks to reassess symptoms and functional status.
- Worsened: return in one week for earlier re-evaluation.

These branches are defined in `src/lib/claude/generate-procedure-note.ts:618-632`.

The same generated PRP note has a second timing instruction in its Assessment and Plan reference: “Reevaluate in 10-14 days” (`src/lib/claude/generate-procedure-note.ts:730`). Because both `procedure_followup` and `assessment_and_plan` are independently generated strings, nothing guarantees that the model will normalize these to identical wording.

The missing-vitals branch explicitly reuses the baseline follow-up cadence, which means two weeks (`src/lib/claude/generate-procedure-note.ts:267-280`). The two-signal pain matrix can adjust narrative tone, but it does not define a different numeric interval except for the worsened branch (`src/lib/claude/generate-procedure-note.ts:285-315`).

The generated sections are accepted as arbitrary strings (`src/lib/validations/procedure-note.ts:67-89`), saved without interval normalization (`src/actions/procedure-notes.ts:753-810`), and passed to the PDF verbatim (`src/lib/pdf/render-procedure-note-pdf.ts:134-153`). Therefore, prompt wording—not a deterministic rule—is the only enforcement mechanism.

The clearest reusable wording already present in the repository is: “Return for follow-up in 2 weeks to reassess symptoms and functional status.” It describes the purpose of the interval as reassessment rather than implying that another procedure is already scheduled.

## Tests and history

- The pain follow-up prompt-contract test checks telehealth safeguards but has no assertion for a two-week interval (`src/lib/claude/__tests__/generate-pain-follow-up.test.ts:55-63`).
- The validation fixture includes `suggested_timing: 'Within 2 weeks'`, but the test only proves the structured recommendation is schema-valid; it is not a product rule (`src/lib/validations/__tests__/pain-follow-up-note.test.ts:12-38`).
- The telehealth quality-control fixture uses `follow_up: 'Follow up as needed.'`, demonstrating that non-specific timing is currently accepted (`src/lib/qc/telehealth-follow-up.test.ts:5-16`).
- PRP prompt tests verify that all response branches and their reference examples exist, but they do not assert the literal two-week cadence or check agreement with the `assessment_and_plan` “10-14 days” wording (`src/lib/claude/__tests__/generate-procedure-note.test.ts:537-560`).
- The focused PRP generator test suite passes: 148 tests in `src/lib/claude/__tests__/generate-procedure-note.test.ts`.
- Git history shows the unconstrained pain follow-up fields originated with the return tele-visit workflow (`561ff93`), while the current recommendation card was introduced with the reset workflow (`e226c27`) and never rendered `suggested_timing`.

## Live-page check

The supplied production visit redirects to the sign-in page in the available browser session, so its patient-specific saved wording could not be read without account access. The repository behavior above is directly inspectable and explains why a generated “Within 2 weeks” value may not appear in the visible recommendation UI.

## Open question

The code does not define whether a universal two-week reassessment rule should override the existing one-week exception for worsened post-procedure response. It also does not define whether “10-14 days” in Assessment and Plan is intentionally acceptable alongside “2 weeks,” or whether both sections should use one exact phrase.
