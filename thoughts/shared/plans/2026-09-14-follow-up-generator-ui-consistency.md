# Follow-up Generator Consistency Implementation Plan

## Overview

Bring the follow-up note generator into the established initial-visit,
procedure, and discharge UI pattern. Add persisted **Tone & Direction**
guidance to generation, retry, and section regeneration while preserving
unsaved narrative edits and the existing save-before-finalize contract.

Scope approved in conversation on 2026-09-14. This artifact plans the work;
implementation completed on 2026-09-14; verification results follow below.

## Current State

The current source map is in
`thoughts/shared/research/2026-09-14-follow-up-generator-ui-consistency.md`.

- `src/components/visits/pain-follow-up-editor.tsx`, `PainFollowUpEditor`, has
  compact generation cards, eleven separate draft cards, fixed four-row
  textareas, immediate section replacement, and no guidance input.
- `src/actions/pain-follow-up-notes.ts`, `generatePainFollowUpNote` and
  `regeneratePainFollowUpSectionAction`, never read or write guidance.
- `src/lib/claude/generate-pain-follow-up.ts`, `generatePainFollowUp`, accepts
  source data and an optional quality-finding instruction, but no guidance.
- `tone_hint` already exists in `pain_follow_up_notes` and Row/Insert/Update
  types. No new column is needed.
- `buildPainFollowUpEditorKey` includes `updated_at`; any refreshed write can
  remount the editor and discard unsaved local text.
- Draft saves already acknowledge a returned saved row before finalization.
  Section regeneration returns only success and relies on a route refresh.
- Full generation is a single structured AI response. Progress counters move
  from zero to eleven; there is no incremental section stream.

## Desired End State

1. Empty and failed/retry states expose the same optional guidance card.
   Draft guidance saves on blur and is flushed before explicit actions.
2. Guidance survives successful generation, failure/retry, reload, and reset.
   Clearing it removes the persisted value; an omitted API argument preserves
   it. It remains scoped to one encounter's note.
3. Full and sectional AI generation receive guidance as provider writing
   preferences subordinate to the clinical/source/output constraints.
4. Draft layout uses shared typography, spacing, badges, icons, and a continuous
   sequence of labeled sections with appropriate textarea sizes.
5. Generation feedback appears immediately. Section regeneration requires
   confirmation, visibly identifies the busy section, and replaces only that
   section in local state.
6. Guidance blur, draft save, section regeneration, and finalization serialize
   against the acknowledged note version. Unrelated local text remains intact.

## Key Discoveries

- Reuse `ToneDirectionCard` from
  `src/components/clinical/tone-direction-card.tsx`; do not create a competing
  custom-prompt component.
- Reuse `useDraftNoteMutations` from `src/hooks/use-note-mutation-queue.ts`.
  Its queue waits for blur, aborts an already-waiting action on blur failure,
  acknowledges returned versions, and cancels unstarted work on identity/lock
  changes. Queue identity must not contain a changing timestamp.
- `useVisitNoteVersion` in `src/hooks/use-visit-note-version.ts` supports
  acknowledged responses and ignores superseded prop versions. Incoming
  narrative changes must remain conflicts, not silently become new save bases.
- `src/app/(dashboard)/patients/[caseId]/visits/[encounterId]/page.tsx` already
  supplies the page heading and separately mounts intake. Preserve that boundary.
- `getPainFollowUpEditorState` in
  `src/lib/clinical/pain-follow-up-editor-state.ts` recognizes cleared drafts,
  including content existing only in structured recommendations.
- `ClinicalResetDialog` owns its own audited, versioned reset action. Keep that
  workflow; reset changes populated draft to empty, and Edit changes finalized
  to draft. Both must still refresh the editor correctly with a stable draft key.

## What We Are Not Doing

- Redesigning encounter intake, auto-saving intake, or changing visit scheduling.
- Rewriting finalized PDF/document presentation or procedure-order workflows.
- Changing clinical prompt rules, model selection, output schemas, or the
  treatment-decision save/finalize RPC contract.
- Creating a generic framework for all note generators or converting this
  component to react-hook-form solely for visual similarity.
- Adding streaming generation, simulated progress, or new dependencies.
- Applying migrations, changing RLS, or deploying this work.

## Implementation Approach

Implement server contracts first, then safe draft state, then presentation.
Reuse existing shared components and hooks without changing other note types'
behavior. Keep full generation and lifecycle refreshes separate from in-place
draft mutations.

### Guidance contract

