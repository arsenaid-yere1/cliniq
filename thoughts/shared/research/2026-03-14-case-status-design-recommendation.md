---
date: 2026-03-14T14:00:00-07:00
researcher: Claude
git_commit: 39f19441cdca3933b1abba607bc3cca7d4152c21
branch: main
repository: cliniq
topic: "Case Status — Design and Implementation Recommendation"
tags: [research, codebase, case-status, workflow, state-machine, personal-injury]
status: complete
last_updated: 2026-03-14
last_updated_by: Claude
---

# Research: Case Status — Design and Implementation Recommendation

**Date**: 2026-03-14
**Researcher**: Claude
**Git Commit**: `39f19441cdca3933b1abba607bc3cca7d4152c21`
**Branch**: main
**Repository**: cliniq

## Research Question

Recommend the best design and implementation for case status management in ClinIQ, a personal injury clinic management system.

## Summary

ClinIQ currently has 5 statuses (`intake`, `active`, `pending_settlement`, `closed`, `archived`) defined in the database, but only 3 are actively used in code: `intake` (set on creation), `closed` (via explicit close action), and `active` (via reopen). The statuses `pending_settlement` and `archived` have no transition logic and no UI to set them. The system currently lacks a forward-progression mechanism (intake → active), has no status dropdown or manual status change UI, and all 20+ components only check for `closed` vs. not-closed.

Industry research shows PI case management software (CASEpeer, SmartAdvocate, CloudLex) uses flexible status models with 10-20 sub-statuses, but these are primarily law-firm-side tools. For a **clinic-side** system like ClinIQ — where the focus is treatment, documentation, and billing — a simpler status model is appropriate.

## Current State

### Database Schema

