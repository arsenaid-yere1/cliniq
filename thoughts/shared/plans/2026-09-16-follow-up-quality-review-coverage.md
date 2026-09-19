# Follow-Up Quality Review Coverage Implementation Plan

Status: Superseded by [the comprehensive Quality Review plan](2026-09-16-quality-review-comprehensive-hardening.md), which incorporates this scope and the additional findings.

## Overview

Close the four confirmed gaps in follow-up Quality Review: incomplete note input, absent follow-up review instructions, incorrect editor navigation, and missing regression coverage. Include the existing encounter facts needed to make those review instructions evidence-based. Preserve manual review, episode boundaries, existing finding storage, and signed-note protections.

Research: `thoughts/shared/research/2026-09-16-follow-up-notes-quality-review.md`.

This document is a plan only. Implementation has not started.

## Current State

- `src/actions/case-quality-reviews.ts`, `gatherSourceData`, selects six of eleven follow-up narrative sections, plus note/encounter IDs and status. It scopes to the active/latest episode but ignores follow-up query errors and does not specify follow-up ordering.
- `src/lib/claude/generate-quality-review.ts`, `QualityReviewInputData`, carries those six sections; `generateQualityReviewFromData` serializes them for the reviewer. `SYSTEM_PROMPT` omits follow-ups from its chain and dedicated checks, although the tool supports `pain_follow_up` findings.
- `src/components/clinical/qc-review-panel.tsx`, `stepLabels`, displays follow-up findings, but `findingDeepLink` falls back to the case overview.
- `fixFinding` already dispatches by encounter to `regeneratePainFollowUpSectionAction`. The latter requires a draft note, in-progress encounter, writable episode, and enabled feature. Its successful return triggers a full recheck.
- `computeSourceHash` hashes collected data, so omitted sections cannot independently mark a review stale.
- Existing tests cover follow-up fix dispatch with a mocked failure and generic finding schemas; they do not cover a populated follow-up payload, section-specific staleness, or the editor link.

## Desired End State

1. Review receives all eleven follow-up narrative sections, structured recommendations, saved treatment-decision context, and a bounded encounter context.
2. All collected follow-up content participates in staleness detection, with stable row ordering.
3. Review instructions explicitly examine follow-up continuity, telehealth source boundaries, recommendations, education, and follow-up instructions without inventing clinical rules or treating every case as requiring a follow-up.
4. Follow-up findings link to the actual encounter editor. Legacy findings without an encounter ID link to the visits list.
5. Existing fix, score, override, feature-flag, and signed-note behavior continues to work.
6. Automated tests establish application behavior; a synthetic-case manual review separately assesses model output and navigation.

## Key Discoveries

- `src/lib/validations/pain-follow-up-note.ts`, `painFollowUpNoteSections`, is the canonical list of eleven sections. `painFollowUpNoteResultSchema` additionally includes `procedure_recommendations`.
- `supabase/migrations/20260826161637_pain_follow_up_notes.sql` already defines all eleven sections and recommendations. No new persistence fields are needed.
- `src/lib/validations/visit-treatment-decision.ts`, `parseVisitDecision`, validates a saved decision and its reviewed plan. `visitDecisionDraft` has a default acceptance intended only for UI suggestions; it must never supply reviewer evidence.
- `src/lib/claude/generate-pain-follow-up.ts` distinguishes historical findings from current video observations and recommendations from orders. Its generation-time prohibition on current treatment decisions cannot be copied wholesale into a reviewer of clinician-saved notes.
- `src/lib/claude/visit-decision-output.ts` explicitly describes its validator as a model-output guard; manual prose is not passed through it. Do not reuse it to reject or automatically flag every saved decision assertion.
- The existing encounter route is `src/app/(dashboard)/patients/[caseId]/visits/[encounterId]/page.tsx`. It already enforces the return-tele-visits page feature flag.
- The reviewer merges two diagnosis validators, but those do not inspect follow-ups. Their rules include encounter-specific coding policy; mechanically copying procedure/discharge rules to follow-ups would introduce unverified policy.

## What We Are Not Doing

