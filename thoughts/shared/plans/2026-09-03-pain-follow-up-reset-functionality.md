# Pain Follow-Up Reset and Unfinalize Functionality Implementation Plan

## Overview

Add whole-note reset support to encounter-scoped pain-management follow-up
notes. Reset will match the repository's established product meaning: only a
`draft` or `failed` note can be cleared; generated note content is discarded;
the same note row and all provider-entered encounter data are preserved; and
the editor returns to a pre-generation state.

Expose the existing finalized-note reversal as a separate, confirmed
Unfinalize action. Unfinalize will preserve the generated clinical content,
remove the current finalized document, return the encounter to `in_progress`,
and reopen the note as a draft. The user may then edit, re-finalize, or invoke
the independently confirmed Reset action.

The reset, finalization, and unfinalization transitions will be made
transactionally safe. Each RPC will use the same note, encounter, episode, and
case lock order. The existing finalization RPC will accept the note's expected
`updated_at`, so a PDF rendered from an older draft cannot be attached after a
reset or concurrent edit changes that draft.

Research basis:
`thoughts/shared/research/2026-09-03-pain-follow-up-reset-functionality.md`.

## Implementation Status (2026-09-03)

- [x] Shared section metadata and validation tests implemented.
- [x] Lifecycle migration and 49-assertion pgTAP regression file implemented.
- [x] Reset, finalize-version, and unfinalize action changes implemented with
  focused tests.
- [x] Explicit editor states, confirmed Reset, and confirmed Unfinalize UI
  implemented.
- [x] Focused tests, full unit suite, changed-file lint, type-check, production
  build, and diff checks passed.
- [ ] Local migration replay, pgTAP execution, and generated-type regeneration
  remain pending because this environment has neither Docker nor Podman.
- [ ] Manual browser/database/storage verification remains pending.

## Current State

`src/actions/pain-follow-up-notes.ts` currently supports load, full generation,
save, per-section regeneration, finalization, and server-side unfinalization.
There is no whole-note reset action.

`src/components/visits/pain-follow-up-editor.tsx` currently shows full
generation for a missing or failed note and the section editor for every other
existing status. It has no Reset or Unfinalize control, does not surface the
stored failure message, and does not recognize a retained empty draft as
pre-generation.

The eleven section keys are duplicated between the action module and editor.
By contrast, procedure and discharge note sections, types, and labels are
centralized in their validation modules
(`src/lib/validations/procedure-note.ts` and
`src/lib/validations/discharge-note.ts`).

The `pain_follow_up_notes` table already has all resettable columns, an
`updated_at` trigger, and authenticated SELECT/UPDATE policies
(`supabase/migrations/20260826161637_pain_follow_up_notes.sql`). However, an
application-only update is insufficient for lifecycle safety:

1. An encounter or episode can become non-writable after the action reads it
   but before it updates the note.
2. Finalization currently renders a PDF before calling the database RPC. If
   reset clears the draft during that interval, the current RPC can finalize
   the empty row while attaching a PDF rendered from the pre-reset content.

The current finalization function is the four-argument
`public.finalize_pain_follow_up(uuid, uuid, uuid, uuid)` defined most recently
in `supabase/migrations/20260830164454_rollback_visit_specific_diagnoses.sql`.
The existing `unfinalizePainFollowUpNote` action and
`public.unfinalize_pain_follow_up(uuid, uuid)` RPC are server-only. The RPC
reopens the encounter, clears finalization linkage, soft-deletes the document,
and refuses reopening when procedure orders or unreleased billing claims depend
on the encounter. The action removes the linked storage object after a
successful RPC. The RPC currently omits `pending_settlement` from its locked
case check and does not share the new explicit lock order planned for reset and
finalization.

## Desired End State

1. An authenticated user can reset a live `draft` or `failed` follow-up note
   for an `in_progress` pain-follow-up encounter in an active, writable case
   episode.
2. Reset clears in place:
   - all eleven generated text sections;
   - `procedure_recommendations` to `[]`;
   - `ai_model`;
   - `raw_ai_response`;
   - `generation_error`;
   - `source_data_hash`;
   - `generation_attempts` to `0`;
   - `sections_done` to `0`; and
   - `sections_total` to the current section count.
3. Reset preserves:
   - note ID, case/encounter ownership, and creation audit fields;
   - `tone_hint`;
   - all `clinical_encounters` intake, consent, pain, provider, modality,
     scheduling, location, and ownership data; and
   - finalization/document state by refusing finalized notes rather than
     mutating those fields.
   Reset records the authenticated actor in `updated_by_user_id` and lets the
   existing trigger advance `updated_at`.
4. Reset locks and validates the note, encounter, episode, and case in one
   database transaction. A concurrent cancellation, no-show, finalization,
   episode discharge, or case lock cannot pass a stale application check.
5. Finalization receives the note `updated_at` used to render its PDF and
   rejects the transaction if the locked draft no longer has that version.
