# Consent, agreement, and understanding across other notes

Date: 2026-09-10

Scope update — 2026-09-10: the broad education/consent implementation was reverted. Current scope is visit-only treatment-plan acceptance, with a visible Accepted draft confirmed through explicit Save/Sign, independent understanding, and unchanged procedure/telehealth consent. The updated plan is `thoughts/shared/plans/2026-09-10-patient-education-and-consent.md`; the research and earlier proposals below are historical and do not override it.

## Research question and scope

Do the other note generators have the unsupported patient-understanding or treatment-agreement issue identified in Initial Visit/Pain Evaluation?

This is a source-code audit of PRP, therapeutic Botox, discharge, and pain follow-up generation and related consent inputs. No stored patient notes or live model outputs were examined. Findings describe verified instructions and contracts; whether a specific generated note contains an unsupported assertion requires comparing that note with its encounter evidence.

## Summary

The strongest issue is in procedure preparation, not Patient Education: PRP and Botox prompts instruct affirmative consent language independently of the recorded consent status. Discharge education requests participation and understanding without a dedicated encounter-response input. Telehealth follow-up does not explicitly force agreement, but lacks a consent/decision evidence rule.

## Detailed findings and references

### PRP procedure: affirmative consent and election boilerplate

`src/lib/claude/generate-procedure-note.ts:57` exposes `procedureRecord.consent_obtained: boolean | null`. `src/actions/procedure-notes.ts:361` maps the recorded value into that payload. `curateInputDataForPrompt` in `src/lib/claude/context-bundle.ts:69` preserves procedureRecord and does not strip nested false/null values.

Despite having the field, the prompt at `generate-procedure-note.ts:545` requires consent-obtained boilerplate. At line 548 it requires adult informed-consent phrasing when age is adult **or unknown**. At line 549 it requires written guardian consent and verbal patient assent for minors, without dedicated fields for consent method or assent. At line 551 it requires specific alternatives-discussed and PRP-election language when no different discussion is documented.

These are verified prompt defects: there is no consent-status branch in the generator. Generic source-precedence wording does not resolve the explicit contradictory instructions reliably. A true consent checkbox also does not separately establish that each named alternative was discussed or that consent was written.

### Botox: written consent asserted without method evidence

`generate-procedure-note.ts:841` overrides PRP preparation with a requirement to document written informed consent and a detailed discussion. It still receives the same boolean/null field; no structured written/verbal distinction is supplied. `systemPromptForProcedureType` at line 862 selects this override for Botox.

`src/lib/validations/botox-procedure.ts:67` allows consent=false with a deviation reason. The existing test at `src/lib/validations/__tests__/botox-procedure.test.ts:122` explicitly accepts a record stating that written consent was declined and verbal consent documented. The unconditional Botox prompt could contradict that supported input.

### Recording defaults weaken the source evidence

- `src/components/procedures/record-procedure-dialog.tsx:60` defaults new PRP consent to true; line 249 uses that default for new records and false for missing consent when editing.
- `src/components/procedures/record-botox-dialog.tsx:109` defaults missing consent to true.
- `src/components/procedures/procedure-appointment-table.tsx:85` prepopulates scheduled PRP/Botox completion with true. Its `completeOtherType` function at line 95 sends true for other procedure types. The simple completion dialog does display “Consent is confirmed for this completion,” so this is a bundled confirmation rather than a wholly hidden assertion; it has no separate consent choice.
- `src/lib/validations/prp-procedure.ts:108` and the Botox schema permit false with a substantive plan_deviation_reason. Therefore false is a supported record state, not an impossible input that the generator can disregard.

### Discharge: the same understanding gap

`src/lib/claude/generate-discharge-note.ts:491` requires Patient Education to include patient participation and understanding. `DischargeNoteInputData` contains procedure history, clinical extractions, prior note context, and discharge vitals, but no dedicated current discharge education/understanding/decision input. Historical treatment or education does not establish the patient's response at discharge.

There is no explicit mandatory treatment-acceptance closing. The verified issue is an unconditional participation/understanding instruction and missing structured evidence, not a confirmed assertion of consent in an actual note.

### Pain follow-up/telehealth: missing safeguard, not forced agreement

`src/lib/claude/generate-pain-follow-up.ts:17` has a short prompt protecting telehealth exam boundaries and keeping procedure recommendations conditional. It does not require “agreed,” “consented,” or “verbalized understanding.” Its patient_education tool property is only a string.

