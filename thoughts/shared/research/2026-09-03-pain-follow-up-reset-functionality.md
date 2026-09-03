# Pain Follow-Up Reset Functionality Research

## Research question

How does the existing pain-management follow-up note lifecycle work, what does
the repository currently mean by “reset” for other generated clinical notes,
and which current state, UI, database, dependency, and test boundaries are
relevant to adding equivalent follow-up reset functionality?

This document describes the repository as it exists on 2026-09-03. It does not
propose or implement a change.

## Summary

Pain follow-ups have a complete encounter-scoped generate, edit, per-section
regenerate, finalize, PDF, and server-side unfinalize lifecycle. They do not
have a whole-note reset server action or Reset control in the editor.

The established reset meaning in the initial-visit, procedure-note, and
discharge-note workflows is narrower than unfinalization:

- only a live `draft` or `failed` note can be reset;
- the existing row is updated in place rather than deleted;
- generated narrative and AI-generation metadata are cleared;
- provider-entered source data and clinical ownership records are preserved;
- the note returns to `draft`; and
- the editor recognizes the retained empty draft as the pre-generation state.

The pain-follow-up generator already reuses an existing non-finalized row, so a
retained empty row is compatible with the current persistence lifecycle. The
current pain-follow-up editor is not compatible with that visual state: it
treats only a missing or `failed` note as pre-generation and would render an
empty `draft` as eleven blank editable sections.

Finalized-note dependencies are handled by a separate unfinalize path. The
`unfinalize_pain_follow_up` database function removes the document association,
returns the encounter to `in_progress`, and refuses to proceed if a procedure
order or unreleased billing claim depends on the encounter. The server action
exists, but the current follow-up editor does not expose it.

## Detailed findings

### 1. Encounter and page ownership

A pain follow-up is an encounter-owned workflow, not a case-level singleton.
Additional visits are inserted into `clinical_encounters` with
`encounter_type = 'pain_follow_up'` and `status = 'scheduled'` by
`schedulePainFollowUp` (`src/actions/clinical-encounters.ts:33-51`). A return
episode can also create its first follow-up encounter directly through the
return-episode flow (`src/components/visits/start-return-episode-dialog.tsx:25-45`;
`supabase/migrations/20260826210732_start_return_episode_rpc.sql:196-239`).

The encounter detail route loads the exact live encounter and its note, then
mounts `PainFollowUpEditor`
(`src/app/(dashboard)/patients/[caseId]/visits/[encounterId]/page.tsx:11-34`).
`getPainFollowUpNote` scopes the read by `case_id`, `encounter_id`, and live
`deleted_at` state (`src/actions/pain-follow-up-notes.ts:15-20`). The database
enforces one live note per encounter through the partial unique index
`pain_follow_up_notes_encounter_active_idx`
(`supabase/migrations/20260826161637_pain_follow_up_notes.sql:46-48`).

The page keys the editor with note ID plus `updated_at`. After a successful
mutation and route refresh, a changed timestamp remounts the editor and reloads
its local textarea state
(`src/lib/clinical/pain-follow-up-editor-key.ts:1-10`;
`src/lib/clinical/__tests__/pain-follow-up-editor-key.test.ts:4-30`).

All follow-up page and mutation entry points are guarded by the return-visit
feature flag (`src/lib/features/return-tele-visits.ts:5-17`). Mutating an
encounter or its note also requires the owning episode to remain active and the
case to remain writable (`src/lib/clinical/episode-context.ts:105-134`).

### 2. Note and encounter state are separate

`pain_follow_up_notes` contains eleven generated text sections:

- `subjective`
- `interval_history`
- `review_of_systems`
- `telehealth_observations`
- `imaging_review`
- `assessment`
- `diagnoses`
- `treatment_plan`
- `patient_education`
- `follow_up`
- `clinician_disclaimer`

It also stores structured `procedure_recommendations`, model/raw-response
metadata, source hash, generation attempts and progress, tone hint,
finalization metadata, a document reference, audit fields, and soft-delete
state (`supabase/migrations/20260826161637_pain_follow_up_notes.sql:1-44`;
`src/types/database.ts:2558-2663`). Valid note statuses are `generating`,
`draft`, `finalized`, and `failed`.