6. A reset draft renders the same generation card as a missing note and can be
   regenerated using the same row.
7. A failed note displays its error and offers independent Retry and Reset
   controls.
8. Reset is absent for generating/finalized notes and disabled whenever the
   encounter is not `in_progress`; the RPC remains authoritative.
9. Section keys, their type, and their display labels have one shared source of
   truth used by validation-adjacent code, the action, editor, and editor-state
   classifier.
10. A finalized follow-up note for a completed encounter exposes confirmed
    Unfinalize. A successful unfinalize preserves note content, changes the note
    to `draft`, clears its finalization fields/document link, soft-deletes and
    removes the current PDF, and restores the encounter to `in_progress`.
11. Unfinalize refuses inactive/locked ownership and any encounter with linked
    non-deleted procedure orders or unreleased billing claims. Reset appears
    only after the unfinalize transition succeeds; there is no combined
    Unfinalize-and-Reset operation.

## Key Discoveries

### Reset and unfinalize are distinct

`resetInitialVisitNote`, `resetProcedureNote`, and `resetDischargeNote` accept
only `draft`/`failed`, clear generated content in place, and preserve clinical
inputs. Finalized-note reversal is a separate operation. This plan preserves
that distinction by exposing the existing follow-up Unfinalize action only in
the finalized state. Unfinalize retains generated content so a provider can
edit or re-finalize without resetting; Reset becomes available only after the
note is a draft.

### Reset/finalize/unfinalize need a shared lock order

All three database transitions must lock the follow-up note first and then the
encounter, episode, and case in the same order. Reset can validate all write
preconditions at mutation time, finalization can compare the locked row with
the PDF's source version, and unfinalization can validate its completed
encounter and downstream dependencies without introducing an inverse lock
order.

### Unfinalize already owns encounter and document reversal

`unfinalize_pain_follow_up` already changes the finalized note back to `draft`,
soft-deletes its linked document, and returns the encounter to `in_progress`.
`unfinalizePainFollowUpNote` reads the file path before the RPC and removes the
storage object only after the transaction succeeds. The implementation should
retain that division while hardening lifecycle checks, error mapping,
revalidation, and test coverage.

### `updated_at` is the existing draft revision

The note table's `before update` trigger rewrites `updated_at` on saves,
generation, section regeneration, and reset. Passing the timestamp loaded with
the note to finalization provides an existing optimistic-concurrency token; no
new revision column is required.

### Shared section metadata follows an established pattern

Procedure and discharge validations export the section tuple, inferred section
type, and a complete label map. Pain follow-up should use the same structure in
`src/lib/validations/pain-follow-up-note.ts` rather than adding a third
duplicated list for reset-state detection.

### Existing page remount behavior supports reset

The encounter page keys `PainFollowUpEditor` with note ID and `updated_at` via
`buildPainFollowUpEditorKey`. Reset will change `updated_at`; action path
revalidation plus `router.refresh()` will remount the editor from persisted
empty state without a new client synchronization mechanism.

## What We Are Not Doing

- Allowing reset of finalized or generating notes.
- Combining Unfinalize and Reset into one destructive action.
- Deleting or soft-deleting a follow-up note row.
- Resetting the encounter, intake, consent, pain scores, provider, schedule,
  modality, location, or episode.
- Deleting documents, storage objects, procedure orders, billing claims, or
  quality-review history through Reset.
- Automatically deleting procedure orders or billing claims to make
  Unfinalize succeed; the user must resolve those dependencies explicitly.
- Adding a follow-up correction/revision history feature.
- Changing AI prompts, output schema semantics, telehealth QC, PDF layout,
  section regeneration, or recommendation ordering.
- Adding a realtime generation progress feature. A minimal non-destructive
  generating state may be rendered so reset/edit controls remain unavailable.
- Changing reset behavior for Initial Visit, Procedure Note, or Discharge
  Summary.

## Implementation Approach

Use a CLI-generated forward migration to add an authenticated,
security-invoker `reset_pain_follow_up` RPC and replace the current four-argument
finalize RPC with a five-argument version that includes
`p_expected_updated_at timestamptz`. Replace the existing unfinalize RPC body
without changing its two-argument signature or UUID return contract. All three
functions will lock rows in the same order and enforce compatible
ownership/lifecycle rules in the database.

Keep the server reset action thin: feature gate, authenticate, call the RPC,
translate expected database errors, and revalidate the encounter route. Update
finalization to pass the timestamp from the note used for PDF rendering; retain
its existing cleanup of the uploaded object and inserted document when the RPC
rejects. Update the existing unfinalize action to map dependency/lifecycle
errors, remove the linked storage object only after a successful transaction,
and revalidate the encounter, visit list, documents, and timeline routes.