| Input | Full-generation behavior |
| --- | --- |
| `undefined` / omitted | Reuse stored guidance, or null for a new note |
| `null`, empty, or whitespace-only string | Explicitly clear guidance |
| Nonempty string | Trim, persist, and use the supplied guidance |

Add a named validation schema for optional guidance in
`src/lib/validations/pain-follow-up-note.ts`; reject non-string/non-null values.
Do not add guidance to the AI result schema or decision RPC patch. Use the
same validation/normalization in full generation and the dedicated tone save.
There is no new arbitrary length limit in this parity change.

## Phase 1: Persist and apply provider guidance

### Files and changes

**`src/actions/pain-follow-up-notes.ts`**

- Extend `generatePainFollowUpNote(caseId, encounterId, toneHint?)` compatibly.
  Read stored guidance and apply the table above. Persist the effective value
  with the transition to generating, before calling AI, so failure retains it.
- Check existing-row load/update errors; do not invoke AI if guidance/status
  persistence fails. Scope reads/writes to case, encounter, and live note.
- Guard entry to generation using the observed non-finalized, non-generating
  row/version and require a returned row; retain the acquired version for
  conditional success/failure writes. Do not let a late request overwrite a
  replacement, reset, or another generation. Handle insert uniqueness conflicts
  as a failed start, not a second AI call. Select `id,updated_at` from both the
  insert and status update to obtain that acquired version. Catch unexpected AI
  exceptions and conditionally record failed status with guidance retained.
  No stale-job recovery redesign.
- Add `savePainFollowUpNoteToneHint(caseId, encounterId, toneHint, version)`
  where `version` requires `{ noteId, expectedUpdatedAt }`. Authenticate, enforce
  the feature flag, correct encounter ownership/type, in-progress visit, and
  writable episode. Update only the exact live draft version and audit user.
  Return `{ data: { updated_at, tone_hint, savedNote } }` from the committed
  row; no-row means conflict. Do not
  create a note from blur. Do not refresh/revalidate the active editor for a
  metadata-only save; normal subsequent page loads read the persisted row.
- Extend the section action with an optional fifth `expectedUpdatedAt`
  argument, preserving its fourth quality-finding argument. Editor calls supply
  it; existing quality-review callers can omit it. Reject a supplied stale
  version before AI, and retain the existing conditional update afterward.
- Read persisted `tone_hint` for section generation. Return the committed
  `savedNote` alongside existing success data so the editor can acknowledge
  the server row without replacing unrelated local fields.
- Continue revalidating after committed generation/section changes; the new
  draft key/state handling must tolerate server-action refreshes.

**`src/lib/claude/generate-pain-follow-up.ts`**

- Add an optional third `toneHint` parameter; preserve the existing source and
  quality-finding parameters and all current callers.
- Append a clearly labeled provider guidance block only when nonblank.
  Explicitly constrain it to phrasing/emphasis and subordinate it to source
  facts, telehealth limitations, consent, treatment decisions, and schema rules.
- Leave quality-finding instructions intact and keep all parser guards.

**Tests**

- Add `src/actions/__tests__/pain-follow-up-notes-guidance.test.ts` covering
  new/existing generation, trimming, omission, clearing, failure/retry retention,
  persistence failure, competing generation, exact-version tone saves, auth,
  disabled feature, locked ownership, and sectional guidance/version responses.
  Use existing `src/test-utils/supabase-mock.ts` patterns.
- Extend `src/lib/claude/__tests__/generate-pain-follow-up.test.ts` for supplied,
  blank, absent, and combined quality-finding/guidance requests. Assert existing
  clinical parsers still reject unsupported output with guidance present.
- Extend `src/lib/validations/__tests__/pain-follow-up-note.test.ts` for the new
  guidance input contract without changing generated-note validation.

### Automated verification

Run the new action suite and the generator/validation suites above. Also run
`src/actions/__tests__/case-quality-reviews.test.ts` to protect the existing
fourth-argument finding-fix caller. Run `npx tsc --noEmit`.

### Manual verification

Using synthetic local visit data, verify a stored hint survives a failed
generation and is reused on retry; clearing persists null. A real AI call is
not necessary for integration tests—use mocked generation responses. Check
the persisted value through the normal note read action/local test database.

## Phase 2: Preserve drafts across guidance and section mutations

### Files and changes

**`src/lib/clinical/pain-follow-up-editor-key.ts` and its existing test**

