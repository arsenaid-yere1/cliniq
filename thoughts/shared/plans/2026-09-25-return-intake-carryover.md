# Return Intake Carryover Implementation Plan

## Overview
Prefill Accident Details, Past Medical History and Social History in a new return pain evaluation from finalized evaluations in earlier discharged episodes of the same case.

## Current State
`getProviderIntake` in `src/actions/initial-visit-notes.ts` reads only the selected episode. `saveProviderIntake` fills unspecified sections with defaults on section saves. `src/components/clinical/initial-visit-editor.tsx` displays saved intake or defaults. `src/components/clinical/intake-draft-context.tsx` flushes only dirty/saving cards, so untouched prefills would otherwise never reach generation. The return RPC creates a draft note with empty structured intake.

## Desired End State
Only absent history sections are prefilled for active return episodes with an ungenerated draft. Current saved sections, including intentional blank/default values, win. Source episode/date is shown; fields remain editable. Sequential save-before-generation persists all carried sections, and saving one card preserves the remaining carried sections across reloads. Historical records remain read-only.

## Key Discoveries
Initial evaluation notes have two encounter foreign keys; explicitly name `initial_visit_notes_encounter_id_fkey`. Section presence, not equality to defaults, is the safe overwrite boundary. Generated drafts have no history intake cards; this change deliberately applies before initial generation. Finalized/generated notes receive no new implicit prefills; reopened draft source evaluations are excluded. Use the current evaluation service date, with encounter date or episode opening date only for new notes, to exclude future source visits.

## What We Are Not Doing
No episode-status repair, database migration, production patient writes, Case Summary rewriting, historical prose parsing, or symptom/exam/vitals/psychological/consent carryover. No overwrite of generated or signed notes. Deployment is not part of this request.

## Implementation Approach
Add an authenticated read-only helper `src/lib/clinical/load-return-intake.ts` receiving an already ownership-validated episode and current note. Walk lower-numbered discharged episodes newest first, then finalized evaluations by clinical date (pain evaluation wins date ties). Require completed, live matching encounters and valid dates at/before current service date. Parse each requested section independently with existing intake schemas; the newest valid source fills each missing section. Paginate episode enumeration; note cardinality is bounded by existing per-episode visit-type uniqueness. Return merged form data and section-specific provenance. Errors remain explicit and block the form rather than masquerading as absent history.

## Phase 1: Server integration
### Files and changes
Create the helper. Extend `getProviderIntake` to return data plus carryover metadata. For section saves of new return drafts, seed missing history sections before overlaying stored data and the submitted section, retaining existing version/status fencing. Full intake saves remain explicitly supplied data. Update the initial-visit page to propagate metadata and surface intake-read failures.
### Automated verification
Test same-case/prior/discharged/finalized/completed/date guards, newer-source precedence and gaps, invalid/partial sections, absent history, saved empty/default section preservation, no historical queries for Episode 1/generated/finalized cases, read errors, and no mutations. Action tests verify section save/reload and generation receive the carried data, while earlier records remain unchanged.
### Manual verification
Inspect synthetic data projection and query scope; production patient records are not edited for testing.

## Phase 2: UI persistence and regression checks
### Files and changes
Pass carried section metadata through InitialVisitEditor to IntakeDraftProvider. Mark carried sections pending until successfully saved in useIntakeSectionSave. Display a concise source/review notice. Keep existing sequential flush and failure behavior.
### Automated verification
Test unchanged and edited prefills save before generation, save failure retains pending state, explicit save clears pending, and current episode ID accompanies saves. Test page metadata and error handling. Run focused tests, full npm test, npx tsc --noEmit, ESLint on changed TS files, production build, and git diff --check.
### Manual verification
Review all three inputs in a synthetic return episode; confirm existing history remains intact and current findings remain visit-specific. Report any unperformed browser check honestly.

## Risks and rollback considerations
Previously saved default sections cannot be distinguished from intentionally entered defaults and must be preserved. Current medications and social history may have changed; the source/review notice directs the clinician to update them. Carryover is a prefill, not confirmation of current accuracy. Rollback is a code revert; already clinician-saved intake remains intact.

## Completion criteria
Three sections prefill only where absent; values are saved before generation; source and current records stay isolated; no episode/QC/save/sign regression; verification results recorded.

## Implementation verification

Implemented locally on 2026-09-25. The read-only helper selects three validated history sections; actions preserve current values and seed absent history on section saves; the page surfaces read errors and passes provenance; UI saves pending unchanged prefills before generation. No migration, production patient mutation, commit, or deployment was performed.

- Focused loader/action/page/UI run: `npx vitest run src/lib/clinical/__tests__/load-return-intake.test.ts src/actions/__tests__/evaluation-episode-isolation.test.ts src/app/__tests__/initial-visit-page.test.tsx src/components/clinical/__tests__/intake-carryover.test.tsx` — **38 passed**.
- Existing exam/psychological/action checks after explicit Episode 1 bypass — **37 passed**.
- Full final `npm test` — **2,347 passed, 11 skipped; 164 test files passed, one skipped**.
- `npx tsc --noEmit` — passed.
- `npx eslint` on all nine changed/new TypeScript files — passed.
- `npm run build` — passed with network access for configured Google Fonts.
- `git diff --check` — passed.
- Independent implementation review — no blockers.

The first full run exposed legacy tests that mock Episode 1 without ownership fields; actions now bypass the new loader entirely for Episode 1/non-pain evaluations, preserving their original intake path. The next full run hit the previously observed 5-second timeout in an unchanged psychological editor test. That file passed alone (18 tests), followed by the fully passing final suite. Test timeouts were not changed.

Synthetic integration verifies prefill → save another intake section → reload → generation, exact current episode scope, and unchanged prior records. UI tests exercise review notice, unchanged/edited history persistence, failure/retry, and generated/read-only bypass. Authenticated browser interaction against a live returning patient was not performed; no clinical prose was generated manually.

Source API behavior follows the existing authenticated Supabase select/filter patterns and explicit encounter foreign key; the [Supabase select reference](https://supabase.com/docs/reference/javascript/select) was checked. The changelog markdown endpoint could not be read by the web tool. No auth/RLS/schema/library version change was needed.
