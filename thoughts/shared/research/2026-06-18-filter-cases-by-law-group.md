---
date: 2026-06-18T15:52:07Z
researcher: arsenaid
git_commit: 063b48df0217b39c4d0a5d28a8a0fa693aa512a8
branch: main
repository: cliniq
topic: "Add filter by law group in patient cases"
tags: [research, codebase, patient-cases, filtering, attorneys, law-group]
status: complete
last_updated: 2026-06-18
last_updated_by: arsenaid
---

# Research: Add filter by law group in patient cases

**Date**: 2026-06-18T15:52:07Z
**Researcher**: arsenaid
**Git Commit**: 063b48df0217b39c4d0a5d28a8a0fa693aa512a8
**Branch**: main
**Repository**: cliniq

## Research Question
Add a filter by "law group" in the patient cases list — document the existing cases-list filtering pipeline and how "law group" is modeled in the codebase.

## Summary

There is **no dedicated "law group" / "law firm" entity** in the codebase. The closest concept is the **`attorneys`** table, where each attorney row carries an optional `firm_name text` column. A case links to exactly one attorney via `cases.attorney_id` (nullable FK). The "law group" is therefore the `firm_name` scalar string on the attorney a case points to — attorneys are not grouped into a separate firm/group table.

The patient cases list filters entirely **client-side** with two `useState` filters (text search + status dropdown). Critically, the list's data loader (`listPatientCases`) does **not** fetch `attorney_id` or any attorney/firm field — the case-row objects flowing into the list have no attorney data at all. Attorney info is only joined in the **single-case detail** loader (`getPatientCase`), not the list.

So a "filter by law group" feature currently has **no data to filter on** in the list pipeline; the relevant join exists only at the case-detail level.

## Detailed Findings

### "Law group" data model — it's `attorneys.firm_name`

