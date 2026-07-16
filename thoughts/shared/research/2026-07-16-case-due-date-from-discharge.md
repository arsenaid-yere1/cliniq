---
date: 2026-07-16T14:14:01Z
researcher: arsenaid
git_commit: d363a6edc970454a90a42932062c03c5259ff3f8
branch: main
repository: cliniq
topic: "Showing a due date on cases, derived from discharge date, for sending case documents to lawyers"
tags: [research, codebase, cases, discharge-notes, attorneys, due-date, patient-list]
status: complete
last_updated: 2026-07-16
last_updated_by: arsenaid
---

# Research: Case Due Date Derived from Discharge Date

**Date**: 2026-07-16T14:14:01Z
**Researcher**: arsenaid
**Git Commit**: d363a6edc970454a90a42932062c03c5259ff3f8
**Branch**: main
**Repository**: cliniq

## Research Question
Explore the best approach to add a feature showing a **due date** on cases. The due date is
determined by the **discharge date**, after which the case document needs to be sent to lawyers.

## Summary

The pieces this feature depends on partly exist and partly do not.

**Exists today:**
- A **discharge date** source: `discharge_notes.visit_date` (provider-editable), with
  `finalized_at` timestamp when the discharge note is finalized into a PDF document.
- **Attorney linkage** to a case: `cases.attorney_id` → `attorneys` table (with `email`, `firm_name`).
- A **cases list table** with a fixed column set (case number, patient, status, accident date, created).
- A single fetch action (`listPatientCases`) backing that list.

**Does NOT exist today:**
- No `due_date`, `deadline`, or discharge-date column on the `cases` table.
- No "sent to lawyer" concept anywhere — no `sent_at`/`sent_to` column, no mark-as-sent status,
  no email/fax infrastructure at all (email is explicitly deferred per prior research).
- No date-math / SLA / business-day helper in the codebase.

So the feature is essentially **net-new state + a derived date + one new UI column**. The discharge
date it derives from is not a case column; it lives on the related `discharge_notes` row. `date-fns`
is already a dependency and is the natural tool for the date math.

## Detailed Findings

### Where "discharge date" actually lives

There is **no `discharge_date` column** on `cases`. Discharge is a separate domain:

- `discharge_notes` table — [016_discharge_notes.sql:1-46](supabase/migrations/016_discharge_notes.sql)
  - `visit_date date` — "Provider-editable date of the discharge visit" (line 6). **This is the discharge date.**
  - `status` — `generating | draft | finalized | failed` (line 27-28)
  - `finalized_at timestamptz` — set when note finalized (line 35)
  - `document_id` — FK to `documents`, populated on finalization (line 38)
  - Unique partial index: one active discharge note per case (`deleted_at is null`) (line 52-53)

The existing precedent for **deriving a discharge date** is in billing:
[billing.ts:367-372](src/actions/billing.ts) —
```
const dischargeDate =
  dischargeData?.visit_date
  ?? dischargeData?.created_at?.split('T')[0]
  ?? firstVisitNote?.visit_date
  ?? firstVisitNote?.created_at?.split('T')[0]
  ?? null
```
Pattern: `visit_date` first, `created_at` fallback. Any due-date feature would read the same source.

**Anchor event candidate:** `finalizeDischargeNote(caseId)`
([discharge-notes.ts:914](src/actions/discharge-notes.ts)) sets status→`finalized`, stamps
`finalized_at`, renders the PDF, uploads it to storage, and creates the `documents` row. This is
the natural moment a "clock starts" for the send-to-lawyer deadline.

### The cases table (target for a stored due date, if chosen)

- [001_initial_schema.sql:73-94](supabase/migrations/001_initial_schema.sql) — `create table public.cases`
  - Date fields present: `accident_date`, `case_open_date` (default `current_date`),
    `case_close_date`, `created_at`, `updated_at`, `deleted_at`.
  - `attorney_id uuid references public.attorneys(id)` (line 77), indexed (line 163).
  - `case_status` CHECK, later widened — full set: `intake | pending_imaging | active |
    pending_settlement | closed | archived`
    ([20260615020000_case_status_pending_imaging.sql](supabase/migrations/20260615020000_case_status_pending_imaging.sql)).
