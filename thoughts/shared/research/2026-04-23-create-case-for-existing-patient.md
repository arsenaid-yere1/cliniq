---
date: 2026-04-23T16:36:52-0700
researcher: arsenaid
git_commit: 620f2fb2fd2f4e21e66f1f1484a4385353c8d0d5
branch: main
repository: cliniq
topic: "Logic to create a case for an existing patient"
tags: [research, codebase, cases, patients, patient-wizard, duplicate-detection]
status: complete
last_updated: 2026-04-23
last_updated_by: arsenaid
---

# Research: Logic to create a case for an existing patient

**Date**: 2026-04-23T16:36:52-0700
**Researcher**: arsenaid
**Git Commit**: 620f2fb2fd2f4e21e66f1f1484a4385353c8d0d5
**Branch**: main
**Repository**: cliniq

## Research Question
Check logic to create a case for existing patient.

## Summary

Codebase has **one path** for case creation: the `PatientWizard` at `/patients/new`. That path always inserts a **new patient row** and then a new case row. There is **no code path that reuses an existing `patients.id`** when creating a case. `cases.patient_id` is `NOT NULL` with a foreign key to `patients.id`, but nothing in the UI, server action, or validation schema accepts a pre-existing `patient_id` as input.

A duplicate-detection mechanism exists (`checkDuplicatePatient`) that runs after the identity step (first name + last name + DOB match against existing patients). When a match is found, a dialog displays the matches, but the only action available is **"Create New Anyway"** — the dialog does not offer to attach a new case to the matched existing patient. The duplicate check is advisory only; the wizard proceeds to create a duplicate patient row regardless.

## Detailed Findings

### Entry Point — Page + Wizard

