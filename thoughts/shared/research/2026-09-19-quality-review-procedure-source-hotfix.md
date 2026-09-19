# Quality Review procedure source hotfix

The production QC v3 collector failed with `Unable to load Quality Review source: procedures` because `collectReviewSnapshot` in `src/lib/qc/review-source.ts` selected `procedures.encounter_id`. Production schema inspection and `src/types/database.ts` confirm that column does not exist.

Procedures belong directly to a care episode. Their optional `source_encounter_id` identifies the ordering visit, not a procedure encounter. `complete_procedure_appointment` and `create_direct_episode_procedure` in `supabase/migrations/20260912170410_procedure_numbering_ignore_deleted.sql` store procedure vitals by `procedure_id`, with a null encounter ID.

The collector now selects type-checked procedure columns, leaves the procedure note encounter unset, and matches procedure vitals by procedure ID. It no longer reports missing encounter context for procedures. Visit notes retain their existing encounter matching, and duplicate procedure vitals remain an explicit coverage limitation.

Verification:

- Corrected production SELECT with zero-row filters succeeded; no patient data returned or modified.
- `npx vitest run src/lib/qc src/actions/__tests__/case-quality-reviews.test.ts src/actions/__tests__/case-quality-review-findings.test.ts`: 142 passed, 10 opt-in live tests skipped.
- `npx tsc --noEmit`: passed.
- Targeted ESLint and `git diff --check`: passed.
- `npm run build`: passed.
- Regression tests cover direct and ordered procedures, correct procedure vitals, unrelated vitals exclusion, and ambiguous duplicate readings.

No database migration or permission change is required. A complete authenticated review in the clinical UI remains a manual check.
