# Verification Summary

Overall readiness: **Ready after revisions**.

## Findings

Independent review identified three major omissions: the legacy `prepare_evaluation_visit` RPC reparented case-wide notes, inserting a draft changed scheduled encounters to in-progress, and procedure-date validation crossed Episode boundaries. A minor omission was unscoped procedure diagnosis choices.

All four findings are now explicit tasks in the implementation plan. Regression checks will cover legacy RPC ownership preservation, scheduled creation and subsequent generation, historical procedure dates, and Episode-specific diagnosis choices. Existing procedure-note post-filtering and case-wide billing collections remain intentional.

## Missing Work

No unresolved design work after these additions. Browser verification and local database availability are execution checks, not assumed results.

## Risks

Cardinality changes affect older callers. Default evaluation actions must deterministically resolve Episode 1, not query arbitrary case/type rows. Return evaluation generation must transition a scheduled encounter to in-progress before finalization.

## Suggested Changes

Incorporated into phases 1 and 2 of the plan.

## Final Recommendation

Approve implementation of the revised plan. Preserve historical data and validate the complete new series in SQL and action tests.

## Implementation verification (2026-09-24)

Implemented migration `supabase/migrations/20260924215440_episode_pain_evaluation_series.sql`, Episode-scoped evaluation actions/helper and visit navigation/editor. New return Episodes require a finalized previous discharge and begin with a distinct pain-evaluation encounter/note. SQL guards require evaluation finalization before follow-up/discharge and enforce service-date ordering. Existing Episodes retain their workflow flag default false; legacy preparation supports intake/pending-imaging and never reparents later notes.

Automated checks:

- `npm test -- --maxWorkers=2`: 157 files passed, 1 skipped; 2,258 tests passed, 11 skipped. Unbounded retries hit 5-second timeouts in interaction-heavy psychological editor tests (with a cascading assertion failure in one run); limiting parallel workers passed the entire final suite without changing timeout values or test assertions.

- `npx supabase test db --local supabase/tests/database/episode_pain_evaluation_series_test.sql`: 41 passed.
- `npx supabase test db --local` with the finalize_episode_discharge, clinical_reset, pain_follow_up_reset and visit_treatment_decision files: 35 passed.
- `npx tsc --noEmit`: passed.
- `npx eslint` over all changed/new TypeScript files: passed.
- `git diff --check`: passed.

Verification limitations:

- Full local database suite encountered other fixture/schema failures: discharge correction fixture references an absent provider profile; procedure numbering fixture violates the existing completed-visit date guard; quality review table/functions are missing locally; visit-specific diagnosis rollback finds an unexpected surviving function. The new lifecycle fixture date failure found during this run was corrected and all 41 new checks subsequently passed.
- `npx supabase db lint --local --schema public,private --level error` reported an error in unchanged `private.preview_clinical_reset`: dynamic SQL quotes the entire table-name array as one relation. No lint errors were reported for the new functions.
- `npx supabase migration up --local` could not run because local history includes version `20260913003202`, absent from checkout. Applied only the reviewed new migration locally with transactional `psql`, then reapplied final changed function definitions; did not repair history, reset local data, apply unrelated migrations, or deploy remotely. Deployment must apply the migration before the new UI.
- Browser end-to-end verification was not performed. Component tests cover scoped navigation, evaluation-first controls, writable state, and historical download/navigation with mutations disabled.

Manual code review covered the combined diff, ownership checks, legacy defaults, status synchronization, grants, idempotency and service-date boundaries. Source vitals for return evaluation exclude later follow-up encounters; Episode1 preserves shared evaluation vitals.

## Follow-up QC compatibility audit (2026-09-24)

The deeper audit found two integration regressions and corrected them: legacy `fixFinding` now passes the selected Episode to evaluation regeneration, and QC's evaluation/discharge editor links now retain the persisted review's Episode (evaluation links also select the correct visit type). V3 fix targets already carried exact Episode, encounter, note and version identity; that path is retained and now tested through the real regeneration action and fenced save call.

Additional tests cover return-series snapshot isolation, historical-note changes leaving the current review hash unchanged, current-note changes invalidating it, no borrowing of historical vitals, legacy fixes with V3 disabled, V3 ordinary/treatment-plan fixes, stale target rejection and failed lease saves without direct writes.

Database verification used `docker exec ... psql -X ... -v ON_ERROR_STOP=1 -At` with a temporary script containing BEGIN, the repository's existing `20260916232155_quality_review_runs.sql` migration, test content and ROLLBACK. All 24 existing `quality_review_runs_test.sql` checks passed. All 19 new `episode_quality_review_compatibility_test.sql` checks passed: real return RPC, independent review publication, exact-note fixes, wrong-Episode/finalized/stale rejection, normal evaluation finalization and follow-up QC edits, historical reviews preserved. TAP outputs contained no failing checks; post-run `to_regclass` confirmed the temporary QC table was rolled back. This resolves the prior QC test verification gap without changing persistent local migration history or deploying anything.

Final follow-up checks: `npm test -- --maxWorkers=2` passed 2,270 tests across 158 passing files (11 tests/1 file skipped). `npx tsc --noEmit`, ESLint on all follow-up TypeScript files, and `git diff --check` passed. Final diff review confirmed only two production integration fixes in this follow-up (legacy QC action argument and review-owned editor links); the remaining additions are tests and verification documentation. Live model evaluation/browser end-to-end checks were not performed; existing non-QC local database fixture/lint limitations above remain.

## Reset preview and return-Episode reset follow-up

Correction to the earlier limitation: the dynamic-relation lint finding did not reproduce at runtime. The existing `clinical_reset_test.sql` successfully calls the real preview repeatedly and performs audited resets/reactivation. The prior wording implied a confirmed runtime failure; the evidence supports a static-analysis issue instead.

Migration `20260924232122_clinical_reset_preview_queries.sql` replaces dynamic table enumeration in `private.preview_clinical_reset` with explicit UNION ALL queries. It retains note-family ordering, ID ordering, Episode/case/deletion filters, procedure ownership joins, active-user validation, response shape, blockers and existing grants. No reset mutation rules change. Applied this replacement only to local database; no remote deployment or migration-history repair.

Post-change checks: local database lint for public/private at error level returned no issues; local security advisors at error level returned no issues. Reset, follow-up reset and Episode lifecycle suites passed 71 checks. Reset action and dialog suites passed 14 tests. Whitespace review passed. Browser interaction has not been verified.

New `episode_reset_compatibility_test.sql`: 25 checks passed using real return, preview, reset and finalization RPCs. Verified signed return evaluation can reopen with an existing follow-up; signed snapshot and original PDF persist, replacement PDF links correctly, follow-up/discharge progression pauses until evaluation is finalized again, latest discharged return Episode reactivates in place with its evaluation requirement intact, and older Episode reactivation is rejected. Total reset-focused SQL verification: 96 checks across four files. No application code changed in this reset follow-up; targeted action/dialog tests passed rather than rerunning the unchanged full app suite.