- `case_close_date` is set/cleared **in application code**, not a DB trigger —
  [case-status.ts:105-110](src/actions/case-status.ts). This is the precedent for maintaining a
  date column from a status transition.
- Generated type: [database.ts:383-486](src/types/database.ts). No hand-written `interface Case`;
  the generated `Row` is canonical.

### The attorney linkage (already complete)

- `attorneys` table — [001_initial_schema.sql:19-34](supabase/migrations/001_initial_schema.sql):
  `first_name, last_name, firm_name, phone, email, fax, address_*, ...`. **`email` exists** but is
  never used for outbound send.
- No separate "law group" table; `firm_name` is free text on `attorneys`
  (see [2026-06-18-filter-cases-by-law-group.md](thoughts/shared/research/2026-06-18-filter-cases-by-law-group.md)).
- Lien generation already gates on attorney presence —
  [lien.ts:7-25](src/actions/lien.ts): `if (!caseData.attorney_id) return { error: 'An attorney must be assigned before generating a lien agreement' }`. Same guard pattern applies to a "send to lawyer" step.

### The cases list UI (where a due-date column/badge would render)

- Page: [patients/page.tsx](src/app/(dashboard)/patients/page.tsx) → calls `listPatientCases()`.
- Client + filters: [patient-list-page-client.tsx](src/components/patients/patient-list-page-client.tsx)
  - `PatientCase` interface: lines 12-30
  - Filter state (`globalFilter`, `statusFilter`, `attorneyFilter`) persisted to `sessionStorage`
    key `patient-cases-filters` (lines 38-64) — recent work (commit `d363a6e`).
- Table: [patient-list-table.tsx](src/components/patients/patient-list-table.tsx)
  - `PatientCase` interface: lines 23-34 — currently `id, case_number, case_status,
    accident_date, created_at, patient{...}`. **A due date would be added here.**
  - Columns (lines 48-94): Case Number, Patient Name, Status (Badge via `CASE_STATUS_CONFIG`),
    Accident Date, Created. `date-fns` `format(...)` already imported (line 21). **A "Due Date"
    column slots in alongside these.**
- Status/badge config single source: [case-status.ts](src/lib/constants/case-status.ts)
  (`CASE_STATUS_CONFIG` labels/colors, `LOCKED_STATUSES`). Precedent for a color-coded badge if a
  due-date status pill (e.g. overdue/due-soon) is wanted.

### Data fetch (what would need to join discharge data)

- [patients.ts:259-297](src/actions/patients.ts) — `listPatientCases(search?)`:
  ```
  .from('cases')
  .select(`id, case_number, case_status, accident_date, created_at, attorney_id,
           patient:patients(id, first_name, last_name),
           attorney:attorneys(id, first_name, last_name, firm_name)`)
  ```
  Normalizes Supabase array-shaped relations to single objects (lines 290-294). To show a
  discharge-derived due date **without** a stored column, this select would add a nested
  `discharge_notes(visit_date, finalized_at, status)` relation.

### What does NOT exist (gaps this feature must fill)

- **No `due_date` / `deadline` / `is_due`** on `cases`, `documents`, `discharge_notes`, or
  `attorneys`. Only "due" concept in the repo is financial `balance_due`
  ([dashboard.ts:10,30,49](src/actions/dashboard.ts)) — unrelated.
- **No send-to-lawyer flow.** No `sent_at`/`sent_to`/mark-as-sent column or status. Document
  statuses are `pending_review | reviewed` ([002_case_dashboard_tables.sql](supabase/migrations/002_case_dashboard_tables.sql))
  and `generating | draft | finalized | failed` for notes — none mean "sent."
- **No email/fax infrastructure at all** — confirmed by
  [2026-03-16-email-integration-options.md:27](thoughts/shared/research/2026-03-16-email-integration-options.md):
  *"ClinIQ currently has zero email infrastructure... Email addresses are stored on patients,
  attorneys, and clinic settings but are never used for outbound communication."* Sending is
  explicitly deferred. PDF generation/download exists
  ([render-discharge-note-pdf.ts](src/lib/pdf/render-discharge-note-pdf.ts)) but only for the
  clinic user's own download, not attorney delivery.