The underlying visit input is stored separately on `clinical_encounters`.
`TelehealthIntakeCard` edits provider intake, patient-reported pain range,
modality, scheduling, consent, location, and connection information
(`src/components/visits/telehealth-intake-card.tsx:17-28,39-56`). Encounter
status and completion timestamps also live outside the note. Intake is locked
when an encounter is completed, cancelled, or marked no-show
(`src/components/visits/telehealth-intake-card.tsx:29,65-75`).

This separation means note-content state can change without inherently
changing provider-entered encounter input. Existing reset implementations for
other note types follow exactly that boundary: fields not included in their
note-row update remain intact.

### 3. Full generation reuses the existing note row

`generatePainFollowUpNote` requires authentication, an `in_progress` encounter,
and a writable episode (`src/actions/pain-follow-up-notes.ts:65-75`). Its source
bundle includes the current encounter, patient, provider, other encounters in
the episode, the latest completed encounter, performed procedures, and the
immediately previous episode's finalized discharge when present
(`src/actions/pain-follow-up-notes.ts:22-62`).

The action hashes the source payload and then finds the live note by encounter.
If a non-finalized row exists, it reuses that row, sets it to `generating`,
clears `generation_error`, increments `generation_attempts`, and resets section
progress. Otherwise it inserts a new row
(`src/actions/pain-follow-up-notes.ts:77-94`). Finalized notes are rejected.

Generation uses a structured output contract for all eleven sections and
procedure recommendations. Output passes schema validation and telehealth QC
before persistence (`src/lib/claude/generate-pain-follow-up.ts:76-96`;
`src/lib/validations/pain-follow-up-note.ts:4-44`;
`src/lib/qc/telehealth-follow-up.ts:40-62`).

On failure, the row becomes `failed` and retains a `generation_error`. On
success, every generated section and recommendation is written to the same row,
the row becomes `draft`, and raw response, source hash, model, and progress are
recorded (`src/actions/pain-follow-up-notes.ts:95-108`).

One current-state detail matters to reset semantics: changing an existing row
to `generating` does not first null its old narrative. If a later full
generation fails, prior generated fields may still be present on the `failed`
row, although the current editor hides all failed-row content behind its
generation card (`src/actions/pain-follow-up-notes.ts:82-105`;
`src/components/visits/pain-follow-up-editor.tsx:29`).

### 4. Current editor states

`PainFollowUpEditor` imports and exposes full generation, draft save,
finalization, and per-section regeneration. It does not import a reset or
unfinalize action (`src/components/visits/pain-follow-up-editor.tsx:10-15`).

Its current branches are:

- missing note or `failed`: display “Generate Follow-Up Note”;
- any other non-finalized note: display all section textareas, Save Draft,
  Finalize, and per-section Regenerate;
- finalized note: display read-only textareas and a Documents link;
- structured procedure recommendations: display after generation, with the
  order action available only when finalized.

These branches are implemented in
`src/components/visits/pain-follow-up-editor.tsx:24-35`. There is no dedicated
`generating` progress branch, no failed error/Retry/Reset branch, no empty-draft
recognition, and no finalized-note reopen control.

The full-generation server action accepts an existing draft, but the current
editor does not expose full generation for a non-empty or empty draft. It only
exposes section-level regeneration in that state
(`src/actions/pain-follow-up-notes.ts:78-105`;
`src/components/visits/pain-follow-up-editor.tsx:29-33`).

### 5. Established whole-note reset contract

Three current server actions define the repository's whole-note reset pattern:

- `resetInitialVisitNote(caseId, visitType)`
  (`src/actions/initial-visit-notes.ts:906-965`)
- `resetProcedureNote(procedureId, caseId)`
  (`src/actions/procedure-notes.ts:1049-1107`)
- `resetDischargeNote(caseId)`
  (`src/actions/discharge-notes.ts:1461-1515`)

All three authenticate the user, enforce case/episode-specific writability,
look up the single live note, and accept only `draft` or `failed`. They update
the note in place, set generated narrative fields to `null`, clear model/raw
response/generation error/source hash, reset `generation_attempts` to zero, set
status to `draft`, record the updating user, and revalidate the owning page.

