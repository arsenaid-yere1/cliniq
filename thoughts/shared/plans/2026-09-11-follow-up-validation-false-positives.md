# Follow-up Validation False Positives Implementation Plan

## Overview

Status: **Implemented, verified automatically, and deployed to production on 2026-09-11.**

Fix reproduced false rejections of documented telehealth consent and declining symptoms. Preserve the existing clinician-confirmed treatment-decision boundary and the standard Patient Education understanding sentence. This is a focused follow-up to the deployed Patient Education feature, not a replacement design.

## Current State

`validateVisitDecisionOutput` in `src/lib/claude/visit-decision-output.ts` scans every top-level narrative string. Its consent pattern does not distinguish telehealth consent from procedure consent. Its patient/decision-verb pattern can associate the patient with a later symptom's verb, such as “pain has declined.”

`generatePainFollowUp` in `src/lib/claude/generate-pain-follow-up.ts` supplies encounter data to the model, then validates the schema, telehealth examination boundaries, and visit-decision prose in that order. It currently passes no encounter context to the last guard. Full generation and section regeneration use this same function.

Read-only investigation confirmed the reported failed visit is telehealth with consent recorded. The failed generated prose was not retained, so telehealth consent is a plausible trigger, not a proven reconstruction of the rejected sentence. The fix addresses independently reproduced defects; it cannot promise that these were the only problems in the lost response.

## Desired End State

| Output / source | Result |
| --- | --- |
| “Verbal consent for telehealth was obtained.” with current telehealth consent recorded | Allow |
| “The patient consented to the telehealth visit.” with current telehealth consent recorded | Allow |
| Affirmative telehealth-consent assertion with false, null, missing, or malformed consent flag | Reject with specific corrective feedback |
| Current telehealth consent inferred solely from a previous encounter | Reject |
| “The patient reports that pain has declined since the last visit.” | Allow |
| Current treatment acceptance/refusal/deferral, including combined telehealth and procedure wording | Reject as before |
| “The patient verbalized understanding.” | Allow; retain current prompt requirement |
| Existing correctly attributed history and prospective/negative procedure consent | Preserve existing behavior |

## Key Discoveries

- `src/lib/claude/visit-decision-output.ts:19` uses a 100-character patient-to-verb window; line 23 broadly matches obtained consent.
- `src/lib/claude/generate-pain-follow-up.ts:94` is the single follow-up integration point, including regeneration.
- `src/lib/claude/__tests__/visit-decision-output.test.ts` already locks down passive, adjectival, coordinated, historical, prospective, and negative forms. All existing expectations must remain.
- `src/lib/claude/__tests__/generate-pain-follow-up.test.ts` already captures and invokes the real parser callback supplied to the mocked model client. Extend this pattern; no live model or patient fixtures are needed for automated tests.
- Other visit generators call the shared validator without context. A defaulted optional argument preserves their call signatures and conservative consent behavior.

## What We Are Not Doing

- No UI, accepted-default, Save/Sign, understanding-closing, spacing, procedure workflow, or database changes.
- No removal of the guard, unrestricted consent exemption, second model classifier, or retry-count increase.
- No expansion of clinical narrative logging or storage of failed raw responses. The diagnostics limitation remains explicit.
- No patient-record edits, automatic regeneration, historical backfill, deployment, or Git publication during implementation.

## Implementation Approach

Keep the change to two source files and their two existing test files. Add optional typed validation context, for example `{ telehealthConsentDocumented?: boolean }`, defaulting to false. Only the follow-up generator supplies true, derived strictly from `source.encounter.modality === 'telehealth' && source.encounter.telehealth_consent_obtained === true`. Do not use truthiness, old encounters, timestamps alone, patient attendance, or generated prose as evidence. A timestamp is not an additional prerequisite for this text guard; the existing boolean is the source fact.

Use bounded, explicit recognition of telehealth-only consent assertions and symptom-decline grammatical forms. Do not exempt entire sections or sentences merely because they contain “telehealth,” “pain,” or “reports.” Retain surrounding content for existing decision checks. Unknown/ambiguous consent formulations stay conservative and receive retry guidance toward supported phrasing.

## Phase 1: Shared validator regression correction

### Files and changes