Centralize section metadata in the follow-up validation module. Add a pure
editor-state classifier using that metadata, then update the editor to render
explicit empty, failed, generating, draft, and finalized states. Automated
coverage will include pgTAP transition/version tests, server-action wiring and
cleanup tests, unfinalize dependency tests, section metadata completeness, and
editor-state precedence.

## Phase 1: Shared Section Metadata

### Files and changes

#### `src/lib/validations/pain-follow-up-note.ts`

Add:

- `painFollowUpNoteSections`: the existing eleven section keys as a readonly
  tuple;
- `PainFollowUpSection`: inferred from that tuple; and
- `painFollowUpNoteSectionLabels`: a
  `Record<PainFollowUpSection, string>` containing the current editor labels.

Keep the existing Zod result/edit schemas and recommendation semantics
unchanged.

#### `src/actions/pain-follow-up-notes.ts`

Replace the private `NOTE_SECTIONS` tuple with the shared
`painFollowUpNoteSections`. Continue exporting `PainFollowUpSection` as a type
from this action module so the existing Quality Review import does not require
an unrelated change.

Use the shared tuple for generation progress counts, section validation, and
the later reset payload.

#### `src/components/visits/pain-follow-up-editor.tsx`

Remove the local section tuple. Render section fields using
`painFollowUpNoteSections` and `painFollowUpNoteSectionLabels`.

#### `src/lib/validations/__tests__/pain-follow-up-note.test.ts`

Extend the existing suite to assert:

- there are exactly eleven section keys;
- every section has a non-empty display label; and
- the result schema accepts a complete object constructed from the shared
  tuple, preserving the current schema contract.

### Automated verification

```bash
npx vitest run src/lib/validations/__tests__/pain-follow-up-note.test.ts
npx eslint \
  src/lib/validations/pain-follow-up-note.ts \
  src/lib/validations/__tests__/pain-follow-up-note.test.ts \
  src/actions/pain-follow-up-notes.ts \
  src/components/visits/pain-follow-up-editor.tsx
npx tsc --noEmit
```

### Manual verification

Open an existing draft and finalized follow-up note and confirm all eleven
sections retain their current order and labels.

## Phase 2: Transactional Reset, Finalization, and Unfinalization

### Files and changes

#### `supabase/migrations/<CLI-generated timestamp>_pain_follow_up_reset.sql`

Before creating the migration, inspect current CLI syntax with:

```bash
npx supabase migration new --help
```

Then create the file with:

```bash
npx supabase migration new pain_follow_up_reset
```

Do not invent the timestamped filename manually.

The migration will define
`public.reset_pain_follow_up(p_case_id uuid, p_encounter_id uuid) returns uuid`
with:

- `language plpgsql`;
- `security invoker`;
- `set search_path = ''`;
- an explicit `auth.uid()` authentication check;
- a row lock on the live note scoped by case and encounter;
- validation that the note status is `draft` or `failed`;
- subsequent locks on the exact live `pain_follow_up` encounter, its owning
  episode, and case, in the same order used by finalization;
- validation that the encounter is `in_progress`, the episode is `active`, and
  the case is not in the repository's locked statuses: `pending_settlement`,
  `closed`, or `archived`;
- an explicit in-place UPDATE that clears all eleven text sections,
  `procedure_recommendations`, and specified generation metadata while
  preserving tone, case/encounter ownership, creation, and finalization fields,
  while setting `updated_by_user_id = auth.uid()`; and
- the reset note ID as the return value.

Use stable SQLSTATE/message pairs for authentication, missing ownership,
invalid note status, and non-writable encounter/episode/case failures so the
server action can map expected errors.

Revoke execution from `public` and `anon`; grant it only to `authenticated`.
The function must remain a security invoker so the existing table RLS and role
grants continue to apply.

In the same migration, replace the old
`public.finalize_pain_follow_up(uuid, uuid, uuid, uuid)` signature rather than
leaving an unguarded overload callable. Define:

```text
public.finalize_pain_follow_up(
  p_case_id uuid,
  p_encounter_id uuid,
  p_note_id uuid,
  p_document_id uuid,
  p_expected_updated_at timestamptz
)
```

Preserve the current return columns. Tighten idempotent finalized replay so it
succeeds only when the locked note is already linked to the same
`p_document_id`. If it is finalized with a different document, return the same
stable conflict used for competing/stale finalization so the action cleans up
the losing upload and document row.

For a non-finalized note, after locking it and before linking the document:

- require `status = 'draft'`;
- compare the locked row's `updated_at` with `p_expected_updated_at` using a
  null-safe equality check;
- reject with a stable conflict error when the timestamp differs; and
- retain the existing encounter/episode/case locks, document validation, note
  finalization, and encounter completion.

Revoke `public`/`anon` execution and grant only `authenticated` on the new
five-argument signature. Confirm the obsolete four-argument function no longer
exists after migration.