The initial-visit reset additionally empties generated PRP target artifacts.
The discharge reset additionally blocks while a discharge correction is open.
Each reset preserves provider-entered or underlying clinical records by not
including them in the update: initial-visit intake/vitals, procedure/vitals,
and discharge visit date/vitals remain separate or untouched.

The corresponding editors expose Reset in both failed and draft states through
an `AlertDialog` confirmation:

- Initial Visit:
  `src/components/clinical/initial-visit-editor.tsx:507-558,1485-1514`
- Procedure Note:
  `src/components/procedures/procedure-note-editor.tsx:314-368,481-510`
- Discharge Note:
  `src/components/discharge/discharge-note-editor.tsx:372-425,633-662`

These editors also interpret a retained `draft` row with no anchor narrative as
the pre-generation state:

- Initial Visit checks `introduction || chief_complaint`
  (`src/components/clinical/initial-visit-editor.tsx:345-346,392-394`).
- Procedure Note checks `subjective || assessment_and_plan`
  (`src/components/procedures/procedure-note-editor.tsx:219-221,255-256`).
- Discharge Note checks `subjective || assessment`
  (`src/components/discharge/discharge-note-editor.tsx:268-269,303-304`).

The pain-follow-up editor has no equivalent empty-draft check. Under its current
branching, an in-place reset matching the other note tables would leave the user
in an eleven-section blank draft editor rather than the pre-generation card.

### 6. Whole-note reset and section regeneration are different operations

`regeneratePainFollowUpSectionAction` requires an `in_progress` encounter, a
writable episode, and a `draft` note. It invokes the generator but persists
only the requested text section plus the latest raw response
(`src/actions/pain-follow-up-notes.ts:132-164`). It does not reset the remaining
sections, recommendations, attempt count, source hash, or note status.

The Quality Review Fix flow dispatches pain-follow-up findings to this same
section action using the finding's `encounter_id`
(`src/actions/case-quality-reviews.ts:984-1003`;
`src/actions/__tests__/case-quality-reviews.test.ts:684-707`).

Whole-note generation, section regeneration, and whole-note reset therefore
occupy distinct current lifecycle roles. Only the first two exist for pain
follow-ups today.

### 7. Finalization and unfinalization are separate from reset

`finalizePainFollowUpNote` accepts a live `draft`, renders and uploads a PDF,
inserts a reviewed generated `documents` row, and calls the
`finalize_pain_follow_up` database function
(`src/actions/pain-follow-up-notes.ts:166-208`). The active function definition
atomically links the document, marks the note `finalized`, and moves the
encounter from `in_progress` to `completed`, while requiring an active episode
and writable case
(`supabase/migrations/20260830164454_rollback_visit_specific_diagnoses.sql:5-60`).

If database finalization fails after object/document creation, the action
removes the uploaded file and soft-deletes the document row
(`src/actions/pain-follow-up-notes.ts:195-201`).

`unfinalizePainFollowUpNote` is the separate finalized-note reversal path
(`src/actions/pain-follow-up-notes.ts:210-225`). Its database function:

- requires a live finalized note in an active episode and writable case;
- refuses to reopen if a live procedure order or unreleased billing claim
  references the encounter;
- changes the note back to `draft` without clearing narrative;
- clears note finalization and document fields;
- soft-deletes the document row; and
- changes the encounter back to `in_progress`.

The behavior is defined in
`supabase/migrations/20260826212446_return_visit_workflow_rpcs.sql:62-98`.
After the RPC succeeds, the server action removes the PDF object from storage.

No UI reference to `unfinalizePainFollowUpNote` exists. The finalized editor
currently exposes only a link to the Documents page
(`src/components/visits/pain-follow-up-editor.tsx:32-35`).

Existing initial-visit, procedure-note, and discharge reset actions reject
finalized notes. Based on verified current behavior, “reset” and “unfinalize”
are distinct operations rather than interchangeable names.

### 8. Downstream dependencies after finalization

Finalization makes the encounter and recommendations authoritative to several
downstream workflows:

- A structured procedure order requires a completed encounter and a finalized
  note containing the matching recommendation
  (`supabase/migrations/20260827185012_add_next_procedure_current_active_series.sql:40-48`).
