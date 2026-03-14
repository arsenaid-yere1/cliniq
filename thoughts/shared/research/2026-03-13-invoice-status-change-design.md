---
date: 2026-03-13T12:00:00-07:00
researcher: Arsen
git_commit: 71b0c8923d905a7163f04aa34afe9ce9b27c782b
branch: main
repository: cliniq
topic: "Recommended Design for Invoice Status Changes"
tags: [research, codebase, invoices, billing, status-management, epic-6]
status: complete
last_updated: 2026-03-13
last_updated_by: Arsen
---

# Research: Recommended Design for Invoice Status Changes

**Date**: 2026-03-13
**Git Commit**: 71b0c89
**Branch**: main

## Research Question
What is the recommended design for invoice status changes in ClinIQ, considering the existing codebase patterns, HIPAA requirements, and PI clinic billing workflows?

## Summary

ClinIQ currently has 6 invoice statuses (`draft`, `pending`, `paid`, `partial`, `denied`, `overdue`) defined in `002_case_dashboard_tables.sql` but **no status history table and no transition guards**. The case entity, by contrast, has a full `case_status_history` table, server-side guard functions (`assertCaseNotClosed`), and a React context for UI access. The recommended design for invoice status changes should follow the established case status pattern while incorporating industry-standard medical billing practices.

## Detailed Findings

### Current Invoice Status Implementation

The invoice status is defined as a DB-level CHECK constraint with 6 values:

```sql
-- supabase/migrations/002_case_dashboard_tables.sql:52
status text not null default 'draft'
  check (status in ('draft', 'pending', 'paid', 'partial', 'denied', 'overdue')),
```

