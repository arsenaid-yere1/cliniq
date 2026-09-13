# Verification Summary

Overall readiness: **Ready for phased implementation** after incorporating the review findings below.

Plan: `2026-09-12-follow-up-source-freshness-and-review.md`.

Verification combined source inspection with an independent plan-verifier review. No production code or patient records changed. The verification is architectural review; concurrency, database, UI, and model-output checks specified in the plan remain implementation acceptance criteria.

## Findings

### Major — Opposing source and lifecycle lock orders

Location: Atomicity / Phase 2.

Blocking source locks could conflict with existing note → encounter → episode → case operations: a historical writer already holds a source row before a trigger requests the case scope, while finalization can hold lifecycle rows before reading history.

Resolution: final plan specifies nonblocking `pg_try_advisory_xact_lock` for added scopes and `FOR SHARE NOWAIT` for added source rows, rollback on conflict, no automatic stale mutation retries, and separate-connection race tests. Existing lifecycle order remains unchanged. Source-set insertions/deletions and multi-case identity changes are explicitly included.

### Major — Unguarded ordinary saves

Location: Phase 3 / `src/actions/pain-follow-up-notes.ts`, `savePainFollowUpNote`.

The branch without a treatment decision discards `expected_updated_at` and saves unconditionally. UI dirty-state handling alone cannot prevent an old request overwriting an accepted proposal.

Resolution: require optimistic version checks on every save and test stale no-decision saves against proposal acceptance/manual review.

### Major — PDF snapshot mismatch

Location: Phase 3 / `src/lib/pdf/render-pain-follow-up-pdf.ts`.

The renderer independently reads patient, encounter, and provider data. A source change/reversion during rendering can escape a final content-hash comparison while leaving different data in the PDF.

Resolution: render clinical fields from the immutable checked source snapshot, then recheck that snapshot fingerprint and note version during signing. Add explicit A → B → A coverage. Rendering-only clinic assets remain separate.

### Minor — Phase dependency

Location: Phases 1–3.

The original phase order wired an RPC before the database phase created it.

Resolution: Phase 1 defines contracts/adapters and tests; Phase 2 creates database support; Phase 3 connects live actions.

## Missing Work

No material product decision remains unresolved in the revised plan. The source snapshot projection, source-write trigger coverage, and lock tests must be implemented together before UI integration. Do not treat a passing prompt-string test as proof of clinical narrative correctness.

## Risks

- Schema and signing changes have wider operational impact than a prompt-only fix; rollout begins in report-only mode.
- Existing drafts have unknown compatible provenance and need explicit review, not automatic baseline backfill.
- Patient/provider source dependencies span cases; fail-fast conflicts must be surfaced by affected write paths.
- Historical symptom relevance still needs reviewed synthetic generation examples and clinician review.
- Source-review metadata must be protected from direct writes and kept separate from patient treatment decisions.

## Suggested Changes

All blocking recommendations above were incorporated. No additional scope expansion is recommended. First release remains pain-follow-up-only, with reusable contracts for later adoption.

## Final Recommendation

Approve phased implementation. Source race tests, lifecycle integration, PDF snapshot tests, and UI dirty-state tests are release gates. The planning turn ran a whitespace check on the plan with no findings; application tests were not rerun because only documentation changed.
