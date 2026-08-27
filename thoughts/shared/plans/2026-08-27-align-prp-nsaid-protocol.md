# Align PRP NSAID Protocol Implementation Plan

## Overview

Align every PRP NSAID instruction in the Pain Evaluation → consent → procedure-note path to one two-week before-and-after policy. Remove the conflicting procedure-note aftercare example that permits Naproxen and ice, and add regression coverage that checks semantic agreement across artifacts rather than merely checking that each artifact uses its own helper.

This plan assumes the existing Pain Evaluation and consent instruction—avoid NSAIDs for **two weeks before and after PRP**—is the intended clinic policy. The user identified the seven-day hold as the gap to fix.

## Current State

- `src/lib/clinical/prp-protocol.ts` intentionally stores three windows:
  - seven-day pre-procedure hold;
  - two-week protective window;
  - seven-day recent-use screen.
- `src/lib/claude/generate-initial-visit.ts` uses the two-week window in the Pain Evaluation treatment plan.
- `src/lib/claude/generate-procedure-note.ts` mandates a seven-day hold attestation in every PRP procedure-note subjective.
- `src/lib/pdf/procedure-consent-template.tsx` screens for NSAID use in the past seven days but instructs avoidance for two weeks before and after.
- The procedure-note post-care example advises continuing Naproxen and applying ice, while the consent prohibits NSAIDs for two weeks after PRP and ice for 72 hours.
- Existing tests verify the separate helper outputs, thereby preserving the mismatch.

## Desired End State

- One canonical two-week avoidance window drives:
  - Pain Evaluation counseling;
  - procedure-note pre-procedure hold language;
  - consent contraindication screening;
  - consent post-care instructions;
  - procedure-note discharge instructions.
- The procedure-note aftercare prompt permits acetaminophen for breakthrough pain, prohibits NSAIDs for two weeks after PRP, and prohibits ice for the first 72 hours.
- No PRP prompt example recommends Naproxen or immediate ice.
- Tests fail if the evaluation, screening, attestation, consent, or procedure-note post-care paths diverge again.

## Key Discoveries

- The mismatch is centralized rather than caused by stale call sites. Commit `7693fe5` created the current three-value model and wired all existing NSAID emitters to it.
- `nsaidAvoidanceTreatmentPlanFragment()` and `nsaidPostCareInstructionSentence()` already express the desired two-week policy.
- `nsaidHeldPreProcedureClause()` and `nsaidScreeningContraindicationLabel()` are the only shared helper outputs that retain seven days.
- The procedure-note generator does not reuse the shared post-care helper; its Naproxen/ice example is an independent literal.
- Procedure-note tests already expose the complete generated system prompt through `capturePrompt()`, so prompt-level regression tests can be added without a new test harness.
- Consent tests import the exported `POST_CARE_ITEMS` and `CONTRAINDICATION_ITEMS`, so cross-artifact assertions can remain fast unit tests without rendering a PDF.

## What We Are Not Doing

- No database migration or new structured field for last NSAID use, hold duration, or clearance status.
- No new hard gate preventing procedure recording when NSAID avoidance is unconfirmed.
- No change to the general `consent_obtained` boolean or consent-signature workflow.
- No change to anticoagulant, antiplatelet, daily aspirin, or corticosteroid clinical rules.
- No retroactive regeneration or modification of finalized clinical notes or existing consent PDFs.
- No external clinical-policy research; this implementation follows the two-week policy already specified by the user and existing Pain Evaluation/consent text.

Structured clearance provenance remains a known follow-up concern: the generated procedure note uses clinician-reviewed boilerplate rather than a dedicated source field. That concern does not prevent correcting the duration and aftercare contradictions in this scoped change.

## Implementation Approach

Use `src/lib/clinical/prp-protocol.ts` as the only source for the NSAID avoidance duration. Collapse the independently configurable hold and screening intervals into the existing two-week protective window, so future edits cannot change counseling without changing clearance and screening. Keep sentence-builder helpers because their grammar differs by artifact, but have all builders read the same canonical value.

