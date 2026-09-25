# Prior Episode History — Implementation Validation

Implemented 2026-09-25 against the reviewed plan. No deployment, database migration, Case Summary update, or historical record write.

## Delivered

- `src/lib/clinical/prior-episode-history.ts`: pure dated projection, detailed latest episode/compact older episodes, raw clinical fields and provenance, explicit partial coverage, corrected canonical rows, byte budget, shared history prompt.
- `src/lib/clinical/load-prior-episode-history.ts`: authenticated paged reads with ownership validation, performed-procedure joins and internal version fingerprint. No elevated client or mutation API.
- `src/actions/initial-visit-notes.ts` and `src/lib/claude/generate-initial-visit.ts`: separate history for full generation and both regeneration branches. Same-episode `priorVisitData`, current intake/vitals and PRP evidence remain separate. Save/sign do not retrieve history. Return prompts support recurrence after successful discharge.
- `src/lib/qc/review-source.ts`, `review-types.ts`, `review-findings.ts`, `review-trajectory.ts`: historical sources remain outside editable notes/current procedure trajectory, with evidence-date validation and historical selection freshness.
- `src/lib/qc/legacy-review-target.ts`, `src/actions/case-quality-reviews.ts`, `src/lib/claude/generate-quality-review.ts`: legacy history and target-membership checks before publication/fix/verify; current-target behavior remains supported.

## Automated results

| Command/check | Result |
| --- | --- |
| Initial history loader/projector tests | 27 passed |
| Focused generation/QC regression run | 117 passed |
| Legacy target/model contract checks | 43 passed |
| Full `npm test`, final full run | 2,315 passed; 11 skipped; 161 test files passed and one skipped |
| Final focused check after coverage refinement | 58 passed across six files |
| `npx tsc --noEmit` | Passed |
| `npx eslint` on every changed/new TypeScript file | Passed |
| `npm run lint` | Existing `react-hooks/set-state-in-effect` error in unchanged `src/components/settings/invite-user-dialog.tsx:62`; 40 existing warnings |
| `npm run build` | Passed with network access for configured Google Fonts |
| `git diff --check` | Passed |

One full run timed out in the unchanged psychological visit editor test at its 5-second limit while other checks were running. The entire file passed in the focused rerun, and the subsequent full suite passed. No timeout setting or unrelated UI code was changed.

The initial sandbox build could not fetch Google Fonts; its network-enabled retry passed. Supabase CLI help hit a sandbox telemetry-write restriction; no CLI mutation was attempted. The Supabase MCP SQL connection was unauthorized. A fallback using the application's public API configuration performed zero-row schema queries without retrieving patient data: discharge, procedure, and procedure-note selections passed. Episode, encounter, initial-evaluation and follow-up tables require authentication, so those live checks remain unverified. Repository-generated types and migrations were inspected for their columns and foreign keys. New evaluation-to-encounter joins explicitly name the foreign key because two relationships exist.

Supabase documentation was checked for paging/join behavior; the relationship syntax was confirmed against the [official joins documentation](https://supabase.com/docs/guides/database/joins-and-nesting). No schema, RLS, auth configuration, or migration history was changed.

## Regression coverage

- Earlier episode number gaps, same-day discharge, future and wrong-case exclusions, missing dates, cancelled/deleted records, draft corrections and canonical finalized corrections.
- Procedure performance separated from draft narrative; structured site labels and legacy fallback; no invented sustained benefit from tolerance.
- Pagination, deterministic ordering, collection/projected byte limits, and read errors.
- Full/section/special Treatment Plan regeneration and QC fenced saves receive history.
- Current exam/vitals and same-episode reference remain isolated; prior notes unchanged.
- Historical correction changes generation/QC clinical hashes while PRP evidence remains unchanged; metadata/eligibility changes update QC version checks.
- Save and sign succeed without querying history, even when the mocked history service is unavailable.
- Historical notes cannot become current targets; legacy historical/mismatched IDs are rejected before regeneration/override changes.
- Exact historical evidence quotes, future-evidence rejection, current-only procedure counting, and historical rereads during snapshot stabilization.
- Legacy failed history retrieval leaves the published review untouched.

## Compatibility details

Legacy evaluation/discharge findings sometimes omit encounter IDs. They remain usable only after exact current note/case/episode/type validation; any supplied encounter ID must match. Follow-up fixes require the exact encounter. This preserves existing findings without allowing historical IDs to redirect regeneration.

As planned, QC freshness retains the existing final-reread boundary rather than adding a transactional source-row check to the publication RPC. Already signed notes are not automatically regenerated when a historical record changes.

## Remaining verification

- Authenticated non-production smoke check of all new read queries.
- Manual clinician review of generated synthetic prose and lifecycle: previous discharge → return evaluation → follow-up → discharge, including both QC modes and section regeneration.
- Deployment is not performed by this implementation task.

Manual checks are not marked complete. Automated model-stub checks establish data isolation and prompt contracts, not guaranteed clinical prose quality.

## Release verification — 2026-09-25

The user confirmed the vitals fix works and authorized production deployment of the episode workflow changes. The release builds on vitals commit `064a4f8` and contains the previous-episode history integration, tests, and supporting research/plan documents only.

- `npm test`: **2,319 passed, 11 skipped; 162 test files passed, one skipped**.
- `npx tsc --noEmit`: passed.
- `npx eslint` across all 22 changed/new TypeScript files: passed.
- `git diff --check`: passed.
- No schema migration is required. The existing automated episode-isolation, generation, save/sign, PRP, and both QC-mode regressions passed.

Deployment status will be confirmed against Vercel's build and production alias. The manual clinical-prose and authenticated synthetic workflow checks listed above remain unverified.
