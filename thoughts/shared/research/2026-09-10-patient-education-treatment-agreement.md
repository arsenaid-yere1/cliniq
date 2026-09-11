# Patient Education generation and treatment agreement

Date: 2026-09-10

Scope update — 2026-09-10: the broad education/consent implementation was reverted. Current scope is visit-only treatment-plan acceptance, with a visible Accepted draft confirmed through explicit Save/Sign, independent understanding, and unchanged procedure/telehealth consent. The updated plan is `thoughts/shared/plans/2026-09-10-patient-education-and-consent.md`; the research and earlier proposals below are historical and do not override it.

## Research question

How does Patient Education generation produce the supplied closing, and should it document agreement to the treatment plan more explicitly?

## Summary

Yes: document the patient's actual decision explicitly when supported by the current encounter. Do not replace the mandatory understanding sentence with mandatory agreement boilerplate. The supplied excerpt documents understanding but does not establish acceptance of PRP or the overall plan. Its source encounter was not supplied, so actual agreement cannot be verified.

The excerpt closely matches the Pain Evaluation branch of the Initial Visit generator (an inference from its topics and exact closing). Both visit branches currently require “The patient verbalized understanding.” Neither the generator input nor the provider intake schema has a dedicated treatment-decision field.

## Findings by component

- `src/lib/claude/generate-initial-visit.ts:244`: INITIAL_VISIT_SECTIONS requires a single education paragraph and the exact understanding closing. PRP education is prohibited for this branch.
- `src/lib/claude/generate-initial-visit.ts:354`: PAIN_EVALUATION_VISIT_SECTIONS requires injury education, PRP mechanism/course, home exercise, ergonomics, and the same closing. It does not explicitly require documentation of the patient's decision or condition the understanding statement on evidence.
- `src/lib/claude/generate-initial-visit.ts:340`: the treatment-plan instructions already distinguish staged recommendations from subsequent injections requiring reassessment, continued necessity, and renewed informed consent. An education closing should not imply blanket consent to future injections.
- `src/lib/claude/generate-initial-visit.ts`, InitialVisitInputData: providerIntake contains complaints, accident details, medical/social history, and exam findings; no dedicated current-encounter understanding, acceptance, or consent field. Free-text notes may contain relevant evidence, but this is not guaranteed.
- `src/lib/validations/initial-visit-note.ts`, providerIntakeSchema and defaultProviderIntake: likewise no dedicated decision capture. The AI result accepts patient_education as a string; the edit schema checks that it is nonempty, not that an agreement assertion is supported.
- `src/lib/claude/generate-initial-visit.ts`, buildSystemPrompt, generateInitialVisitFromData, regenerateSection: full generation and regeneration share visit-specific system instructions. Regeneration also includes current prose and other sections; these should not be treated as independent proof that a patient agreed.
- `src/lib/qc/voice-charter.ts`, voiceCharterPromptBlock: provides style and anti-marketing rules, not a treatment-decision evidence contract.

Related generator snippets inspected: procedure input includes consent_obtained (`generate-procedure-note.ts:57`) and procedure preparation contains consent language (`:545`); procedure education has anti-marketing and future-series constraints (`:736`). Discharge education requests participation and understanding (`generate-discharge-note.ts:491`). These are separate prompts, not a shared education implementation. The procedure workflow was not fully audited here and its consent boilerplate should not be assumed to be evidence-gated.

## Execution and data flow

`src/actions/initial-visit-notes.ts` gathers current source data in gatherSourceData; providerIntake is mapped at line 267. generateInitialVisitNote calls generateInitialVisitFromData at line 544. The generator curates input, composes the visit-specific prompt, calls Claude, and validates tool output. The action maps patient_education into note data at line 596. regenerateNoteSection calls the same generator's regenerateSection at line 997 with source data, current content, other sections, and tone guidance.

## Recommendations (proposed, not implemented)

### Updated UI decisions from the subsequent discussion

The user requested sensible defaults as accepted. This supersedes the initial recommendation below to default a new treatment-decision form to not documented. Application code has not been implemented.

- New encounter forms preselect Treatment decision = Accepted and Understanding = Verbalized understanding. Education topics may be suggested from the current treatment plan and remain editable.
- Display these values visibly as draft form selections. Saving this area must clearly confirm that they reflect the actual encounter (for example, a “Save education & decision” action with explanatory text). An unrelated save, autosave, or opening the form must not silently attest to the defaults.
- Preserve existing saved values, including unknown, deferred, declined, or partial acceptance. Missing persisted data remains not documented until the clinician reviews and saves the new area. Do not backfill existing notes or encounters as accepted.
- Capture the treatments covered by acceptance, especially for partial acceptance. Persist the confirming clinician, encounter, and timestamp. A later treatment-plan change requires review of whether the recorded decision still applies.
- Keep procedure consent, method, guardian/surrogate authority, and assent separate from general plan acceptance. No affirmative inference from age alone or from telehealth consent.
- Apply the shared area to Initial Visit, Pain Evaluation, procedure aftercare/rehabilitation, discharge, and pain follow-up. Procedure-specific consent remains in PRP/Botox recording; telehealth consent remains in its existing control.
- Full generation and section regeneration use saved current-encounter values. Suggested education topics alone are not proof that counseling occurred. Add missing/conflicting-evidence notices in the editor and tests for defaults versus confirmed data, saved exceptions, and regeneration.

