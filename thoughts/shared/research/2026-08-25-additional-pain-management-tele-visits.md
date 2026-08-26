# Additional Pain-Management Tele-Visits After Discharge

## Research question

How does the current application represent pain-management visits, discharge,
case reopening, and procedures, and what must change to support this flow on the
same legal case?

1. A patient completes care and is discharged.
2. The patient later returns for an additional pain-management tele-visit.
3. The provider recommends and schedules one or more procedures.
4. Prior discharge and treatment history remain intact and auditable.

This document records current behavior first. The proposed model is explicitly
labeled and is not an implemented change.

## Summary

The requested workflow cannot be represented correctly by the current data
model.

- A closed case can already be reopened from `closed` to `active`. Finalizing a
  discharge note is separate from closing the case.
- A case can have exactly one live `initial_visit` note and one live
  `pain_evaluation_visit` note. Reusing the pain-evaluation workflow replaces or
  edits the existing row; it does not create a new encounter.
- A case can have exactly one live discharge note, so it cannot retain an old
  discharge and later record a second discharge episode.
- There is no visit modality (`telehealth`, `in_person`, etc.), encounter table,
  appointment table, or procedure scheduling state.
- A `procedures` row means a performed/recorded procedure. It is immediately
  included in the timeline and billing inputs. Creating a future-dated row would
  incorrectly treat an appointment as completed care.
- Procedures are numbered across the entire case. Reopening after discharge does
  not begin a new procedure series.

The clean extension is to keep `cases` as the legal/administrative container and
introduce clinical episodes and append-only encounters beneath it. A tele-visit
becomes an encounter with `modality = 'telehealth'`; a procedure recommendation
creates a separate scheduled appointment/order; completion creates or links the
existing performed `procedures` record. Existing cases can be backfilled into an
initial episode.

## Current implementation

### 1. Case and patient ownership

`patients` own one or more `cases`; all notes, procedures, documents, invoices,
and status history are case-scoped. The original schema defines the patient-to-
case foreign key and the case open/close fields
(`supabase/migrations/001_initial_schema.sql:42-94`).

The application already supports a returning patient as a completely new case:

- `createPatientCase` accepts an `existing_patient` mode, reuses the patient ID,
  and inserts a fresh case and status-history row
  (`src/actions/patients.ts:37-67,98-137`).
- The patient detail screen exposes **New Case for This Patient**
  (`src/components/patients/patient-detail.tsx:145-171`).

That path creates a fully separate legal and clinical lifecycle. It is available
today, but it does not satisfy a same-case return when the ongoing care belongs
to the original legal case.

### 2. Case discharge, close, and reopen are separate concepts

The case status machine explicitly permits `closed -> active` and
`pending_settlement -> active`. `pending_settlement`, `closed`, and `archived`
are write-locked (`src/lib/constants/case-status.ts:17-30`).

`updateCaseStatus`:

- validates the transition;
- requires a non-void medical/visit invoice before settlement or closure;
- sets `case_close_date` for `closed`/`archived` and clears it for active states;
- appends `case_status_history` (`src/actions/case-status.ts:50-139`).

`reopenCase` is a thin wrapper that moves the case to `active`
(`src/actions/case-status.ts:174-180`). The status dropdown exposes the allowed
transitions (`src/components/patients/status-change-dropdown.tsx:35-133`).

Every clinical write path uses `assertCaseNotClosed`, which tells the user to
move a locked case back to Active (`src/actions/case-status.ts:10-31`).

Finalizing a discharge note only finalizes the note, creates its PDF/document,
and records finalization metadata. It does not update case status
(`src/actions/discharge-notes.ts:914-1005`). Therefore:

- if only the discharge note was finalized and the case remains Active, later
  writes are currently allowed;
- if the case was actually closed, reopening it to Active re-enables writes.

### 3. Visits are two singleton note types, not encounters