- Replace timestamp identity with encounter identity, note ID, and semantic
  editor state from `getPainFollowUpEditorState`. Include case/encounter for
  missing-note identity. Update the helper signature and page call together.
- Same-note draft metadata/content refreshes keep the key stable. Missing to
  created, generating to draft/failed, draft to empty reset, finalized to draft
  Edit, note replacement, and encounter navigation change it.
- Replace the test expecting every regenerated timestamp to remount with tests
  for these explicit lifecycle transitions and stable ordinary draft writes.

**Visit page and `src/components/visits/pain-follow-up-editor.tsx`**

- Separate the editable draft into a local `DraftEditor` component if needed
  to call draft hooks unconditionally with a concrete note. Keep state branches
  and rendering in this file unless separation improves clarity materially.
- Initialize guidance from the saved row. Use `useDraftNoteMutations` with
  identity case/encounter/note and writable state based on draft, visit, case,
  and episode. Wire blur and all explicit draft actions to that queue.
- Keep the version ref as the execution-time source of truth. Integrate
  `useVisitNoteVersion` acknowledgements; include `tone_hint` in the follow-up
  fingerprint fields so another editor's guidance changes do not silently
  authorize overwriting them. In the local `saveTone` wrapper, validate the
  returned `savedNote` identity/version/fields and call `acknowledgeSavedNote`
  with that persisted row before returning the minimal tone result to the queue.
  Do not copy that row into local narrative/decision fields. Timestamp-only
  acknowledgement cannot update a fingerprint that now includes guidance;
  the full-row acknowledgement is required. Keep the shared hooks unchanged.
- Within the same identity and draft lifecycle, never copy incoming props over
  dirty local narrative/decision/guidance state. A differing unacknowledged row
  remains a stale-version conflict. Retain local
  edits and show the returned reload/review error; no automatic retry against
  a newer version. Ignore delayed superseded props. Lifecycle transitions such
  as an audited reset to empty or finalized Edit intentionally initialize a
  fresh form; distinguish them from ordinary draft edits in tests.
- A successful Save Draft adopts the canonical saved row as today. A successful
  section regeneration acknowledges the returned row/version but changes only
  the requested local section; preserve other unsaved sections, decision draft,
  and guidance. Retain persisted decision metadata from the returned row so
  reviewed-plan mismatch remains visible.
- Do not call `router.refresh()` for tone saves or as a substitute for handling
  returned section content. Server revalidation may still deliver props; stable
  identity and acknowledgements must handle that ordering.
- Keep Save Draft and Finalize in one queued operation: flush tone, save current
  narrative/decision with the latest version, acknowledge, then finalize that
  exact version. Call queue `finish()` only on successful finalization. Preserve
  retry after save/sign failures and prevent duplicate clicks.
- Check queue activity after awaits before changing local state or signing.
  Track pending tone writes locally for disabling Reset while a tone save is
  active. Keep existing audited reset preview/version checks and surface a stale
  preview error rather than bypassing it. Reset/Edit lifecycle refreshes still
  remount using the semantic key.

### Automated verification

Add `src/components/visits/__tests__/pain-follow-up-guidance.test.tsx` and
extend `pain-follow-up-decision.test.tsx` as necessary:

- Blur then Save/Regenerate/Finalize waits for tone and uses its returned version.
- Failed blur blocks the waiting action; a later explicit retry can succeed.
- Delayed metadata/section props never erase unsaved fields or roll versions back.
- An acknowledged local tone change establishes the persisted fingerprint, so a
  subsequent unrelated metadata refresh can advance the version correctly.
- Regenerating one section preserves edited other sections and decision details.
- An external narrative or guidance edit conflicts instead of being overwritten.
- Confirmed section version becomes the next save version without refreshed props.
- Save-before-sign ordering, failed sign retry, and canonical save responses work.
- Unmount, encounter change, or locking cancels unstarted work; finalization stops
  later queued work. Reset and Edit transitions initialize the correct state.

Run those suites, editor-key/state suites, existing queue/version hook suites,
and follow-up finalize/reset action suites. Include a keyed test wrapper that
rerenders with the actual helper; a bare component rerender cannot test remounts.

### Manual verification

Edit two sections, blur changed guidance, regenerate one section, then Save and
Finalize. Confirm the other edit survives throughout. Exercise an external edit
in another browser tab and confirm conflict handling retains the local draft.

## Phase 3: Align the generator presentation

### Files and changes

**Follow-up editor**