In the same migration, replace the body of
`public.unfinalize_pain_follow_up(p_case_id uuid, p_note_id uuid) returns uuid`
while preserving its callable signature and return value. The revised function
will:

- authenticate with `auth.uid()` and remain `security invoker` with an empty
  search path;
- lock the finalized note first, followed by its exact `pain_follow_up`
  encounter, active episode, and case in the shared order;
- require the encounter to be `completed` and reject every locked case status:
  `pending_settlement`, `closed`, and `archived`;
- while holding the transition locks, reject any non-deleted procedure order
  sourced from the encounter and any billing source claim for the encounter
  whose `released_at` is null;
- preserve all generated note content while setting the note to `draft`,
  clearing `finalized_at`, `finalized_by_user_id`, and `document_id`, and
  recording the actor in `updated_by_user_id`;
- soft-delete the linked document and record the actor;
- restore the encounter to `in_progress`, clear `completed_at`, and record the
  actor; and
- return the reopened encounter ID.

Keep the dependency failure message stable and distinct from ownership or
lifecycle failures so the server action can tell the user to remove procedure
orders and billing claims before reopening. Retain authenticated-only execution
privileges and assert that `public`/`anon` cannot call the function.

#### `supabase/tests/database/pain_follow_up_reset_test.sql` (new)

Add a pgTAP transaction fixture with authenticated and anonymous role checks.
Cover:

- authenticated execution and anonymous/public denial for reset, finalize, and
  unfinalize RPC signatures;
- successful reset of a populated `draft` note;
- successful reset of a populated `failed` note;
- all eleven sections null after reset;
- recommendations empty and generation metadata reset;
- same note ID, tone hint, ownership, and creation fields preserved;
- `updated_by_user_id` changed to the authenticated reset actor;
- encounter intake/consent/pain/provider/schedule values and `in_progress`
  status preserved;
- rejection of `generating` and `finalized` notes;
- rejection for scheduled/completed/cancelled/no-show encounters;
- rejection after episode discharge and for each locked case status
  (`pending_settlement`, `closed`, and `archived`);
- case/episode/encounter ownership mismatch rejection;
- finalize succeeds with the matching pre-render `updated_at`;
- simulated reset-wins ordering: capture the draft timestamp, reset it, then
  call finalize with the stale timestamp and verify note/document/encounter
  finalization is rejected;
- seed the reset-wins draft with an explicit timestamp earlier than the test
  transaction before capturing it, because `now()` is stable within pgTAP's
  enclosing transaction and otherwise may not prove a version change;
- simulated finalize-wins ordering: finalize first, then verify reset rejects
  and the finalized note/document/encounter remain unchanged; and
- competing finalizations: finalize with document A, call finalize with
  document B, verify B receives the stable conflict while A remains linked so
  application cleanup can remove B; and
- the old four-argument finalize signature is absent;
- successful unfinalize changes a finalized note to `draft` without clearing
  any generated section or recommendation;
- successful unfinalize clears finalization linkage, soft-deletes the linked
  document, and restores the encounter to `in_progress`;
- unfinalize preserves encounter clinical inputs and records the authenticated
  actor on the note, document, and encounter;
- unfinalize rejects a non-finalized note, a non-completed encounter, inactive
  episode, ownership mismatch, and each locked case status;
- unfinalize rejects when any non-deleted procedure order is sourced from the
  encounter;
- unfinalize rejects when an unreleased billing source claim references the
  encounter, but permits the transition after the dependency is resolved; and
- reset succeeds after a successful unfinalize, proving the intended two-step
  state transition.

Use the repository's existing auth fixture and `set local role authenticated`
patterns. Keep all three RPCs in the same regression file because their
lock/version contract is one note state machine.

#### `supabase/tests/database/visit_specific_diagnosis_rollback_test.sql`

Update the existing function-identity assertion at lines 62-76 to expect the
new five-argument `finalize_pain_follow_up` signature. Retain its current
assertions that the rollback removed the visit-specific diagnosis parameters;
this is a compatibility expectation update, not a weakening of that regression
coverage.

#### `src/types/database.ts`

After the migration and database tests pass locally, regenerate types with:

```bash
npm run gen:types:local
```

Verify the generated RPC types include `reset_pain_follow_up` and the new
`p_expected_updated_at` argument, and no longer expose the old finalize
signature. Confirm the existing two-argument unfinalize signature and UUID
return remain unchanged. Do not hand-edit this generated file.

### Automated verification

```bash
npm run db:reset
npm run db:test
npm run gen:types:local
git diff -- src/types/database.ts
npx tsc --noEmit
```

Success criteria:

- Migrations replay cleanly from zero.
- pgTAP proves reset authorization, preservation, lifecycle guards, both
  reset/finalize orderings, unfinalize cleanup, dependency gates, and the
  unfinalize-then-reset transition.
- Generated types exactly reflect the new RPCs.
- The application type-check exposes every outdated finalize call.

### Manual verification