- **No date-math / SLA / business-day helper.** `date-fns ^4.1.0` is in `package.json` but no
  `addDays`/`due_date` logic exists yet.

## Architecture Documentation

Relevant patterns to model against:

1. **Deriving discharge date** — copy the `visit_date ?? created_at` fallback chain from
   [billing.ts:367-372](src/actions/billing.ts).
2. **Maintaining a date column from a lifecycle event** — `case_close_date` written in the
   status-transition action [case-status.ts:105-110](src/actions/case-status.ts). A stored
   `document_due_date` could be written the same way inside `finalizeDischargeNote`.
3. **Guarding an attorney-dependent action** — [lien.ts:7-25](src/actions/lien.ts) attorney-presence check.
4. **Single-source badge config** — [case-status.ts](src/lib/constants/case-status.ts) is the
   pattern for any due-date status pill (overdue/due-soon color mapping).
5. **List column + fetch** — a new column in [patient-list-table.tsx](src/components/patients/patient-list-table.tsx)
   plus a new nested relation in `listPatientCases` [patients.ts:259-297](src/actions/patients.ts).

Two broad shapes the implementation could take (documented, not recommended):
- **Derived (no schema change):** compute due date at read time from
  `discharge_notes.visit_date`/`finalized_at` + an offset constant. Cheapest; nothing stored.
- **Stored column:** add e.g. `cases.document_due_date` (and possibly `document_sent_at`), written
  on discharge finalization — mirrors `case_close_date`. Enables sorting/filtering/"overdue"
  server-side and a future send-tracking step.

## Code References
- `supabase/migrations/016_discharge_notes.sql:1-46` — discharge_notes table; `visit_date` (discharge date), `finalized_at`, `document_id`
- `src/actions/billing.ts:367-372` — existing discharge-date derivation (visit_date ?? created_at)
- `src/actions/discharge-notes.ts:914` — `finalizeDischargeNote` (anchor event; stamps finalized_at, creates document)
- `supabase/migrations/001_initial_schema.sql:73-94` — cases table (date fields, attorney_id)
- `src/actions/case-status.ts:105-110` — `case_close_date` written from status transition (precedent for a date column)
- `src/actions/patients.ts:259-297` — `listPatientCases` select (where a discharge join would be added)
- `src/components/patients/patient-list-table.tsx:23-94` — cases list interface + columns (where a Due Date column goes)
- `src/lib/constants/case-status.ts` — badge/status config pattern
- `supabase/migrations/001_initial_schema.sql:19-34` — attorneys table (has email, firm_name)
- `src/actions/lien.ts:7-25` — attorney-presence guard pattern

## Related Research
- `thoughts/shared/research/2026-03-16-email-integration-options.md` — email deferred; providers evaluated
- `thoughts/shared/research/2026-06-18-filter-cases-by-law-group.md` — no law-group table; attorney/firm_name only
- `thoughts/shared/plans/2026-06-18-filter-cases-by-attorney.md` — recent per-attorney filter (implemented)
- `thoughts/shared/research/2026-04-22-pending-settlement-notes-docs-freeze.md` — document-freeze lifecycle on pending_settlement

## Decisions (2026-07-16, from user)
- **Offset:** discharge `visit_date` + **7 calendar days**.
- **Anchor:** `discharge_notes.visit_date` (not `finalized_at`).
- **Scope:** **due-date display only** — show due date + overdue/due-soon badge on cases list.
  No send tracking, no "mark as sent" state.
- **Derived, no schema change** implied by display-only scope: compute at read-time.

### Resulting change surface
1. `listPatientCases` — add nested `discharge_notes(visit_date)` relation to the select
   ([patients.ts:259-297](src/actions/patients.ts)); normalize array→object like existing relations.
2. Compute `dueDate = addDays(visit_date, 7)` (`date-fns`, already a dep) + derive an overdue /
   due-soon / on-track status.
3. New "Due Date" column + status badge in
   [patient-list-table.tsx](src/components/patients/patient-list-table.tsx); extend `PatientCase`
   interface (lines 23-34). Badge follows `CASE_STATUS_CONFIG` color pattern in
   [case-status.ts](src/lib/constants/case-status.ts).

Cases with no discharge note (no `visit_date`) → no due date; render `—`.