The earlier research recommendations below describe the original proposal; these updated UI decisions control the proposed defaults.

1. Replace the unconditional closing in both visit branches with an evidence-dependent patient-response rule. Preserve one paragraph and branch-specific education topics.
2. Capture a current-encounter decision in provider intake: accepted, deferred, declined, partially accepted, or not documented. Include the treatment(s) involved, relevant limitations, clinician-confirmed response, and encounter provenance. Default to not documented. Keep understanding separate from decision, and procedure consent separate from general plan acceptance.
3. Make any patient-response language traceable to this evidence. Do not infer acceptance from a recommendation, education, scheduling, prior consent, or another AI-generated section. Do not infer refusal from missing data.
4. Prompt-only improvement can prevent unsupported assertions, but reliable explicit agreement requires evidence capture. If stronger guarantees are required, render the closing deterministically from confirmed structured fields; prompt instructions alone are probabilistic.

Suggested prompt rule:

> End with the patient's documented response and treatment decision for this encounter. State understanding only when documented. State agreement or election to proceed only when explicitly documented, naming the accepted treatment and preserving any limitations. If the patient deferred, declined, or accepted only part of the plan, state that accurately. If a decision is absent, omit an agreement assertion and flag the missing decision for clinician review outside the narrative. Do not infer informed consent, risks/benefits/alternatives discussion, questions answered, or consent to future injections. Prior notes and generated prose are context, not independent evidence of the current decision.

Suggested replacement closing when BOTH understanding and acceptance are confirmed:

> The patient verbalized understanding of the proposed treatment plan and agreed to proceed with the recommended PRP treatment and rehabilitation program.

If PRP is deferred but rehabilitation accepted:

> The patient agreed to continue the rehabilitation program and deferred a decision regarding PRP treatment.

For the supplied excerpt alone, retain the documented understanding statement; do not add agreement, questions answered, or informed consent without additional encounter evidence. Even the existing understanding default should become evidence-dependent for future generation.

Avoid promising gradual improvement or prevention of chronic pain as certain outcomes. Education should reflect documented counseling about expected recovery and uncertainty, using neutral PRP language consistent with the shared voice charter.

## Clinical documentation reference

[AMA Code of Medical Ethics, Informed Consent](https://code-medical-ethics.ama-assn.org/ethics-opinions/informed-consent) distinguishes communication resulting in authorization for a specific intervention from merely providing information. It recommends explaining the intervention, burdens, risks, expected benefits and alternatives (including forgoing treatment), and recording the discussion and decision. General plan acceptance should not be presented as a substitute for that process. This research does not determine jurisdiction-specific consent requirements.

## Existing tests and proposed verification

Read `src/lib/claude/__tests__/generate-initial-visit.test.ts` completely. It mocks callClaudeTool and tests model/tool configuration, regeneration context, tone guidance, diagnostic rules, and target selection. It contains no dedicated education/decision assertions and does not evaluate actual model-generated agreement statements.

Recommended cases for a future implementation: explicit acceptance; understanding only; decision absent; refusal; deferral; partial acceptance; prior-encounter consent only; conflicting generated prose; both visit branches; full generation and education regeneration. Assert that evidence survives input curation and that an accepted conservative plan never becomes consent to PRP or a future injection series. Use output evaluations in addition to prompt-string tests.

## Historical context and research limits

Recent file history includes `923eeb0` (refine PRP recommendation narrative), `0f55a4d` (stage ultrasound PRP recommendations), and `766258c` (preserve pain treatment plan template). Commit titles were inspected; no historical cause for the understanding default was established.

The existing graph linked the generator, action, validation schema, editor, and tests. The CLI was absent from PATH; invoking its installed absolute path succeeded. Its source line references are stale relative to the current checkout, so current source was used for findings. No graph rebuild or model inference was run; graph-query model token usage was not reported.

Open questions for implementation: preferred clinician capture location; handling conflicting current-encounter evidence; guardian/surrogate identity and authority; whether an undocumented decision should produce an optional review notice or a finalization requirement. None prevents the wording recommendation above.

## Verification record

Source inspection and repository searches were manual research, not clinical encounter verification. Only this research artifact was added; application behavior was not changed. Formatting, lint, and type checking are not applicable to this Markdown-only research change. Narrow generator test execution and final diff checks are reported with the delivery.