[src/app/(dashboard)/patients/new/page.tsx:1-10](src/app/(dashboard)/patients/new/page.tsx#L1-L10)
- Single page route. Renders `<PatientWizard />`. No variant that accepts a `patientId` query param.

[src/components/patients/patient-wizard.tsx:27-88](src/components/patients/patient-wizard.tsx#L27-L88)
- Three-step form: Identity → Contact & Case Details → Review.
- Uses `react-hook-form` + `zodResolver(createPatientCaseSchema)`.
- Submission calls `createPatientCase(values)` at [patient-wizard.tsx:76](src/components/patients/patient-wizard.tsx#L76).
- On success, redirects to `/patients/${result.data.id}` (the new case's id).

### Server Action — `createPatientCase`

[src/actions/patients.ts:29-101](src/actions/patients.ts#L29-L101)
1. `createPatientCaseSchema.safeParse(data)` validation ([line 30](src/actions/patients.ts#L30)).
2. **Always insert new patient row** ([lines 45-64](src/actions/patients.ts#L45-L64)) — no branch for existing patient.
3. Insert case with `patient_id = patient.id` (the freshly inserted patient), `case_status: 'intake'` ([lines 71-86](src/actions/patients.ts#L71-L86)).
4. Insert initial `case_status_history` row ([lines 93-97](src/actions/patients.ts#L93-L97)).
5. `revalidatePath('/patients')`, return new `caseRecord`.

The action does not accept a `patient_id` parameter; input type is `CreatePatientCaseValues`, which does not have a patient identifier field.

### Validation Schema

[src/lib/validations/patient.ts:3-27](src/lib/validations/patient.ts#L3-L27)
- `patientIdentitySchema` — patient fields (`first_name`, `last_name`, `middle_name`, `date_of_birth`, `gender`).
- `patientDetailsSchema` — contact + case fields (`phone_primary`, `email`, address fields, `accident_date`, `accident_type`, `accident_description`, `attorney_id`, `assigned_provider_id`, `lien_on_file`).
- `createPatientCaseSchema = patientIdentitySchema.merge(patientDetailsSchema)` — **no `patient_id` field**.
- Separate `editPatientSchema` and `editCaseSchema` ([lines 31-53](src/lib/validations/patient.ts#L31-L53)) cover editing existing rows, not creating a case for an existing patient.

### Duplicate Detection (Advisory Only)

[src/actions/patients.ts:7-27](src/actions/patients.ts#L7-L27) — `checkDuplicatePatient(firstName, lastName, dob)`
- Queries `patients` table with case-insensitive name match + exact DOB match + `deleted_at IS NULL`.
- Returns `{ duplicates: [...] }` (id, first_name, last_name, date_of_birth).

[src/components/patients/wizard-step-identity.tsx:46-68](src/components/patients/wizard-step-identity.tsx#L46-L68)
- `onStepComplete()` calls `checkDuplicatePatient` when all three fields filled.
- `handleDobBlur()` triggers the check on DOB blur or calendar select ([lines 61-68](src/components/patients/wizard-step-identity.tsx#L61-L68)).

[src/components/patients/wizard-step-identity.tsx:190-217](src/components/patients/wizard-step-identity.tsx#L190-L217) — Duplicate dialog
- Shows matches with name and DOB.
- Only action: button labeled **"Create New Anyway"** (line 213) that closes the dialog.
- No "Attach new case to this patient" / "Use existing patient" action.

### Review Step

[src/components/patients/wizard-step-review.tsx:34-120](src/components/patients/wizard-step-review.tsx#L34-L120)
- Read-only summary of patient identity, contact, and case details.
- `getAttorney()` loads attorney display name.
- "Edit" buttons jump back to earlier steps via `goToStep()`.
- No special rendering for "existing patient" scenarios.

### Database Schema — Cases Table

[supabase/migrations/001_initial_schema.sql:73-94](supabase/migrations/001_initial_schema.sql#L73-L94)
```sql
create table public.cases (
  id uuid primary key default uuid_generate_v4(),
  case_number text not null unique,
  patient_id uuid not null references public.patients(id),
  attorney_id uuid references public.attorneys(id),
  ...
  case_status text not null default 'intake' check (case_status in ('intake', 'active', 'pending_settlement', 'closed', 'archived')),
  ...
);
```
- `patient_id` NOT NULL, FK → `patients(id)`. Schema allows **multiple cases per patient** (no unique constraint on `patient_id`).
- Index `idx_cases_patient_id` ([line 160](supabase/migrations/001_initial_schema.sql#L160)) supports lookup by patient.

### case_number Auto-Generation

[supabase/migrations/001_initial_schema.sql:68](supabase/migrations/001_initial_schema.sql#L68) — sequence `case_number_seq start 1`.

[supabase/migrations/001_initial_schema.sql:99-110](supabase/migrations/001_initial_schema.sql#L99-L110) — trigger `set_case_number` BEFORE INSERT sets `case_number := 'PI-' || year || '-' || lpad(nextval, 4, '0')`.

Server action comment at [actions/patients.ts:70](src/actions/patients.ts#L70) confirms: `case_number auto-generated by trigger`.

### Status History Bootstrapping

[src/actions/patients.ts:93-97](src/actions/patients.ts#L93-L97) — on case insert, writes one `case_status_history` row with `new_status: 'intake'`, `previous_status: null` (omitted).

[supabase/migrations/001_initial_schema.sql:115-123](supabase/migrations/001_initial_schema.sql#L115-L123) — `case_status_history` table definition (append-only audit).

### URL Parameter Naming

App routes patient-case detail pages under `/patients/[caseId]`, e.g.:
- [src/app/(dashboard)/patients/[caseId]/page.tsx](src/app/(dashboard)/patients/[caseId]/page.tsx)
- [src/app/(dashboard)/patients/[caseId]/initial-visit/page.tsx](src/app/(dashboard)/patients/[caseId]/initial-visit/page.tsx)
- `.../discharge`, `.../procedures`, `.../clinical`, `.../documents`, `.../timeline`, `.../billing`

The route segment is named `caseId` but lives under `/patients/`. Navigation target after successful creation at [patient-wizard.tsx:86](src/components/patients/patient-wizard.tsx#L86) uses the case id (`result.data.id` from `cases` table).

### Tests

[src/actions/__tests__/patients.test.ts:30-60](src/actions/__tests__/patients.test.ts#L30-L60) — `checkDuplicatePatient` suite (empty, matches, DB failure).

[src/actions/__tests__/patients.test.ts:62-120](src/actions/__tests__/patients.test.ts#L62-L120) — `createPatientCase` suite:
- Validation errors on empty required fields
- Happy path: mocks `patients`, `cases`, `case_status_history` inserts in that order
- Error path when `patients` insert fails
- Error path when `cases` insert fails

No test asserts an existing-patient flow or the `checkDuplicatePatient` → `createPatientCase` linkage.

[src/lib/validations/__tests__/patient.test.ts](src/lib/validations/__tests__/patient.test.ts) — schema tests only cover identity, details, merged, edit variants.

### Other Case-Related Files (Not Part of Creation Flow)

- [src/actions/case-status.ts](src/actions/case-status.ts) — post-creation status transitions.
- [src/actions/case-summaries.ts](src/actions/case-summaries.ts) — case summary generation.
- [src/components/patients/case-overview.tsx](src/components/patients/case-overview.tsx), [case-sidebar.tsx](src/components/patients/case-sidebar.tsx), [case-overview-edit-dialog.tsx](src/components/patients/case-overview-edit-dialog.tsx) — case detail views (edit, not create).
- [src/components/cases/case-stat-cards.tsx](src/components/cases/case-stat-cards.tsx), [case-recent-activity.tsx](src/components/cases/case-recent-activity.tsx) — dashboard widgets.
- [src/components/patients/patient-list-page-client.tsx](src/components/patients/patient-list-page-client.tsx), [patient-list-table.tsx](src/components/patients/patient-list-table.tsx) — list view (backed by `listPatientCases`).

## Code References

- `src/actions/patients.ts:7-27` — `checkDuplicatePatient` (advisory lookup)
- `src/actions/patients.ts:29-101` — `createPatientCase` (always inserts new patient + case)
- `src/actions/patients.ts:45-64` — unconditional patient insert
- `src/actions/patients.ts:71-86` — case insert using newly created `patient.id`
- `src/actions/patients.ts:93-97` — `case_status_history` bootstrap
- `src/lib/validations/patient.ts:3-27` — schemas; `createPatientCaseSchema` has no `patient_id`
- `src/components/patients/patient-wizard.tsx:27-88` — wizard orchestration
- `src/components/patients/wizard-step-identity.tsx:46-68` — duplicate check trigger
- `src/components/patients/wizard-step-identity.tsx:190-217` — duplicate dialog ("Create New Anyway" only)
- `src/components/patients/wizard-step-review.tsx:34-120` — review step
- `src/app/(dashboard)/patients/new/page.tsx:1-10` — route renders wizard
- `supabase/migrations/001_initial_schema.sql:73-94` — `cases` table definition
- `supabase/migrations/001_initial_schema.sql:99-110` — `case_number` trigger
- `supabase/migrations/001_initial_schema.sql:115-123` — `case_status_history` table
- `src/actions/__tests__/patients.test.ts:62-120` — `createPatientCase` tests

## Architecture Documentation

**Creation sequence** (single path, always new patient):
```
UI: /patients/new
  → PatientWizard
    → Step 1 Identity (onBlur/onSelect) → checkDuplicatePatient() [advisory dialog]
    → Step 2 Details
    → Step 3 Review → createPatientCase(values)
      → zod validate (createPatientCaseSchema)
      → INSERT patients (new row)
      → INSERT cases (patient_id = new patient.id, case_status = 'intake')
      → INSERT case_status_history (new_status = 'intake')
      → redirect /patients/{case.id}
```

**Schema cardinality**: `cases.patient_id` is a plain FK with no unique constraint, so the data model permits multiple cases per patient. The application layer does not expose this.

**Duplicate detection**: name (ilike) + DOB (eq) + `deleted_at IS NULL` lookup, UI-surface only, no server-side blocking, no "attach to existing" action.

## Related Research

- [thoughts/shared/research/2026-03-05-epic-1-patient-case-management-design.md](thoughts/shared/research/2026-03-05-epic-1-patient-case-management-design.md) — Epic 1 design for patient/case management.

## Open Questions

- None raised by this query; the answer is definitive: no existing-patient path currently exists.
