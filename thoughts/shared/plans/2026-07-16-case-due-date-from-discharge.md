---
date: 2026-07-16
git_commit: d363a6edc970454a90a42932062c03c5259ff3f8
branch: main
repository: cliniq
topic: "Derived due date on patient cases list (discharge visit_date + 7 calendar days)"
tags: [plan, cases, discharge-notes, patient-list, due-date]
status: ready
research: thoughts/shared/research/2026-07-16-case-due-date-from-discharge.md
---

# Case Due Date From Discharge — Implementation Plan

## Overview

Show a **document due date** on the patient cases list. Due date = the case's discharge
`visit_date` + **7 calendar days**. Rendered as a new "Due Date" column with an overdue /
due-soon / on-track status badge. **Fully derived at read time — no schema change, no send
tracking.**

## Current State Analysis

- Cases list is `page.tsx` → `listPatientCases()` → `PatientListPageClient` → `PatientListTable`.
  - `listPatientCases` select today: `id, case_number, case_status, accident_date, created_at,
    attorney_id, patient:patients(...), attorney:attorneys(...)`
    ([patients.ts:262-273](src/actions/patients.ts)).
  - Table columns: Case Number, Patient Name, Status badge, Accident Date, Created
    ([patient-list-table.tsx:48-94](src/components/patients/patient-list-table.tsx)).
- Discharge date source = `discharge_notes.visit_date` (provider-editable)
  ([016_discharge_notes.sql:6](supabase/migrations/016_discharge_notes.sql)). Unique partial index
  guarantees **≤1 active (`deleted_at is null`) discharge note per case** (line 52-53).
- `date-fns ^4.1.0` already a dependency; no day-math used yet in the repo.
- `Badge` accepts `variant` + `className` (color classes), already used for status
  ([patient-list-table.tsx:62-77](src/components/patients/patient-list-table.tsx)).

### Key Discoveries
- **No code embeds `discharge_notes` onto a `cases` query today** — sibling `.from('discharge_notes')
  .eq('case_id').is('deleted_at', null).maybeSingle()` is the norm
  ([case-quality-reviews.ts:92-99](src/actions/case-quality-reviews.ts)). But embedding a one-to-many
  child on a parent list IS an established pattern: `listPatients` embeds `cases(...)` and normalizes
  with `Array.isArray(row.cases) ? row.cases : []`
  ([patients.ts:188-215](src/actions/patients.ts)). This plan follows that embed style.
- Supabase embedded child selects return an **array** and include soft-deleted rows, so filter
  `deleted_at === null` in JS, then take `[0]`.
- Existing discharge-date fallback precedent: `visit_date ?? created_at`
  ([billing.ts:367-372](src/actions/billing.ts)). This plan uses **`visit_date` only** (per decision;
  no due date without a real discharge visit date).
- `listPatientCases` is unit-tested ([patients.test.ts:301-334](src/actions/__tests__/patients.test.ts)) —
  the normalization test asserts `result.data[0].patient` shape; a new field must not break it.

## Desired End State

On `/patients`, each case row shows a "Due Date" column:
- Case **with** an active discharge note that has a `visit_date`: shows `visit_date + 7 days`
  (MM/dd/yyyy) with a badge — **Overdue** (red) if past today, **Due soon** (yellow) if within the
  next 3 days, **On track** (neutral) otherwise.
- Case **without** a discharge visit date: shows `—`, no badge.

Verify: pick a case, set its discharge note `visit_date` to 10 days ago → row shows a date 3 days
ago with a red "Overdue" badge. Set to today → yellow "Due soon" with date 7 days out. Remove the
discharge note → `—`.

## What We're NOT Doing

- No DB migration, no `due_date`/`sent_at` column on any table.
- No "mark as sent" / send-to-lawyer flow, no email/fax.
- No sorting or filtering by due date (display only).
- No due date on the case detail page / sidebar (list only).
- Not using `finalized_at` — anchor is `visit_date`.
- No business-day logic — calendar days only.

## Implementation Approach

Two phases: (1) a pure due-date helper + extend the server action to carry the discharge visit date;
(2) the UI column + badge. Helper is pure/unit-tested so the date logic is verified without the DB.

