# Case Status Transitions — Implementation Plan

## Overview

Implement the full case status lifecycle for ClinIQ: transition validation, unified status change action, status dropdown UI, auto `intake→active` advancement, and patient list status filtering. This replaces the current binary close/reopen model with a flexible 5-status system.

## Current State Analysis

**Database**: 5 statuses defined in CHECK constraint (`intake`, `active`, `pending_settlement`, `closed`, `archived`) — [001_initial_schema.sql:81](supabase/migrations/001_initial_schema.sql#L81). Audit table `case_status_history` already exists.

**Code**: Only 3 transitions implemented:
- `new → intake` (case creation)
- `any → closed` (closeCase, requires finalized discharge)
- `closed → active` (reopenCase)

**Problems**:
- No way to reach `active`, `pending_settlement`, or `archived`
- Status config duplicated 3x: [patient-list-table.tsx:35-49](src/components/patients/patient-list-table.tsx#L35-L49), [case-sidebar.tsx:25-39](src/components/patients/case-sidebar.tsx#L25-L39), [timeline.ts:132-141](src/actions/timeline.ts#L132-L141)
- `assertCaseNotClosed` only blocks `closed`, not `archived`
- No status filter on patient list
- `CaseStatus` type is `string` everywhere — no union type

### Key Discoveries:
- `assertCaseNotClosed` is called in 13 action files (~38 call sites) — [case-status.ts:8-23](src/actions/case-status.ts#L8-L23)
- 21 components consume `useCaseStatus()` — all only check `=== 'closed'`
- `case-overview.tsx:71` has a local `isClosed` variable used for UI gating
- No database migration needed — CHECK constraint already allows all 5 values

## Desired End State

- A single source of truth for status config, labels, colors, and transitions in `src/lib/constants/case-status.ts`
- A unified `updateCaseStatus` server action with transition validation and prerequisite checks
- Status dropdown in the case overview area showing only valid next statuses
- `archived` cases blocked from writes (same as `closed`)
- Auto-advancement from `intake → active` on first clinical activity
- Client-side status filter on the patient list page (default: hide `archived`)

## What We're NOT Doing

- No database migration (CHECK constraint already covers all 5 statuses)
- No sub-statuses or two-tier status model
- No kanban/board view for case management
- No status change notifications/emails
- No role-based status change permissions (all authenticated users can change status)
- No required notes on status changes (notes field remains optional)

## Implementation Approach

Five phases, each independently testable. Phases 1-2 are backend/shared, phases 3-5 are UI.

---

## Phase 1: Constants & Type Foundation

### Overview
Create a single source of truth for case status configuration and replace all 3 duplicated configs.

### Changes Required:

#### 1. Create constants file
**File**: `src/lib/constants/case-status.ts` (new)

```typescript
export const CASE_STATUSES = ['intake', 'active', 'pending_settlement', 'closed', 'archived'] as const
export type CaseStatus = (typeof CASE_STATUSES)[number]

export const CASE_STATUS_CONFIG: Record<CaseStatus, {
  label: string
  color: string
  variant: 'default' | 'secondary' | 'outline'
}> = {
  intake:             { label: 'Intake',             color: 'bg-blue-100 text-blue-800 border-blue-200',     variant: 'default' },
  active:             { label: 'Active',             color: 'bg-green-100 text-green-800 border-green-200',  variant: 'default' },
  pending_settlement: { label: 'Pending Settlement', color: 'bg-yellow-100 text-yellow-800 border-yellow-200', variant: 'secondary' },
  closed:             { label: 'Closed',             color: 'bg-gray-100 text-gray-800 border-gray-200',     variant: 'secondary' },
  archived:           { label: 'Archived',           color: 'bg-gray-50 text-gray-500 border-gray-200',      variant: 'outline' },
}

export const CASE_STATUS_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  intake:             ['active', 'closed'],
  active:             ['pending_settlement', 'closed'],
  pending_settlement: ['closed', 'active'],
  closed:             ['active', 'archived'],
  archived:           ['closed'],
}

export const LOCKED_STATUSES: CaseStatus[] = ['closed', 'archived']
```

#### 2. Replace duplicated config in patient-list-table.tsx
**File**: `src/components/patients/patient-list-table.tsx`
**Changes**: Remove `statusConfig` (lines 35-41) and `statusColors` (lines 43-49). Import from constants. Update the badge rendering in the status column to use `CASE_STATUS_CONFIG`.

Replace:
```typescript
const statusConfig: Record<string, { label: string; variant: ... }> = { ... }
const statusColors: Record<string, string> = { ... }
```
With:
```typescript
import { CASE_STATUS_CONFIG, type CaseStatus } from '@/lib/constants/case-status'
```

Update the badge cell renderer to:
```typescript
const status = row.getValue('case_status') as string
const config = CASE_STATUS_CONFIG[status as CaseStatus]
return (
  <Badge variant={config?.variant ?? 'secondary'} className={config?.color ?? ''}>
    {config?.label ?? status}
  </Badge>
)
```

#### 3. Replace duplicated config in case-sidebar.tsx
**File**: `src/components/patients/case-sidebar.tsx`
**Changes**: Remove `statusColors` (lines 25-31) and `statusLabels` (lines 33-39). Import from constants.

Replace:
```typescript
const statusColors: Record<string, string> = { ... }
const statusLabels: Record<string, string> = { ... }
```
With:
```typescript
import { CASE_STATUS_CONFIG, type CaseStatus } from '@/lib/constants/case-status'
```

Update the badge at line 94-96:
```typescript
const config = CASE_STATUS_CONFIG[caseData.case_status as CaseStatus]
<Badge className={config?.color ?? ''}>
  {config?.label ?? caseData.case_status}
</Badge>
```

#### 4. Replace duplicated config in timeline.ts
**File**: `src/actions/timeline.ts`
**Changes**: Replace `formatStatus` function (lines 132-141) with import.

Replace:
```typescript
function formatStatus(status: string): string {
  const labels: Record<string, string> = { ... }
  return labels[status] ?? status
}
```
With:
```typescript
import { CASE_STATUS_CONFIG, type CaseStatus } from '@/lib/constants/case-status'

function formatStatus(status: string): string {
  return CASE_STATUS_CONFIG[status as CaseStatus]?.label ?? status
}
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `npx tsc --noEmit`
- [x] Lint passes: `npm run lint` (1 pre-existing error, 9 pre-existing warnings — none from our changes)
- [x] App builds: `npm run build`

#### Manual Verification:
- [ ] Patient list table shows correct status badges with colors
- [ ] Case sidebar shows correct status badge
- [ ] Timeline shows correct status labels for status change events

---

## Phase 2: Unified `updateCaseStatus` Server Action

### Overview
Replace `closeCase` and `reopenCase` with a general `updateCaseStatus` action that validates transitions and checks prerequisites. Update `assertCaseNotClosed` to also block `archived`.

### Changes Required:

#### 1. Rewrite case-status.ts
**File**: `src/actions/case-status.ts`

**Update `assertCaseNotClosed`** (lines 8-23): Block both `closed` and `archived`.

```typescript
import { LOCKED_STATUSES, CASE_STATUS_TRANSITIONS, CASE_STATUS_CONFIG, type CaseStatus } from '@/lib/constants/case-status'

export async function assertCaseNotClosed(
  supabase: Awaited<ReturnType<typeof createClient>>,
  caseId: string,
): Promise<{ error: string | null }> {
  const { data } = await supabase
    .from('cases')
    .select('case_status')
    .eq('id', caseId)
    .is('deleted_at', null)
    .single()

  if (data?.case_status && LOCKED_STATUSES.includes(data.case_status as CaseStatus)) {
    return { error: 'This case is closed. No modifications are allowed until it is reopened.' }
  }
  return { error: null }
}
```

**Add `updateCaseStatus`**:

```typescript
export async function updateCaseStatus(caseId: string, newStatus: CaseStatus, notes?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Fetch current status
  const { data: caseData } = await supabase
    .from('cases')
    .select('case_status')
    .eq('id', caseId)
    .is('deleted_at', null)
    .single()

  if (!caseData) return { error: 'Case not found' }

  const currentStatus = caseData.case_status as CaseStatus

  if (currentStatus === newStatus) {
    return { error: `Case is already ${CASE_STATUS_CONFIG[newStatus].label}` }
  }

  // Validate transition
  const allowed = CASE_STATUS_TRANSITIONS[currentStatus]
  if (!allowed?.includes(newStatus)) {
    return { error: `Cannot change status from ${CASE_STATUS_CONFIG[currentStatus].label} to ${CASE_STATUS_CONFIG[newStatus].label}` }
  }

  // Prerequisites: finalized discharge required for pending_settlement and closed
  if (newStatus === 'pending_settlement' || newStatus === 'closed') {
    const { data: dischargeNote } = await supabase
      .from('discharge_notes')
      .select('id')
      .eq('case_id', caseId)
      .eq('status', 'finalized')
      .is('deleted_at', null)
      .maybeSingle()

    if (!dischargeNote) {
      return { error: 'A finalized discharge summary is required before changing to this status.' }
    }
  }

  // Build update payload
  const updatePayload: Record<string, unknown> = {
    case_status: newStatus,
    updated_by_user_id: user.id,
  }

  // Set/clear case_close_date based on target status
  if (newStatus === 'closed' || newStatus === 'archived') {
    updatePayload.case_close_date = new Date().toISOString().split('T')[0]
  } else {
    updatePayload.case_close_date = null
  }

  const { error: updateError } = await supabase
    .from('cases')
    .update(updatePayload)
    .eq('id', caseId)

  if (updateError) return { error: 'Failed to update case status' }

  // Insert history
  await supabase.from('case_status_history').insert({
    case_id: caseId,
    previous_status: currentStatus,
    new_status: newStatus,
    changed_by_user_id: user.id,
    notes: notes ?? null,
  })

  revalidatePath(`/patients/${caseId}`)
  revalidatePath('/patients')
  return { data: { success: true } }
}
```

**Keep `closeCase` and `reopenCase` as thin wrappers** (to avoid changing all existing callers at once):

```typescript
export async function closeCase(caseId: string) {
  return updateCaseStatus(caseId, 'closed')
}

export async function reopenCase(caseId: string) {
  return updateCaseStatus(caseId, 'active')
}
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles: `npx tsc --noEmit`
- [ ] App builds: `npm run build`

#### Manual Verification:
- [ ] Closing a case still works via existing UI (uses thin wrapper)
- [ ] Reopening a case still works
- [ ] Closing without a finalized discharge note shows error
- [ ] Timeline shows status change entries

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Status Change UI

### Overview
Replace the binary Close/Reopen buttons in case-overview with a status dropdown showing only valid next statuses. Update the locked-case banner to cover `archived` too.

### Changes Required:

#### 1. Create StatusChangeDropdown component
**File**: `src/components/patients/status-change-dropdown.tsx` (new)

A client component that:
- Receives `caseId: string` and `currentStatus: CaseStatus`
- Computes available transitions from `CASE_STATUS_TRANSITIONS[currentStatus]`
- Renders a `<Select>` (or `DropdownMenu`) with each valid next status as an option, showing status label + color badge
- On selection, shows a confirmation `AlertDialog` ("Change status from X to Y?")
- On confirm, calls `updateCaseStatus(caseId, newStatus)`
- Shows toast on success/error
- Uses `useTransition` for pending state

```typescript
'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useState } from 'react'
import { updateCaseStatus } from '@/actions/case-status'
import { CASE_STATUS_CONFIG, CASE_STATUS_TRANSITIONS, type CaseStatus } from '@/lib/constants/case-status'

interface StatusChangeDropdownProps {
  caseId: string
  currentStatus: CaseStatus
}

export function StatusChangeDropdown({ caseId, currentStatus }: StatusChangeDropdownProps) {
  const [isPending, startTransition] = useTransition()
  const [confirmStatus, setConfirmStatus] = useState<CaseStatus | null>(null)

  const allowedTransitions = CASE_STATUS_TRANSITIONS[currentStatus] ?? []
  if (allowedTransitions.length === 0) return null

  const currentConfig = CASE_STATUS_CONFIG[currentStatus]

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" disabled={isPending}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Change Status
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {allowedTransitions.map((status) => {
            const config = CASE_STATUS_CONFIG[status]
            return (
              <DropdownMenuItem key={status} onClick={() => setConfirmStatus(status)}>
                <Badge variant={config.variant} className={`${config.color} mr-2`}>
                  {config.label}
                </Badge>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={!!confirmStatus} onOpenChange={(open) => !open && setConfirmStatus(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change Case Status</AlertDialogTitle>
            <AlertDialogDescription>
              Change status from {currentConfig.label} to {confirmStatus ? CASE_STATUS_CONFIG[confirmStatus].label : ''}?
              {(confirmStatus === 'closed' || confirmStatus === 'archived') &&
                ' This will prevent further modifications to the case.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirmStatus) return
                const target = confirmStatus
                setConfirmStatus(null)
                startTransition(async () => {
                  const result = await updateCaseStatus(caseId, target)
                  if (result.error) toast.error(result.error)
                  else toast.success(`Status changed to ${CASE_STATUS_CONFIG[target].label}`)
                })
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
```

#### 2. Update case-overview.tsx
**File**: `src/components/patients/case-overview.tsx`

**Replace** `CaseActions` import and usage with `StatusChangeDropdown`:

```typescript
import { StatusChangeDropdown } from '@/components/patients/status-change-dropdown'
import { LOCKED_STATUSES, type CaseStatus } from '@/lib/constants/case-status'
```

**Update** the `isClosed` variable at line 71:
```typescript
const isLocked = LOCKED_STATUSES.includes(caseData.case_status as CaseStatus)
```

**Replace all `isClosed` references** in the component with `isLocked`.

**Update** the locked-case banner text (line 87-90):
```typescript
{isLocked && (
  <div className="flex items-center gap-2 p-3 mb-4 bg-muted border rounded-lg text-sm text-muted-foreground">
    <Lock className="h-4 w-4 shrink-0" />
    This case is {caseData.case_status === 'archived' ? 'archived' : 'closed'}. No modifications are allowed until it is reopened.
  </div>
)}
```

**Replace** the `<CaseActions>` component at line 108 with:
```typescript
<StatusChangeDropdown caseId={caseData.id} currentStatus={caseData.case_status as CaseStatus} />
```

#### 3. Delete case-actions.tsx
**File**: `src/components/patients/case-actions.tsx`
**Changes**: Delete this file — its functionality is fully replaced by `StatusChangeDropdown`. The `closeCase`/`reopenCase` thin wrappers remain in `case-status.ts` but are no longer called from the UI.

#### 4. Update useCaseStatus consumers
**File**: All 21 components that consume `useCaseStatus()`

Each of these components currently does:
```typescript
const caseStatus = useCaseStatus()
// ... later ...
if (caseStatus === 'closed') { /* disable something */ }
```

Update to:
```typescript
import { LOCKED_STATUSES, type CaseStatus } from '@/lib/constants/case-status'

const caseStatus = useCaseStatus()
const isLocked = LOCKED_STATUSES.includes(caseStatus as CaseStatus)
// ... later ...
if (isLocked) { /* disable something */ }
```

The 21 files to update:
- `src/components/documents/document-list.tsx`
- `src/components/clinical/case-summary-card.tsx`
- `src/components/clinical/initial-visit-editor.tsx`
- `src/components/procedures/procedure-note-editor.tsx`
- `src/components/procedures/procedure-table.tsx`
- `src/components/discharge/discharge-note-editor.tsx`
- `src/components/clinical/ct-scan-extraction-form.tsx`
- `src/components/clinical/ct-scan-extraction-review.tsx`
- `src/components/clinical/ortho-extraction-form.tsx`
- `src/components/clinical/ortho-extraction-review.tsx`
- `src/components/clinical/pt-extraction-form.tsx`
- `src/components/clinical/pt-extraction-review.tsx`
- `src/components/clinical/pm-extraction-form.tsx`
- `src/components/clinical/pm-extraction-review.tsx`
- `src/components/clinical/mri-extraction-form.tsx`
- `src/components/clinical/mri-extraction-review.tsx`
- `src/components/clinical/chiro-extraction-form.tsx`
- `src/components/clinical/chiro-extraction-review.tsx`

**Note**: Each file's exact check pattern may vary slightly (some use `=== 'closed'` directly, some store it in a variable). Read each file before editing to confirm the pattern.

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles: `npx tsc --noEmit`
- [ ] No unused imports/variables: `npm run lint`
- [ ] App builds: `npm run build`

#### Manual Verification:
- [ ] Case overview shows "Change Status" dropdown button
- [ ] Dropdown shows only valid transitions (e.g., intake shows Active and Closed)
- [ ] Clicking a transition shows confirmation dialog
- [ ] Confirming changes the status and shows success toast
- [ ] Invalid transitions (e.g., closing without discharge) show error toast
- [ ] Closed/archived cases show locked banner and disable quick actions + edit
- [ ] All extraction forms, editors, and tables properly disable on closed AND archived cases

**Implementation Note**: After completing this phase, pause for manual confirmation before proceeding to Phase 4.

---

## Phase 4: Auto `intake → active` Transition

### Overview
Automatically advance cases from `intake` to `active` when the first clinical activity occurs (document upload, extraction save, procedure creation, or clinical note generation).

### Changes Required:

#### 1. Add helper function to case-status.ts
**File**: `src/actions/case-status.ts`

Add a non-exported helper that can be called from other server actions:

```typescript
export async function autoAdvanceFromIntake(
  supabase: Awaited<ReturnType<typeof createClient>>,
  caseId: string,
  userId: string,
) {
  const { data } = await supabase
    .from('cases')
    .select('case_status')
    .eq('id', caseId)
    .is('deleted_at', null)
    .single()

  if (data?.case_status !== 'intake') return

  await supabase
    .from('cases')
    .update({ case_status: 'active', updated_by_user_id: userId })
    .eq('id', caseId)

  await supabase.from('case_status_history').insert({
    case_id: caseId,
    previous_status: 'intake',
    new_status: 'active',
    changed_by_user_id: userId,
    notes: 'Auto-advanced: first clinical activity',
  })
}
```

#### 2. Call from key write actions

Add `autoAdvanceFromIntake` call after the `assertCaseNotClosed` guard succeeds in these action files (one call per file, at the first write function):

- `src/actions/documents.ts` — after successful document upload
- `src/actions/procedures.ts` — after creating a procedure
- `src/actions/initial-visit-notes.ts` — after creating an initial visit note
- `src/actions/procedure-notes.ts` — after creating a procedure note
- `src/actions/discharge-notes.ts` — after creating a discharge note

Pattern in each file:
```typescript
import { assertCaseNotClosed, autoAdvanceFromIntake } from '@/actions/case-status'

// ... inside the create function, after assertCaseNotClosed passes:
await autoAdvanceFromIntake(supabase, caseId, user.id)
```

**Note**: We intentionally do NOT call this from extraction actions (mri, chiro, ortho, pt, pm, ct-scan) because extractions are triggered by document upload, which already handles the auto-advance. This avoids redundant DB calls.

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles: `npx tsc --noEmit`
- [ ] App builds: `npm run build`

#### Manual Verification:
- [ ] Create a new case (status = intake)
- [ ] Upload a document → status auto-changes to active
- [ ] Timeline shows "Auto-advanced: first clinical activity" entry
- [ ] Creating a procedure on an intake case also triggers auto-advance
- [ ] Second clinical activity on an already-active case does NOT create duplicate history entries

**Implementation Note**: After completing this phase, pause for manual confirmation before proceeding to Phase 5.

---

## Phase 5: Patient List Status Filter

### Overview
Add a client-side status filter dropdown to the patient list page. Default view excludes `archived` cases.

### Changes Required:

#### 1. Update patient-list-page-client.tsx
**File**: `src/components/patients/patient-list-page-client.tsx`

Add a status filter `Select` next to the search input:

```typescript
import { CASE_STATUS_CONFIG, type CaseStatus } from '@/lib/constants/case-status'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function PatientListPageClient({ cases }: { cases: PatientCase[] }) {
  const [globalFilter, setGlobalFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all_active')

  const filteredCases = cases.filter((c) => {
    if (statusFilter === 'all') return true
    if (statusFilter === 'all_active') return c.case_status !== 'archived'
    return c.case_status === statusFilter
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Patient Cases</h1>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Input
            placeholder="Search by name or case number..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="max-w-sm"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all_active">All Active</SelectItem>
              <SelectItem value="all">All Statuses</SelectItem>
              {(Object.entries(CASE_STATUS_CONFIG) as [CaseStatus, typeof CASE_STATUS_CONFIG[CaseStatus]][]).map(
                ([key, config]) => (
                  <SelectItem key={key} value={key}>{config.label}</SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        </div>
        <Button asChild>
          <Link href="/patients/new">
            <Plus className="h-4 w-4 mr-2" />
            New Patient Case
          </Link>
        </Button>
      </div>

      <PatientListTable
        cases={filteredCases}
        globalFilter={globalFilter}
        onGlobalFilterChange={setGlobalFilter}
      />
    </div>
  )
}
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles: `npx tsc --noEmit`
- [ ] App builds: `npm run build`

#### Manual Verification:
- [ ] Patient list shows filter dropdown defaulting to "All Active"
- [ ] "All Active" hides archived cases
- [ ] "All Statuses" shows everything including archived
- [ ] Individual status filters (Intake, Active, etc.) work correctly
- [ ] Search and status filter work together

---

## Testing Strategy

### Manual Testing Steps:
1. Create a new case → verify status is `intake`
2. Upload a document → verify auto-advance to `active`
3. Use dropdown to change to `pending_settlement` → verify error (no discharge note)
4. Create and finalize a discharge note
5. Change to `pending_settlement` → verify success
6. Change to `closed` → verify success, case_close_date set
7. Change to `archived` → verify success
8. Verify archived case is hidden from default patient list view
9. Change filter to "All Statuses" → archived case appears
10. Un-archive (archived → closed) → verify success
11. Reopen (closed → active) → verify success, case_close_date cleared
12. Verify timeline shows all status changes with correct labels

### Edge Cases:
- Attempting `intake → pending_settlement` (invalid transition) → shows error
- Attempting `active → archived` (invalid transition) → shows error
- Closing a case that's already closed → shows "already closed" error
- Multiple rapid status changes → no race conditions (server-side validation)

## Performance Considerations

- Auto-advance adds one SELECT + conditional UPDATE per write action on intake cases. This is negligible since intake cases transition quickly and the check is a single-row lookup by primary key.
- Client-side filtering is appropriate since the patient list is already fully loaded. If the list grows beyond ~1000 cases, consider server-side filtering via query parameter.

## References

- Research document: [thoughts/shared/research/2026-03-14-case-status-design-recommendation.md](thoughts/shared/research/2026-03-14-case-status-design-recommendation.md)
- Close case plan (implemented): [thoughts/shared/plans/2026-03-12-epic-5-story-5.2-close-patient-case.md](thoughts/shared/plans/2026-03-12-epic-5-story-5.2-close-patient-case.md)
- Invoice status change pattern: [thoughts/shared/plans/2026-03-13-invoice-status-changes.md](thoughts/shared/plans/2026-03-13-invoice-status-changes.md)
- Database schema: [supabase/migrations/001_initial_schema.sql](supabase/migrations/001_initial_schema.sql)