Inspect the local database after a reset call and confirm the note row was
cleared in place while the owning encounter and its intake fields remained
unchanged. Confirm `pg_proc` reports all three functions as security-invoker with an
empty search path and no obsolete four-argument finalize function. Finalize a
follow-up, unfinalize it, and confirm the clinical content remains, the document
is soft-deleted, the encounter is reopened, and Reset can subsequently clear
the draft.

## Phase 3: Server Actions and Cleanup Behavior

### Files and changes

#### `src/actions/pain-follow-up-notes.ts`

Add `resetPainFollowUpNote(caseId: string, encounterId: string)`:

1. Call `requireReturnTeleVisitsMutation()` before database access.
2. Create the server Supabase client and require an authenticated user.
3. Call `reset_pain_follow_up` with the case and encounter IDs. Do not perform
   authoritative precondition reads in the action; the transaction owns all
   lifecycle checks.
4. Map the RPC's stable expected error messages to readable action errors,
   including no note, invalid note status, and non-writable visit/episode/case.
   Return a generic `Unable to reset follow-up note` for unexpected database
   errors without exposing internals.
5. Revalidate `/patients/${caseId}/visits/${encounterId}` only after success.
6. Return `{ data: { success: true, noteId } }`.

Update `finalizePainFollowUpNote` to pass
`p_expected_updated_at: note.updated_at` to the five-argument RPC. Preserve its
current behavior that removes the uploaded storage object and soft-deletes the
new document row whenever the RPC rejects, including a version conflict. Map
the stable conflict to a readable message telling the user the note changed and
must be reviewed/finalized again.

Update the existing `unfinalizePainFollowUpNote(caseId, noteId)` action without
changing its public signature:

1. Retain the return-visit feature gate and authenticated-user requirement.
2. Load the finalized note's linked document path before invoking the RPC, but
   leave status, lifecycle, and dependency authority in the locked database
   transaction.
3. Map the stable dependency error to an actionable message naming procedure
   orders and billing claims; map locked/lifecycle failures to a readable
   reopening error without exposing database internals.
4. Remove the captured `case-documents` object only after the RPC succeeds.
   Treat the database transition as authoritative if storage removal fails;
   log a sanitized cleanup error containing the document ID (not the storage
   path or clinical data) for operational follow-up rather than telling the user
   to retry a transition that already committed.
5. Revalidate the encounter route, visits list, documents, and timeline, and
   return the reopened encounter ID.

#### `src/actions/__tests__/pain-follow-up-notes-reset.test.ts` (new)

Using `createMockSupabase`, mock `next/cache` and the return-visit feature gate.
Cover reset action wiring:

- feature-disabled and unauthenticated early exits;
- exact reset RPC arguments;
- success result and encounter-route revalidation;
- stable expected RPC error mapping;
- unexpected RPC errors remaining generic; and
- no revalidation after any failure.

RPC state correctness belongs in pgTAP rather than duplicated query-builder
mocks.

#### `src/actions/__tests__/pain-follow-up-notes-finalize.test.ts` (new)

Add focused action tests for the concurrency-token and cleanup wiring. Mock PDF
rendering, storage, document insertion, and RPC responses. Cover:

- `note.updated_at` passed as `p_expected_updated_at`;
- successful finalization retains the current response and revalidations;
- idempotent replay with the already-linked document remains successful;
- a competing-document conflict follows the same object/document cleanup path;
- a version-conflict RPC error removes the just-uploaded object;
- the same conflict soft-deletes the just-inserted document;
- the conflict returns a readable retry/review message; and
- unexpected RPC failures retain the current cleanup and generic error.

#### `src/actions/__tests__/pain-follow-up-notes-unfinalize.test.ts` (new)

Add focused action tests for the existing server action. Cover:

- feature-disabled and unauthenticated exits;
- lookup of the finalized note's linked document path;
- exact `unfinalize_pain_follow_up` RPC arguments;
- dependency and lifecycle error mapping;
- no storage deletion or route revalidation when the RPC fails;
- storage deletion only after successful unfinalize;
- successful revalidation of encounter, visits, documents, and timeline; and
- a storage deletion failure does not misreport the already-committed database
  transition as a failed unfinalize.

### Automated verification

```bash
npx vitest run \
  src/actions/__tests__/pain-follow-up-notes-reset.test.ts \
  src/actions/__tests__/pain-follow-up-notes-finalize.test.ts \
  src/actions/__tests__/pain-follow-up-notes-unfinalize.test.ts
npx eslint \
  src/actions/pain-follow-up-notes.ts \
  src/actions/__tests__/pain-follow-up-notes-reset.test.ts \
  src/actions/__tests__/pain-follow-up-notes-finalize.test.ts \
  src/actions/__tests__/pain-follow-up-notes-unfinalize.test.ts
npx tsc --noEmit
```

### Manual verification