- No changes to database schema, RLS, note generation, signing, audited reopening, or procedure ordering.
- No new follow-up diagnosis coding policy, deterministic telehealth finding engine, or Verify workflow. Existing generation validators remain in place; this task closes the identified review-input/prompt/navigation gaps.
- No mandatory follow-up for every case, review of all historical episodes, automatic review triggering, or model/provider changes.
- No changes to unrelated initial-visit/exam-finding work already present in the working tree.

## Implementation Approach

Extend the existing collection → typed payload → review → finding UI flow. Keep the review JSON storage contract and optional top-level `painFollowUpNotes` property compatible with existing callers. Use explicit database selections and a small normalized encounter object, not entire database records or raw AI output.

Use a separate batched encounter lookup keyed by the selected follow-up encounter IDs, scoped again to case, episode, follow-up encounter type, and nondeleted rows. This follows existing batched-query patterns and avoids introducing a new nested-join dependency. Do not make one query per note.

## Phase 1: Complete and stabilize follow-up review input

### Files and changes

**`src/actions/case-quality-reviews.ts` — `gatherSourceData`, `checkQualityReviewStaleness`:**

- Extend the follow-up selection with `interval_history`, `review_of_systems`, `imaging_review`, `patient_education`, `follow_up`, `procedure_recommendations`, and `visit_treatment_decision`.
- Retain current note-status inclusion. Pass status to the reviewer; do not silently remove failed/generating rows or finalized notes.
- For nonempty follow-up rows, collect encounter `id`, `encounter_date`, `status`, `modality`, `reason_for_visit`, `provider_intake`, `patient_reported_pain_min`, `patient_reported_pain_max`, `patient_reported_measurements`, and `telehealth_consent_obtained`. These fields already exist. Do not include unrelated location, provider identifiers, or audit timestamps.
- Attach encounter context by ID. Retain a note with `encounter: null` if the corresponding nondeleted encounter cannot be found; do not silently drop it. A query error is different from an absent row.
- Normalize the saved decision through `parseVisitDecision`; pass only its decision, details, reviewed plan, and visit date, or null. Never use the UI default decision. Label it as a saved decision tied to the reviewed plan, not general consent evidence.
- Explicitly map the review payload. Preserve null/empty narrative content rather than generating substitute text.
- Sort follow-ups by encounter date ascending, unknown dates last, then note ID. Sorting must also stabilize rows sharing a date or missing encounter context. Preserve clinically meaningful array order inside recommendations/intake.
- Return a clear collection error on follow-up-note or encounter-query failure, before `runCaseQualityReview` soft-deletes the previous review. Do not substitute an empty successful result on error.
- If source gathering fails during staleness checking, conservatively return `isStale: true` rather than certifying the saved review as current. No new UI state is required for this bounded change.

**`src/lib/claude/generate-quality-review.ts` — `QualityReviewInputData`:**

- Define a named follow-up input type with all eleven nullable narrative strings, IDs/status, recommendations, nullable normalized saved decision, and nullable encounter context.
- Keep raw JSON-shaped source values typed as unknown unless already validated. Do not assert malformed legacy JSON is a validated recommendation or decision.
- Keep `painFollowUpNotes` optional for compatibility; real collection supplies an array.

**`src/actions/__tests__/case-quality-reviews.test.ts`:**

- Add explicit default follow-up and encounter fixtures. Capture per-table query builders where filters and errors matter.
- Assert the generator receives all eleven sections with unique fixture values, recommendations, saved decision, and the matching encounter facts for multiple notes.
- Assert case/episode/nondeleted/type filters, retained draft/finalized statuses, empty-list behavior without an encounter lookup, and a retained note with null encounter context.
- Assert either source-query failure prevents the AI call and review replacement writes.
- Obtain a baseline source hash from a successful run; table-drive changes to each of the five formerly omitted fields, recommendations, decision, and encounter facts, then assert staleness. Reordered database rows must not produce staleness. Cover deletion and source-fetch failure.

### Automated verification

Run `npm test -- src/actions/__tests__/case-quality-reviews.test.ts` and `npx tsc --noEmit`. Confirm missing follow-up lists in existing callers still compile.

