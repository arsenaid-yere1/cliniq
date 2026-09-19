# Verification Summary

Date: 2026-09-16
Plan: [Comprehensive Quality Review Hardening](2026-09-16-quality-review-comprehensive-hardening.md)
Overall readiness: **Ready after incorporated revisions.** This approves the implementation approach, not completed implementation or production rollout.

The full plan was independently reviewed against current schemas, action paths, note regeneration, decision persistence, UI disposition behavior, and migration conventions. The author incorporated the findings below. No application code was changed for this planning task.

## Findings

### Major — Assessment enum compatibility

Location: Phase 3; `src/lib/validations/case-quality-review.ts`; original Quality Review migration.

The first draft used `major`/`minor`, while persistence accepts `major_issues`/`minor_issues`. Corrected to the actual enum values.

### Major — Saved decisions can become stale

Location: Phases 1–2; `supabase/migrations/20260910234459_visit_treatment_decision.sql`.

Parsing establishes structure, not continued applicability. Added matching against the current normalized plan hash and effective visit date, separate stale/malformed/absent states, historical evidence retention, and signed/correction exceptions. Added regression cases for changed plans/dates and unchanged normalized text.

### Major — Disposition lifecycle and derived UI state

Location: Phases 3, 5–6; `src/components/clinical/qc-review-panel.tsx`; `src/actions/case-quality-reviews.ts`.

Added explicit manually-resolved status distinct from verified resolution, a shared active-status predicate, and assessment/count/score derivation after disposition writes and at read time. Acknowledged and edited findings remain active. Recurring resolved findings reopen.

### Major — Lease fencing and publication authorization

Location: Phases 4–5.

Added unexpired-lease requirements for heartbeat/publication and transactional revalidation of case/episode restrictions. Expired attempts cannot renew or publish.

### Major — Late fix can write after lease expiry

Location: Phases 4–5; note regeneration actions.

Note-version comparison alone cannot stop an expired fix if the note has not changed. Added an atomic database-guarded QC final-note commit checking the fix run token/lease, note version/status, allowed fields, and clinical edit restrictions. Added expired-during-regeneration tests and migration/type requirements. Ordinary editor regeneration retains its contract.

### Major — Consistent database lock order

Location: Phase 4; visit-decision migration conventions.

Begin, publication, and fix operations must not acquire episode/run locks in opposite order. Specified a common needed-subset order: note, encounter, episode, case, run, review. Added begin-versus-publication and expired-fix-save contention cases to real two-connection verification.

### Minor — Score-helper behavior

Location: Phase 3; `src/lib/validations/case-quality-review.ts`; `src/lib/claude/generate-quality-review.ts`.

Clarified that generator normalization and legacy `getFindingScore` fallback are separate; the getter itself does not normalize arbitrary numeric scores. New merged scores normalize at the server boundary.

## Missing Work

No material planning blocker remains after the listed revisions. All application changes, migrations, tests, browser verification, and model evaluations are future implementation work. The plan explicitly defines them as completion gates.

## Risks

- Current source collection spans queries; repeated manifests reduce races but are not a transactional clinical snapshot. The plan states this limit.
- AI semantic detection remains probabilistic; synthetic model evaluations are required separately from mocked contract tests.
- Historical vitals ownership may be unrecoverable; unavailable evidence must remain visible.
- Database migration, legacy recovery, authorization, lock ordering, and real concurrency require local integration verification before rollout.
- Concurrent unrelated note changes may alter interfaces; implementation must recheck section inventories and signatures.

## Suggested Changes

All concrete review corrections above are incorporated. Preserve the phase gates and explicit distinctions between nondetection, clinician disposition, and deterministic verification during implementation. Keep the earlier follow-up-only plan marked superseded to prevent conflicting implementation instructions.

## Final Recommendation

Approve this plan as the implementation blueprint. Start with the snapshot/contracts phase and follow the dependency order; do not enable the new writer until integrated persistence, action, and UI gates pass.

Planning verification: source inspection and independent review completed; `git diff --check` passed. No application tests were rerun for documentation-only changes. The research baseline of 101 passing tests is historical evidence, not validation of these proposed changes.