**`cases.case_status`** — text column with CHECK constraint ([001_initial_schema.sql:81](supabase/migrations/001_initial_schema.sql#L81)):
```sql
case_status text not null default 'intake'
  check (case_status in ('intake', 'active', 'pending_settlement', 'closed', 'archived'))
```

**`case_status_history`** — audit table ([001_initial_schema.sql:115-123](supabase/migrations/001_initial_schema.sql#L115-L123)):
- `case_id`, `previous_status`, `new_status`, `changed_at`, `changed_by_user_id`, `notes`

### Active Transitions

Only 3 transitions exist in code ([case-status.ts](src/actions/case-status.ts)):

| From | To | Trigger | Prerequisite |
|---|---|---|---|
| `(new case)` | `intake` | `createPatientCase` in [patients.ts:80](src/actions/patients.ts#L80) | None |
| `any (not closed)` | `closed` | `closeCase` in [case-status.ts:27](src/actions/case-status.ts#L27) | Finalized discharge note |
| `closed` | `active` | `reopenCase` in [case-status.ts:85](src/actions/case-status.ts#L85) | None |

**Missing transitions**: There is no mechanism to move a case from `intake` to `active`, no way to set `pending_settlement`, and no way to set `archived`.

### TypeScript Types

`case_status` is typed as `string` in generated Supabase types ([database.types.ts:322](src/lib/supabase/database.types.ts#L322)). No TypeScript enum or union type exists. Status values are string literals scattered across the codebase.

### UI Components

- **Status badges** with color coding in [patient-list-table.tsx:35-49](src/components/patients/patient-list-table.tsx#L35-L49) and [case-sidebar.tsx:25-39](src/components/patients/case-sidebar.tsx#L25-L39) (duplicated)
- **Close/Reopen buttons** in [case-actions.tsx](src/components/patients/case-actions.tsx)
- **`useCaseStatus()` context** in [case-status-context.tsx](src/components/patients/case-status-context.tsx) consumed by 20+ components — all only check `=== 'closed'`
- **Status label helper** in [timeline.ts:132-141](src/actions/timeline.ts#L132-L141) (third copy of label mapping)
- **No status dropdown or manual status change UI** exists

### Write Guards

`assertCaseNotClosed` in [case-status.ts:8-23](src/actions/case-status.ts#L8-L23) is called in 13 action files (~38 write functions). It only blocks writes when status is `closed`.

---

## Industry Context: PI Clinic vs. Law Firm

Most PI case management software (CASEpeer, SmartAdvocate) is designed for **law firms** and tracks the legal lifecycle:

```
Intake → Pre-Litigation → Treating → Demand → Negotiation → Settlement → Lien Negotiation → Closed
```

ClinIQ is a **clinic-side** system. The clinic's involvement in a PI case is narrower:

```
Intake → Active Treatment → Treatment Complete → Pending Settlement → Settled/Closed
```

The clinic doesn't manage demand letters, litigation, or settlement negotiations — the attorney does. The clinic needs to track:
1. Whether the patient is actively being treated
2. Whether treatment is complete (discharged)
3. Whether the case has settled (for lien/billing resolution)
4. Whether the case is fully closed (all payments received, nothing outstanding)

### Industry Best Practices (Sources)

- **Flexible transitions, not rigid state machines**: CASEpeer, SmartAdvocate, and Smokeball all allow manual status changes without enforcing a strict order. Cases are unpredictable. ([Smokeball](https://www.smokeball.com/blog/making-your-personal-injury-law-firm-workflow-more-efficient))
- **Status + sub-status two-tier model**: CloudLex uses macro-status with sub-statuses. ([CloudLex](https://www.cloudlex.com/applications/matter-management-software/))
- **Audit trails required**: HIPAA mandates tracking who changed what and when. Already implemented via `case_status_history`. ([Compliancy Group](https://compliancy-group.com/hipaa-audit-log-requirements/))
- **Status drives automation**: Status changes trigger task creation, notifications, and downstream workflows. ([CASEpeer](https://www.casepeer.com/blog/personal-injury-workflow/))
- **UI patterns**: Color-coded badges (universal), timeline/activity feeds (per-case), kanban boards (for bulk monitoring). ([Case Status](https://www.casestatus.com/practice-area/personal-injury))

---

## Recommendation

### Proposed Status Model

Keep the existing 5 statuses but redefine their semantics for clinic-side use and add proper transitions:

| Status | Meaning (Clinic-Side) | When Set |
|---|---|---|
| `intake` | New case, initial paperwork/evaluation | Auto on creation |
| `active` | Patient is actively receiving treatment | Manual or auto when first clinical activity occurs |
| `pending_settlement` | Treatment complete (discharged), awaiting settlement/payment | Manual after discharge note finalized |
| `closed` | Case fully resolved — all documentation complete, payment settled | Manual (existing flow, requires finalized discharge) |
| `archived` | Long-term storage — case is old and no longer relevant for daily views | Manual, only from `closed` |

### Proposed Transition Rules

```
intake ──────────→ active
   │                  │
   │                  ↓
   │           pending_settlement
   │                  │
   │                  ↓
   └───────────→  closed  ←── (can also come from intake/active for rejected/withdrawn cases)
                      │
                      ↓
                  archived
```

**Allowed transitions** (flexible, not rigid):

| From | Allowed To |
|---|---|
| `intake` | `active`, `closed` |
| `active` | `pending_settlement`, `closed` |
| `pending_settlement` | `closed`, `active` (if treatment resumes) |
| `closed` | `active` (reopen), `archived` |
| `archived` | `closed` (un-archive) |

**Note**: The `intake → closed` path handles rejected referrals or cases that never begin treatment.

### Prerequisites by Transition

| Transition | Prerequisite |
|---|---|
| `* → pending_settlement` | Finalized discharge note |
| `* → closed` | Finalized discharge note (existing requirement) |
| `* → archived` | Must be `closed` first |
| `closed → active` | None (existing reopen flow) |
| All others | None |

### Write Guard Changes

The current `assertCaseNotClosed` guard should be expanded to also block writes on `archived` cases:

```typescript
if (data?.case_status === 'closed' || data?.case_status === 'archived') {
  return { error: 'This case is closed. No modifications are allowed until it is reopened.' }
}
```

### Implementation Design

#### 1. TypeScript Constants (new file)

Create `src/lib/constants/case-status.ts`:

```typescript
export const CASE_STATUSES = ['intake', 'active', 'pending_settlement', 'closed', 'archived'] as const
export type CaseStatus = (typeof CASE_STATUSES)[number]

export const CASE_STATUS_CONFIG: Record<CaseStatus, {
  label: string
  color: string
  variant: 'default' | 'secondary' | 'outline'
}> = {
  intake:             { label: 'Intake',             color: 'bg-blue-100 text-blue-800 border-blue-200',   variant: 'default' },
  active:             { label: 'Active',             color: 'bg-green-100 text-green-800 border-green-200', variant: 'default' },
  pending_settlement: { label: 'Pending Settlement', color: 'bg-yellow-100 text-yellow-800 border-yellow-200', variant: 'secondary' },
  closed:             { label: 'Closed',             color: 'bg-gray-100 text-gray-800 border-gray-200',   variant: 'secondary' },
  archived:           { label: 'Archived',           color: 'bg-gray-50 text-gray-500 border-gray-200',    variant: 'outline' },
}

// Allowed transitions: from → [allowed to values]
export const CASE_STATUS_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  intake:             ['active', 'closed'],
  active:             ['pending_settlement', 'closed'],
  pending_settlement: ['closed', 'active'],
  closed:             ['active', 'archived'],
  archived:           ['closed'],
}

// Statuses that block all write operations
export const LOCKED_STATUSES: CaseStatus[] = ['closed', 'archived']
```

This eliminates the 3 duplicated status config objects across [patient-list-table.tsx](src/components/patients/patient-list-table.tsx), [case-sidebar.tsx](src/components/patients/case-sidebar.tsx), and [timeline.ts](src/actions/timeline.ts).

#### 2. Server Action: `updateCaseStatus`

Replace the single-purpose `closeCase`/`reopenCase` with a general `updateCaseStatus(caseId, newStatus, notes?)` action:

```typescript
export async function updateCaseStatus(caseId: string, newStatus: CaseStatus, notes?: string) {
  // 1. Auth check
  // 2. Fetch current status
  // 3. Validate transition is allowed (CASE_STATUS_TRANSITIONS[current].includes(newStatus))
  // 4. Check prerequisites (e.g., finalized discharge for → closed)
  // 5. Update cases table (set case_close_date if closing, clear if reopening)
  // 6. Insert case_status_history row (with optional notes)
  // 7. revalidatePath
}
```

Keep `closeCase` and `reopenCase` as thin wrappers for backward compatibility if needed, or migrate callers.

#### 3. UI: Status Change Dropdown

Add a status dropdown to the case sidebar or case overview that shows only valid next statuses based on `CASE_STATUS_TRANSITIONS[currentStatus]`. This replaces the current binary Close/Reopen button pattern.

**Design options** (in order of simplicity):

**Option A — Dropdown in sidebar** (recommended):
- Place below the current status badge in [case-sidebar.tsx](src/components/patients/case-sidebar.tsx)
- Shows as a `<Select>` with only valid transitions as options
- Each option shows the status label with its color badge
- Selecting triggers confirmation dialog → `updateCaseStatus`

**Option B — Status badge is clickable**:
- The status badge itself becomes a popover/dropdown trigger
- Clicking opens a popover with available transitions
- More compact but less discoverable

**Option C — Keep buttons on case overview**:
- Expand the current Close/Reopen pattern to include all transitions
- More explicit but cluttered with 2-3 buttons

#### 4. Auto-Transition: `intake → active`

Consider auto-transitioning from `intake` to `active` when the first clinical activity occurs (document upload, extraction, procedure creation, or clinical note generation). This prevents cases from sitting in `intake` indefinitely when the clinic forgets to manually advance the status.

Implementation: Add a check in relevant server actions — if current status is `intake`, auto-update to `active` and write a history entry with `notes: 'Auto-advanced: first clinical activity'`.

#### 5. Patient List Filtering

Add a status filter dropdown to the patient list page ([patients/page.tsx](src/app/(dashboard)/patients/page.tsx)):
- Filter options: All, Intake, Active, Pending Settlement, Closed, Archived
- Default view: exclude `archived` cases (show Intake + Active + Pending Settlement + Closed)
- Server-side filter via query parameter for efficiency

#### 6. Database Migration

No schema change needed — the CHECK constraint already allows all 5 values. If adding `archived` write blocking, only the server action code needs updating.

---

## Complexity Assessment

| Component | Effort | Notes |
|---|---|---|
| Constants file + type | Small | Replaces 3 duplicated config objects |
| `updateCaseStatus` action | Medium | Replaces `closeCase`/`reopenCase`, adds transition validation |
| Status dropdown UI | Medium | New component in sidebar or overview |
| Auto `intake → active` | Small | One-line check in a few server actions |
| Patient list status filter | Medium | New filter dropdown + server-side query param |
| Update write guard for `archived` | Small | One-line change in `assertCaseNotClosed` |
| Migrate 20+ `isClosed` checks | Small-Medium | Change to `LOCKED_STATUSES.includes(status)` |

**Total estimated scope**: ~1 story worth of work.

---

## Code References

- [supabase/migrations/001_initial_schema.sql:81](supabase/migrations/001_initial_schema.sql#L81) — `case_status` CHECK constraint
- [supabase/migrations/001_initial_schema.sql:115-123](supabase/migrations/001_initial_schema.sql#L115-L123) — `case_status_history` table
- [src/actions/case-status.ts](src/actions/case-status.ts) — `closeCase`, `reopenCase`, `assertCaseNotClosed`
- [src/actions/patients.ts:80](src/actions/patients.ts#L80) — Initial `intake` status set on case creation
- [src/components/patients/case-status-context.tsx](src/components/patients/case-status-context.tsx) — React context
- [src/components/patients/patient-list-table.tsx:35-49](src/components/patients/patient-list-table.tsx#L35-L49) — Status config (1 of 3 copies)
- [src/components/patients/case-sidebar.tsx:25-39](src/components/patients/case-sidebar.tsx#L25-L39) — Status config (2 of 3 copies)
- [src/actions/timeline.ts:132-141](src/actions/timeline.ts#L132-L141) — Status labels (3 of 3 copies)
- [src/components/patients/case-actions.tsx](src/components/patients/case-actions.tsx) — Close/Reopen UI buttons
- [src/lib/supabase/database.types.ts:322](src/lib/supabase/database.types.ts#L322) — Generated type (`string`, not union)

## Historical Context (from thoughts/)

- [thoughts/personal/tickets/epic-5/story-2.md](thoughts/personal/tickets/epic-5/story-2.md) — Close Patient Case user story
- [thoughts/shared/plans/2026-03-12-epic-5-story-5.2-close-patient-case.md](thoughts/shared/plans/2026-03-12-epic-5-story-5.2-close-patient-case.md) — Close case implementation plan (implemented)
- [thoughts/shared/research/2026-03-05-epic-1-patient-case-management-design.md](thoughts/shared/research/2026-03-05-epic-1-patient-case-management-design.md) — Original data model design defining the 5 statuses
- [thoughts/shared/research/2026-03-13-invoice-status-change-design.md](thoughts/shared/research/2026-03-13-invoice-status-change-design.md) — Analogous status transition pattern for invoices

## External Sources

- [CASEpeer - List of Case Statuses](https://casepeer.zendesk.com/hc/en-us/articles/360021640331-List-of-Case-Statuses) — PI-specific status taxonomy (20+ statuses)
- [CASEpeer - PI Case Management Guide](https://www.casepeer.com/blog/personal-injury-case-management-guide-and-checklist/) — Workflow stages
- [SmartAdvocate - Personal Injury](https://www.smartadvocate.com/practice-area/personal-injury) — PI case lifecycle
- [CloudLex - Matter Management](https://www.cloudlex.com/applications/matter-management-software/) — Status + sub-status model
- [Smokeball - PI Firm Workflows](https://www.smokeball.com/blog/making-your-personal-injury-law-firm-workflow-more-efficient) — Flexible vs. rigid transitions
- [Case Status - PI Practice Area](https://www.casestatus.com/practice-area/personal-injury) — Status badges and client-facing status views
- [Martin Fowler - Audit Log Pattern](https://martinfowler.com/eaaDev/AuditLog.html) — Audit trail design
- [Compliancy Group - HIPAA Audit Logs](https://compliancy-group.com/hipaa-audit-log-requirements/) — HIPAA audit requirements
- [OutSystems - Case State Machine](https://success.outsystems.com/documentation/11/building_apps/create_case_management_and_workflow_apps/use_case_management_framework/case_status/defining_allowed_case_status_transitions_with_a_case_state_machine/) — State machine transition design

## Resolved Questions

1. **`intake → active` is automatic.** Auto-transitions on first clinical activity (document upload, extraction, procedure, clinical note). History entry records `notes: 'Auto-advanced: first clinical activity'`.
2. **`pending_settlement` requires a finalized discharge note.** Same prerequisite as `closed` — treatment must be complete before either status.
3. **`archived` cases are hidden from the default patient list.** Default query excludes `archived`. A filter option or toggle can reveal them.

4. **Status change notes are optional.** The `case_status_history.notes` column remains available but is not required. No notes prompt in the UI.