Then consume the shared post-care language in the procedure-note prompt and replace its conflicting example. Strengthen tests at both the helper and consumer levels, including explicit absence checks for Naproxen, seven-day screening/hold language, and immediate ice advice within the PRP-specific prompt block.

## Phase 1: Canonicalize the two-week protocol

### Files and changes

- `src/lib/clinical/prp-protocol.ts`
  - Replace the three independently meaningful duration fields with one canonical `avoidanceWindowWeeks: 2` value. Update all four builders to read this field and remove `preProcedureHoldDays`, `protectiveWindowWeeks`, and `screeningRecentDays`.
  - Update `nsaidHeldPreProcedureClause()` to say the patient held NSAIDs for **2 weeks** before the procedure.
  - Update `nsaidScreeningContraindicationLabel()` to say **NSAIDs in past 2 weeks**.
  - Keep `nsaidPostCareInstructionSentence()` and `nsaidAvoidanceTreatmentPlanFragment()` driven by that same value.
  - Do not retain separate seven-day constants or derive a second duration that can diverge later.

- `src/lib/clinical/__tests__/prp-protocol.test.ts`
  - Replace assertions for three distinct windows with an assertion for the single two-week window.
  - Update exact helper-output expectations for the pre-procedure hold and contraindication screen.
  - Add a semantic invariant test showing all four helper outputs contain the same two-week duration and none contains a seven-day duration.

- `src/lib/pdf/__tests__/procedure-consent-template.test.ts`
  - Update the screening expectation through the revised shared helper.
  - Add a direct assertion that both the contraindication checklist and post-care list refer to the same two-week window.
  - Add a regression assertion that the PRP consent contains no `7 days`, `7-day`, or `past 7 days` NSAID wording.

### Automated verification

- Run `npm test -- --run src/lib/clinical/__tests__/prp-protocol.test.ts src/lib/pdf/__tests__/procedure-consent-template.test.ts`.
- Run `npx tsc --noEmit` to catch removed/renamed constant consumers. (`package.json` has no dedicated type-check script.)
- Search `src` for `preProcedureHoldDays`, `screeningRecentDays`, and NSAID-related seven-day literals; expect no live PRP consumer matches.

### Manual verification

- Inspect the rendered consent content or exported arrays and confirm the contraindication checklist says “NSAIDs in past 2 weeks” while post-care says avoidance for two weeks before and after.
- Confirm other checklist items, especially systemic corticosteroids and antiplatelet drugs, are unchanged.

## Phase 2: Align procedure-note attestation and aftercare

### Files and changes

- `src/lib/claude/generate-procedure-note.ts`
  - Continue using `nsaidHeldPreProcedureClause()` in the mandatory safety checklist; after Phase 1 it will produce the two-week attestation in the directive and all five subjective reference examples.
  - Import `nsaidPostCareInstructionSentence()` and interpolate it into the `procedure_post_care` discharge requirements so the generated note receives the same two-week aftercare rule as the consent.
  - Replace the current Naproxen/Acetaminophen and “apply ice as needed” reference paragraph with PRP-consistent wording:
    - acetaminophen may be used for breakthrough pain when clinically appropriate;
    - avoid NSAIDs for the canonical two-week period;
    - do not apply ice during the first 72 hours;
    - preserve existing compression-bandage, activity-restriction, and infection-warning instructions.
  - Add an explicit prompt guard that Naproxen, ibuprofen, aspirin, or other NSAIDs must not be recommended as PRP post-procedure analgesia. The base prompt is PRP-specific; the appended `BOTOX_PROMPT_OVERRIDE` already supersedes its PRP-only instructions for `procedure_type = 'botox'`. Leave that override and BOTOX consent behavior unchanged.

- `src/lib/claude/__tests__/generate-procedure-note.test.ts`
  - Update the safety-checklist test to expect the revised shared two-week hold clause.
  - Keep the five-reference-example occurrence test, ensuring all examples inherit the shared clause.
  - Extend the `procedure_post_care` tests to assert the prompt includes `nsaidPostCareInstructionSentence()`, acetaminophen-only breakthrough guidance, and the 72-hour no-ice instruction.
  - Restrict negative checks to the PRP `procedure_post_care` block and assert it does not recommend continuing Naproxen or applying ice as needed.