- `attorneys` table defined in [supabase/migrations/001_initial_schema.sql:19-38](supabase/migrations/001_initial_schema.sql#L19-L38). `firm_name text` is optional ([:23](supabase/migrations/001_initial_schema.sql#L23)). No separate firms/law_groups table exists; no later migration alters this.
- `cases.attorney_id uuid references public.attorneys(id)` at [supabase/migrations/001_initial_schema.sql:77](supabase/migrations/001_initial_schema.sql#L77), indexed at [:163](supabase/migrations/001_initial_schema.sql#L163).
- TS types: `attorneys` Row with `firm_name: string | null` at [src/types/database.ts:27](src/types/database.ts#L27); `cases.attorney_id: string | null`; FK relationship at [src/types/database.ts:459-462](src/types/database.ts#L459-L462).
- Zod: `firm_name: z.string().optional()` at [src/lib/validations/attorney.ts:6](src/lib/validations/attorney.ts#L6); attorney required on a case at [src/lib/validations/patient.ts:23](src/lib/validations/patient.ts#L23).
- `listAttorneys` searches `first_name`, `last_name`, `firm_name` — [src/actions/attorneys.ts:107](src/actions/attorneys.ts#L107).
- Attorney select dropdown displays `Last, First — FirmName` — [src/components/attorneys/attorney-select.tsx:72-73](src/components/attorneys/attorney-select.tsx#L72-L73).

### Patient cases list pipeline

**Page entry** — [src/app/(dashboard)/patients/page.tsx:1-8](src/app/(dashboard)/patients/page.tsx#L1-L8): server component calls `listPatientCases()` (no args) and passes result as `cases` prop to `PatientListPageClient`. No filter params at this level.

**Data loader** — `listPatientCases(search?)` at [src/actions/patients.ts:259-294](src/actions/patients.ts#L259-L294). Exact select ([:264-271](src/actions/patients.ts#L264-L271)):
```
id,
case_number,
case_status,
accident_date,
created_at,
patient:patients(id, first_name, last_name)
```
Filtered `.is('deleted_at', null)`, ordered `created_at DESC`. **No `attorney_id` column, no `attorney:attorneys(...)` join, no firm field.** Optional `search` param does `ilike` OR over `case_number` + patient names only ([:276-279](src/actions/patients.ts#L276-L279)) — and the page does not pass `search` anyway.

Returned case-row shape (6 fields): `id`, `case_number`, `case_status`, `accident_date`, `created_at`, `patient: {id, first_name, last_name} | null`.

**Filter UI / client** — [src/components/patients/patient-list-page-client.tsx](src/components/patients/patient-list-page-client.tsx):
- Local `PatientCase` type ([:12-23](src/components/patients/patient-list-page-client.tsx#L12-L23)) — same 6 fields, no attorney/firm.
- `globalFilter` state ([:26](src/components/patients/patient-list-page-client.tsx#L26)) — text search.
- `statusFilter` state, default `'all'` ([:27](src/components/patients/patient-list-page-client.tsx#L27)).
- Filter logic ([:29-33](src/components/patients/patient-list-page-client.tsx#L29-L33)): `'all'` → exclude `archived`; else exact `case_status` match.
- Status `<Select>` dropdown ([:49-61](src/components/patients/patient-list-page-client.tsx#L49-L61)) — hardcoded "All Statuses" item ([:54](src/components/patients/patient-list-page-client.tsx#L54)) + entries from `CASE_STATUS_CONFIG`.
- No URL/searchParams persistence — both filters are plain `useState`.

**Table** — [src/components/patients/patient-list-table.tsx](src/components/patients/patient-list-table.tsx): TanStack Table, 5 columns (`case_number`, patient name, `case_status`, `accident_date`, `created_at`) — [:48-94](src/components/patients/patient-list-table.tsx#L48-L94). Global filter via `getFilteredRowModel()` + `state.globalFilter` ([:96-103](src/components/patients/patient-list-table.tsx#L96-L103)). No attorney/firm column. Row click → `/patients/${id}` ([:127](src/components/patients/patient-list-table.tsx#L127)).

**Status constants** (filter option source) — [src/lib/constants/case-status.ts](src/lib/constants/case-status.ts): `CASE_STATUSES` tuple ([:1](src/lib/constants/case-status.ts#L1)), `CASE_STATUS_CONFIG` ([:8-15](src/lib/constants/case-status.ts#L8-L15)).

### Where attorney/firm IS joined (not the list)

- `getPatientCase` (single-case detail) uses `attorney:attorneys(*)` — [src/actions/patients.ts:156-175](src/actions/patients.ts#L156-L175).
- Case overview panel renders attorney name + `firm_name` — [src/components/patients/case-overview.tsx:296-307](src/components/patients/case-overview.tsx#L296-L307).
- Lien + invoice PDFs join `attorney:attorneys(*)` and render `firmName` — [src/actions/lien.ts:40](src/actions/lien.ts#L40), [src/lib/pdf/render-invoice-pdf.ts:43](src/lib/pdf/render-invoice-pdf.ts#L43).

## Code References
- `src/actions/patients.ts:259-294` — `listPatientCases` (list loader; no attorney join)
- `src/actions/patients.ts:156-175` — `getPatientCase` (detail loader; has attorney join)
- `src/components/patients/patient-list-page-client.tsx:26-61` — filter state + status dropdown UI
- `src/components/patients/patient-list-table.tsx:48-103` — columns + TanStack global filter
- `src/lib/constants/case-status.ts` — status filter option source pattern
- `supabase/migrations/001_initial_schema.sql:19-38,77,163` — attorneys table, cases.attorney_id FK + index
- `src/types/database.ts:27,459-462` — attorney firm_name type, cases→attorneys FK
- `src/components/attorneys/attorney-select.tsx:72-73` — `Last, First — FirmName` display pattern
- `src/actions/attorneys.ts:107` — `listAttorneys` firm_name search pattern

## Architecture Documentation
- **Filtering pattern**: cases list fetches the full dataset once server-side, then filters client-side with React `useState` (no URL persistence). Status filter is exact-match against a constants-driven dropdown; text filter uses TanStack's built-in `globalFilter` across visible columns.
- **Law-group model**: flat — one `attorneys` table, `firm_name` is a text column (not normalized into a firm entity). Multiple attorneys may share the same `firm_name` string with no enforced relationship. A case → exactly one attorney (nullable).
- **List vs detail data divergence**: the list loader is deliberately lean (6 fields, one patient join); attorney data is only pulled in detail/PDF loaders.

## Related Research
- `thoughts/shared/research/2026-06-15-create-existing-case-manual-documents.md`
- `thoughts/shared/research/2026-05-20-user-management.md`

## Open Questions
- Whether "law group" should mean `attorney.firm_name` (string grouping) or per-attorney filter — the data model only offers `firm_name` as a grouping key, and many attorneys can share it as a free-text value (no canonical firm list / normalization).