### Manual verification

On a synthetic active-episode case, run review, edit only Interval History, reload Quality Review, and confirm Stale appears. Recheck and confirm it clears. Repeat once with Follow-Up. Confirm an earlier episode's notes are not included.

## Phase 2: Specify grounded follow-up review rules

### Files and changes

**`src/lib/claude/generate-quality-review.ts` — `SYSTEM_PROMPT`, output contract:**

- Describe follow-ups as optional, repeatable visits interleaved with procedures, not a single required step after all procedures. Compare by supplied dates; never invent dates for null values.
- Require review of every supplied draft/finalized follow-up and all its available sections. Treat generating/failed notes as unfinished, not completed narrative suitable for contradiction checking; if any are present, use incomplete assessment without inventing section defects from partial output.
- Check interval/symptom/pain/imaging/diagnosis/plan continuity against supplied evidence. Do not assume pain must monotonically improve between follow-ups. Preserve the existing non-follow-up rules.
- For documented telehealth encounters, distinguish reported symptoms, video-observed findings, dated historical facts, and unsupported current hands-on findings/vitals. Accept explicit non-performance statements and source-labeled historical/home readings.
- Compare affirmative telehealth-consent claims to current encounter consent evidence. Missing encounter context means the reviewer cannot verify it; do not equate absent context with documented refusal.
- Compare plan prose to structured procedure recommendations. Flag internal contradictions; do not infer that recommendations are orders, scheduled appointments, or consent. No order database is added, so do not claim to verify actual scheduling.
- Review education and follow-up instructions for contradictions or material missing context supported by the case. Do not mandate a specific follow-up interval, intervention, or unsupported education boilerplate.
- Respect saved clinician-confirmed decisions and their reviewed plans. Do not flag all acceptance/decline language merely because the generator forbids emitting it. Treatment decisions, telehealth consent, and procedure consent are distinct.
- Require `step='pain_follow_up'`, the actual note ID, and its matching encounter ID for a single-note finding. Use a canonical narrative section key only when correcting that section addresses the problem. For structured-only recommendation defects or missing encounter context, use `section_key: null` so the existing eligibility gate disables AI Fix; regenerating prose cannot repair structured data. For a prose contradiction with supported recommendations, target `treatment_plan`. Preserve cross-step findings for genuinely multi-note issues.
- State that no follow-up notes is valid and does not alone make a review incomplete. Retain existing chain-origin logic and the 25-finding limit.

**New `src/lib/claude/__tests__/generate-quality-review.test.ts`:**

- Follow the existing `callClaudeTool` mock pattern in `generate-pain-follow-up.test.ts`. Inspect serialized messages, tool schema, and the parser callback without calling the model.
- Assert complete follow-up payload survives serialization and valid encounter-scoped findings survive parsing. Preserve nullable encounter IDs for legacy/other-step results; no new global schema restriction is introduced.
- Cover null-section structured-only findings and confirm they remain displayable without becoming auto-fixable.
- Assert the prompt contract covers optional repeatable follow-ups, evidence boundaries, saved decisions, unfinished statuses, and the identifier/section requirements. These are contract tests, not evidence that the model always obeys them.
- Confirm existing model selection, score normalization, and no-follow-up inputs still work.

### Automated verification

Run `npm test -- src/lib/claude/__tests__/generate-quality-review.test.ts src/lib/validations/__tests__/case-quality-review.test.ts src/actions/__tests__/case-quality-reviews.test.ts`.

### Manual verification

Run review on synthetic examples containing: a contradiction only in Interval History; contradictory follow-up instructions; an unsupported telehealth examination claim; a properly labeled historical finding; and a saved treatment decision consistent with its reviewed plan. Verify useful findings for the positive examples and no blanket false positives for the controls. Check multiple follow-ups and a case with no follow-ups. Record actual outputs separately from automated results; adjust prompt wording if the model misses a target or flags a control.

## Phase 3: Correct navigation and protect the existing fix flow

### Files and changes

**`src/components/clinical/qc-review-panel.tsx` — `findingDeepLink`:**