Use a deliberately delayed finalization in local development. Edit or reset the
draft after PDF rendering begins and confirm finalization rejects, removes its
new object/document, leaves the encounter `in_progress`, and requires a new
finalization attempt from the current note version. Finalize and unfinalize a
note and confirm the action removes the finalized PDF object only after the
database transition succeeds and refreshes every affected route.

## Phase 4: Editor Reset and Explicit State Handling

### Files and changes

#### `src/lib/clinical/pain-follow-up-editor-state.ts` (new)

Add a pure classifier returning one of:

- `empty`
- `generating`
- `failed`
- `draft`
- `finalized`

Classification order must be explicit:

1. Missing note is `empty`.
2. `generating`, `failed`, and `finalized` statuses take precedence over
   content inspection.
3. A `draft` is `empty` only when every key in
   `painFollowUpNoteSections` is null/empty/whitespace and
   `procedure_recommendations` is an empty array.
4. Any populated section or recommendation makes the state `draft`.

Do not count source hash, generation error, progress, tone, or other metadata as
generated clinical content.

#### `src/lib/clinical/__tests__/pain-follow-up-editor-state.test.ts` (new)

Cover:

- missing note;
- all-null and whitespace-only reset drafts;
- each section individually as the only content;
- recommendations as the only content;
- failed status taking precedence over stale generated content;
- generating status taking precedence over content;
- finalized status taking precedence over content; and
- unrelated metadata not changing an empty draft classification.

#### `src/components/visits/pain-follow-up-editor.tsx`

1. Import `resetPainFollowUpNote`, `unfinalizePainFollowUpNote`, the state
   classifier, `RotateCcw`, failure/reopen icon(s), and the existing AlertDialog
   primitives.
2. Refactor the local async runner to accept an operation-specific success
   message and use `try/catch/finally`, ensuring a rejected promise cannot leave
   `pending` stuck. Unexpected client errors receive a generic toast.
3. Render from the classifier:
   - `empty`: existing generation card;
   - `generating`: a minimal non-editable generation-in-progress card with no
     Reset, Save, Regenerate, or Finalize controls;
   - `failed`: stored error plus Retry and confirmed Reset;
   - `draft`: current editor plus confirmed Reset in the toolbar;
   - `finalized`: current read-only content, Documents link, and confirmed
     Unfinalize control when the encounter is `completed`.
4. Render reset confirmation in failed and draft states. State that generated
   narrative and structured recommendations will be discarded while visit
   intake, consent, pain information, and encounter details remain.
5. Gate Retry, Reset, Save, section Regenerate, and Finalize on both
   `!pending` and `encounter.status === 'in_progress'`. Keep the RPC/action
   guards authoritative for stale clients.
6. Use operation-specific success messages, including
   `Follow-up note reset successfully`.
7. On successful reset, retain `router.refresh()`. The existing
   `updated_at`-based page key will remount the editor as `empty`.
8. Add a separate Unfinalize confirmation in the finalized state. Explain that
   reopening preserves the generated note content, removes the current
   finalized PDF from Documents, returns the encounter to `in_progress`, and
   produces a fresh PDF if finalized again. Also state that Reset is a separate
   subsequent action.
9. On successful unfinalize, show `Follow-up note reopened successfully` and
   call `router.refresh()`. The refreshed note is `draft`, so the existing draft
   branch displays Reset without chaining or automatically opening its dialog.
10. Keep Unfinalize absent from empty, generating, failed, and draft states.
    Disable it while another operation is pending or when the finalized note's
    encounter is not `completed`; the RPC remains authoritative for stale
    clients and downstream dependencies.
11. Display the action's dependency error unchanged enough for the provider to
    understand that procedure orders and billing claims must be resolved before
    reopening.

No browser component-test framework is currently configured. The pure state
classifier provides deterministic automated state precedence coverage; dialog
wiring, control visibility, and toast behavior remain explicit manual checks.

### Automated verification

```bash
npx vitest run \
  src/lib/clinical/__tests__/pain-follow-up-editor-state.test.ts \
  src/lib/clinical/__tests__/pain-follow-up-editor-key.test.ts \
  src/lib/validations/__tests__/pain-follow-up-note.test.ts \
  src/actions/__tests__/pain-follow-up-notes-reset.test.ts \
  src/actions/__tests__/pain-follow-up-notes-finalize.test.ts \
  src/actions/__tests__/pain-follow-up-notes-unfinalize.test.ts
npx eslint \
  src/components/visits/pain-follow-up-editor.tsx \
  src/lib/clinical/pain-follow-up-editor-state.ts \
  src/lib/clinical/__tests__/pain-follow-up-editor-state.test.ts
npx tsc --noEmit
```

Then run the focused follow-up regressions:

```bash
npx vitest run \
  src/lib/claude/__tests__/generate-pain-follow-up.test.ts \
  src/lib/qc/telehealth-follow-up.test.ts \
  src/lib/pdf/__tests__/render-pain-follow-up-pdf.test.ts \
  src/lib/pdf/__tests__/pain-follow-up-template.test.tsx \
  src/actions/__tests__/case-quality-reviews.test.ts
```

### Manual verification

1. **Draft reset:** cancel once, then confirm; verify the reset-specific toast
   and pre-generation card.
2. **Preservation:** verify the same note ID remains and encounter intake,
   consent, pain, provider, modality, location, and schedule are unchanged.
3. **Regenerate after reset:** generate again and confirm the same row receives
   fresh sections/recommendations; Save and section Regenerate still work.
4. **Failed state:** force a controlled failure; verify stored error, Retry,
   Reset, and their separate behavior.
5. **Generating state:** verify no destructive/edit/finalize controls appear.
6. **Finalized state:** verify Reset remains absent and direct RPC/action reset
   attempts fail without touching the note, encounter, PDF, document, orders,
   or billing claims. Verify Unfinalize is present, its dialog distinguishes
   reopening from resetting, and cancelling leaves the finalized state intact.
7. **Locked state:** verify controls are disabled and the RPC rejects stale
   attempts after encounter cancellation/no-show, episode discharge, or case
   lock.
8. **Unfinalize then reset:** finalize a note, unfinalize it, verify content is
   still editable and the old PDF disappears, then invoke Reset separately and
   verify the editor returns to pre-generation.
9. **Dependency gate:** attach a procedure order and an unreleased billing
   claim in separate scenarios; verify Unfinalize explains the dependency and
   leaves the note, encounter, document row, and PDF unchanged.

## Phase 5: Full Verification and Diff Review

### Files and changes

Expected implementation scope:

- `src/lib/validations/pain-follow-up-note.ts`
- `src/lib/validations/__tests__/pain-follow-up-note.test.ts`
- `src/actions/pain-follow-up-notes.ts`
- `src/actions/__tests__/pain-follow-up-notes-reset.test.ts`
- `src/actions/__tests__/pain-follow-up-notes-finalize.test.ts`
- `src/actions/__tests__/pain-follow-up-notes-unfinalize.test.ts`
- `src/components/visits/pain-follow-up-editor.tsx`
- `src/lib/clinical/pain-follow-up-editor-state.ts`
- `src/lib/clinical/__tests__/pain-follow-up-editor-state.test.ts`
- CLI-generated pain-follow-up reset migration under `supabase/migrations/`
- `supabase/tests/database/pain_follow_up_reset_test.sql`
- `supabase/tests/database/visit_specific_diagnosis_rollback_test.sql`
- regenerated `src/types/database.ts`

Do not modify or discard the user's pre-existing change in
`thoughts/shared/plans/2026-09-02-prp-anatomic-clinical-target-validation.md`.

### Automated verification

Run in this order:

```bash
npm run db:reset
npm run db:test
npm run gen:types:local
npx tsc --noEmit
npm test
npm run lint
npm run build
git diff --check
```

Review the resulting diff after generated types are stable. If a command fails,
distinguish a regression introduced by this change from a pre-existing or
environment-only failure and record the exact command/output.

### Manual verification

Repeat draft reset, regenerate-after-reset, failed reset/retry, generating
protection, finalized protection, finalized-to-draft unfinalize,
unfinalize-then-reset, dependency rejection, and stale-finalization conflict
scenarios against the production build. Inspect note, encounter, document, and
storage state after each destructive/concurrent case.

### Deployment sequence

Changing the finalize RPC signature is not compatible with an older running
application. Use the existing server-side return-visit feature gate to avoid a
mixed-version window:

1. Deploy or set `ENABLE_RETURN_TELE_VISITS=false` and confirm follow-up pages
   and mutations are unavailable.
2. Apply the migration and deploy the application that calls the new RPC
   signatures.
3. Run the function-signature/privilege checks and a reset/finalize smoke test.
   Include finalized-to-draft Unfinalize and dependency rejection before
   enabling the feature.
4. Remove the override or set `ENABLE_RETURN_TELE_VISITS=true`, then redeploy.

Do not apply the signature-changing migration while an older enabled
application can still call the four-argument finalize function.

## Risks and rollback considerations

### Locking and deadlocks

Reset and finalization must acquire locks in the same order: note, encounter,
episode, case. Database tests cover both sequential orderings; implementation
review must confirm no inverse lock order was introduced.

### PDF/note version mismatch

Every note update changes `updated_at`. Finalization must pass the timestamp
from the row used to render the PDF, and the RPC must compare it only after
locking the note. On mismatch, existing action cleanup must remove the newly
created object and soft-delete its document row.

### Competing finalization artifacts

Finalized replay is idempotent only for the document already linked to the
note. A second finalization carrying a different document ID must conflict so
the action removes that upload and soft-deletes that document instead of
leaking an unattached artifact.

### Function overload bypass