`NoteVisitType` is a closed union of exactly `initial_visit` and
`pain_evaluation_visit` (`src/lib/claude/generate-initial-visit.ts:21`). The
database CHECK has the same two values. A partial unique index permits only one
live row per `(case_id, visit_type)`
(`supabase/migrations/20260413_initial_visit_visit_type.sql:3-16`).

The UI hard-codes two tabs, one for each singleton row
(`src/components/clinical/initial-visit-editor.tsx:213-250`). All note actions
are keyed by `(caseId, visitType)`, not encounter ID:

- find/create and generate: `src/actions/initial-visit-notes.ts:325-448`;
- get one/get both: `src/actions/initial-visit-notes.ts:570-607`;
- edit/finalize lifecycle: `src/actions/initial-visit-notes.ts:611-724`.

When generation finds the existing row for a type, it clears and replaces that
row's narrative fields (`src/actions/initial-visit-notes.ts:381-413`). This is a
document lifecycle, not append-only clinical history.

The closest existing follow-up pattern is the pain-evaluation variant. It loads
imaging, approved pain-management extraction data, and the finalized initial
visit as comparison context (`src/actions/initial-visit-notes.ts:55-106`). The
generator can also produce a standalone pain evaluation when no prior initial
visit exists (`src/lib/claude/generate-initial-visit.ts:254-274`). This content
logic is reusable, but the row cardinality is not.

The date-order trigger also knows only these two singleton siblings: Initial
Visit must be on or before Pain Evaluation Visit
(`supabase/migrations/20260414_initial_visit_date_order.sql:1-64`).

### 4. No telehealth modality exists

Repository-wide searches found no production visit/encounter field or workflow
for telehealth, telemedicine, video, virtual visits, or visit modality. Generated
database types also contain no appointment or encounter table.

Current visit generation assumes shared provider intake, physical-exam content,
and case-level non-procedure vitals. Non-procedure vitals are stored as
`vital_signs.procedure_id IS NULL`, not linked to a particular visit
(`src/actions/initial-visit-notes.ts:955-1098`). An additional tele-visit would
therefore risk reusing or overwriting ambiguous visit context unless intake and
vitals become encounter-scoped.

Historical context confirms that scheduling was intentionally deferred. The
case-dashboard plan states that no encounters/appointments table was in scope
(`thoughts/shared/plans/2026-03-05-epic-1-story-1.2-case-dashboard.md:49-57`),
and the corresponding research says those entities could be added when
scheduling ships
(`thoughts/shared/research/2026-03-05-epic-1-story-1.2-case-dashboard-design.md:417-422`).

### 5. Discharge is a singleton case document

The database permits one live discharge note per case
(`supabase/migrations/016_discharge_notes.sql:48-53`), and read/write actions
address it by `case_id` (`src/actions/discharge-notes.ts:848-898`).

Generation requires any finalized initial-visit-note row. It does not require a
specific visit type or completed procedure
(`src/actions/discharge-notes.ts:597-617`). Source gathering aggregates all live
case procedures and case-level clinical inputs
(`src/actions/discharge-notes.ts:76-180`).

**Inference:** reopening a case preserves the finalized discharge row and PDF,
but there is no new clinical episode and no place for a second discharge note.
The user could unfinalize the existing discharge after reopening
(`src/actions/discharge-notes.ts:1010-1045`), but that would mutate the prior
episode's discharge rather than retain an immutable historical discharge.

There is also a current singleton-query assumption worth addressing during any
cardinality migration: parts of discharge source gathering call
`.maybeSingle()` on finalized `initial_visit_notes` without selecting a visit
type (`src/actions/discharge-notes.ts:117-122`). Multiple finalized visit rows
can already exist, so encounter-aware selection must be explicit.

### 6. Procedures are performed encounters, not appointments

`procedures` belongs directly to `cases` and requires `procedure_date` and
`procedure_name`. It has no encounter, episode, appointment, lifecycle status,
scheduled timestamp, duration, or cancellation fields
(`supabase/migrations/002_case_dashboard_tables.sql:27-41`).

