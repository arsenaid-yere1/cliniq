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
- Overpayment handling / refunds (paid amount > total_amount is rejected)
- Insurance claims or EDI integration
- Invoice status React context (unlike cases, invoices don't need a layout-level provider since status changes happen on the detail page, not across sibling routes)

## Payment Model

Invoices have existing columns `total_amount` and `paid_amount`, plus an existing `payments` table (see [002_case_dashboard_tables.sql:46-91](supabase/migrations/002_case_dashboard_tables.sql#L46-L91)). The status lifecycle integrates with these as follows:

- Recording a payment inserts a row into `payments` and increments `invoices.paid_amount`.
- Marking an invoice `paid` is a user decision — it means "this invoice is settled" regardless of whether `paid_amount == total_amount`. Common in personal injury cases where a settlement check is accepted as final payment for a larger billed amount.
- When `paid_amount < total_amount` at the time of marking paid, the user must supply a `settlement_reason` which is persisted on the invoice and in status history metadata. The unpaid remainder is effectively written off as part of the settlement.
- Overpayment (`amount > balance_due`) is rejected at the server action level.
- Partial payments that do NOT settle the invoice (user records a payment but leaves status as `issued`) are supported via a separate `recordPayment` action.

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

-- 3a. Add settlement_reason column for invoices paid below total_amount
alter table public.invoices add column settlement_reason text;

-- 4. Seed history for all existing non-draft invoices (audit backfill)
-- This creates a single "initial" history entry so the audit trail has a starting point
insert into public.invoice_status_history (invoice_id, previous_status, new_status, reason)
select id, null, status, 'Backfill: status at time of migration 020'
from public.invoices
where status != 'draft' and deleted_at is null;
```

### Success Criteria:

#### Automated Verification:
- [x] Migration applies cleanly against current DB
- [x] `SELECT DISTINCT status FROM invoices` returns only values from new set
- [x] `invoice_status_history` table exists with correct columns
- [x] `invoices.settlement_reason` column exists (nullable text)
- [x] RLS policies exist (select + insert only, no update/delete)
- [x] History rows exist for all non-draft invoices

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
- [x] TypeScript compiles with no errors: `npm run typecheck`
- [x] No remaining references to `invoiceStatusColors`, `invoiceStatusLabels`, or `formatInvoiceStatus` in the codebase
- [x] `INVOICE_STATUS_COLORS` and `INVOICE_STATUS_LABELS` are imported in all 3 consumer files

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
import { assertCaseNotClosed } from '@/actions/case-status'

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

export async function markInvoicePaid(
  invoiceId: string,
  input: {
    amount: number
    paymentDate?: string // ISO date; defaults to today
    paymentMethod?: string
    referenceNumber?: string
    notes?: string
    settlementReason?: string // required if amount + existing paid_amount < total_amount
  }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Fetch invoice totals
  const { data: invoice, error: fetchError } = await supabase
    .from('invoices')
    .select('id, status, case_id, total_amount, paid_amount')
    .eq('id', invoiceId)
    .is('deleted_at', null)
    .single()

  if (fetchError || !invoice) return { error: 'Invoice not found' }

  const closedCheck = await assertCaseNotClosed(supabase, invoice.case_id)
  if (closedCheck.error) return { error: closedCheck.error }

  const currentStatus = invoice.status as InvoiceStatus
  if (!ALLOWED_TRANSITIONS[currentStatus]?.includes('paid')) {
    return { error: `Cannot mark invoice paid from status '${currentStatus}'` }
  }

  const total = Number(invoice.total_amount)
  const alreadyPaid = Number(invoice.paid_amount)
  const balanceDue = total - alreadyPaid
  const amount = Number(input.amount)

  if (!(amount > 0)) return { error: 'Payment amount must be greater than 0' }
  if (amount > balanceDue) {
    return { error: `Payment amount (${amount}) exceeds balance due (${balanceDue}). Overpayment is not supported.` }
  }

  const newPaidTotal = alreadyPaid + amount
  const isSettledBelowTotal = newPaidTotal < total
  const settlementReason = input.settlementReason?.trim() ?? ''

  if (isSettledBelowTotal && settlementReason.length === 0) {
    return { error: 'Settlement reason is required when marking an invoice paid below its total amount' }
  }

  // Insert payment record
  const { error: paymentError } = await supabase.from('payments').insert({
    invoice_id: invoiceId,
    amount,
    payment_date: input.paymentDate ?? new Date().toISOString().slice(0, 10),
    payment_method: input.paymentMethod ?? null,
    reference_number: input.referenceNumber ?? null,
    notes: input.notes ?? null,
    created_by_user_id: user.id,
  })
  if (paymentError) return { error: paymentError.message }

  // Update invoice: paid_amount, status, settlement_reason (if below total)
  const { error: updateError } = await supabase
    .from('invoices')
    .update({
      paid_amount: newPaidTotal,
      status: 'paid',
      settlement_reason: isSettledBelowTotal ? settlementReason : null,
      updated_by_user_id: user.id,
    })
    .eq('id', invoiceId)
  if (updateError) return { error: updateError.message }

  // Insert status history with payment metadata
  const { error: historyError } = await supabase.from('invoice_status_history').insert({
    invoice_id: invoiceId,
    previous_status: currentStatus,
    new_status: 'paid',
    changed_by_user_id: user.id,
    reason: isSettledBelowTotal ? settlementReason : null,
    metadata: {
      payment_amount: amount,
      total_amount: total,
      paid_amount_after: newPaidTotal,
      settled_below_total: isSettledBelowTotal,
      settlement_shortfall: isSettledBelowTotal ? total - newPaidTotal : 0,
    },
  })
  if (historyError) {
    console.error('Failed to insert invoice status history:', historyError)
  }

  revalidatePath(`/patients/${invoice.case_id}/billing`)
  return { error: null }
}

// Record a partial payment without changing invoice status.
// Use when user receive payment but not yet settling the invoice.
export async function recordPayment(
  invoiceId: string,
  input: {
    amount: number
    paymentDate?: string
    paymentMethod?: string
    referenceNumber?: string
    notes?: string
  }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: invoice, error: fetchError } = await supabase
    .from('invoices')
    .select('id, status, case_id, total_amount, paid_amount')
    .eq('id', invoiceId)
    .is('deleted_at', null)
    .single()
  if (fetchError || !invoice) return { error: 'Invoice not found' }

  const closedCheck = await assertCaseNotClosed(supabase, invoice.case_id)
  if (closedCheck.error) return { error: closedCheck.error }

  // Only issued/overdue invoices can accept a partial payment
  const status = invoice.status as InvoiceStatus
  if (status !== 'issued' && status !== 'overdue') {
    return { error: `Cannot record payment on invoice with status '${status}'` }
  }

  const total = Number(invoice.total_amount)
  const alreadyPaid = Number(invoice.paid_amount)
  const balanceDue = total - alreadyPaid
  const amount = Number(input.amount)

  if (!(amount > 0)) return { error: 'Payment amount must be greater than 0' }
  if (amount > balanceDue) {
    return { error: `Payment amount (${amount}) exceeds balance due (${balanceDue}). Overpayment is not supported.` }
  }

  const { error: paymentError } = await supabase.from('payments').insert({
    invoice_id: invoiceId,
    amount,
    payment_date: input.paymentDate ?? new Date().toISOString().slice(0, 10),
    payment_method: input.paymentMethod ?? null,
    reference_number: input.referenceNumber ?? null,
    notes: input.notes ?? null,
    created_by_user_id: user.id,
  })
  if (paymentError) return { error: paymentError.message }

  const { error: updateError } = await supabase
    .from('invoices')
    .update({
      paid_amount: alreadyPaid + amount,
      updated_by_user_id: user.id,
    })
    .eq('id', invoiceId)
  if (updateError) return { error: updateError.message }

  revalidatePath(`/patients/${invoice.case_id}/billing`)
  return { error: null }
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
- [x] TypeScript compiles with no errors: `npm run typecheck`
- [x] `issueInvoice` rejects invoices with no line items
- [x] `voidInvoice` rejects empty reason
- [x] `writeOffInvoice` rejects empty reason
- [x] `updateInvoice` rejects non-draft invoices
- [x] `deleteInvoice` rejects non-draft invoices
- [x] `deleteInvoice` requires authentication
- [x] All transition functions insert a row into `invoice_status_history`
- [x] Invalid transitions return an error (e.g., `paid → draft`)
- [x] `markInvoicePaid` rejects amount <= 0 and amount > balance_due
- [x] `markInvoicePaid` requires `settlementReason` when paid_amount after payment < total_amount
- [x] `markInvoicePaid` inserts a row in `payments`, updates `invoices.paid_amount`, and sets `invoices.settlement_reason` when applicable
- [x] `markInvoicePaid` status history `metadata` records `payment_amount`, `settled_below_total`, `settlement_shortfall`
- [x] `recordPayment` accepts partial payment on `issued`/`overdue` invoices without changing status
- [x] `recordPayment` rejects payments on invoices in any other status

#### Manual Verification:
- [ ] Create a draft invoice → issue it → mark paid in full (happy path)
- [ ] Issue a $1000 invoice → mark paid for $600 with settlement reason → status is `paid`, `paid_amount=600`, `settlement_reason` populated
- [ ] Issue a $1000 invoice → record $400 partial payment → status stays `issued`, `paid_amount=400`
- [ ] Then mark paid for remaining $600 → status `paid`, `paid_amount=1000`, `settlement_reason` null
- [ ] Try to mark paid below total without a settlement reason — should be rejected
- [ ] Try to mark paid with amount > balance_due — should be rejected
- [ ] Try to edit an issued invoice — should be rejected
- [ ] Try to delete an issued invoice — should be rejected
- [ ] Void an issued invoice with a reason — should succeed
- [ ] Check `invoice_status_history` table has correct entries including payment metadata
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
import { issueInvoice, markInvoicePaid, recordPayment, voidInvoice, markInvoiceOverdue, writeOffInvoice } from '@/actions/invoice-status'
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
- `paid` → "Mark as Paid" button (green/success style, opens a payment dialog)
- `void` → "Void Invoice" button (red/destructive style, opens a dialog for reason)
- `overdue` → "Mark Overdue" button (amber/warning style)
- `uncollectible` → "Write Off" button (destructive style, opens a dialog for reason)

Additionally, for `issued` and `overdue` invoices, render a "Record Payment" button (secondary style) that opens the payment dialog in partial-payment mode (no status change).

**Add Mark-as-Paid payment dialog:**
A `Dialog` containing a small form. Shared with Record Payment (same dialog component, different submit action). Fields:
- `amount` (number input) — defaults to current `balance_due = total_amount - paid_amount`
- `paymentDate` (date input) — defaults to today
- `paymentMethod` (select or text: e.g., Check, Card, Cash, Settlement, Other)
- `referenceNumber` (text)
- `notes` (textarea)
- `settlementReason` (textarea) — only visible/required when `amount < balanceDue` AND mode is "mark paid". Hidden for "record payment".

Header summary shows `Total: $X  •  Already Paid: $Y  •  Balance Due: $Z`.

On submit:
- Mark-as-Paid mode → call `markInvoicePaid(invoiceId, { amount, paymentDate, paymentMethod, referenceNumber, notes, settlementReason })`
- Record-Payment mode → call `recordPayment(invoiceId, { amount, paymentDate, paymentMethod, referenceNumber, notes })`

Client-side validations (server re-validates):
- `amount > 0`
- `amount <= balanceDue`
- For mark-paid with `amount < balanceDue`: `settlementReason` non-empty

**Add void/write-off reason dialog:**
A simple `AlertDialog` with a `<Textarea>` for the reason, similar to the existing delete confirmation dialog. Two separate dialogs (void and write-off) each with their own state:
- `showVoidDialog` / `voidReason` state
- `showWriteOffDialog` / `writeOffReason` state
- `showPaymentDialog` / `paymentDialogMode` (`'mark-paid' | 'record-payment'`) / form fields state

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
- [x] TypeScript compiles with no errors: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Build succeeds: `npm run build`

#### Manual Verification:
- [ ] Draft invoice shows: Edit, Delete, "Issue Invoice", "Void Invoice" buttons
- [ ] Issued invoice shows: "Mark as Paid", "Record Payment", "Mark Overdue", "Void Invoice" buttons (no Edit/Delete)
- [ ] Overdue invoice shows: "Mark as Paid", "Record Payment", "Write Off" buttons
- [ ] Paid/Void/Uncollectible invoices show no action buttons (terminal states)
- [ ] Void dialog requires a reason before confirming
- [ ] Write-off dialog requires a reason before confirming
- [ ] Payment dialog defaults amount to balance_due and shows Total/Paid/Balance summary
- [ ] Payment dialog (mark-paid mode) reveals settlement reason field when amount < balance_due and blocks submit when empty
- [ ] Payment dialog rejects amount > balance_due client-side
- [ ] Record Payment flow on $1000/$400-paid invoice then Mark Paid flow correctly updates running totals in UI
- [ ] Settlement reason appears on the invoice detail after mark-paid-below-total
- [ ] Toast notifications appear on success and failure
- [ ] Status badge updates immediately after transition
- [ ] Billing table reflects updated statuses and paid_amount

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

Map results to `TimelineEvent` entries. For `paid` transitions with payment metadata, include the payment amount and settlement note:
```typescript
function buildInvoiceStatusEvent(record) {
  const prev = INVOICE_STATUS_LABELS[record.previous_status] ?? 'New'
  const next = INVOICE_STATUS_LABELS[record.new_status]
  const meta = record.metadata as { payment_amount?: number; settled_below_total?: boolean; settlement_shortfall?: number } | null

  let description = `${prev} → ${next}`
  if (record.new_status === 'paid' && meta?.payment_amount != null) {
    description += `. Payment: $${Number(meta.payment_amount).toFixed(2)}`
    if (meta.settled_below_total) {
      description += ` (settled; $${Number(meta.settlement_shortfall ?? 0).toFixed(2)} written off)`
    }
  }
  if (record.reason) description += `. Reason: ${record.reason}`

  return {
    type: 'invoice_status_change',
    date: record.changed_at,
    title: `Invoice ${record.invoices.invoice_number} — ${next}`,
    description,
  }
}
```

Add a 6th parallel query for partial payments recorded via `recordPayment` (payments that did NOT trigger a status change). One way: fetch all `payments` for the case, then exclude those whose `(invoice_id, payment_date)` coincides with a `paid`-transition history row. Simpler approach: emit a timeline event for every payment and let the status-change event (when it exists) be complementary:

```typescript
const paymentsPromise = supabase
  .from('payments')
  .select(`
    id,
    invoice_id,
    amount,
    payment_date,
    payment_method,
    reference_number,
    invoices!inner(invoice_number, case_id)
  `)
  .eq('invoices.case_id', caseId)
  .order('payment_date', { ascending: false })
```

Map each payment to:
```typescript
{
  type: 'invoice_payment',
  date: record.payment_date,
  title: `Payment received — Invoice ${record.invoices.invoice_number}`,
  description: `$${Number(record.amount).toFixed(2)}${record.payment_method ? ` via ${record.payment_method}` : ''}${record.reference_number ? ` (ref ${record.reference_number})` : ''}`,
}
```

Merge all events into the existing sorted timeline array.

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles with no errors: `npm run typecheck`

#### Manual Verification:
- [ ] Issue an invoice → timeline shows "Invoice INV-2026-XXXX — Issued" event
- [ ] Void an invoice → timeline shows the transition with the reason
- [ ] Mark paid in full → timeline shows status change with payment amount
- [ ] Mark paid below total with settlement reason → timeline shows `settled; $X written off` and reason
- [ ] Record a partial payment (no status change) → timeline shows "Payment received" event
- [ ] Events appear in correct chronological order

---

## Testing Strategy

### Integration Testing (Manual):
1. **Happy path (full payment)**: Create draft → Issue ($1000) → Mark Paid for $1000 → `paid_amount=1000`, no settlement_reason
2. **Settlement below total**: Create draft → Issue ($1000) → Mark Paid for $600 with reason "PI settlement final" → status `paid`, `paid_amount=600`, `settlement_reason` persisted
3. **Partial then full**: Issue ($1000) → Record Payment $400 (status stays `issued`) → Mark Paid $600 → status `paid`, `paid_amount=1000`
4. **Partial then settled**: Issue ($1000) → Record Payment $400 → Mark Paid $300 with settlement reason → status `paid`, `paid_amount=700`, `settlement_reason` set
5. **Overpayment rejected**: Issue ($1000) → Mark Paid $1200 → rejected
6. **Missing settlement reason**: Issue ($1000) → Mark Paid $600 with empty reason → rejected
7. **Void from draft**: Create draft → Void (with reason)
8. **Void from issued**: Create draft → Issue → Void (with reason)
9. **Overdue flow**: Create draft → Issue → Mark Overdue → Mark Paid
10. **Write-off flow**: Create draft → Issue → Mark Overdue → Write Off (with reason)
11. **Immutability**: Issue an invoice → try Edit button (should not appear) → try API update (should be rejected)
12. **Delete guard**: Issue an invoice → try Delete (should not appear) → try API delete (should be rejected)
13. **Case-closed guard**: Close a case → try creating/editing/deleting invoices, recording payments, marking paid (all should fail)
14. **Invalid transitions**: Try `paid → draft`, `void → issued` via direct API call (should be rejected)

### Edge Cases:
- Invoice with no line items cannot be issued
- Void and write-off require non-empty reason
- Mark-paid below total requires non-empty settlement reason
- Overpayment (amount > balance_due) rejected in both `markInvoicePaid` and `recordPayment`
- `recordPayment` rejected on `draft`, `paid`, `void`, `uncollectible` invoices
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