- Add `pain_follow_up`: link to `/patients/${caseId}/visits/${encounter_id}` when present, otherwise `/patients/${caseId}/visits`.
- Keep other routes, findings labels, scores, and generic override controls unchanged. Do not add Verify for follow-ups or bypass the route's feature flag.

**New `src/components/clinical/__tests__/qc-review-panel.test.tsx`:**

- Use the repository's jsdom/Testing Library conventions and mock navigation, case status, and server actions.
- Render real follow-up finding cards and assert accessible “View in editor” links for two different encounters plus the legacy fallback.
- Assert scores/labels and existing initial/procedure/discharge links remain correct. Confirm a valid follow-up finding exposes Fix with AI, an ID-deficient finding disables it, and follow-ups do not expose unsupported Verify.

**`src/actions/__tests__/case-quality-reviews.test.ts`:**

- Keep the current failure-dispatch test. Add a successful mocked follow-up regeneration → full recheck case, asserting the correct encounter/section and resolution when the finding disappears.
- Add the still-present and recheck-failure cases to ensure pending/error behavior survives. Include one formerly omitted narrative section as the fix target.

**`src/lib/validations/__tests__/case-quality-review.test.ts`:**

- Add direct follow-up eligibility cases for present/missing encounter and note IDs, plus hash separation for different encounters and unchanged legacy hashing when encounter ID is absent.

### Automated verification

Run all five targeted suites:

```sh
npm test -- src/actions/__tests__/case-quality-reviews.test.ts src/lib/claude/__tests__/generate-quality-review.test.ts src/lib/validations/__tests__/case-quality-review.test.ts src/components/clinical/__tests__/qc-review-panel.test.tsx src/lib/claude/__tests__/generate-pain-follow-up.test.ts
npx tsc --noEmit
npm run lint -- src/actions/case-quality-reviews.ts src/lib/claude/generate-quality-review.ts src/components/clinical/qc-review-panel.tsx src/actions/__tests__/case-quality-reviews.test.ts src/lib/claude/__tests__/generate-quality-review.test.ts src/lib/validations/__tests__/case-quality-review.test.ts src/components/clinical/__tests__/qc-review-panel.test.tsx
git diff --check
```

No formatter script is configured; follow existing formatting and use ESLint/diff checks. If shared interfaces change beyond the planned optional payload extension, broaden tests to affected callers. Report unrelated baseline failures without altering other work.

### Manual verification

Open two follow-up findings and confirm each reaches its own visit. Apply an eligible draft-section fix and inspect the regenerated section and recheck result. Confirm finalized notes cannot be regenerated and disabled return-tele-visits still enforce existing page/mutation restrictions. Review a no-follow-up case for regressions.

## Risks and rollback considerations

- More context increases review input size and latency. Use explicit selections, no raw AI response, and no arbitrary truncation that silently drops reviewed sections. Measure a representative multi-follow-up case.
- Richer inputs change the source hash. Existing reviews will appear stale until manually rechecked; no backfill or automatic AI calls are needed.
- Prompt behavior is nondeterministic; passing mock tests establishes integration and contracts, not clinical accuracy. Synthetic manual checks are a separate completion requirement.
- Null encounter context, legacy findings, malformed saved decisions, and unfinished notes must remain representable without inventing facts.
- Query failures must not produce a deceptively clean partial review or replace the prior review.
- Rollback consists of reverting application/test changes. No migration or stored finding rewrite is required; existing follow-up findings remain parseable.

## Completion criteria

- All eleven follow-up sections and specified supporting context reach review; all newly included values participate in staleness detection.
- Explicit follow-up rules handle multiple visits and source boundaries while preserving valid no-follow-up workflows.
- Editor links target the correct encounter, including safe legacy fallback.
- Existing fix, override, scoring, and signed-note protections remain intact.
- Targeted tests, type check, lint, and diff checks pass, or unrelated baseline failures are clearly isolated and reported.
- Synthetic manual checks are documented, with any unavailable environment explicitly marked unverified.
- No unresolved implementation decisions or unrequested persistence/clinical-policy changes remain.
