---
date: 2026-04-25T21:50:19Z
researcher: arsenaid
git_commit: e8c68379dfcaad02c16777927694f746d4ecb20b
branch: main
repository: cliniq
topic: "Improve main UI: browse patients then their cases"
tags: [research, ui, navigation, patients, cases, dashboard, proposal]
status: complete
last_updated: 2026-04-25
last_updated_by: arsenaid
---

# Research: Improve Main UI — Browse Patient Records Then Their Cases

**Date**: 2026-04-25T21:50:19Z
**Researcher**: arsenaid
**Git Commit**: e8c68379dfcaad02c16777927694f746d4ecb20b
**Branch**: main
**Repository**: cliniq

## Research Question
Propose best approach to improve main UI screen so user can browse patient records first, then drill into their cases.

## Summary

Current app has true 1:N patient→case schema, but UI flattens it: root list shows **cases** joined to patient, not patients. There is no patient-centric browse path. Only way to "see all cases for one patient" today is the `New Case for This Patient` button on a case overview, which uses query param `?patientId=` on the new-case form. List sorting/searching is by case, not patient.

This document maps the current state, then proposes a phased approach to add patient-first browsing without disrupting existing case-centric workflows.

## Detailed Findings

### Routing & Naming

- Root route `/` → [src/app/page.tsx](src/app/page.tsx) renders landing.
- Dashboard root `/dashboard` → [src/app/(dashboard)/page.tsx:3-5](src/app/(dashboard)/page.tsx#L3-L5) just `redirect("/patients")`.
- Top nav has only **Patients** and **Attorneys** → [src/components/layout/app-sidebar.tsx:18-21](src/components/layout/app-sidebar.tsx#L18-L21).
- The `/patients` route actually lists **cases** (joined to patient) — naming is misleading.
- Case detail URL: `/patients/[caseId]/...` — segment named `patients` but param is `caseId`. All sub-tabs (overview, documents, clinical, initial-visit, procedures, discharge, billing, timeline) live under that case.

### Data Model (1:N patient → cases)

[supabase/migrations/001_initial_schema.sql:43-94](supabase/migrations/001_initial_schema.sql#L43-L94):
- `patients` table: demographics only, soft-delete via `deleted_at`.
- `cases` table: `patient_id uuid not null references patients(id)`, `case_number` (unique, sequence-generated), `case_status`, `accident_*`, `attorney_id`, financials (`total_billed`, `total_paid`, `balance_due`).
- One patient can have many cases. The schema fully supports patient-first browsing.

### Current List Page

[src/app/(dashboard)/patients/page.tsx:1-8](src/app/(dashboard)/patients/page.tsx#L1-L8) calls `listPatientCases()`:

[src/actions/patients.ts:165-200](src/actions/patients.ts#L165-L200) selects from `cases` joined to `patients(id, first_name, last_name)`, returns one row per case.

UI shell [src/components/patients/patient-list-page-client.tsx:35-79](src/components/patients/patient-list-page-client.tsx#L35-L79):
- Title literally says **"Patient Cases"**.
- Filter: search by name or case number; status filter `all_active` / `all` / per-status.
- Button: **New Patient Case** → `/patients/new`.

Table [src/components/patients/patient-list-table.tsx:48-94](src/components/patients/patient-list-table.tsx#L48-L94):
- Columns: case_number, patient_name, status, accident_date, created_at.
- Row click → `/patients/${row.original.id}` (case id).
- One patient with three cases shows up as three rows with the same name.

### Case Detail Layout

[src/app/(dashboard)/patients/[caseId]/layout.tsx:1-28](src/app/(dashboard)/patients/[caseId]/layout.tsx#L1-L28) wraps children with `CaseStatusProvider` and a left `CaseSidebar`.

[src/components/patients/case-sidebar.tsx:27-36](src/components/patients/case-sidebar.tsx#L27-L36) — case-scoped tabs: Overview, Documents, Clinical Data, Initial Visit, Procedures, Discharge, Billing, Timeline.

[src/components/patients/case-overview.tsx:204-211](src/components/patients/case-overview.tsx#L204-L211) — only patient-centric affordance: `New Case for This Patient` link `/patients/new?patientId={patient.id}`.

### New Case Flow

[src/actions/patients.ts:36-126](src/actions/patients.ts#L36-L126) `createPatientCase` accepts two modes:
- `mode: 'existing_patient'` with `patient_id` — reuses patient row.
- `mode: 'new_patient'` with full demographics.

Implies a wizard already supports both paths but entry from list page only triggers new-patient mode.

[src/actions/patients.ts:128-142](src/actions/patients.ts#L128-L142) `getPatientForNewCase(patientId)` — exists, used when wizard is preloaded with `?patientId=`.

### What Is Missing for Patient-First Browse

- No `/patients` route that lists *patients* (one row per patient).
- No `/patients/[patientId]` page showing patient demographics + list of that patient's cases.
- No way to find a patient who has only archived cases without filter twiddling.
- Sidebar nav has no "Patients" + "Cases" separation.
- Search behavior on root mixes case_number and patient name into one box, but patient hits are duplicated per case.
- Dashboard redirect goes to flat list — no real "home" with KPIs across all cases.

## Proposed Approach

### Recommendation — Phased, Non-Breaking

Keep existing case URL space (`/patients/[caseId]/...`) untouched to avoid breaking deep links and bookmarks. Add a new patient-first browse path alongside.

#### Phase 1 — Rename + dual list (small change, big clarity win)

1. Add new route segment for **patients-as-people**:
   - `/people` (list of patients) and `/people/[patientId]` (patient detail with their cases).
   - Avoid colliding with `/patients/[caseId]`. Alternate name: `/clients` or keep `/patients` for people and migrate case URLs to `/cases/[caseId]` later (Phase 3).
2. Sidebar: split into **Patients** (`/people`) and **Cases** (existing `/patients` list, rename label to "Cases").
3. Top sidebar/header keeps the same shell ([src/app/(dashboard)/layout.tsx](src/app/(dashboard)/layout.tsx)).

#### Phase 2 — Patient list + detail

New server actions in [src/actions/patients.ts](src/actions/patients.ts):
- `listPatients(search?)` — distinct patients with aggregates: case count, latest case status, last activity, open balance sum.
- `getPatientWithCases(patientId)` — patient demographics + array of cases (id, case_number, status, accident_date, totals).

New components:
- `src/components/patients/patients-list-page-client.tsx` — table: name, DOB, # cases, last accident date, total balance, latest status badge. Row click → `/people/[patientId]`.
- `src/components/patients/patient-detail.tsx` — patient header (name, DOB, contact, address — reuse blocks from [case-overview.tsx:225-264](src/components/patients/case-overview.tsx#L225-L264)) + a CasesTable showing each case as a row with status badge and case number. Row click → existing `/patients/[caseId]`.
- Buttons: `Edit Patient` (reuse [edit page](src/app/(dashboard)/patients/[caseId]/page.tsx) demographics form), `New Case for This Patient` (reuse `/patients/new?patientId={id}` flow already wired at [case-overview.tsx:204-211](src/components/patients/case-overview.tsx#L204-L211)).

#### Phase 3 — Case URL migration (optional, breaking)

If team wants clean URLs:
- Move case detail to `/cases/[caseId]/...`.
- Add Next.js redirect from `/patients/[caseId]` → `/cases/[caseId]` to keep old links alive.
- `/patients` becomes patient list (currently lives at `/people` from Phase 1).

#### Phase 4 — Dashboard home

Replace the silent `redirect("/patients")` at [src/app/(dashboard)/page.tsx:4](src/app/(dashboard)/page.tsx#L4) with a real home: KPI cards (active cases, intake queue, pending settlement, total open balance), recent activity feed, quick search across patients & cases.

### Tradeoffs

| Choice | Pro | Con |
|--------|-----|-----|
| New `/people` route, keep `/patients/[caseId]` | Zero breaking change, deploy incrementally | Two segment names mean people for a while ("people" vs "patients") |
| Migrate cases to `/cases/[caseId]` (Phase 3) | Clean semantics, proper REST nesting | Bookmarks break unless redirects added |
| Skip Phase 1 rename, just add patient list at `/patients` and move case list to `/cases` | Cleanest end state | Bigger PR, all internal `Link` refs change at once |

### Minimum viable PR (Phase 1+2 only)

1. New action `listPatients` + `getPatientWithCases`.
2. New routes `src/app/(dashboard)/people/page.tsx` + `src/app/(dashboard)/people/[patientId]/page.tsx`.
3. New components `patients-list-page-client.tsx`, `patient-detail.tsx`, `patient-cases-table.tsx`.
4. Update [app-sidebar.tsx:18-21](src/components/layout/app-sidebar.tsx#L18-L21) nav: add `Patients → /people`, rename existing Patients → "Cases".
5. Update [dashboard/page.tsx:4](src/app/(dashboard)/page.tsx#L4) redirect to `/people`.
6. Add unit tests mirroring [src/actions/__tests__/patients.test.ts](src/actions/__tests__/patients.test.ts).

Estimated touch: ~6 new files, ~3 edits. No DB migration needed.

## Code References

- `src/app/(dashboard)/page.tsx:4` — landing redirect
- `src/app/(dashboard)/layout.tsx:10-18` — dashboard shell
- `src/app/(dashboard)/patients/page.tsx:4-8` — current "patients" list (cases)
- `src/app/(dashboard)/patients/[caseId]/page.tsx:11-41` — case dashboard
- `src/app/(dashboard)/patients/[caseId]/layout.tsx:6-28` — case sidebar wrapper
- `src/components/layout/app-sidebar.tsx:18-21` — nav items
- `src/components/patients/patient-list-page-client.tsx:35-79` — list shell, "Patient Cases" title
- `src/components/patients/patient-list-table.tsx:48-94` — row-per-case columns
- `src/components/patients/case-overview.tsx:204-211` — only patient-scoped link
- `src/components/patients/case-sidebar.tsx:27-36` — case tabs
- `src/actions/patients.ts:36-126` — `createPatientCase` (supports existing-patient mode)
- `src/actions/patients.ts:128-142` — `getPatientForNewCase`
- `src/actions/patients.ts:165-200` — `listPatientCases` (joined query)
- `src/actions/dashboard.ts:14-53` — case-level stats
- `supabase/migrations/001_initial_schema.sql:43-94` — patients & cases tables

## Architecture Notes

- App Router with route groups: `(auth)` and `(dashboard)`.
- All data fetching server-side via `'use server'` actions in [src/actions](src/actions/).
- Supabase client per request via [src/lib/supabase/server.ts](src/lib/supabase/server.ts).
- shadcn/ui sidebar primitive at [src/components/ui/sidebar.tsx](src/components/ui/sidebar.tsx).
- Tanstack Table for lists.
- Soft delete via `deleted_at` on patients, cases, attorneys, documents, procedures.

## Related Research

- [2026-04-23-create-case-for-existing-patient.md](thoughts/shared/research/2026-04-23-create-case-for-existing-patient.md) — existing-patient new-case flow already designed
- [2026-04-25-attorney-selection-dropdown.md](thoughts/shared/research/2026-04-25-attorney-selection-dropdown.md) — recent UI pattern reference

## Open Questions

- Naming: `/people` vs renaming `/patients` to `/patients` (people) and moving cases to `/cases`. User preference?
- Should patient list show financial roll-up (sum of balances across cases) or just last-case status? Roll-up needs an aggregate query — feasible but slower without an index.
- Should archived-only patients be shown by default? Suggest hiding behind a toggle.
- Phase 4 dashboard home: scope creep risk — keep separate from this work.