- Preserve the existing page H1. Use a consistent subordinate note heading,
  status badge, wrapping header actions, and six-unit vertical spacing.
- Empty state: guidance card followed by the centered bordered muted generation
  panel, explanatory text, Sparkles button, and existing start-visit prerequisite.
  Keep pre-generation guidance in local state until Generate submits it.
- Failed state: error strip, stored guidance available to edit, Retry, and Reset.
  Retry submits the current guidance explicitly so clearing works.
- Full generation: dedicated optimistic state with captured start time, rendered
  before empty/failed branches. Reuse `GeneratingProgress` and eleven skeletons.
  For a persisted row pass its ID, `realtimeTable="pain_follow_up_notes"`, and
  actual counters. For no row, polling works without realtime. Never simulate
  section completion; the existing backend reports only actual zero/eleven.
- Draft: guidance card, existing treatment-decision controls, continuous section
  labels and textareas. Use visible labels, `resize-y`, and row counts:
  subjective 6, interval history 6, review of systems 4, telehealth observations 4,
  imaging review 4, assessment 6, diagnoses 4, treatment plan 6, patient education 5,
  follow-up 3, disclaimer 3.
- Regenerate buttons use the existing AlertDialog components, naming the section
  being replaced; cancel performs no mutation. Confirmation enters the queue,
  disables repeated actions, and shows a spinner only for the selected section.
- Keep finalized read-only behavior, PDF link, audited Edit/Reset, and structured
  recommendations/order relationships. No guidance editing on finalized notes.

**`src/components/clinical/tone-direction-card.tsx`**

- Add accessible textarea labeling with `useId`, `aria-labelledby`, and
  `aria-describedby` connected to the existing card title/description. Preserve
  props, appearance, and caller behavior. This narrowly shared change enables
  reliable labeled-field interaction across generators.

### Automated verification

Add `src/components/visits/__tests__/pain-follow-up-generator-states.test.tsx`
covering empty/reset, optimistic generating, persisted generating, failed retry,
draft, finalized, and locked states. Mock shared progress to assert its wiring;
use real confirmation controls to verify cancel/confirm behavior and accessible
guidance labeling. Test that pre-generation guidance survives a generation error.

Run all focused suites from Phases 1–2 and these state tests. Shared component
and lifecycle integration justify broader `npm test` and `npx tsc --noEmit`.
Run `npm run lint` and `git diff --check`; compare failures against baseline
and report unrelated pre-existing failures without broadening the patch.
The repository has no dedicated formatter script; follow existing formatting
and use ESLint rather than introducing another formatter.

### Manual verification

Compare against the procedure/discharge generator in the same app/theme at
desktop and narrow mobile widths using synthetic data. Check heading hierarchy,
spacing, textarea readability/resizing, wrapping actions, keyboard focus,
guidance labels, confirmation focus/return, and loading/error visibility.
Verify saved guidance after navigation and reset. Check progress polling reaches
draft/failed without manual reload, including a newly inserted note. Record
screenshots and outcomes; do not claim visual verification from jsdom tests.

## Risks and rollback considerations

- Stable identity changes the previous remount-based refresh contract. Explicit
  lifecycle keys and acknowledgement/rerender tests are required together.
- Server actions can deliver refreshed props before their promises settle.
  Tests must exercise both response orderings and superseded timestamps.
- Guidance saves change `updated_at` even without narrative changes. Keeping
  them outside the decision RPC requires the serialized version handoff.
- Audited Reset has a separate queue. Its exact-version preview remains the
  authority if it races another write; do not force success on a stale preview.
- Full generation has no new stalled-job recovery mechanism. Existing recovery
  limitations should be reported if encountered, not hidden by simulated progress.
- No migration is planned. Reverting the application changes leaves nullable
  stored guidance harmlessly retained. Never delete clinical data for rollback.

## Completion criteria

- [x] Guidance works for first generation, edited retry, and section regeneration.
- [x] Omitted versus cleared guidance has the specified tested behavior.
- [x] Persistence/AI failures never falsely report successful guidance saves.
- [x] Draft mutations preserve unrelated unsaved text and use acknowledged versions.
- [x] Full generation/reset/Edit/finalization still transition correctly.
- [x] Existing clinical safeguards, encounter locks, and order workflows pass.
- [ ] UI matches the established generator pattern on desktop and mobile.
- [x] Focused and broader checks are recorded with results and any limitations.
- [x] Diff contains only the planned feature, tests, and documentation changes.


## Implementation results — 2026-09-14

