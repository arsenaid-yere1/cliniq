# Follow-up finalization after source-review revert

## Question

Why can the follow-up encounter ending `6f279b5fefe6` not be finalized after revert `279e1de`?

## Verified observations

- Production visit page shows an in-progress visit, draft note, saved accepted treatment decision, and enabled finalization button. Source-review controls are absent, consistent with the reverted UI.
- Read-only production REST queries confirm draft status, no linked final document, a saved decision, populated visit date/provider/telehealth fields, and null `source_review`.
- Three generated-document rows at approximately 21:27:13, 21:27:27, and 21:28:53 UTC on September 13 were soft-deleted immediately after creation. This is consistent with the finalization RPC failure cleanup in `src/actions/pain-follow-up-notes.ts`, `finalizePainFollowUpNote`.
- The production database still exposes `source_review`, even though the migration adding it was removed from the repository by the revert. The code revert did not roll back the applied schema.

## Leading hypothesis (not yet confirmed)

The database may still enforce source review after the app has removed the controls required to satisfy it. In implementation commit `8b608ef`, migration `supabase/migrations/20260913003202_follow_up_source_review.sql` added `private.follow_up_review_settings`, `private.guard_follow_up_review`, and a source-review check to `private.finish_clinical_note`. With `enforce=true`, a null review blocks signing. The migration defaults enforcement to false, so the presence of the column alone does not prove the gate is active.

## Code path

`src/components/visits/pain-follow-up-editor.tsx` saves the note and decision before calling `finalizePainFollowUpNote`. The action renders/uploads a PDF, creates the document row, calls `finalize_pain_follow_up`, and cleans up the document on RPC failure. Error messages containing `changed` are replaced by a generic changed-note message; other errors mostly become `Unable to finalize follow-up note`. This can conceal the database's actual rejection reason.

## Existing verification

The earlier rollback passed 123 targeted tests, including `src/actions/__tests__/pain-follow-up-notes-finalize.test.ts`. Those tests use mocked database responses and do not verify production enforcement settings.

## Open questions and access limitation

Need production PostgreSQL error logs and a read-only query of `private.follow_up_review_settings` plus the live signing function definitions to confirm the actual blocker. The Supabase SQL/log connector rejected authentication; the configured management token also failed authentication. Production REST access works but does not expose the private configuration. Other database signing guards remain possible.

No finalization was attempted during this investigation; no patient records or production settings were changed.

## Confirmed production blocker — follow-up investigation

Using the authenticated Supabase dashboard SQL editor, the read-only query `select enforce from private.follow_up_review_settings` returned `true`. Together with this draft's null source review and the removed UI, this confirms the obsolete requirement remains enabled after the code revert.

Prepared, but did not execute, a transaction setting `enforce=false` for the singleton configuration row and selecting the result. This is a global follow-up workflow configuration change, not deletion of case data or fabricated review metadata. Browser policy requires action-time confirmation before disabling an approval requirement. Awaiting that confirmation; clinical records remain unchanged.

## Production remediation completed — 2026-09-13

After explicit user confirmation, executed the prepared transaction setting `private.follow_up_review_settings.enforce=false` for the singleton row. The transaction returned false, and a separate read-only query after commit also returned false, confirming persistence. This disables the retired source-review requirement for all follow-up notes. No clinical note, treatment decision, proposal, PDF, or audit record was deleted or modified. Finalization was not attempted on behalf of the clinician; end-to-end signing remains to be retried in the app.
