# Quality Review v3 implementation and verification

Updated: 2026-09-19. Implementation is present in the working tree. Production release was explicitly requested on 2026-09-19. The QC migration is applied; deployment verification is in progress. The code defaults to disabled unless `QUALITY_REVIEW_V3_ENABLED=true` is configured.

## Implemented contracts

- `src/lib/qc/review-source.ts` collects every canonical saved section, exact episode/encounter context, effective approved imaging/PM evidence, saved treatment decisions, and source versions. Errors abort rather than become missing rows. Clinical and version hashes are separate. Input is bounded at 240,000 bytes without truncation; consecutive reads and a prepublication check detect changes, but are not a transactional clinical snapshot.
- `review-rules.ts`, `review-validators.ts`, and `review-trajectory.ts` apply current narrative, coding, telehealth, stale-decision, and numeric checks. Derived endpoints explicitly distinguish measured, estimated, and carried-forward values. Follow-ups have no invented external-cause coding or mandatory-section policy.
- `src/lib/claude/generate-quality-review.ts` supplies ten semantic rule families and a source-constrained citation contract. The model must cite valid source IDs and top-level fields with exact excerpts. Invalid targets or citations fail bounded structured-output validation. Reaching the finding cap marks coverage limited.
- `review-identity.ts` uses rule/target/entity keys and evidence fingerprints. Dispositions reopen when relevant evidence or severity changes. Nondetection is separate from verification, including recurrence after an intervening absent result. Previous published rows and run transitions retain history. Manual resolution remains separately labeled.
- `review-service.ts` separates attempts from published reviews, renews leases independently of model progress, checks renewal health before publication, and reconciles disposition conflicts without rerunning the model. Logs include operation, run ID, duration, version, and conflict status, without source text.
- `src/actions/case-quality-review-findings.ts` binds mutations to the displayed review and persisted finding. Verify replays a supported deterministic rule on current sources. Fix binds the exact note/version/run, preserves concurrent disposition changes, and distinguishes a saved note with failed recheck from an unsuccessful note save. Expired operations can be recovered.
- Regeneration actions accept an optional QC target while ordinary editor calls retain their signatures. QC saves use `quality_review_save_fix`; the database checks lease, actor, target, version, draft status, case/episode/encounter restrictions, correction locks, and allowed patch fields. Initial/procedure/discharge QC source reads add target scoping and checked errors.
- `qc-review-panel.tsx` retains the last success during processing/failure, derives counts and status from findings/dispositions, displays evidence dates and limitations, hides unsupported Verify, gates signed-note Fix, navigates to the exact follow-up, and pages history with timestamp/ID cursors. Rollback leaves v3 results readable with actions disabled.

## Automated results

| Check | Result |
|---|---|
| Final `npm test` | 148 files passed; 2 failed; 1 live-evaluation file skipped by default. 2,157 tests passed, 19 failed, 10 explicitly opt-in tests skipped. All QC tests passed. |
| Final action/QC/schema/component focused run | 494 tests passed across 36 files; ten live-model tests skipped here and executed separately. |
| Final `npx tsc --noEmit` | Passed. |
| Final `npm run build` | Passed. Network access was required for the application's existing Google Fonts dependency. |
| Final `npm run lint` | One existing error at `src/components/settings/invite-user-dialog.tsx:62` (`react-hooks/set-state-in-effect`), plus 40 warnings. No new QC lint errors. |
| `git diff --check` | Passed. |
| QC pgTAP | 24/24 passed in disposable `cliniq_qc_test_20260916`, including publication rollback, grants, ownership, version conflict, and late-fix fencing. |
| `scripts/test-quality-review-concurrency.py` | Seven real-session scenarios passed: simultaneous begin; begin/publication; independent dispositions; publication/disposition; expired publication; fix/review; expired fix/replacement. |
| `scripts/test-quality-review-backfill.py` | Six assertions passed using the exact migration backfill inside a rolled-back transaction. Failed/processing history restores the latest eligible completion; first-run pending does not manufacture success; completed rows and original attempt metadata remain. |
| Live model matrix | Ten rule families passed their issue and clean-control pair (20 synthetic inputs), using the configured Opus model. Results retained under `quality-review-evaluation/qc-v3/`. |
| Supabase security advisors | Seven warnings in existing functions/audit policy; no warning identified the new QC functions/table. |

The 18 `visit-editor-save-finalize.test.tsx` failures were reproduced in a temporary baseline checkout containing the preexisting non-QC work and no QC implementation changes. The psychological editor test passed in isolation but timed out in the full run. These are not a passing repository-wide gate and remain visible rather than being skipped or weakened.

The broader database suite ran against a schema-only disposable copy: 14 files/114 executed assertions, with three fixture/setup failures. `clinical_reset_test.sql` needs a storage bucket; `discharge_note_correction_test.sql` needs its provider fixture; `procedure_numbering_test.sql` fails an existing episode date guard. The QC suite passed. No production or existing application database was reset to satisfy these prerequisites. Local migration listing also showed an existing database-only migration `20260913003202`; the new QC migration is intentionally not applied to the normal local database.

## Model evaluation findings

Initial live evaluation correctly failed closed when model citation paths did not match the source registry. Constraining the tool schema to registered source IDs and top-level fields fixed that interface defect. A chronology clean-control fixture itself contained contradictory dates and was corrected. A subsequent real consent false positive led to an explicit prompt rule against review reminders and mutually consistent refusals. The final full matrix passed; earlier failures are recorded here rather than treated as evidence of passing coverage.

This is a small synthetic regression matrix, not a measured clinical sensitivity/specificity claim. It tests each semantic family with one seeded issue and one clean control. Broader longitudinal and clinician-reviewed evaluation remains part of controlled rollout. Changes to rules, prompt, identity, or evidence semantics must bump the review version and rerun the matrix.

## Release gates still open

1. Manual clinical/UI verification from the plan: synthetic cases covering both entry paths, multiple visits, signed/draft restrictions, source changes, actual editor fixes, keyboard behavior, and two browser sessions. No manual verification is marked complete.
2. Resolve or explicitly account for the repository-wide test/lint failures and the broader database fixture prerequisites before deployment.
3. Reconcile normal environment migration history, apply `supabase/migrations/20260916232155_quality_review_runs.sql` through the deployment workflow, and verify the generated schema against that environment.
4. Enable the flag only for controlled synthetic testing first. Drain existing legacy writers before enabling v3. Rollback disables v3 writes while retaining published reviews/history; do not reintroduce an old writer for an episode that already has a v3 result.

No commit, production migration, deployment, or rollout enablement was performed.

## Production release — 2026-09-19

The user explicitly requested production deployment with the reported verification limitations. The migration dry run initially detected the previously reverted source-review migration in remote history. A temporary migration-only release copy restored its exact original file from commit `8b608ef`; no remote migration history was repaired or deleted, and no retired enforcement setting was changed. A second dry run confirmed only `20260916232155_quality_review_runs.sql` would run. The production processing-review count was zero before deployment. The QC migration applied successfully through `supabase db push --linked --skip-vault`.

Production enablement uses the Vercel `QUALITY_REVIEW_V3_ENABLED=true` variable. GitHub main is the production source; only QC implementation, tests, scripts, and QC documentation are included in this release. Manual clinical acceptance remains unconfirmed and is not represented as completed by the deployment request.