The UI says **Record Procedure** and collects performed-encounter details such as
consent, preparation, anesthesia, injection, post-procedure findings, and vitals
(`src/components/procedures/procedure-table.tsx:140-209`;
`src/components/procedures/record-procedure-dialog.tsx:218-395`).

`createPrpProcedure` immediately:

1. blocks locked cases;
2. enforces the visit-date floor;
3. counts all live case procedures to assign the next series number;
4. inserts the detailed performed procedure;
5. inserts procedure vitals (`src/actions/procedures.ts:75-195`).

BOTOX follows the same case-wide lifecycle (`src/actions/procedures.ts:432-524`).
Billing creates line items for every procedure row, and the timeline emits every
row as a procedure event (`src/actions/billing.ts:292-383`;
`src/actions/timeline.ts:33-38,101-109`). The Draft/Finalized badge on the
procedure page is the linked procedure note's status, not the procedure's
appointment state (`src/app/(dashboard)/patients/[caseId]/procedures/page.tsx:28-42`).

Consequently, using a future `procedure_date` as a scheduler would pollute the
performed-care timeline and billing inputs.

### 7. Procedure continuity after a return

Procedure creation is allowed after a case is reopened. It has no check against
discharge-note status or discharge date. Its only clinical date floor is the
maximum live Initial/Pain Evaluation visit date, enforced in both the action and
database trigger (`src/actions/procedures.ts:86-103`;
`supabase/migrations/20260415_procedure_date_order.sql:1-38`).

The next `procedure_number` is `count(all live procedures on case) + 1`
(`src/actions/procedures.ts:107-121`). Deletion renumbers every remaining live
procedure on the case (`src/actions/procedures.ts:850-930`). A post-discharge
return therefore continues the original case-wide series.

Procedure defaults prefer the singleton pain-evaluation note over the initial
visit and use the maximum visit date as the earliest procedure date
(`src/actions/procedures.ts:675-808`). There is no foreign key from a procedure
to the visit that recommended it.

### 8. Timeline and billing assumptions

The timeline currently includes status changes, documents, performed
procedures, invoices, invoice changes, and payments. It has no visit or
appointment event (`src/actions/timeline.ts:7-18,21-109`).

Billing treats every current visit-note row as a billable visit and assigns CPT
99204, with a different description for the pain evaluation
(`src/actions/billing.ts:227-253`). A repeat tele-follow-up cannot safely reuse
this logic without an explicit service/billing classification; in particular,
it should not automatically inherit the new-patient/evaluation behavior of the
singleton rows.

## Current execution flow

### Existing same-case return

```text
Finalized discharge note
        |
        | (does not close case)
        v
Optional explicit case close -> status history + write lock
        |
        v
Change Closed -> Active -> clear case_close_date + unlock writes
        |
        +--> Existing Pain Evaluation row can be edited/regenerated
        |    (no new encounter is retained)
        |
        +--> Record Procedure
             -> immediately treated as performed
             -> continues case-wide procedure_number
             -> appears in billing and timeline
```

### Existing new-case return

```text
Existing Patient -> New Case for This Patient
                 -> fresh case status/note/procedure/discharge lifecycle
                 -> historical cases remain separate
```

## Proposed target model (not implemented)

### Design principle

Keep a `case` as the legal and financial container. Add explicit clinical
episodes and encounters so treatment can stop and restart without overwriting
history.

```text
Patient
  -> Case (legal/financial matter)
       -> Care Episode 1 (discharged)
       |    -> Encounter(s)
       |    -> Performed Procedure(s)
       |    -> Discharge Encounter + immutable discharge note
       |
       -> Care Episode 2 (active return)
            -> Telehealth Pain Follow-up Encounter
            -> Procedure Recommendation/Order
            -> Scheduled Procedure Appointment(s)
            -> Performed Procedure(s), when completed
            -> Later discharge encounter/note
```

### A. `care_episodes`

Add a case-owned episode entity with, at minimum:

- `id`, `case_id`, `episode_number`;
- `status` such as `active`, `discharged`, `cancelled`;
- `started_at`, `discharged_at`;
- optional `reopened_from_episode_id` or return reason;
- audit fields.