- Update `src/lib/claude/visit-decision-output.ts` and `src/lib/claude/__tests__/visit-decision-output.test.ts`.
- Add the optional context without changing the success/error return contract or section-specific Zod paths.
- Recognize explicit consent targets: telehealth, telemedicine, video visit, or remote visit. Cover passive obtained-consent and active patient-consented/agreed-to-participate constructions. A generic “consent was obtained” remains blocked even when the encounter flag is true.
- Permit only the recognized consent assertion when current source context permits it. Continue inspecting remaining assertions. Evaluate coordinated consent objects before conjunction splitting so “consent for telehealth and PRP was obtained” cannot become a telehealth-only exception. Cover reverse object order as well.
- Retain current treatment-decision patterns, but exclude a matched decline verb when its grammatical subject is an explicit symptom trend, such as pain, pain level/score, symptoms, or symptom severity following reported-history wording. Limit this exclusion to that match; another treatment decision in the same sentence must still be evaluated. Do not solve this by ignoring all patient-reported statements or all uses of “declined.”
- Keep historical attribution, prospective/negative wording, passive/adjectival decisions, and coordinated “has agreed to proceed” coverage. No general-purpose grammar rewrite is required.
- Give rejected unsupported telehealth assertions a distinct section-specific message directing omission unless documented. Existing treatment-decision feedback should clarify that documented telehealth consent and symptom trends are separate. Messages must not include raw patient prose.

### Automated verification

Add table-driven cases before changing logic and observe the false-positive cases fail. Cover:

1. Both reported consent reproductions with context true, false, omitted; aliases and case/whitespace variation.
2. Generic consent remains rejected with context true; procedure consent never becomes permitted by that flag.
3. Telehealth and PRP consent in one sentence, coordinated object list, reverse order, semicolon, newline, and separate sections. Include “The patient consented to telehealth and agreed to PRP,” “Consent for telehealth and PRP was obtained,” and “The patient consented to telehealth; the treatment plan was accepted.”
4. Patient-reported pain/symptom decline with past and present tense; a standalone symptom trend; “The patient declined PRP” and “The patient reports that he declined PRP” still fail. “Pain has declined, but the patient declined treatment” still fails.
5. Every existing rejection/acceptance fixture, understanding sentence, and correct Zod section path.

Run `npx vitest run src/lib/claude/__tests__/visit-decision-output.test.ts`.

### Manual verification

Review the matching logic and test matrix together. Confirm every exception is limited to a specific assertion rather than an entire sentence, and that mixed-object consent is examined before splitting away its context.

## Phase 2: Follow-up source context and parser integration

### Files and changes

- Update `src/lib/claude/generate-pain-follow-up.ts` and `src/lib/claude/__tests__/generate-pain-follow-up.test.ts`.
- Pass the strictly derived current-encounter flag into the shared guard in the existing parser callback. Keep schema validation, recommendation normalization, examination checks, model routing, and regeneration behavior intact.
- Extend follow-up prompt guidance: telehealth consent is separate from treatment/procedure consent; mention it only when the current encounter explicitly records it; prefer “Consent for the telehealth visit was obtained.” Do not invent the consent method, date, or person from a boolean alone. Pain/symptom decline is not a treatment refusal. Keep the exact standard understanding closing and explicit contradictory-source exception.
- Use synthetic complete tool payloads and invoke captured `opts.parse` for both full generation and regeneration. Do not settle for a test of helper calls or prompt text alone.

### Automated verification

- Full/regenerated notes with documented telehealth consent parse successfully; false, null, absent, string `"true"`, non-telehealth modality, and prior-encounter-only consent do not authorize affirmative consent text.
- Patient-reported pain decline parses with or without telehealth-consent documentation.
- The same valid payload containing PRP acceptance or procedure consent still fails, including when valid telehealth consent occurs elsewhere in the note.
- Unsupported current hands-on findings still fail; normalization and required schema fields still behave as before.
- Prompt tests preserve understanding-closing and source-contradiction instructions along with the new distinction.

Run:

```sh
npx vitest run src/lib/claude/__tests__
npx tsc --noEmit --pretty false
npx eslint src/lib/claude/visit-decision-output.ts src/lib/claude/generate-pain-follow-up.ts src/lib/claude/__tests__/visit-decision-output.test.ts src/lib/claude/__tests__/generate-pain-follow-up.test.ts
npm test
npm run lint
git diff --check
```

Use existing source formatting; the package has no dedicated formatting script. Report current results, distinguish any pre-existing broad lint failures, and do not fix unrelated files. The shared-validator change justifies the broader generator and full test suites. Run `npm run build` before a separately requested production release.