### Automated verification

- Run `npm test -- --run src/lib/claude/__tests__/generate-procedure-note.test.ts`.
- Run all three focused suites together:
  `npm test -- --run src/lib/clinical/__tests__/prp-protocol.test.ts src/lib/claude/__tests__/generate-procedure-note.test.ts src/lib/pdf/__tests__/procedure-consent-template.test.ts`.
- Search PRP source and tests for the legacy seven-day language and for the conflicting phrases `continue his prescribed pain medication (Naproxen` and `apply ice to the injection site as needed`; expect no live prompt/template matches.

### Manual verification

- Capture or inspect the generated PRP procedure-note system prompt and confirm:
  - subjective attestation says two weeks;
  - discharge instructions prohibit NSAIDs for two weeks after PRP;
  - acetaminophen is the permitted breakthrough option;
  - ice is prohibited for 72 hours;
  - no example recommends Naproxen.
- Generate a draft Pain Evaluation and PRP procedure note in a local/manual test case, then compare the treatment-plan, subjective, and post-care sections side by side for consistent timing and medication advice.

## Phase 3: Cross-artifact regression and full verification

### Files and changes

- Prefer extending the three existing focused test files instead of creating a new integration-test fixture:
  - `src/lib/clinical/__tests__/prp-protocol.test.ts`
  - `src/lib/claude/__tests__/generate-procedure-note.test.ts`
  - `src/lib/pdf/__tests__/procedure-consent-template.test.ts`
- If direct verification of the Pain Evaluation consumer is not currently exposed, add a focused prompt-capture assertion to the existing initial-visit generator test suite (located under `src/lib/claude/__tests__/`) that verifies the Pain Evaluation prompt includes `nsaidAvoidanceTreatmentPlanFragment()`.
- Ensure the combined tests prove all five consumer surfaces use the canonical two-week duration: evaluation counseling, pre-procedure attestation, consent screening, consent aftercare, and procedure-note aftercare.

### Automated verification

- Run the focused NSAID/PRP suites.
- Run the complete `npm test -- --run` suite because the shared protocol module affects multiple clinical-document generators.
- Run `npm run lint` and `npx tsc --noEmit` (`package.json` has lint but no dedicated type-check script).
- Review `git diff --check` and the final diff for unrelated changes.

### Manual verification

- Render or preview one PRP consent PDF and check the contraindication and post-care sections visually.
- Generate one Pain Evaluation draft and one subsequent PRP procedure-note draft and verify the language across the clinical sequence.
- Confirm BOTOX consent and procedure generation remain unchanged.

## Risks and rollback considerations

- **Clinical-policy risk:** Changing the minimum hold from seven days to two weeks is a clinical-policy change, not merely copy editing. The implementation should proceed only under the user-provided assumption that two weeks is authoritative.
- **Historical-document risk:** Existing finalized notes and consent PDFs will retain their original language. This is expected; silently rewriting signed records is out of scope.
- **LLM variability:** Prompt changes reduce conflicting output but cannot guarantee exact wording. Exact shared phrases plus negative prompt tests minimize this risk; provider review remains part of finalization.
- **Aspirin ambiguity:** The consent treats daily aspirin separately as an antiplatelet and also includes aspirin in the general NSAID examples. This plan deliberately does not resolve medication-specific exceptions.
- **Rollback:** The change is limited to shared prompt/template constants and tests, so rollback is a normal code revert. No database rollback or data repair is required.

## Completion criteria

- The shared PRP protocol has one two-week avoidance duration and no independent seven-day hold or screening value.
- Pain Evaluation counseling, procedure-note hold attestation, consent screening, consent aftercare, and procedure-note aftercare all communicate the same two-week policy.
- The PRP procedure-note prompt does not recommend Naproxen or immediate ice and instead permits acetaminophen while prohibiting ice for 72 hours.
- Focused protocol, procedure-note, consent, and initial-visit prompt tests pass.
- Full tests, lint, type-check, and diff checks pass, with results reported.
- Manual comparison of one evaluation, consent, and procedure-note sequence shows no seven-versus-fourteen-day or Naproxen/ice contradiction.
