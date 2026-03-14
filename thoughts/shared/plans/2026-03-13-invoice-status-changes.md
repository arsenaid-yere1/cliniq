# Invoice Status Changes Implementation Plan

## Overview

Upgrade invoice status management from a simple DB column with no guards to a full lifecycle system with transition validation, audit history, immutability enforcement, and case-closed guards — following the established `case_status_history` pattern.

## Current State Analysis

- 6 statuses in DB CHECK constraint: `draft`, `pending`, `paid`, `partial`, `denied`, `overdue`
- No `invoice_status_history` table
- No transition validation — status can be set to anything via `updateInvoice`
- No `assertCaseNotClosed` guard on any billing action
- Status labels/colors duplicated in 3 places:
  - [billing-table.tsx:35-51](src/components/billing/billing-table.tsx#L35-L51)
  - [invoice-detail-client.tsx:146-150](src/components/billing/invoice-detail-client.tsx#L146-L150)
  - [timeline.ts:122-132](src/actions/timeline.ts#L122-L132)
- Line items can be edited regardless of invoice status
- `deleteInvoice` has no auth check or status guard

## Desired End State

Invoices have a 6-status lifecycle (`draft`, `issued`, `paid`, `void`, `overdue`, `uncollectible`) with:
- Every status change recorded in `invoice_status_history` (HIPAA audit trail)
- Transition validation enforcing allowed paths
- Immutability after `draft → issued` (line items and invoice fields locked)
- `assertCaseNotClosed` guard on all mutating billing actions
- Centralized status constants (labels, colors, transitions) in one file
- Named server actions for each transition with precondition checks
- UI controls to trigger status changes from the invoice detail page

### Verification

- Migration applies cleanly
- All existing `draft` invoices remain `draft`; existing `pending` invoices become `issued`; `partial` invoices become `paid`; `denied` invoices become `void`
- Status transitions only succeed on allowed paths
- `updateInvoice` and `deleteInvoice` reject non-draft invoices
- History rows are inserted on every status change
- `assertCaseNotClosed` blocks billing writes on closed cases
- Status labels/colors render correctly in billing table, detail page, and timeline

## What We're NOT Doing

- PI-specific lien statuses (`pending_settlement`, `submitted_to_attorney`, etc.) — deferred to future epic
- Automated `overdue` detection via cron — manual only for now
- Payment tracking system (amounts, payment methods, payment records)
- Insurance claims or EDI integration
- Invoice status React context (unlike cases, invoices don't need a layout-level provider since status changes happen on the detail page, not across sibling routes)

## Implementation Approach

Follow the case status pattern in [case-status.ts](src/actions/case-status.ts) with named transition functions, history logging, and guards. Centralize status constants to eliminate duplication. Enforce immutability at the server action level by rejecting edits/deletes on non-draft invoices.

---

## Phase 1: Database Migration

### Overview
Create the `invoice_status_history` table and update the invoice status CHECK constraint to the new set of values, migrating existing data.

### Changes Required:

#### 1. New migration file
**File**: `supabase/migrations/020_invoice_status_changes.sql`

```sql
-- ============================================================
-- 020_invoice_status_changes.sql
-- Invoice status lifecycle: history table + status value updates
-- ============================================================

-- 1. Create invoice_status_history table (follows case_status_history pattern)
create table public.invoice_status_history (
  id uuid primary key default uuid_generate_v4(),
  invoice_id uuid not null references public.invoices(id),
  previous_status text,
  new_status text not null,
  changed_at timestamptz not null default now(),
  changed_by_user_id uuid references public.users(id),
  reason text,
  metadata jsonb
);

-- Indexes
create index idx_invoice_status_history_invoice on public.invoice_status_history(invoice_id);
create index idx_invoice_status_history_changed_at on public.invoice_status_history(changed_at);

-- RLS: same pattern as case_status_history
alter table public.invoice_status_history enable row level security;

create policy "Users can view invoice status history"
  on public.invoice_status_history for select
  using (auth.role() = 'authenticated');

create policy "Users can insert invoice status history"
  on public.invoice_status_history for insert
  with check (auth.role() = 'authenticated');

-- Append-only: no update or delete policies (HIPAA audit requirement)

-- 2. Migrate existing status values to new set
-- pending → issued (renamed)
update public.invoices set status = 'issued' where status = 'pending';
-- partial → paid (no partial status; treat as paid)
update public.invoices set status = 'paid' where status = 'partial';
-- denied → void (denied removed from MVP)
update public.invoices set status = 'void' where status = 'denied';

-- 3. Replace CHECK constraint with new status values
alter table public.invoices drop constraint invoices_status_check;
alter table public.invoices add constraint invoices_status_check
  check (status in ('draft', 'issued', 'paid', 'void', 'overdue', 'uncollectible'));

-- 4. Seed history for all existing non-draft invoices (audit backfill)
-- This creates a single "initial" history entry so the audit trail has a starting point
insert into public.invoice_status_history (invoice_id, previous_status, new_status, reason)
select id, null, status, 'Backfill: status at time of migration 020'
from public.invoices
where status != 'draft' and deleted_at is null;
```

### Success Criteria:

#### Automated Verification:
- [ ] Migration applies cleanly against current DB
- [ ] `SELECT DISTINCT status FROM invoices` returns only values from new set
- [ ] `invoice_status_history` table exists with correct columns
- [ ] RLS policies exist (select + insert only, no update/delete)
- [ ] History rows exist for all non-draft invoices

#### Manual Verification:
- [ ] Existing invoices retain correct data after status migration
- [ ] No orphaned or corrupted records

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Shared Constants & Types

### Overview
Centralize invoice status labels, colors, and transition rules into a single source of truth, eliminating the 3-way duplication.

### Changes Required:

#### 1. New constants file
**File**: `src/lib/constants/invoice-status.ts`

```typescript
// Canonical invoice status definitions
// All UI and server code should import from here

export const INVOICE_STATUSES = ['draft', 'issued', 'paid', 'void', 'overdue', 'uncollectible'] as const
export type InvoiceStatus = typeof INVOICE_STATUSES[number]

export const TERMINAL_STATUSES: InvoiceStatus[] = ['paid', 'void', 'uncollectible']

export const ALLOWED_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ['issued', 'void'],
  issued: ['paid', 'overdue', 'void'],
  overdue: ['paid', 'uncollectible'],
  paid: [],
  void: [],
  uncollectible: [],
}

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  issued: 'Issued',
  paid: 'Paid',
  void: 'Void',
  overdue: 'Overdue',
  uncollectible: 'Uncollectible',
}

export const INVOICE_STATUS_COLORS: Record<InvoiceStatus, string> = {
  draft: 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
  issued: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
  paid: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800',
  void: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
  overdue: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
  uncollectible: 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800',
}

export function isTerminalStatus(status: InvoiceStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

export function canTransitionTo(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}
```

#### 2. Update billing-table.tsx
**File**: `src/components/billing/billing-table.tsx`

Remove the local `invoiceStatusColors` (lines 35-42) and `invoiceStatusLabels` (lines 44-51) maps. Import from `@/lib/constants/invoice-status` instead:

```typescript
import { INVOICE_STATUS_COLORS, INVOICE_STATUS_LABELS, type InvoiceStatus } from '@/lib/constants/invoice-status'
```

Update the Badge rendering at line 101-102 to use the imported constants:
```typescript
<Badge variant="outline" className={INVOICE_STATUS_COLORS[status as InvoiceStatus] ?? ''}>
  {INVOICE_STATUS_LABELS[status as InvoiceStatus] ?? status}
</Badge>
```

#### 3. Update invoice-detail-client.tsx
**File**: `src/components/billing/invoice-detail-client.tsx`

Remove the local `statusColors` map (lines 146-150). Import from `@/lib/constants/invoice-status`:

```typescript
import { INVOICE_STATUS_COLORS, INVOICE_STATUS_LABELS, type InvoiceStatus } from '@/lib/constants/invoice-status'
```

Update the Badge at lines 282-284:
```typescript
<Badge variant="outline" className={INVOICE_STATUS_COLORS[invoice.status as InvoiceStatus] ?? ''}>
  {INVOICE_STATUS_LABELS[invoice.status as InvoiceStatus] ?? invoice.status}
</Badge>
```

#### 4. Update timeline.ts
**File**: `src/actions/timeline.ts`

Remove the `formatInvoiceStatus` function (lines 122-132). Import from `@/lib/constants/invoice-status`:

```typescript
import { INVOICE_STATUS_LABELS, type InvoiceStatus } from '@/lib/constants/invoice-status'
```

Update line 91 to use the imported map:
```typescript
description: `$${Number(i.total_amount).toFixed(2)} - ${INVOICE_STATUS_LABELS[i.status as InvoiceStatus] ?? i.status}`,
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles with no errors: `npm run typecheck`
- [ ] No remaining references to `invoiceStatusColors`, `invoiceStatusLabels`, or `formatInvoiceStatus` in the codebase
- [ ] `INVOICE_STATUS_COLORS` and `INVOICE_STATUS_LABELS` are imported in all 3 consumer files

#### Manual Verification:
- [ ] Billing table renders status badges with correct colors
- [ ] Invoice detail page renders status badge correctly
- [ ] Timeline shows formatted status labels

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Server Actions — Status Transitions & Guards

### Overview
Create named transition functions with validation and history logging. Add `assertCaseNotClosed` guard to all billing actions. Enforce immutability on non-draft invoices.

### Changes Required:

#### 1. New invoice status actions file
**File**: `src/actions/invoice-status.ts`

```typescript
'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { ALLOWED_TRANSITIONS, type InvoiceStatus } from '@/lib/constants/invoice-status'

// -- Internal helper: validate and execute a status transition --

async function transitionInvoiceStatus(
  invoiceId: string,
  targetStatus: InvoiceStatus,
  options: { reason?: string; metadata?: Record<string, unknown> } = {}
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Fetch current invoice
  const { data: invoice, error: fetchError } = await supabase
    .from('invoices')
    .select('id, status, case_id')
    .eq('id', invoiceId)
    .is('deleted_at', null)
    .single()

  if (fetchError || !invoice) return { error: 'Invoice not found' }

  const currentStatus = invoice.status as InvoiceStatus

  // Validate transition
  if (!ALLOWED_TRANSITIONS[currentStatus]?.includes(targetStatus)) {
    return { error: `Cannot change status from '${currentStatus}' to '${targetStatus}'` }
  }

  // Update status
  const { error: updateError } = await supabase
    .from('invoices')
    .update({
      status: targetStatus,
      updated_by_user_id: user.id,
    })
    .eq('id', invoiceId)

  if (updateError) return { error: updateError.message }

  // Insert history record
  const { error: historyError } = await supabase
    .from('invoice_status_history')
    .insert({
      invoice_id: invoiceId,
      previous_status: currentStatus,
      new_status: targetStatus,
      changed_by_user_id: user.id,
      reason: options.reason ?? null,
      metadata: options.metadata ?? null,
    })

  if (historyError) {
    console.error('Failed to insert invoice status history:', historyError)
    // Don't fail the transition — the status update already succeeded
    // Log for monitoring but don't block the user
  }

  revalidatePath(`/patients/${invoice.case_id}/billing`)
  return { error: null }
}

// -- Public named transition actions --

export async function issueInvoice(invoiceId: string) {
  // Precondition: invoice must have at least 1 line item
  const supabase = await createClient()

  const { data: lineItems } = await supabase
    .from('invoice_line_items')
    .select('id')
    .eq('invoice_id', invoiceId)
    .limit(1)

  if (!lineItems || lineItems.length === 0) {
    return { error: 'Cannot issue an invoice with no line items' }
  }

  return transitionInvoiceStatus(invoiceId, 'issued')
}

export async function markInvoicePaid(invoiceId: string) {
  return transitionInvoiceStatus(invoiceId, 'paid')
}

export async function voidInvoice(invoiceId: string, reason: string) {
  if (!reason || reason.trim().length === 0) {
    return { error: 'A reason is required to void an invoice' }
  }
  return transitionInvoiceStatus(invoiceId, 'void', { reason: reason.trim() })
}

export async function markInvoiceOverdue(invoiceId: string) {
  return transitionInvoiceStatus(invoiceId, 'overdue')
}

export async function writeOffInvoice(invoiceId: string, reason: string) {
  if (!reason || reason.trim().length === 0) {
    return { error: 'A reason is required to write off an invoice' }
  }
  return transitionInvoiceStatus(invoiceId, 'uncollectible', { reason: reason.trim() })
}

// -- History query --

export async function getInvoiceStatusHistory(invoiceId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('invoice_status_history')
    .select('id, previous_status, new_status, changed_at, changed_by_user_id, reason')
    .eq('invoice_id', invoiceId)
    .order('changed_at', { ascending: false })

  if (error) return { error: error.message, data: null }
  return { error: null, data }
}
```

#### 2. Update billing.ts — Add guards and immutability enforcement
**File**: `src/actions/billing.ts`

**Add `assertCaseNotClosed` import at top:**
```typescript
import { assertCaseNotClosed } from '@/actions/case-status'
```

**Update `createInvoice` (after auth check, ~line 264):**
Add case-closed guard:
```typescript
const closedCheck = await assertCaseNotClosed(supabase, caseId)
if (closedCheck.error) return { error: closedCheck.error }
```

**Update `updateInvoice` (after auth check, ~line 319):**
Add case-closed guard and draft-only enforcement:
```typescript
// Case-closed guard
const { data: invoiceRow } = await supabase
  .from('invoices')
  .select('status, case_id')
  .eq('id', invoiceId)
  .is('deleted_at', null)
  .single()

if (!invoiceRow) return { error: 'Invoice not found' }

const closedCheck = await assertCaseNotClosed(supabase, invoiceRow.case_id)
if (closedCheck.error) return { error: closedCheck.error }

// Immutability: only draft invoices can be edited
if (invoiceRow.status !== 'draft') {
  return { error: 'Only draft invoices can be edited. Void this invoice and create a new one.' }
}
```

**Update `deleteInvoice` (add auth check and guards, ~line 368):**
```typescript
export async function deleteInvoice(invoiceId: string, caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Fetch invoice to check status
  const { data: invoice } = await supabase
    .from('invoices')
    .select('status, case_id')
    .eq('id', invoiceId)
    .is('deleted_at', null)
    .single()

  if (!invoice) return { error: 'Invoice not found' }

  const closedCheck = await assertCaseNotClosed(supabase, invoice.case_id)
  if (closedCheck.error) return { error: closedCheck.error }

  // Only draft invoices can be deleted; issued+ invoices must be voided
  if (invoice.status !== 'draft') {
    return { error: 'Only draft invoices can be deleted. Use void for issued invoices.' }
  }

  const { error } = await supabase
    .from('invoices')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', invoiceId)

  if (error) return { error: error.message }

  revalidatePath(`/patients/${caseId}/billing`)
  return { success: true }
}
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles with no errors: `npm run typecheck`
- [ ] `issueInvoice` rejects invoices with no line items
- [ ] `voidInvoice` rejects empty reason
- [ ] `writeOffInvoice` rejects empty reason
- [ ] `updateInvoice` rejects non-draft invoices
- [ ] `deleteInvoice` rejects non-draft invoices
- [ ] `deleteInvoice` requires authentication
- [ ] All transition functions insert a row into `invoice_status_history`
- [ ] Invalid transitions return an error (e.g., `paid → draft`)

#### Manual Verification:
- [ ] Create a draft invoice → issue it → mark paid (happy path)
- [ ] Try to edit an issued invoice — should be rejected
- [ ] Try to delete an issued invoice — should be rejected
- [ ] Void an issued invoice with a reason — should succeed
- [ ] Check `invoice_status_history` table has correct entries
- [ ] Close a case → try to create/edit/delete invoice — should be blocked

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 4.

---

## Phase 4: UI — Status Change Controls

### Overview
Add status transition buttons to the invoice detail page, disable edit/delete for non-draft invoices, and show status history.

### Changes Required:

#### 1. Update invoice-detail-client.tsx
**File**: `src/components/billing/invoice-detail-client.tsx`

**Import transition actions and constants:**
```typescript
import { issueInvoice, markInvoicePaid, voidInvoice, markInvoiceOverdue, writeOffInvoice } from '@/actions/invoice-status'
import { ALLOWED_TRANSITIONS, INVOICE_STATUS_LABELS, type InvoiceStatus } from '@/lib/constants/invoice-status'
```

**Conditionally show Edit/Delete buttons only for draft invoices:**
The Edit button (line 254) and Delete button (line 258) should only render when `invoice.status === 'draft'`.

**Add status action buttons based on allowed transitions:**
After the existing action buttons, add a section that renders available transition buttons based on the current status:

```typescript
// Derive available transitions
const currentStatus = invoice.status as InvoiceStatus
const availableTransitions = ALLOWED_TRANSITIONS[currentStatus] ?? []
```

For each available transition, render an appropriate button:
- `issued` → "Issue Invoice" button (primary style)
- `paid` → "Mark as Paid" button (green/success style)
- `void` → "Void Invoice" button (red/destructive style, opens a dialog for reason)
- `overdue` → "Mark Overdue" button (amber/warning style)
- `uncollectible` → "Write Off" button (destructive style, opens a dialog for reason)

**Add void/write-off reason dialog:**
A simple `AlertDialog` with a `<Textarea>` for the reason, similar to the existing delete confirmation dialog. Two separate dialogs (void and write-off) each with their own state:
- `showVoidDialog` / `voidReason` state
- `showWriteOffDialog` / `writeOffReason` state

**Toast feedback:**
Each action should show `toast.success` on success and `toast.error` on failure, following the existing pattern.

#### 2. Update create-invoice-dialog.tsx (optional safety)
**File**: `src/components/billing/create-invoice-dialog.tsx`

No changes needed — the server action guard in `updateInvoice` handles immutability. The UI will simply not show the Edit button for non-draft invoices, so the dialog won't open. The server-side guard is defense-in-depth.

#### 3. Update billing-table.tsx — ensure new statuses render
**File**: `src/components/billing/billing-table.tsx`

Already handled in Phase 2 — the imported `INVOICE_STATUS_COLORS` and `INVOICE_STATUS_LABELS` contain all 6 new statuses. No additional changes needed.

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles with no errors: `npm run typecheck`
- [ ] Lint passes: `npm run lint`
- [ ] Build succeeds: `npm run build`

#### Manual Verification:
- [ ] Draft invoice shows: Edit, Delete, "Issue Invoice", "Void Invoice" buttons
- [ ] Issued invoice shows: "Mark as Paid", "Mark Overdue", "Void Invoice" buttons (no Edit/Delete)
- [ ] Overdue invoice shows: "Mark as Paid", "Write Off" buttons
- [ ] Paid/Void/Uncollectible invoices show no action buttons (terminal states)
- [ ] Void dialog requires a reason before confirming
- [ ] Write-off dialog requires a reason before confirming
- [ ] Toast notifications appear on success and failure
- [ ] Status badge updates immediately after transition
- [ ] Billing table reflects updated statuses

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 5.

---

## Phase 5: Timeline Integration

### Overview
Add invoice status change events to the case timeline, following the existing `status_change` event pattern from case status history.

### Changes Required:

#### 1. Update timeline.ts
**File**: `src/actions/timeline.ts`

In `getTimelineEvents`, add a 5th parallel query to fetch `invoice_status_history` records for the case:

```typescript
const invoiceStatusHistoryPromise = supabase
  .from('invoice_status_history')
  .select(`
    id,
    invoice_id,
    previous_status,
    new_status,
    changed_at,
    reason,
    invoices!inner(invoice_number, case_id)
  `)
  .eq('invoices.case_id', caseId)
  .order('changed_at', { ascending: false })
```

Map results to `TimelineEvent` entries:
```typescript
{
  type: 'invoice_status_change',
  date: record.changed_at,
  title: `Invoice ${record.invoices.invoice_number} — ${INVOICE_STATUS_LABELS[record.new_status]}`,
  description: record.reason
    ? `${INVOICE_STATUS_LABELS[record.previous_status] ?? 'New'} → ${INVOICE_STATUS_LABELS[record.new_status]}. Reason: ${record.reason}`
    : `${INVOICE_STATUS_LABELS[record.previous_status] ?? 'New'} → ${INVOICE_STATUS_LABELS[record.new_status]}`,
}
```

Merge these events into the existing sorted timeline array.

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles with no errors: `npm run typecheck`

#### Manual Verification:
- [ ] Issue an invoice → timeline shows "Invoice INV-2026-XXXX — Issued" event
- [ ] Void an invoice → timeline shows the transition with the reason
- [ ] Events appear in correct chronological order

---

## Testing Strategy

### Integration Testing (Manual):
1. **Happy path**: Create draft → Issue → Mark Paid
2. **Void from draft**: Create draft → Void (with reason)
3. **Void from issued**: Create draft → Issue → Void (with reason)
4. **Overdue flow**: Create draft → Issue → Mark Overdue → Mark Paid
5. **Write-off flow**: Create draft → Issue → Mark Overdue → Write Off (with reason)
6. **Immutability**: Issue an invoice → try Edit button (should not appear) → try API update (should be rejected)
7. **Delete guard**: Issue an invoice → try Delete (should not appear) → try API delete (should be rejected)
8. **Case-closed guard**: Close a case → try creating/editing/deleting invoices (all should fail)
9. **Invalid transitions**: Try `paid → draft`, `void → issued` via direct API call (should be rejected)

### Edge Cases:
- Invoice with no line items cannot be issued
- Void and write-off require non-empty reason
- Deleted (soft) invoices should not be transitionable
- History backfill from migration should be visible

## Migration Notes

- Existing `pending` invoices → `issued`
- Existing `partial` invoices → `paid`
- Existing `denied` invoices → `void`
- Existing `draft`, `paid`, `overdue` invoices → unchanged
- History backfill creates one entry per non-draft invoice at migration time

## Performance Considerations

- `invoice_status_history` has an index on `invoice_id` for fast lookups
- `changed_at` index supports timeline queries sorted by date
- Status transition is 3 queries (fetch → update → insert history) — acceptable for user-initiated actions
- Timeline adds one more parallel query — minimal impact since it runs concurrently with existing queries

## References

- Research: [thoughts/shared/research/2026-03-13-invoice-status-change-design.md](thoughts/shared/research/2026-03-13-invoice-status-change-design.md)
- Case status pattern: [src/actions/case-status.ts](src/actions/case-status.ts)
- Case status history schema: [supabase/migrations/001_initial_schema.sql:115-123](supabase/migrations/001_initial_schema.sql#L115-L123)
- Current invoice schema: [supabase/migrations/002_case_dashboard_tables.sql:46-61](supabase/migrations/002_case_dashboard_tables.sql#L46-L61)
- Current billing actions: [src/actions/billing.ts](src/actions/billing.ts)
- Invoice detail UI: [src/components/billing/invoice-detail-client.tsx](src/components/billing/invoice-detail-client.tsx)