---

## Phase 1: Due-date helper + server action data

### Overview
Add a pure `computeDocumentDueDate` helper and surface `discharge_visit_date` from
`listPatientCases`.

### Changes Required

#### 1. New pure helper
**File**: `src/lib/cases/document-due-date.ts` (new)
**Changes**: Compute due date + status from a discharge visit date, calendar-days based.

```typescript
import { addDays, differenceInCalendarDays, parseISO } from 'date-fns'

export const DOCUMENT_DUE_OFFSET_DAYS = 7
export const DUE_SOON_WINDOW_DAYS = 3

export type DueStatus = 'overdue' | 'due_soon' | 'on_track'

export interface DocumentDueDate {
  dueDate: Date
  status: DueStatus
  /** Calendar days until due; negative if overdue. */
  daysUntilDue: number
}

/**
 * Document-to-lawyer due date, derived from the discharge visit date.
 * `visitDate` is a 'YYYY-MM-DD' date string (discharge_notes.visit_date) or null.
 * `today` is injectable for testing; defaults to now.
 * Returns null when there is no discharge visit date.
 */
export function computeDocumentDueDate(
  visitDate: string | null | undefined,
  today: Date = new Date(),
): DocumentDueDate | null {
  if (!visitDate) return null
  // Parse as local midnight to match the MM/dd/yyyy rendering used elsewhere.
  const visit = parseISO(`${visitDate}T00:00:00`)
  if (Number.isNaN(visit.getTime())) return null

  const dueDate = addDays(visit, DOCUMENT_DUE_OFFSET_DAYS)
  const daysUntilDue = differenceInCalendarDays(dueDate, today)

  const status: DueStatus =
    daysUntilDue < 0 ? 'overdue' : daysUntilDue <= DUE_SOON_WINDOW_DAYS ? 'due_soon' : 'on_track'

  return { dueDate, status, daysUntilDue }
}

export const DUE_STATUS_CONFIG: Record<DueStatus, { label: string; color: string }> = {
  overdue:  { label: 'Overdue',  color: 'bg-red-100 text-red-800 border-red-200' },
  due_soon: { label: 'Due soon', color: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  on_track: { label: 'On track', color: 'bg-gray-100 text-gray-700 border-gray-200' },
}
```

#### 2. Extend `listPatientCases` select + normalization
**File**: `src/actions/patients.ts` ([patients.ts:262-297](src/actions/patients.ts))
**Changes**: Embed `discharge_notes(visit_date, deleted_at)`, derive a single
`discharge_visit_date` per case (active note only).

```typescript
// in the .select(`...`) template, add the embedded child:
      attorney:attorneys(id, first_name, last_name, firm_name),
      discharge_notes(visit_date, deleted_at)
```

```typescript
  // in the normalize map, after patient/attorney normalization:
  const normalized = (data ?? []).map((row) => {
    const activeDischarge = (Array.isArray(row.discharge_notes) ? row.discharge_notes : [])
      .find((d) => d.deleted_at === null)
    return {
      ...row,
      patient: Array.isArray(row.patient) ? row.patient[0] ?? null : row.patient,
      attorney: Array.isArray(row.attorney) ? row.attorney[0] ?? null : row.attorney,
      discharge_visit_date: activeDischarge?.visit_date ?? null,
      discharge_notes: undefined, // drop raw child array from the returned shape
    }
  })
```

> Note: keep `discharge_notes: undefined` out of the returned object if cleaner — spread then
> `delete`, or omit via destructuring. Goal: returned rows expose `discharge_visit_date`, not the raw array.

### Success Criteria

#### Automated Verification
- [x] New helper unit tests pass: `npm test -- document-due-date`
- [x] Existing action tests still pass: `npm test -- patients`
- [x] Type check clean: `npx tsc --noEmit`
- [x] Lint clean: `npm run lint`

#### Manual Verification
- [ ] `listPatientCases()` result rows include `discharge_visit_date` (null for cases w/o active
      discharge note), verified via a temporary log or the UI in Phase 2.