- Orders retain `source_encounter_id` and `source_recommendation_id`
  (`supabase/migrations/20260827185012_add_next_procedure_current_active_series.sql:91-99`).
- Completed pain follow-ups become CPT 99213 billing sources, and active claims
  suppress duplicate line items (`src/actions/billing.ts:155-158,412-426`).
- Billing source claims are keyed to the encounter
  (`supabase/migrations/20260826161643_procedure_orders_and_appointments.sql:103-129`).
- Timeline classification derives from encounter status
  (`src/actions/timeline.ts:176-184`).
- Completed follow-ups contribute to the episode's procedure-date floor
  (`supabase/migrations/20260826212448_episode_contract_hardening.sql:43-61`).

These dependencies explain the guards in the existing unfinalize RPC. They do
not ordinarily exist for a `draft` or `failed` note, which is the state domain
used by the repository's existing reset actions.

## Execution and data flow

```text
clinical_encounters row
  scheduled
     |
     | start visit + retain provider intake / consent / pain values
     v
  in_progress
     |
     | generatePainFollowUpNote
     v
pain_follow_up_notes row
  missing -> generating -> draft
               |           |
               | failure   +--> save all sections
               v           +--> regenerate one section
             failed        +--> finalize + create PDF/document
                               |
                               v
                          finalized note
                          completed encounter
                               |
                               +--> procedure orders / billing claims
                               |
                               +--> unfinalize RPC only when dependencies allow
                                    -> draft note (content retained)
                                    -> in_progress encounter

Current missing transition:
  draft or failed note -- whole-note reset --> retained empty draft
                                            (no action or UI exists today)
```

The current repository's comparable reset flow is:

```text
draft or failed note
   -> authenticate and enforce writable owner
   -> update the existing note row in place
   -> clear generated sections and AI metadata
   -> preserve source/clinical records and row identity
   -> status = draft
   -> refresh owning page
   -> editor recognizes empty draft as pre-generation
```

## File and symbol reference map

| Area | Current files and symbols |
| --- | --- |
| Encounter scheduling/status | `src/actions/clinical-encounters.ts` — `schedulePainFollowUp`, `updatePainFollowUpEncounter`, `changePainFollowUpStatus` |
| Page entry | `src/app/(dashboard)/patients/[caseId]/visits/[encounterId]/page.tsx` — `VisitPage` |
| Editor | `src/components/visits/pain-follow-up-editor.tsx` — `PainFollowUpEditor` |
| Note actions | `src/actions/pain-follow-up-notes.ts` — `getPainFollowUpNote`, `generatePainFollowUpNote`, `savePainFollowUpNote`, `regeneratePainFollowUpSectionAction`, `finalizePainFollowUpNote`, `unfinalizePainFollowUpNote` |
| AI contract | `src/lib/claude/generate-pain-follow-up.ts` — `generatePainFollowUp`, `PAIN_FOLLOW_UP_SYSTEM_PROMPT` |
| Validation | `src/lib/validations/pain-follow-up-note.ts` — result/edit/recommendation schemas |
| Telehealth QC | `src/lib/qc/telehealth-follow-up.ts` — `validateTelehealthFollowUpOutput` |
| Editor refresh | `src/lib/clinical/pain-follow-up-editor-key.ts` — `buildPainFollowUpEditorKey` |
| Note table | `supabase/migrations/20260826161637_pain_follow_up_notes.sql` — `pain_follow_up_notes` |
| Finalize RPC | `supabase/migrations/20260830164454_rollback_visit_specific_diagnoses.sql` — current `finalize_pain_follow_up` definition |
| Unfinalize RPC | `supabase/migrations/20260826212446_return_visit_workflow_rpcs.sql` — `unfinalize_pain_follow_up` |
| Comparable resets | `src/actions/initial-visit-notes.ts` — `resetInitialVisitNote`; `src/actions/procedure-notes.ts` — `resetProcedureNote`; `src/actions/discharge-notes.ts` — `resetDischargeNote` |

## Existing tests

The following focused pain-follow-up tests exist and passed in this research
run:

- `src/lib/clinical/__tests__/pain-follow-up-editor-key.test.ts`
- `src/lib/validations/__tests__/pain-follow-up-note.test.ts`
- `src/lib/claude/__tests__/generate-pain-follow-up.test.ts`
- `src/lib/qc/telehealth-follow-up.test.ts`
- `src/lib/pdf/__tests__/render-pain-follow-up-pdf.test.ts`
- `src/lib/pdf/__tests__/pain-follow-up-template.test.tsx`

Command:

```text
npm test -- src/lib/clinical/__tests__/pain-follow-up-editor-key.test.ts \
  src/lib/validations/__tests__/pain-follow-up-note.test.ts \
  src/lib/claude/__tests__/generate-pain-follow-up.test.ts \
  src/lib/qc/telehealth-follow-up.test.ts \
  src/lib/pdf/__tests__/render-pain-follow-up-pdf.test.ts \
  src/lib/pdf/__tests__/pain-follow-up-template.test.tsx
```

Result: 6 test files passed; 23 tests passed.

Other related coverage includes the Quality Review dispatch test at
`src/actions/__tests__/case-quality-reviews.test.ts:684-707` and database tests
that seed or inspect finalized follow-ups under `supabase/tests/database/`.

No direct automated test currently exercises:

- a pain-follow-up whole-note reset;
- pain-follow-up server-action generate/save/finalize/unfinalize transitions;
- the follow-up editor's failed, empty-draft, reset, or unfinalize states; or
- the dependency guards in `unfinalize_pain_follow_up`.

Repository searches also found no direct tests of the three existing reset
server actions.

## Historical context

The return tele-visit workflow was introduced in commit `561ff93` on
2026-08-26. That commit added the current pain-follow-up action and editor files,
including generate, save, section regeneration, finalization, and unfinalize,
but not a Reset control or action. Later commits added procedure-series
continuation (`945c4bd`), visit-specific diagnoses (`4824974`), and the current
diagnosis rollback/finalize function definition (`c3c5155`).

The implementation plan that preceded the return-visit work explicitly listed
“transactional unfinalize/reset” as part of the intended follow-up lifecycle
(`thoughts/shared/plans/2026-08-25-additional-pain-management-tele-visits-implementation.md:668-678`).
The current implementation contains the transactional unfinalize RPC but no
separately named reset function. This is a verified difference between the
historical plan and the current source, not evidence of the desired reset
semantics.

The repository's in-place reset convention arose from earlier duplicate-row
issues. Commit `4713878` changed initial-visit reset from soft-delete/reinsert to
clearing the existing row in place, and commit `8a79100` changed subsequent
generation to reuse that row. Commit `c1b4565` carried the same retained-row
pattern into procedure notes. Discharge reset was added in commit `4ec1459`.

## Open questions

1. Does “follow-up reset” mean the established `draft`/`failed` whole-note reset,
   or should it include finalized-note reversal? The repository currently treats
   finalized reversal as unfinalization and applies downstream dependency
   guards.
2. Which follow-up fields should be considered generated artifacts beyond the
   eleven text sections: `procedure_recommendations`, `tone_hint`, generation
   progress counters, or all of them? Existing note resets are not completely
   uniform about auxiliary fields.
3. Should a failed follow-up continue to show direct full-generation retry, or
   should the failure state separately expose its stored error and reset state?
4. Which text fields should define “generated content” for an empty-draft check?
   Existing editors use two anchor sections rather than checking every generated
   column.
5. Should reset preserve the note row's current `generation_attempts` for audit
   history or follow the existing reset actions that set it to zero?
6. Is `tone_hint` provider-authored input that must survive reset? The column
   exists on follow-up notes but the current follow-up editor does not expose it.
7. Is the absence of a finalized-note unfinalize control intentional, or is that
   existing server capability expected to be surfaced independently from reset?

## Research verification

- Read and traced the encounter route, editor, server actions, generator,
  validation, QC, generated database types, note-table migration, active
  finalization definition, and unfinalize RPC.
- Compared the initial-visit, procedure-note, and discharge-note reset actions
  and their failed/draft/empty-state UI handling.
- Searched tests, migrations, actions, components, historical planning/research,
  and git history for follow-up, reset, regenerate, unfinalize, and revision
  behavior.
- Ran the six focused follow-up test files listed above: all 23 tests passed.
- Reviewed the resulting diff. Only this research document was added; existing
  application code, schema, and tests were not changed.
