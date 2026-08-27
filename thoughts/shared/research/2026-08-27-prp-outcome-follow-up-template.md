# PRP Outcome Follow-Up Template Research

## Research question

Are pain-management follow-up visits explicitly templated to evaluate outcomes after a PRP procedure?

## Summary

Not fully. The current follow-up generator is a general telehealth pain-management template that receives a lightweight list of performed procedures, including whether a procedure was PRP. That lets the model mention prior PRP when the provider documents the outcome in free-text interval history, but there is no explicit PRP outcome-evaluation template, structured PRP response questionnaire, or required PRP outcome section.

## Detailed findings

### Source data

`src/actions/pain-follow-up-notes.ts::gatherSource()` sends the generator:

- the current follow-up encounter and its generic provider intake;
- the latest completed encounter;
- the previous episode discharge summary;
- performed procedures in the current episode.

The performed-procedure query selects only `procedure_date`, `procedure_type`, `sites`, `diagnoses`, and `procedure_number`. It does not select procedure pain rating, tolerance, complications, post-procedure instructions, procedure note content, or procedure-scoped vital/pain measurements.

### Intake UI

`src/components/visits/telehealth-intake-card.tsx::TelehealthIntakeCard()` captures:

- current patient-reported pain minimum and maximum;
- chief complaint;
- free-text interval history;
- review of systems;
- video-observable findings;
- telehealth consent and location metadata.

It has no PRP-specific fields for percentage relief, functional improvement, duration of benefit, time to response, post-injection flare, adverse effects, medication reduction, return to activity, satisfaction, or target-site outcome.

### Generator contract

`src/lib/claude/generate-pain-follow-up.ts::PAIN_FOLLOW_UP_SYSTEM_PROMPT` asks for a generic remote pain-management follow-up and focuses on source labeling, modality, telehealth limitations, and conditional procedure recommendations. It does not instruct the model to evaluate PRP efficacy or compare pre- versus post-PRP outcomes.

The output schema contains generic narrative sections: subjective, interval history, assessment, diagnoses, treatment plan, education, and follow-up. `procedure_recommendations` supports recommending PRP or another procedure, but it describes future treatment recommendations rather than the outcome of a previously performed PRP.

### Existing tests

`src/lib/claude/__tests__/generate-pain-follow-up.test.ts` tests telehealth safety wording and deterministic recommendation IDs. It does not test PRP outcome assessment.

`src/lib/qc/telehealth-follow-up.test.ts` tests rejection of unsupported hands-on findings and vitals. It does not enforce PRP response content.

## Execution flow

1. Provider records generic encounter intake and pain scores.
2. `gatherSource()` adds basic performed-procedure metadata.
3. The general pain follow-up prompt receives all sources as JSON.
4. The model generates generic narrative sections and optional future procedure recommendations.
5. Any PRP outcome description depends on information supplied manually in free text and the model choosing to incorporate it.

## Historical context

The return-tele-visit implementation added current-episode procedure history so a later visit can maintain clinical continuity. The implementation emphasizes remote-visit safety and procedure scheduling, not a dedicated post-PRP outcome instrument.

## Open questions

- Whether one follow-up template should cover PRP, BOTOX, cortisone, and hyaluronic procedures through conditional sections, or PRP should have a distinct encounter purpose/template.
- Which structured outcome measures the clinic wants required for PRP follow-up.
