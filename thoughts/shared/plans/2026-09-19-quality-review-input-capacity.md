# Quality Review input capacity Implementation Plan

## Overview
Replace the 240 KB snapshot cap that blocks larger clinical episodes with lossless prompt packaging and model-specific token preflight.

## Current State
`collectReviewSnapshot` in `src/lib/qc/review-source.ts` limits each collection and the complete snapshot to 240,000 bytes. `generateGroundedQualityReview` in `src/lib/claude/generate-quality-review.ts` sends both notes and sources, duplicating canonical note fields. The shared `src/lib/claude/client.ts` uses Opus with Sonnet fallback, 16,000 output tokens, and validation retries.

## Desired End State
Ordinary larger episodes retain every source and section and reach review generation. Only genuinely excessive input fails, with a specific capacity message. Existing snapshot hashes, deterministic checks, evidence validation, and publication safeguards remain unchanged.

## Key Discoveries
- `ReviewSnapshot` intentionally has both note-oriented and evidence-oriented representations; change only the model serialization.
- `sources[].fields` already contains note sections, context, and saved decisions.
- Some synthetic callers have incomplete source mirrors; never remove a note value unless the matching source has exactly equal JSON content.
- Anthropic documents 1M context for both configured models and model-specific `messages.countTokens`. Count the exact system, tools, tool choice, and messages for both models; reserve 100,000 tokens for output, retries, and estimation margin.
- Documentation: https://platform.claude.com/docs/en/build-with-claude/token-counting and https://platform.claude.com/docs/en/build-with-claude/context-windows.

## What We Are Not Doing
No clinical summarization, truncation, sampling, batching, schema changes, model changes, or shared-client behavior changes.

## Implementation Approach
Keep the full internal snapshot, and build a separate compact model payload. Note metadata points to its evidence source and lists canonical section keys. Remove sections/context/decision only when the entire group is duplicated exactly in that source; retain unmatched groups. Keep all sources unchanged. Replace the tiny byte cap with a 16 MB aggregate collection memory guard and 32 MB complete snapshot guard. Before inference, count the full request using both configured models and enforce a 900,000 input-token budget. Fail explicitly if counting fails or either model exceeds the budget.

## Phase 1: Lossless input packaging and collection capacity
### Files and changes
- New `src/lib/qc/review-input.ts`: capacity constants and lossless prompt serializer.
- `src/lib/qc/review-source.ts`: aggregate page-byte memory guard and snapshot guard.
- Collector tests and new input tests: above-old-limit content, source preservation, missing/unequal mirrors, no mutation, empty/null fields, aggregate memory rejection.
### Automated verification
- [x] Focused tests and type-check pass.
### Manual verification
- [ ] User confirms the formerly failing episode can be reviewed after deployment.

## Phase 2: Exact request preflight and release
### Files and changes
- `src/lib/claude/generate-quality-review.ts`: compact payload instructions; preflight both primary/fallback using the existing Anthropic client with bounded timeout/retries; retain parser and evidence checks.
- `src/lib/claude/__tests__/generate-quality-review.test.ts`: exact request counting, success above the old byte limit, excessive counts, fallback differences, count failure, no generation on failed preflight.
### Automated verification
- [x] Relevant QC/action/model tests, targeted lint, type-check, and production build pass.
- [x] Live synthetic anatomy conflict/clean control passes with compact payload and real token counting.
- [x] Additional live synthetic request above 240 KB completes and detects the seeded conflict.
- [ ] Review diff, commit scoped files, push, and confirm production alias.
### Manual verification
- [ ] Full authenticated clinical review remains user-verified.

## Risks and rollback considerations
Larger episodes consume more model input and may take longer. Preflight adds two bounded API requests; counting failure must preserve the prior successful review. Keep output/retry headroom. Aggregate memory guards prevent unbounded collection. Rollback by reverting this scoped commit; no migration required.

## Completion criteria
Automated checks pass, the release is live, and remaining manual acceptance is explicitly reported.

## Verification Summary
Readiness: Ready. Verified collector, snapshot types, model generator, shared client, existing unit tests, and synthetic evaluation runner. No shared-client change or database migration is required. Lossless equality checks address partial source mirrors; both fallback capacity and failed preflight are tested. Approved for implementation.

## Automated results
- `npx vitest run src/lib/qc src/lib/claude/__tests__/generate-quality-review.test.ts src/actions/__tests__/case-quality-reviews.test.ts src/actions/__tests__/case-quality-review-findings.test.ts`: 157 passed; opt-in model tests verified separately.
- `npx tsc --noEmit`, ESLint on all changed TypeScript files, and `git diff --check`: passed.
- `npm run build`: passed.
- Live evaluation selected `anatomy_consistency` and `larger than` through the existing environment-loading workflow: 2 tests passed, representing three model generations. Reports are saved under `thoughts/shared/research/quality-review-evaluation/qc-v3/`.
- No production clinical records were changed during verification. Full authenticated review of the user's episode remains a manual acceptance check.