`src/components/visits/telehealth-intake-card.tsx:15` captures complaints, interval history, review of systems, and video observations. It separately captures telehealth consent, defaulting missing consent to false at line 23. The encounter schema (`src/lib/validations/clinical-encounter.ts:36`) includes telehealth consent and timestamp, but no dedicated treatment decision. Free-text intake can contain a response; its absence must not be converted into agreement.

`src/actions/pain-follow-up-notes.ts:28` passes the current encounter and historical sources to the generator. `src/lib/qc/telehealth-follow-up.ts` validates hands-on findings and current vitals, not consent claims. Possible conflation of telehealth consent with treatment consent is a risk inference, not demonstrated model output.

## Execution flow and regeneration

Procedure action → source gathering including recorded consent → context curation → generateProcedureNoteFromData → procedure-type prompt → string output validation. regenerateProcedureNoteSection uses the same procedure-type prompt and additionally receives current/other generated prose.

Discharge generation and regenerateDischargeNoteSection both use the same SYSTEM_PROMPT. Pain follow-up generation and quality-finding regeneration use the same PAIN_FOLLOW_UP_SYSTEM_PROMPT and telehealth output validator. All three need the same evidence boundaries on regeneration as on first generation.

## Recommended changes, in priority order

Subsequent UI decision: the user requested Accepted as the default treatment decision. See “Updated UI decisions from the subsequent discussion” in `2026-09-10-patient-education-treatment-agreement.md`. That changes the proposed general education/decision form defaults, not the requirement to distinguish procedure-specific consent and use confirmed encounter data. No implementation has been made.

1. Fix PRP/Botox preparation prompts first. Honor true/false/unknown consent; never assert written consent, guardian authorization, patient assent, named alternatives, or treatment election without supporting evidence. Preserve a documented deviation reason without translating it into consent.
2. Remove affirmative consent defaults for new procedure entries. Capture an explicit clinician response, consent method, consenting party, and assent where relevant. Do not change existing true records to false; a default-origin record cannot be classified retrospectively without review.
3. Apply a shared evidence rule to education, treatment plans, and preparation across Initial Visit, Pain Evaluation, procedures, discharge, and follow-up. Keep understanding, plan decision, procedure consent, and telehealth consent separate.
4. Add current-encounter education/decision capture for discharge and follow-up, using the same contract proposed for Initial Visit/Pain Evaluation.
5. Add source-aware output checks and evaluations for false/unknown consent, verbal-only consent, absent guardian/assent evidence, declined/deferred/partial decisions, historical consent only, and regeneration from unsupported existing prose. Merely checking that a prompt contains the word “consent” will not verify correctness.

## Existing tests and historical context

`src/lib/claude/__tests__/generate-procedure-note.test.ts:422` tests the age-based consent template. Lines 1152–1176 test that alternatives-discussed/election boilerplate exists, including guardian election. These tests currently preserve the behavior that should change. Schema tests already cover false consent plus a deviation reason. No dedicated evidence-gated consent checks were found in the searched generator tests or QC files.

The repository test headings identify prior additions as “minor-patient consent” and “alternatives-discussed rule.” No commit-level historical cause was established in this follow-up. Existing graph traversal corroborated procedure/discharge generator links to actions, schemas, and editors; the graph did not resolve the newer follow-up generator as a starting node. Current source was authoritative.

## Verification and open questions

Ran `npm test -- src/lib/claude/__tests__/generate-procedure-note.test.ts src/lib/claude/__tests__/generate-discharge-note.test.ts src/lib/claude/__tests__/generate-pain-follow-up.test.ts src/lib/validations/__tests__/prp-procedure.test.ts src/lib/validations/__tests__/botox-procedure.test.ts src/lib/validations/__tests__/clinical-encounter.test.ts`: **6 files, 254 tests passed**. These mocked/unit checks do not validate actual clinical statements. Node emitted a module.register deprecation warning.

Only this research document was added. No application code, stored notes, or consent records changed. Formatting/lint/type checks are not applicable to the Markdown-only artifact. Final whitespace check is reported on delivery.

Open questions for implementation: how to represent written versus verbal consent; how to capture guardian/surrogate authority and assent; whether unknown consent requires a review flag or blocks note finalization; how to review legacy default-true records. These require workflow decisions, not stronger boilerplate.
