# Follow-up source freshness implementation record

Implemented locally against the approved `2026-09-12-follow-up-source-freshness-and-review.md` plan. No production migration, deployment, or clinical-record rewrite was performed.

## Delivered behavior

- `private.follow_up_snapshot` in `supabase/migrations/20260913003202_follow_up_source_review.sql` supplies one canonical clinical projection, dated source manifest, and fingerprint. Historical encounters/procedures must precede the current clinical date. Metadata-only changes do not alter the clinical fingerprint.
- `private.follow_up_review_rpc` manages durable pending/ready/failed/applied/discarded proposals. Original content remains in the audit record; generation never updates note prose. Proposal completion and application require the original note version and current source fingerprint. Full acceptance records review of the resulting content; section acceptance requires a separate whole-note review. Plan and recommendations apply together.
- Review metadata is server-owned and bound to clinical sources and note content. Direct forgery is rejected. Ordinary saves require a note version, including saves without a treatment decision. Existing decision confirmation remains independent and must be renewed when its plan/date changes.
- `src/actions/pain-follow-up-notes.ts` routes generation, review, acceptance, and signing through these contracts. The model used is retained from the actual API response via `src/lib/claude/client.ts`.
- `src/lib/pdf/render-pain-follow-up-pdf.ts` renders clinical identity/date/telehealth fields exclusively from the checked snapshot. Signing rechecks the snapshot and note version after rendering and uploading. Existing unreferenced-document cleanup remains in place.
- `src/components/visits/follow-up-source-review.tsx` shows current/history sources, changed-source labels, and current/proposed narrative comparisons. The editor preserves unsaved text on refresh and explicitly handles external versions. `follow-up-workspace.tsx` coordinates unsaved intake with generation/review/signing controls.
- `fixFinding` and `QcReviewPanel` were also adapted: follow-up AI corrections create proposals and navigate to review, without rechecking unchanged text or reporting that the correction has already been applied.
- Signed replays remain unchanged. Audited keep-content reopening retains the baseline and clears review, with signed provenance in `clinical_note_revisions`. Wipe resets clear provenance and cancel active proposals, including manually reviewed legacy drafts with no generation hash.

## Database protection and verification

The source-write triggers and protected snapshot use case-scoped advisory locks. Added scope locks and snapshot row locks fail immediately when busy. Existing UPDATE row-lock acquisition may wait before a row trigger runs; the separate-connection tests distinguish this existing row protection from fail-fast source-membership checks. No model or network request holds these transaction locks.

`supabase/tests/database/follow_up_source_review_test.sql` exercises actual authenticated RPCs and triggers, including chronology and deterministic procedure ordering, metadata-only updates, changed clinical facts, duplicate proposals, malformed recommendations, version conflicts, review invalidation, linked plan replacement and decision invalidation, both existing signing entry points, signed replay, signed review archival, keep-content reopening, and wipe resets. Fixtures roll back.

`scripts/tests/follow-up-source-concurrency.py` passes 12 separate-connection scenarios, covering historical writes/deletion/insertion, eligibility changes, old/new ownership, patient/provider changes, evaluation encounter synchronization, reset during a protected snapshot, reverse writer/reader acquisition, and existing row locks. It only targets the local Supabase Docker container and uses synthetic fixtures.

A larger procedure-history fixture exposed a source-read failure involving non-materialized JSONB provenance. The read RPC now materializes the note JSON before nested source queries; the larger fixture passes through repeated review, replacement, signing, and reset.

## Automated checks

| Check | Result |
| --- | --- |
| `npm test` | 1,608 tests in 121 files passed |
| `npx tsc --noEmit` | Passed |
| `npm run build` | Passed with network access for existing Google font downloads |
| `npm run lint` | Existing 1 error and 40 warnings; error remains `src/components/settings/invite-user-dialog.tsx:62` |
| `npm run db:test` | New source-review test and 9 other files pass; the same 2 pre-existing fixture failures remain before and after this migration |
| `python3 scripts/tests/follow-up-source-concurrency.py` | 12 scenarios passed |
| `supabase gen types --local --lang=typescript` | Generated locally; integrated the follow-up table fields and RPC contract without unrelated type reordering |
| `git diff --check` | Passed |

The PDF regression includes a simulated A → B → A chart change during asset rendering and confirms that only the checked A clinical snapshot is rendered. Prompt tests cover current versus historical shoulder symptoms, explicit corrections, omission, onset, and reported movement pain. They establish prompt/payload contracts, not model narrative accuracy.

## Existing local baseline issues

A clean repository migration replay fails at `20260412_discharge_notes_visit_date.sql`: `visit_date` is already declared in `016_discharge_notes.sql`. Testing used a disposable copy under `/tmp/cliniq-source-review` with `ADD COLUMN IF NOT EXISTS` only in that old copied migration. Repository historical migrations were not modified.

The copied local configuration enables legacy automatic public-schema grants to match the expectations of the older migrations. Without that setting, the current CLI defaults produce unrelated permission failures. After matching that baseline, these two test files fail identically before and after the new migration:

- `discharge_note_correction_test.sql`: its assigned-provider fixture references a missing `provider_profiles` row.
- `procedure_numbering_test.sql`: its fixture creates a procedure before the latest completed visit, violating the existing date guard.

The final new migration also applied successfully in a clean rebuild of this adjusted local fixture. Colima/Docker were installed for local database verification; no production connection was used for these tests.

## Rollout and remaining manual checks

The migration defaults `private.follow_up_review_settings.enforce` to `false`. The new application signing action always enforces review; legacy signing entry points remain in report-only mode until rollout activation. After deploying the additive migration and compatible application, smoke-test the review flows, then enable the existing-entry-point guard through an administrator-controlled database change. Do not backfill old notes as reviewed.

Still pending clinician/browser verification:

- Review the synthetic narrative scenarios in `src/lib/claude/evals/pain-follow-up-history.json`; no live model evaluation or clinician wording review was claimed.
- Exercise the compare/discard/apply and manually reconcile/save/review/sign flows in a browser, including a second session and intake edits.
- Verify production deployment and enable legacy signing enforcement only after the compatible application passes smoke tests.

No manual checklist item has been marked complete. The motivating patient's saved note and PDFs remain untouched.