Adding the five-argument finalize function without dropping the old
four-argument signature would leave a callable path without the version guard.
The migration and pgTAP tests must assert the old signature is absent and has no
execute privilege.

### Coordinated rollout

The migration removes an RPC signature used by the current application. The
return-visit feature must be disabled across the migration/application deploy
window, then re-enabled only after the new application and database functions
are verified together.

### Provider-input loss

The reset SQL must explicitly enumerate only generated note columns and
generation metadata. It must not update the encounter or spread a broad record
over either table. pgTAP verifies preserved note metadata and encounter input.

### Unfinalize dependency integrity

Unfinalize must not silently orphan procedure orders or unreleased billing
claims that depend on the completed encounter. The RPC checks dependencies
while holding the state-transition locks and rejects without changing the note,
document, encounter, or storage object. The UI reports what must be resolved;
it never deletes those dependencies automatically.

### Document and storage cleanup split

The database transaction soft-deletes the linked document and clears the note's
document link before the server action removes the storage object. Storage
cannot participate in the PostgreSQL transaction. The action must never remove
the object before RPC success, and a storage deletion error must not encourage
the user to retry an unfinalize transition that already committed. Record the
cleanup failure for operations and preserve the successful reopened state.

### Two-step destructive intent

Unfinalize preserves generated content and reopens the encounter; Reset then
irreversibly clears the generated draft. Separate dialogs and refreshed states
prevent a single click from performing both transitions or obscuring which
artifact will be removed.

### Empty-state misclassification

The editor classifier must use every shared section key plus recommendations,
with status precedence before content. One-field-at-a-time tests prevent a
partially populated draft or stale failed row from entering the wrong branch.

### Irreversible draft-content deletion

Reset intentionally discards draft narrative and recommendations. There is no
revision history for these drafts, so the dialog must clearly communicate that
the text cannot be recovered.

### Rollback

Application rollback requires compatible database functions. After deployment,
do not merely revert the application to a build that calls the old
four-argument finalize RPC. If rollback is required, disable return tele-visits,
ship a forward migration that drops `reset_pain_follow_up` and restores the
prior four-argument finalize definition/grants and prior unfinalize body, deploy
the compatible prior application, verify it, and only then re-enable the
feature. Already reset draft content and PDFs removed by completed unfinalize
operations cannot be recovered; encounter clinical inputs remain unaffected.

## Completion criteria

- Section keys/types/labels are centralized and used by action, editor, reset,
  and editor-state classification.
- The transactional reset RPC locks and rechecks note, encounter, episode, and
  case; allows only draft/failed + in-progress + active/writable ownership; and
  clears only the documented note fields.
- Database and UI lifecycle checks use the repository's full locked-case set,
  including `pending_settlement`, `closed`, and `archived`.
- The obsolete four-argument finalize RPC is removed; the five-argument version
  rejects a stale `updated_at` before linking a document or completing an
  encounter.
- Finalized replay succeeds only for the note's linked document; a competing
  document receives a conflict that triggers action cleanup.
- Reset preserves creation/case/encounter ownership while setting
  `updated_by_user_id` to the authenticated actor.
- Reset and finalize actions use generated RPC types and return readable,
  non-leaking errors.
- The existing unfinalize RPC uses the shared lock order, rejects every locked
  case status and downstream procedure/billing dependency, preserves generated
  content, soft-deletes its linked document, and reopens the completed
  encounter.
- The unfinalize action removes the linked storage object only after RPC
  success and revalidates encounter, visit-list, document, and timeline routes.
- Finalize conflict cleanup removes the uploaded object and soft-deletes the
  inserted document.
- Failed and draft states expose confirmed Reset; failed retains Retry and shows
  its stored error.
- Empty reset drafts render pre-generation; generating states do not expose
  destructive/edit/finalize controls; finalized states expose only the
  confirmed Unfinalize lifecycle action alongside read-only content.
- Successful Unfinalize refreshes to a populated draft with Reset available as
  a separate action; it never automatically clears content.
- pgTAP covers authorization, preservation, lifecycle guards, function
  signature replacement, both reset/finalize orderings, unfinalize cleanup and
  dependencies, and the unfinalize-then-reset transition.
- The existing visit-specific-diagnosis rollback regression expects the new
  five-argument function identity while retaining its no-diagnosis assertions.
- Unit tests cover reset/finalize/unfinalize action wiring and cleanup, section
  metadata, editor state and status precedence, and existing editor-key
  behavior.
- Focused and repository-wide database tests, unit tests, lint, typecheck, and
  build pass.
- Deployment uses the return-visit feature gate so no enabled application runs
  against an incompatible finalize RPC signature.
- Manual verification confirms preservation, row reuse, separate destructive
  warnings, unfinalize dependency rejection, unfinalize-then-reset behavior,
  storage cleanup, protected lifecycle states, and stale-finalization rejection.
