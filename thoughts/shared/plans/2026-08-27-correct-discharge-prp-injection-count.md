# Correct Discharge PRP Injection Count Implementation Plan

## Overview

Make Discharge-note PRP course counts deterministic. Generated prose must use the number of recorded target-area occurrences when it says “injections,” while retaining a separate count of PRP procedure sessions for visit/session language. The generator must no longer infer either count from the shape of `procedures[]`.

## Current State

`gatherDischargeNoteSourceData` creates one `procedures[]` item per live procedure row in the selected care episode. Structured target areas remain nested in each item as `sites[]`. The Discharge prompt calls the outer array an injection series but receives no explicit count, so the LLM can equate session records with injections. The query also omits `procedure_type`, preventing an explicit PRP-only count. Legacy procedure rows can have a populated denormalized `injection_site` while structured `sites` is empty.

## Desired End State

- `DischargeNoteInputData` exposes `prpSessionCount` and nullable `prpTargetAreaCount`.
- Counts include only `procedure_type = 'prp'` records.
- `prpSessionCount` counts PRP procedure rows.
- `prpTargetAreaCount` sums target-area occurrences across PRP sessions.
- Structured `sites[]` is authoritative. When it is empty, a populated legacy `injection_site` is parsed with the repository's existing legacy-site grammar.
- If any PRP session has neither usable structured sites nor a usable legacy string, `prpTargetAreaCount` is `null` rather than an understated number.
- One stored site object counts as one target-area occurrence, including `laterality: 'bilateral'`; repeated sites in separate sessions count again.
- Prompt rules require the target-area count for “injection(s),” the session count for “session(s)” or visits, and prohibit model re-derivation. A null target count must not be stated numerically.
- Full generation and section regeneration receive the same fields and rules.

## Key Discoveries

- `procedures.procedure_type` is non-null with a database default of `prp`, and the allowed set now includes PRP, cortisone, hyaluronic, and BOTOX.
- `sitesFromLegacyString` already implements the legacy delimiter grammar needed for fallback.
- `curateInputDataForPrompt` removes null and empty top-level values unless their keys are explicitly preserved.
- Existing Discharge generator tests capture both the system prompt and serialized user payload, providing a direct regression-test pattern.
- The pain trajectory is intentionally session-based and must remain unchanged.

## What We Are Not Doing

- Changing pain-trajectory construction or procedure numbering.
- Deduplicating anatomical areas across sessions.
- Expanding one bilateral site object into two injections.
- Changing procedure storage, adding a migration, or rewriting historical rows.
- Changing billing quantity behavior.
- Reworking Discharge notes into procedure-type-specific note templates.

## Implementation Approach

Introduce a small pure counting helper for PRP course counts, use the existing legacy parser while assembling Discharge procedure inputs, and derive the two count fields before returning `DischargeNoteInputData`. Keep the complete procedure array unchanged for existing clinical context and pain logic. Add a high-priority prompt contract and focused unit tests for counting semantics and prompt/payload wiring.

## Phase 1: Deterministic count derivation

### Files and changes

- `src/lib/claude/discharge-prp-counts.ts`
  - Add a pure `deriveDischargePrpCounts` helper.
  - Filter strictly to PRP procedure records.
  - Count sessions independently from target-area occurrences.
  - Return a null target count if any PRP session lacks a usable site.
- `src/lib/claude/__tests__/discharge-prp-counts.test.ts`
  - Cover one session/multiple sites, multiple sessions, mixed procedure types, repeated sites, bilateral entries, no PRP sessions, and incomplete site data.
- `src/actions/discharge-notes.ts`
  - Select `procedure_type`.
  - Preserve it in the assembled procedure objects.
  - Use structured sites first and `sitesFromLegacyString` only when structured sites are empty.
  - Derive and return both explicit count fields without changing the procedure array consumed by pain logic.
- `src/lib/claude/generate-discharge-note.ts`
  - Extend the input interface with `procedure_type`, `prpSessionCount`, and nullable `prpTargetAreaCount`.

### Automated verification

- Run the new count-helper unit tests.
- Run TypeScript checking after interface changes.

### Manual verification

- Inspect an assembled sample mentally or through a focused test: two PRP sessions with three sites each yields two sessions and six target-area injections.

## Phase 2: Prompt contract and regression coverage

### Files and changes

- `src/lib/claude/generate-discharge-note.ts`
  - Add a high-priority PRP course-count rule.
  - Require `prpTargetAreaCount` for injection-count language and `prpSessionCount` for session/visit language.
  - Prohibit counting `procedures[]` or re-deriving counts.
  - Require omission of numeric injection counts when `prpTargetAreaCount` is null.
  - Ensure both initial generation and section regeneration inherit the same system rule.
- `src/lib/claude/context-bundle.ts`
  - Preserve both count keys even when zero/null so the prompt sees an explicit audit state.
- `src/lib/claude/__tests__/generate-discharge-note.test.ts`
  - Update the shared fixture for the new fields.
  - Assert the prompt contract and both serialized values.
  - Assert a null target count is retained and governed by the omission rule.
- `src/actions/__tests__/discharge-notes-regenerate.test.ts`
  - Update typed procedure fixtures with `procedure_type` if required by TypeScript.

### Automated verification

- Run Discharge generator and regeneration tests.
- Run context-bundle tests.
- Run focused ESLint on changed source/test files and `npx tsc --noEmit` (the repository has no dedicated type-check script).

### Manual verification

- Review the captured prompt text for unambiguous separation of sessions and injections.
- Confirm no prompt instruction still directs the model to treat the number of outer procedure entries as an injection total.

## Phase 3: Final verification and documentation

### Files and changes

- Review all changed files and the final diff.
- Update this plan's automated-verification items with outcomes.
- Leave manual clinical-output review explicitly pending unless performed by the user in the application.

### Automated verification

- Run `git diff --check`.
- Run the narrow test suite for all changed helpers and Discharge generation.
- Run the repository's TypeScript check and lint check where available.

### Manual verification

- Generate a Discharge note from a case containing one multi-site session and confirm the prose distinguishes one session from multiple injections.
- Generate or regenerate a section for a multi-session case and confirm the count remains consistent.

## Risks and rollback considerations

- Legacy free text may contain delimiters that represent phrasing rather than separate targets; the fallback intentionally reuses the repository's established parsing grammar.
- Marking the target count null for missing site data avoids undercounting but can remove a numeric statement from generated prose.
- Mixed-procedure episodes remain in the general context and pain trajectory; only the new PRP course counts are filtered. This limits behavioral scope.
- Prompt-only adherence is not a hard output validator. The deterministic input and explicit high-priority instruction materially reduce drift without expanding this task into post-generation narrative parsing.
- The change is reversible by removing the two derived fields/helper and prompt block; no database rollback is required.

## Completion criteria

- Multi-site PRP sessions produce a target-area injection count greater than the session count when appropriate.
- Non-PRP records never contribute to either PRP count.
- Incomplete target data produces a null injection count rather than an incorrect total.
- Both generation paths receive explicit counts and a non-derivation prompt rule.
- Focused tests, type checking, linting, and diff checks pass, or any pre-existing failures are clearly documented.
- Manual application verification remains identified if not performed.

## Implementation verification results

- Phase 1 complete: deterministic PRP session/target-area derivation and legacy fallback implemented.
- Phase 2 complete: prompt contract, context preservation, and regression coverage implemented.
- Focused Vitest run: 4 files, 53 tests passed.
- TypeScript: `npx tsc --noEmit` passed.
- Focused ESLint on all changed source/test files passed.
- `git diff --check` passed.
- Manual application generation remains pending.