Status is updated directly via `updateInvoice` in [billing.ts](src/actions/billing.ts) with no transition validation or history tracking. New invoices default to `draft` ([billing.ts:283](src/actions/billing.ts#L283)).

UI display maps exist in [billing-table.tsx:35-50](src/components/billing/billing-table.tsx#L35-L50):
- `invoiceStatusColors` — Tailwind classes per status
- `invoiceStatusLabels` — Display names per status

Timeline formatting exists in [timeline.ts:122](src/actions/timeline.ts#L122) via `formatInvoiceStatus()`.

### Existing Status Patterns in the Codebase

| Entity | Status Column | Values | History Table | Guard Functions |
|---|---|---|---|---|
| `cases` | `case_status` | intake, active, pending_settlement, closed, archived | `case_status_history` | `assertCaseNotClosed` |
| `discharge_notes` | `status` | generating, draft, finalized, failed | None | Status-based query filters |
| `procedure_notes` | `status` | generating, draft, finalized, failed | None | Status-based query filters |
| `mri_extractions` | `extraction_status` / `review_status` | Two independent enums | None | None |
| `invoices` | `status` | draft, pending, paid, partial, denied, overdue | **None** | **None** |
| `documents` | `status` | pending_review, reviewed | None | None |

The **case status pattern** is the most mature, featuring:
1. **History table** — `case_status_history` with `previous_status`, `new_status`, `changed_at`, `changed_by_user_id`, `notes`
2. **Server-side guards** — `assertCaseNotClosed()` called by 9+ action files before any write
3. **Named transition actions** — `closeCase()`, `reopenCase()` with precondition checks (e.g., finalized discharge note required)
4. **React context** — `CaseStatusProvider` distributes status to child components
5. **Timeline integration** — Status changes appear as `status_change` events

### Industry Standard: Medical Invoice Statuses

Research across SigmaMD, CharmHealth, Stripe, and PI billing services yields a consensus set:

**Core Statuses (applicable to any medical practice):**

| Status | Description |
|---|---|
| `draft` | Created, fully editable, not yet sent |
| `issued` / `open` | Finalized and sent to payer; line items become immutable |
| `partially_paid` | Partial payment received |
| `paid` | Full balance received |
| `void` | Cancelled/issued in error; immutable audit record preserved |
| `past_due` | Unpaid past due date (can be auto-flagged) |
| `uncollectible` / `bad_debt` | Written off; no further collection |

**PI-Specific Lien Statuses (optional extension for future):**

| Status | Description |
|---|---|
| `pending_settlement` | Lien established, case open |
| `submitted_to_attorney` | Invoice/lien package sent |
| `under_negotiation` | Attorney negotiating lien reduction |
| `settled` | Settlement funds disbursed |

### Recommended Status Transition Map

For ClinIQ's current MVP scope (no insurance claims, no EDI), the recommended transitions:

```
draft → issued          (finalize invoice, lock line items)
draft → void            (cancel before sending)
issued → partially_paid (partial payment posted)
issued → paid           (full payment posted)
issued → past_due       (due date exceeded, can be automatic)
issued → void           (cancel after sending, requires reason)
issued → denied         (payer denial)
past_due → paid         (late payment received)
past_due → uncollectible (write-off decision)
partially_paid → paid   (remaining balance received)
denied → issued         (appeal/resubmission)
```

**Terminal states**: `paid`, `void`, `uncollectible`

### HIPAA Audit Requirements

Under 45 CFR 164.312(b), billing systems handling ePHI must log:

| Field | Purpose |
|---|---|
| `invoice_id` | Which invoice changed |
| `previous_status` | Status before change |
| `new_status` | Status after change |
| `changed_by_user_id` | Who made the change |
| `changed_at` | When (timestamptz) |
| `reason` | Why (especially for void, write-off) |
| `metadata` | IP, session, notes (jsonb) |

Audit logs must be **append-only** (never update/delete) and retained for **6+ years**.

### Recommended Implementation (Following Case Status Pattern)

**1. Database: `invoice_status_history` table**

```sql
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
create index idx_invoice_status_history_invoice on public.invoice_status_history(invoice_id);
```

**2. Server actions: Named transition functions with guards**

Following the `closeCase`/`reopenCase` pattern:

- `issueInvoice(invoiceId)` — requires at least 1 line item, valid patient/case
- `markInvoicePaid(invoiceId, paymentAmount)` — validates amount matches balance
- `voidInvoice(invoiceId, reason)` — requires reason, logs audit entry
- `markInvoicePastDue(invoiceId)` — can be called by scheduled job or manually

Each function:
1. Reads current status
2. Validates the transition is allowed
3. Updates `invoices.status`
4. Inserts into `invoice_status_history`

**3. Transition validation (guard pattern)**

```typescript
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ['issued', 'void'],
  issued: ['partially_paid', 'paid', 'past_due', 'void', 'denied'],
  partially_paid: ['paid'],
  past_due: ['paid', 'uncollectible'],
  denied: ['issued'],
}
```

**4. Case-closed guard integration**

Invoice modifications should call `assertCaseNotClosed()` (currently missing from billing actions).

## Code References

- [002_case_dashboard_tables.sql:52](supabase/migrations/002_case_dashboard_tables.sql#L52) — Invoice status CHECK constraint
- [billing.ts:283](src/actions/billing.ts#L283) — Default draft status on creation
- [billing-table.tsx:35-50](src/components/billing/billing-table.tsx#L35-L50) — Status color/label maps
- [timeline.ts:122](src/actions/timeline.ts#L122) — `formatInvoiceStatus()`
- [case-status.ts](src/actions/case-status.ts) — Case status pattern (model to follow)
- [001_initial_schema.sql:81-123](supabase/migrations/001_initial_schema.sql#L81-L123) — `case_status_history` table (pattern reference)

## Architecture Documentation

The codebase has a clear progression of status management maturity:
1. **Simple** — `documents.status` (2 values, no history)
2. **Pipeline** — `extractions.extraction_status` + `review_status` (dual enums, no history)
3. **Lifecycle** — `notes.status` with finalization audit fields (4 values, partial audit)
4. **Full** — `cases.case_status` with history table, guards, context, timeline (5 values, complete audit)

Invoices currently sit at level 1 (simple) but should be at level 4 (full) given their financial and compliance significance.

## Historical Context

- [thoughts/personal/tickets/epic-6/story-1.md](thoughts/personal/tickets/epic-6/story-1.md) — Story 6.1 acceptance criteria (patient info, provider info, date of service, line items)
- [thoughts/personal/tickets/epic-6/story-2.md](thoughts/personal/tickets/epic-6/story-2.md) — Story 6.2 pricing catalog
- [thoughts/personal/tickets/epic-6/story-3.md](thoughts/personal/tickets/epic-6/story-3.md) — Story 6.3 export (PDF, printable)
- [thoughts/shared/plans/2026-03-12-epic-6-story-6.1-create-invoice-from-procedure.md](thoughts/shared/plans/2026-03-12-epic-6-story-6.1-create-invoice-from-procedure.md) — Implementation plan for Story 6.1

None of the existing tickets or plans explicitly address invoice status transitions or audit history.

## External References

- [SigmaMD: Understanding Invoice Status](https://clinician-help.sigmamd.com/article/97-understanding-invoice-status) — 7-status model
- [CharmHealth: Invoicing](https://www.charmhealth.com/resources/billing/invoices.html) — Draft/Unpaid/Partially Paid/Paid/Cancelled
- [Stripe: Status Transitions](https://docs.stripe.com/invoicing/integration/workflow-transitions) — Formal state machine model
- [HIPAA Audit Log Requirements (Keragon)](https://www.keragon.com/hipaa/hipaa-explained/hipaa-audit-log-requirements)
- [PI Billing Guide (DoctorMGT)](https://doctormgt.com/complete-101-guide-to-personal-injury-billing/)

## Open Questions

1. Should ClinIQ support PI-specific lien statuses now, or defer to a future epic?
2. Should `past_due` be set automatically via a cron job, or only manually?
3. Should invoice line items become immutable after `draft → issued` transition?
4. Should `assertCaseNotClosed` be retroactively added to existing billing actions?
5. Does the current `pending` status map to `issued`, or is there a meaningful distinction?
6. Should `denied` remain, or is it only relevant for insurance billing (not in MVP scope)?