Backfill every existing case with Episode 1 and attach its historical clinical
records to that episode. Opening post-discharge care creates Episode 2; it should
not unfinalize or overwrite Episode 1's discharge.

Case status can remain `active` while an episode is active. Whether reopening a
closed legal case is also required is a product rule, not something that should
be inferred from note finalization.

### B. `clinical_encounters`

Add an append-only encounter entity with:

- `id`, `case_id`, `episode_id`;
- `encounter_type` such as `initial_evaluation`, `pain_evaluation`,
  `pain_follow_up`, `discharge`;
- `modality` such as `in_person`, `telehealth`, possibly `phone`;
- scheduling/occurrence fields (`scheduled_start`, `occurred_at`, timezone);
- lifecycle status (`scheduled`, `checked_in`, `completed`, `cancelled`,
  `no_show`);
- provider, reason for visit, and audit fields.

Clinical notes, provider intake, clinical orders, and non-procedure vitals should
reference `encounter_id`. Notes can retain a document-specific status
(`generating`, `draft`, `finalized`) independently from encounter status.

The existing two note variants can initially remain as templates, but storage
and actions should be keyed by note/encounter ID rather than
`(case_id, visit_type)`. This removes the singleton constraint and permits
multiple pain follow-ups.

### C. Telehealth-aware documentation

Add modality-aware validation and note-generation input. For a telehealth
encounter:

- do not silently reuse case-level vitals as current-visit vitals;
- distinguish patient-reported findings from provider-observed findings;
- prevent the generator from fabricating hands-on physical-exam findings;
- render the encounter modality in the note/PDF/header and timeline;
- capture any clinic-required consent, patient location, provider location, and
  platform fields only after operational/compliance requirements are confirmed.

The current pain-evaluation prompt/source gathering is the closest reusable
content path, but its prior-comparison lookup should become episode/encounter
aware: usually compare with the latest relevant completed encounter, while
retaining the original evaluation and prior discharge in the longitudinal
context.

### D. Procedure orders and appointments

Do not weaken the existing `procedures` record into a mixed
scheduled/performed table. Its downstream consumers already interpret every row
as performed and billable.

Introduce a separate `procedure_orders` and/or `procedure_appointments` model:

- parent links: `case_id`, `episode_id`, `source_encounter_id`;
- clinical intent: procedure type, proposed sites, diagnoses, priority, notes;
- appointment data: scheduled start/end, provider, location, status;
- lifecycle: `recommended -> authorized -> scheduled -> completed`, plus
  cancellation/no-show states as needed;
- `completed_procedure_id` linking to the existing performed `procedures` row.

When the appointment is completed, launch the existing Record Procedure form
with recommendation/appointment data prefilled, create the performed procedure,
and link the two. Billing and performed-care timeline behavior then remain
correct.

### E. Discharge history

Move discharge cardinality from one live row per case to one finalized discharge
per episode/discharge encounter. Preserve old PDFs and finalized notes as
immutable historical records. A new episode receives a new discharge note.

Discharge source gathering, quality review, billing diagnosis precedence, and
pain trajectory queries must select an explicit episode rather than aggregating
all case history indiscriminately.

### F. Procedure series semantics

Add an explicit `procedure_series_id` or episode-scoped series number if a return
starts a new treatment series. Avoid deriving clinical series identity from a
count across the entire case. If the clinic considers the return a continuation,
the same series ID can be reused deliberately.

## Suggested implementation slices

These are planning boundaries, not completed work.

1. **Episode and encounter foundation**
   - Add/backfill `care_episodes` and `clinical_encounters`.
   - Add encounter/episode foreign keys to visit notes, discharge notes,
     clinical orders, vitals, and procedures where appropriate.
   - Preserve compatibility for existing case pages during migration.

2. **Repeat pain follow-up + telehealth note**
   - Replace the fixed two-tab singleton lookup with encounter list/detail UI.
   - Add `pain_follow_up` and `telehealth` modality.
   - Make generation, edit, finalize, PDFs, QC, and source selection encounter-ID
     based and modality aware.