### Manual verification

With synthetic development data, generate a telehealth follow-up with recorded consent, review Subjective and Patient Education, and verify the existing Save Draft treatment-decision workflow. Repeat section regeneration. Automated mocked parser tests establish deterministic boundaries; they do not prove live model wording. Keep any unavailable live/UI verification explicitly pending. After a separately authorized deployment, the clinician can retry the reported failed visit and review the resulting draft; do not trigger that patient mutation automatically.

## Risks and rollback considerations

Regex matching remains a targeted guard, not an exhaustive semantic or consent-compliance guarantee. Overly broad exceptions could admit treatment decisions; too-narrow phrasing could leave false rejections. Explicit context, bounded matching, mixed-clause regressions, and conservative unspecified-consent behavior limit these risks.

Rollback is an application-code revert; no migration or patient-data rollback is required. It restores the prior false-positive behavior, so report that tradeoff. Preserve recorded decisions and existing notes throughout.

## Completion criteria

- [x] Reproduced false positives pass with appropriate source context.
- [x] Missing/negative consent facts cannot authorize affirmative telehealth wording.
- [x] Existing treatment-decision, procedure-consent, historical, and examination boundaries retain regression coverage.
- [x] Full generation and regeneration exercise the corrected real parser callback.
- [x] Required automated checks completed and manual checks reported accurately.
- [x] No UI, database, patient-record, or understanding-closing changes introduced.

## Verification Summary

Overall readiness: **Ready.** Reviewed the complete plan against the current shared validator, follow-up generator, and both existing test files; checked package scripts and the follow-up schema/examination guard. The existing graph query returned no matching validator node, so repository source was used directly.

### Findings and suggested changes

- **Major, resolved in Phase 1:** a sentence-level telehealth exemption could hide procedure consent. The plan now requires assertion-scoped recognition and mixed-object checks before conjunction splitting.
- **Major, resolved in Phase 2:** a bare telehealth exception could permit invented consent. The plan requires a strict current-encounter boolean and tests false/missing/malformed and historical-only evidence.
- **Minor, resolved in Phase 1:** changing all decision matching to require an explicit treatment object could reopen existing implicit-decision cases. The plan retains those cases and limits the decline correction to explicit symptom subjects.

### Missing work

No material planning gaps remain. Implementation and its verification are pending; no passing implementation tests or successful patient regeneration are claimed by this plan.

### Final recommendation

Approve this four-file implementation scope. Deployment and live patient regeneration remain separate actions.


## Implementation verification — 2026-09-11

Implemented both phases in the four planned source/test files. Telehealth-only assertions require strict current-encounter context; coordinated consent objects remain together during validation, and surrounding assertions are still checked. Only symptom-decline verbs are excluded from decision matching. Returned narrative is unchanged. Follow-up full/regeneration parser callbacks supply the source context and retain examination/schema checks.

Regression-first run reproduced 23 failures. Final verification: all 22 generator suites passed (465 tests); the full suite passed (113 files, 1,482 tests). TypeScript, changed-file ESLint and diff whitespace checks passed. Repository-wide lint retains the previously recorded unrelated error in `src/components/settings/invite-user-dialog.tsx:62` and 40 warnings. Local production build was started but has not completed; deployment build verification remains pending.

Manual clinician/browser/PDF and live model verification remain pending. No patient generation, data change, migration, or UI change was performed. User authorized production release in this implementation turn. No material scope deviation.


## Production release — 2026-09-11

Release commit `8530353` was deployed from a clean committed archive to the existing Vercel project. Deployment `dpl_4RuhsSYx9w5YYCJP2GASKj3237GR` completed its production build and reached Ready before promotion. Promotion succeeded. No migration was needed. Local `npm run build` failed fetching Google Fonts in the restricted environment; the Vercel production build succeeded.

The live domain verification and authentication smoke checks are recorded below. No failed patient note was regenerated or rewritten. An unrelated untracked case-reset script appeared during release preparation and was excluded from the committed deployment archive. Source publication to GitHub was not part of this release.

Postflight: inspecting `https://cliniq-nine.vercel.app` resolved to the new Ready deployment. `/login` returned HTTP 200; unauthenticated `/patients` returned HTTP 307 to `/login`. Clinician/live-model and visual PDF checks remain pending.