**Implementation Note**: Add unit tests for `computeDocumentDueDate` covering: null/empty input,
overdue (visit 10d ago), due_soon (visit today), on_track (visit far future), and the
boundary at exactly `daysUntilDue === 3` (due_soon) vs `=== 4` (on_track), using an injected `today`.
Pause for manual confirmation before Phase 2.

---

## Phase 2: Due Date column + badge in the list

### Overview
Render the derived due date and status badge as a new column.

### Changes Required

#### 1. Extend `PatientCase` interfaces
**Files**:
- `src/components/patients/patient-list-table.tsx` ([lines 23-34](src/components/patients/patient-list-table.tsx))
- `src/components/patients/patient-list-page-client.tsx` ([lines 12-30](src/components/patients/patient-list-page-client.tsx))

**Changes**: add `discharge_visit_date: string | null` to both `PatientCase` interfaces.

#### 2. Add the "Due Date" column
**File**: `src/components/patients/patient-list-table.tsx` (columns array, after Accident Date ~line 85)

```typescript
    {
      id: 'due_date',
      header: 'Due Date',
      cell: ({ row }) => {
        const due = computeDocumentDueDate(row.original.discharge_visit_date)
        if (!due) return <span className="text-muted-foreground">—</span>
        const config = DUE_STATUS_CONFIG[due.status]
        return (
          <div className="flex items-center gap-2">
            <span>{format(due.dueDate, 'MM/dd/yyyy')}</span>
            <Badge variant="outline" className={config.color}>{config.label}</Badge>
          </div>
        )
      },
    },
```

Add import at top:
```typescript
import { computeDocumentDueDate, DUE_STATUS_CONFIG } from '@/lib/cases/document-due-date'
```
(`Badge` and `format` are already imported.)

### Success Criteria

#### Automated Verification
- [x] Type check clean: `npx tsc --noEmit`
- [x] Lint clean: `npm run lint`
- [x] Build succeeds: `npm run build`
- [x] Full test suite passes: `npm test`

#### Manual Verification
- [ ] `/patients` shows a "Due Date" column.
- [ ] Case with discharge `visit_date` 10 days ago → date 3 days ago + red **Overdue** badge.
- [ ] Case with discharge `visit_date` today → date +7d + yellow **Due soon** badge.
- [ ] Case with discharge `visit_date` far future → neutral **On track** badge.
- [ ] Case with no active discharge note → `—`, no badge.
- [ ] Existing filters (search/status/attorney) + persistence still work; no layout break.

**Implementation Note**: Pause for manual confirmation after Phase 2.

---

## Testing Strategy

### Unit Tests (`src/lib/cases/__tests__/document-due-date.test.ts`)
- null / undefined / empty `visitDate` → null
- invalid date string → null
- overdue / due_soon / on_track via injected `today`
- boundary: `daysUntilDue === 0` (overdue? no — due today is not past → due_soon), `=== 3` due_soon,
  `=== 4` on_track, `=== -1` overdue

### Existing Tests
- `patients.test.ts` `listPatientCases` block must still pass; add an assertion that
  `discharge_visit_date` is derived from an embedded active `discharge_notes` row and that a
  soft-deleted note (`deleted_at` set) is ignored.

### Manual Testing Steps
1. In DB (or via discharge UI), set a case's discharge note `visit_date` to `today - 10 days`.
2. Load `/patients` → confirm Overdue badge + correct date.
3. Change to today → Due soon. Change to `today + 30` → On track.
4. Soft-delete the discharge note → `—`.

## Performance Considerations
Single added embedded relation on an existing list query — no extra round trip. Due-date math is
pure client-side per row. Negligible.

## Migration Notes
None — no schema change.

## References
- Research: `thoughts/shared/research/2026-07-16-case-due-date-from-discharge.md`
- Discharge date derivation precedent: `src/actions/billing.ts:367-372`
- Embedded child + normalize precedent: `src/actions/patients.ts:188-215` (`listPatients`)
- Active-discharge fetch precedent: `src/actions/case-quality-reviews.ts:92-99`
- List table + status badge: `src/components/patients/patient-list-table.tsx:48-94`