3. **Return-after-discharge workflow**
   - Add an explicit **Start New Care Episode / Return Visit** action.
   - Preserve prior discharge and create the new tele-visit in the new episode.
   - Decide whether this action also reactivates a closed case or requires a
     separate case-status confirmation.

4. **Procedure recommendation and scheduling**
   - Add order/appointment tables and status transitions.
   - Schedule from the tele-visit treatment plan.
   - Convert a completed appointment into the existing performed-procedure flow.

5. **Cross-cutting consumers**
   - Make timeline, billing, discharge generation, quality review, pain
     trajectory, procedure defaults, and diagnoses episode/encounter aware.
   - Add visit and appointment events to the timeline.

## Existing tests

- Case lock and status transitions, including reopen:
  `src/actions/__tests__/case-status.test.ts:35-80,82-250,315-344`.
- Status constants and allowed transitions:
  `src/lib/constants/__tests__/case-status.test.ts:34-96`.
- Pain-evaluation prior-visit comparison and vitals input:
  `src/lib/claude/__tests__/generate-initial-visit.test.ts:92-113,206-232`.
- QC's two visit types and pain-management-start behavior:
  `src/actions/__tests__/case-quality-reviews.test.ts:254-361`.
- PRP/BOTOX performed-procedure form validation:
  `src/lib/validations/__tests__/prp-procedure.test.ts:53-87` and
  `src/lib/validations/__tests__/botox-procedure.test.ts:42-143`.
- Repeat procedure-note narrative behavior:
  `src/lib/claude/__tests__/generate-procedure-note.test.ts:212-218,534-568,804-852`.

No tests were found for multiple same-type pain visits, telehealth modality,
multiple discharge episodes, procedure appointment states, or creating a
procedure after a discharge/reopen cycle.

## Verification targets for a future implementation

- Backfilled cases render exactly the same clinical records as before.
- A finalized prior discharge remains immutable after a return.
- A closed case can be reactivated with complete status/episode audit history.
- Two or more pain-management follow-up visits can coexist on the same case.
- Telehealth notes never render uncollected in-person exam/vital findings as
  current-visit facts.
- Scheduled procedures do not appear as performed care or billable services.
- Completing an appointment creates/links exactly one performed procedure.
- Procedure numbering follows the chosen episode/series rule.
- Discharge/QC/billing use the intended episode rather than an arbitrary
  singleton or all-case aggregation.

## Open questions

1. Does “discharged” mean the discharge note was finalized, the legal case was
   moved to Closed, or both?
2. Must the return stay on the same legal case, or should some returns use the
   existing New Case for This Patient flow?
3. Does every return create a new care episode, or only returns after a finalized
   discharge?
4. Is the new visit a `pain_evaluation`, a `pain_follow_up`, or configurable?
5. Which modalities are required: video telehealth only, phone, and/or in-person?
6. Which encounter details are operationally or legally required for a telehealth
   note in the clinic's jurisdictions?
7. Which prior encounter should drive comparison: last procedure, last pain
   visit, prior discharge, or a provider-selected baseline?
8. Should post-return procedures start a new clinical series or continue the old
   series?
9. Does “schedule procedures” require calendar availability, reminders,
   authorization tracking, cancellation/no-show handling, or only a planned date?
10. What billing/service classification applies to repeat tele-follow-ups? The
    current visit billing logic assumes CPT 99204 for both singleton visit types.

## Research and verification performed

- Queried the existing `graphify-out/graph.json` using repository vocabulary for
  pain, visits, discharge, encounters, patients, procedures, and clinical flow.
- Read and traced the relevant migrations, server actions, route components,
  editors, status model, timeline, billing flow, validations, and tests.
- Searched production source, generated database types, migrations, and
  historical documents for telehealth, encounters, appointments, and scheduling.
- Reviewed current git history for the visit/status/procedure/discharge areas.
- No application code, schema, or tests were changed.
