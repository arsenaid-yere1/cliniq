# Verification Summary

Overall readiness: **Ready**.

Reviewed plan: `thoughts/shared/plans/2026-09-25-prior-episode-pain-evaluation-history.md`.

The plan was checked against generation/source gathering, historical record ownership, correction behavior, prompt/decision contracts, and both QC paths. Independent QC review initially requested revisions; the revised plan was reread and approved with no remaining blockers.

## Findings

### Major — legacy QC historical target IDs (resolved)

Location: QC implementation approach and Phase 3; `src/lib/claude/generate-quality-review.ts`, `src/actions/case-quality-reviews.ts`.

Legacy parsing validates result shape but not current-note membership. Historical provenance introduces IDs the model could accidentally select as fix targets; legacy evaluation fixes dispatch by step/current episode.

Resolution: require current target tuple validation before publication and before legacy fix/verify dispatch; reject historical or mismatched targets and test model-generated and persisted invalid findings.

### Minor — future records leaking into coverage hashes (resolved)

Location: shared selection and QC hashing.

Reporting every skipped historical row could make future records change coverage and therefore hashes despite exclusion from clinical evidence.

Resolution: wholly future records contribute no counts, IDs, dates, metadata, or hash changes. Clinically relevant missing/pending historical sources retain explicit coverage.

### Minor — version descriptor representation (resolved)

Location: QC snapshot contract; `src/lib/qc/review-types.ts`.

The current versions array supports only source ID and update timestamp.

Resolution: add an optional deterministic fingerprint and a namespaced historical-selection version entry. Internal descriptors stay outside clinical hashes and model serialization; rereads include historical selection.

### Minor — freshness guarantee exceeded existing architecture (resolved)

Location: QC testing and rollback risks; `src/lib/qc/review-service.ts`.

The final reread detects changes before publication, but the publication RPC does not atomically recheck every source row.

Resolution: explicitly preserve this existing concurrency boundary. Tests cover changes detected by the final reread; transactional enforcement remains separate work.

### Minor — historical cutoff fallback (resolved during author review)

Location: generation integration; `src/lib/age.ts`, `pickVisitAnchor`.

The existing age/date helper falls back to finalized-at or today, which cannot establish historical eligibility for an undated encounter.

Resolution: historical selection uses an explicit service-date policy shared with QC; unknown dates produce unavailable coverage rather than a today fallback.

## Missing Work

No missing planning requirements identified. Implementation, automated regression tests, synthetic clinical prose review, and release verification remain future execution work as listed in the plan.

## Risks

- Incomplete or reopened historical records reduce available context.
- Explicit history budgets may block generation/QC for unusually large records while preserving saved work.
- Model prose requires manual synthetic review in addition to mocked tests.
- Existing final-reread publication race remains unchanged.
- Unrelated database/QC and migration-history issues must not be repaired implicitly in this feature.

## Suggested Changes

All requested changes were incorporated. Keep generation and both QC integrations together when implementing or rolling back.

## Verification Performed

- Read-only repository searches and source inspection completed; source-path existence checks passed.
- Python document whitespace/structure check passed; four implementation phases present.
- `git diff --check` passed for tracked changes; the new untracked plan received a separate whitespace check.
- No application tests run: this task changed planning documents only.
- No Node processes started, application code changed, schema changes made, or deployment performed.

## Final Recommendation

Approve the revised plan for implementation. No outstanding blocker from the independent review.
