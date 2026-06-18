---
date: 2026-06-18
author: arsenaid
git_commit: 17d139e
branch: main
repository: cliniq
topic: "Filter patient cases list by attorney (firm name shown)"
status: implemented
related_research: thoughts/shared/research/2026-06-18-filter-cases-by-law-group.md
tags: [plan, patient-cases, filtering, attorneys]
---

# Plan: Filter Patient Cases by Attorney

## Goal
Add a per-attorney filter to the patient cases list. Dropdown lists distinct
attorneys present in the cases, each labeled `Last, First — Firm`. "Law group"
maps to `attorneys.firm_name` (free-text), shown in the label only; filtering is
by `attorney_id`.

## Background
See research: [2026-06-18-filter-cases-by-law-group.md](../research/2026-06-18-filter-cases-by-law-group.md).
Key constraints found:
- No `law_groups`/`firms` table. Closest concept = `attorneys.firm_name text`.
- A case → one attorney via nullable `cases.attorney_id`.
- Cases list filters fully client-side (`useState`, no URL persistence).
- List loader `listPatientCases` did **not** fetch attorney data — only the
  single-case detail loader joined `attorney:attorneys(*)`.

## Decision
- **Per-attorney filter**, not per-firm-string. `firm_name` is free-text and not
  normalized; filtering by `attorney_id` is exact and unambiguous.
- Firm name displayed in the dropdown label for context.
- Dropdown options derived from attorneys present in the loaded cases (deduped by
  id), so no extra query is needed.

## Changes (all implemented)

### 1. `src/actions/patients.ts` — `listPatientCases`
Add `attorney_id` column + join to the select:
```
attorney:attorneys(id, first_name, last_name, firm_name)
```
Normalize the `attorney` relation from array to single object (Supabase returns
array for FK relations), matching the existing `patient` normalization.

### 2. `src/components/patients/patient-list-page-client.tsx`
- Extend local `PatientCase` type: add `attorney_id` and nested `attorney`.
- `attorneyLabel(a)` helper → `Last, First — Firm` (firm omitted when null).
- Build distinct attorney list from `cases` (Map by id, sorted by label).
- Add `attorneyFilter` state (default `'all'`).
- Combine status + attorney into the `filteredCases` predicate
  (`attorney_id === attorneyFilter`).
- Add "All Attorneys" `<Select>` dropdown mirroring the status filter pattern.

## Behavior notes
- Dropdown shows only attorneys present in current cases (deduped, label-sorted).
- Cases with no attorney are hidden when a specific attorney is selected; visible
  under "All Attorneys".
- Multiple attorneys at the same firm appear as separate rows (filter is by id).

## Verification
- `npx tsc --noEmit` — clean.

## Out of scope
- URL-persisted filter state.
- Server-side filtering / pagination.
- Normalizing firms into a canonical entity.

## Commits
- `fb16a39` feat: add per-attorney filter to patient cases list
- `17d139e` docs: research for filter cases by law group / attorney
