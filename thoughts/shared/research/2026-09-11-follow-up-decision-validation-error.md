# Follow-up decision validation failure

## Research question

Why does the reported telehealth follow-up fail with a subjective-section treatment-decision validation error?

## Confirmed findings

- A read-only production query of the reported visit confirmed a failed pain follow-up note, telehealth modality, and documented telehealth consent. Neither subjective text nor raw model response was saved. Patient narrative and identifiers are omitted here.
- `src/lib/claude/generate-pain-follow-up.ts:94` applies `validateVisitDecisionOutput` after the follow-up schema and telehealth examination guard. The source includes current encounter facts.
- `src/lib/claude/visit-decision-output.ts:19` matches patient-related decision verbs without checking their object. Line 23 matches obtained consent without distinguishing telehealth from procedure consent.
- Direct execution of the validator rejected both `Verbal consent for telehealth was obtained.` and `The patient consented to the telehealth visit.` It also rejected `The patient reports that pain has declined since the last visit.`
- The same execution accepted `The patient verbalized understanding.` This standard closing is not the reproduced cause.

## Execution and diagnostics

`generatePainFollowUp` passes generated prose through schema validation and both guards. `src/lib/claude/client.ts:73` permits one validation retry; lines 207–208 return the final error and raw response. On failure, `src/actions/pain-follow-up-notes.ts:104` saves the error but not the raw response. Raw output is saved only on success (line 110).

## Existing tests and historical context

`src/lib/claude/__tests__/visit-decision-output.test.ts` covers treatment-decision assertions, historical attribution, prospective consent, education and understanding. It has no telehealth-consent or symptom-decline acceptance examples.

The current Patient Education plan is `thoughts/shared/plans/2026-09-10-patient-education-and-consent.md`. The guard is shared across generated sections, so this failure appears in Subjective even though the feature originated in Patient Education.

## Inference and open question

Documented telehealth consent is a plausible trigger in this visit, supported by its saved encounter flag and the reproduced false positives. The exact rejected sentence cannot be established from the saved failed note: the failed model response was not retained. This investigation does not claim it was definitely a telehealth-consent sentence.

## Verification and scope

Used a read-only linked Supabase query, inspected generator/client/action/validator source, and directly executed the validator with synthetic examples. No application code, production record, or deployment was changed. No full test suite was run because this investigation changed documentation only.
