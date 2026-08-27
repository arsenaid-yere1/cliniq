# Upgrade Pain Follow-Up Notes to Opus Implementation Plan

## Overview

Upgrade pain-management telehealth follow-up note generation from Claude Sonnet 4.6 to Claude Opus 4.6, with Sonnet 4.6 configured as the retryable-error fallback. The same model policy will apply to both full note generation and QC-triggered regeneration because both paths use `generatePainFollowUp()`.

## Current State

- `src/lib/claude/generate-pain-follow-up.ts` calls `callClaudeTool()` with `model: 'claude-sonnet-4-6'` and no `fallbackModel`.
- The optional `regeneration` argument only appends instructions; it does not use a separate model path. Full generation and regeneration therefore both use Sonnet 4.6 today.
- The shared client supports `fallbackModel`, but invokes it only after the primary model exhausts retryable API/network failures. It does not fall back for non-retryable errors, schema-validation failures, or `max_tokens` termination.
- Initial Visit, PRP Procedure, and Discharge generators use Opus 4.6 for primary note generation. Their section-regeneration calls use Opus 4.6 with Sonnet 4.6 fallback.
- `src/lib/claude/__tests__/generate-pain-follow-up.test.ts` covers prompt safeguards and recommendation-ID normalization, but does not assert the selected model or fallback.

## Desired End State

- Every `generatePainFollowUp()` call uses:
  - primary: `claude-opus-4-6`;
  - fallback: `claude-sonnet-4-6`;
  - existing `maxTokens: 6000` and all current prompt, tool schema, normalization, and telehealth validation behavior unchanged.
- Tests explicitly protect the primary/fallback configuration for both normal generation and regeneration.
- Production validation confirms successful follow-up generation and exposes the actual selected model through existing `[claude]` usage logs.

## Key Discoveries

- No separate regeneration function exists for pain follow-ups; changing the one `callClaudeTool()` options object covers both modes.
- The shared fallback implementation is already tested in `src/lib/claude/__tests__/client.test.ts`; this change does not require modifying retry logic.
- `callClaudeTool()` retries the primary model up to three API attempts before invoking the fallback once. That behavior is intentionally unchanged.
- Existing Zod and telehealth QC validation runs identically regardless of which model returns the tool output.
- The follow-up generator was introduced with Sonnet 4.6 and its Git history contains no documented clinical or performance rationale for that choice.

## What We Are Not Doing

- No prompt, tool schema, output schema, normalization, QC, or telehealth-safeguard changes.
- No increase to the 6,000-token output limit.
- No switch to Opus 4.7; other primary clinical note generators currently standardize on Opus 4.6.
- No change to shared retry counts, timeout, backoff, or fallback eligibility.
- No database migration, UI change, feature flag, or regeneration workflow redesign.
- No automatic fallback on validation failures or `max_tokens`; that would change shared-client semantics and is outside this model-selection upgrade.

## Implementation Approach

Make one model-configuration change in `generatePainFollowUp()` and extend the existing focused test file to capture the `callClaudeTool()` options for both invocation modes. Reuse the repository's existing literal model configuration pattern rather than introducing a new model registry for a two-line change.

## Phase 1: Upgrade primary and fallback model configuration

### Files and changes

- `src/lib/claude/generate-pain-follow-up.ts`
  - Change `model` from `claude-sonnet-4-6` to `claude-opus-4-6`.
  - Add `fallbackModel: 'claude-sonnet-4-6'` next to the primary model.
  - Preserve `maxTokens: 6000`, system prompt, tool choice, source payload, output normalization, Zod parsing, and telehealth validation exactly as-is.

### Automated verification

- Run `npx tsc --noEmit`.
- Run focused lint on `src/lib/claude/generate-pain-follow-up.ts`.
- Review the diff to confirm only model-routing configuration changed in production code.

### Manual verification

- Inspect one successful production `[claude]` usage log after deployment and confirm the logged model is `claude-opus-4-6` under normal conditions.
- If a controlled retryable-failure test is available outside production, confirm the fallback log names `claude-sonnet-4-6`; do not induce an outage in production solely to test fallback.

## Phase 2: Add model-routing regression tests

### Files and changes

- `src/lib/claude/__tests__/generate-pain-follow-up.test.ts`
  - Mock `callClaudeTool` using the same Vitest pattern as the other generator tests.
  - Add a representative `PainFollowUpSourceData` fixture.
  - Add a normal-generation test that invokes `generatePainFollowUp()` and asserts:
    - `model === 'claude-opus-4-6'`;
    - `fallbackModel === 'claude-sonnet-4-6'`;
    - `maxTokens === 6000`;
    - the existing follow-up tool name remains unchanged.
  - Add a regeneration test using the optional regeneration argument and assert the same primary/fallback pair. Also retain an assertion that the regeneration instruction is present in the user message, proving the existing path still works.
  - Do not duplicate the shared client's fallback-behavior tests; those remain in `src/lib/claude/__tests__/client.test.ts`.

### Automated verification

- Run `npm test -- --run src/lib/claude/__tests__/generate-pain-follow-up.test.ts`.
- Run `npm test -- --run src/lib/claude/__tests__/client.test.ts` to ensure the fallback contract still passes.
- Run the complete `npm test -- --run` suite.
- Run focused ESLint, `npx tsc --noEmit`, and `git diff --check`.

### Manual verification

- Generate a draft telehealth follow-up from a representative case and confirm all sections populate, hands-on findings remain prohibited, and procedure recommendations remain conditional.
- Compare generation latency and note quality with a recent Sonnet-generated follow-up, recording any material verbosity or workflow regression before broad clinical use.

## Risks and rollback considerations

- **Latency and cost:** Opus may be slower and more expensive. Existing token logging provides model and usage data; compare production behavior after rollout.
- **Narrative verbosity:** Opus may produce longer prose within the same 6,000-token cap. Schema validation remains unchanged, but manual review should check concision.
- **Telehealth fabrication:** A stronger model does not eliminate hallucination risk. Existing prompt rules and `validateTelehealthFollowUpOutput()` remain the enforcement layer.
- **Fallback timing:** The client attempts Opus three times before Sonnet fallback, so a sustained Opus capacity event may increase user-visible latency before recovery. This plan preserves established shared-client behavior.
- **Rollback:** Revert the two model options to Sonnet-only. No data migration or repair is required; finalized historical notes remain unchanged.

## Completion criteria

- Normal and regenerated pain follow-up notes request Opus 4.6 first and Sonnet 4.6 only as retryable-error fallback.
- Focused tests explicitly assert the primary model, fallback model, token limit, tool name, and regeneration instruction.
- Follow-up, shared-client, and full test suites pass.
- Focused lint, type-check, and diff checks pass.
- Manual draft review confirms telehealth safeguards and structured recommendations still behave correctly.
- Post-deployment logs confirm Opus 4.6 handles normal follow-up generation; latency and token usage are observed and reported separately from implementation completion.