### Phase status

- [x] Phase 1 implementation, automated checks, and diff review.
- [x] Phase 2 implementation, automated checks, and diff review.
- [x] Phase 3 implementation, automated browser checks, and diff review.
- [ ] User acceptance of the visual layout and live-database workflow verification.

Guidance uses the existing column. Full generation conditionally acquires and
commits its version, retains guidance on returned/thrown AI errors, and applies
explicit clear-versus-omitted semantics. The dedicated tone action and section
regenerator return committed rows. Draft metadata saves do not revalidate the
page; section/full generation still do. Stable lifecycle keys, full-row
acknowledgement, and the existing mutation queue protect unsaved text.

The state and visual portions touched the same editor and were assembled together;
the phase-specific test groups were verified independently. Shared mutation hooks,
intake, database schemas, and model routing were not changed. The shared tone card
received only accessible title/description associations.

### Automated checks

- Phase 1: `npm test -- src/actions/__tests__/pain-follow-up-notes-guidance.test.ts src/lib/claude/__tests__/generate-pain-follow-up.test.ts src/lib/validations/__tests__/pain-follow-up-note.test.ts src/actions/__tests__/case-quality-reviews.test.ts` — **101 passed**.
- Phase 2: `npm test -- src/components/visits/__tests__/pain-follow-up-guidance.test.tsx src/components/visits/__tests__/pain-follow-up-decision.test.tsx src/lib/clinical/__tests__/pain-follow-up-editor-key.test.ts src/hooks/__tests__/use-note-mutation-queue.test.ts src/hooks/__tests__/use-visit-note-version.test.ts src/actions/__tests__/pain-follow-up-notes-finalize.test.ts src/actions/__tests__/pain-follow-up-notes-reset.test.ts` — **58 passed**.
- Phase 3: `npm test -- src/components/visits/__tests__/pain-follow-up-generator-states.test.tsx` — **10 passed**.
- Final combined follow-up regression run (editor guidance/decision/states, action guidance, generator, validation, key/state helpers) — **8 files, 134 tests passed**.
- `npx tsc --noEmit` — **passed** after resolving action-result union narrowing.
- ESLint over all changed/new TypeScript files — **passed**.
- `git diff --check` — **passed**.
- `npm test` — **130 files / 1,753 tests passed; 1 file / 18 tests failed**.
  All failures are in the existing `visit-editor-save-finalize.test.tsx` suite
  for initial-visit/pain-evaluation/discharge editors. Running this exact suite
  from an untouched `git archive HEAD` baseline reproduced **all 18 failures**.
- `npm run lint` — **1 error, 40 warnings**. The error is the unchanged
  `src/components/settings/invite-user-dialog.tsx:62` synchronous effect update.
  Running ESLint on this file in the untouched baseline reproduced the error.

Full-suite and baseline logs are at `/tmp/cliniq-follow-up-tests.log`,
`/tmp/cliniq-follow-up-lint.log`, `/tmp/cliniq-follow-up-baseline-tests.log`, and
`/tmp/cliniq-follow-up-baseline-lint.log` in this workspace session.

### Automated browser checks

Used a temporary localhost Vite harness importing the actual follow-up editor,
shared components, and application CSS. Server actions, navigation, reset, and
Supabase realtime were stubbed; only synthetic data was used. Also rendered the
actual procedure generator as a visual reference. This verifies browser layout
and event ordering, not production persistence or live AI generation.

At 1280×1000 and 390×844:

- No horizontal overflow; generation panel and draft header/actions wrap correctly.
- Shared guidance card matches the procedure-generator reference.
- Real blur-to-Save click waits for tone response `v2` before saving narrative.
- Confirmed section regeneration replaces the selected section while another
  unsaved assessment remains unchanged.
- Failed generation retains the typed guidance.
- No browser console errors.

Session screenshots: `/tmp/follow-up-empty-desktop.png`,
`/tmp/follow-up-draft-desktop.png`, `/tmp/follow-up-draft-mobile.png`,
`/tmp/follow-up-mobile-top.png`, `/tmp/follow-up-empty-mobile.png`, and
`/tmp/procedure-reference-mobile.png`.

### Remaining manual verification

User visual acceptance remains unchecked, as required by the implement-plan
skill. No live database writes or real AI requests were made. The localhost
54322 listener belongs to SSH rather than a verified disposable local database,
so it was not used for synthetic persistence tests. Validate persistence and
reset/retry with an authorized test encounter in the running application.
