---
date: 2026-07-26T20:36:14Z
researcher: arsenaid
git_commit: 395ec55e18d9bb53f10b3c1da535e7f246e62ea3
branch: main
repository: cliniq
topic: "Allow marking invoices as paid while case is in Pending Settlement status"
tags: [research, codebase, billing, invoice-status, case-status, pending-settlement]
status: complete
last_updated: 2026-07-26
last_updated_by: arsenaid
---

# Research: Marking Invoices Paid in `pending_settlement`

**Date**: 2026-07-26T20:36:14Z
**Researcher**: arsenaid
**Git Commit**: `395ec55e18d9bb53f10b3c1da535e7f246e62ea3`
**Branch**: main
**Repository**: cliniq

## Research Question

Allow invoices to be marked as paid while the case is in `Pending Settlement` status — what exists today that governs this?

## Summary

`pending_settlement` is a **case** status, not an invoice status. It is one of three values in `LOCKED_STATUSES` alongside `closed` and `archived`. The lock is enforced server-side by a single guard function, `assertCaseNotClosed`, which is called at the top of every invoice write action — including `markInvoicePaid` and `recordPayment`. There is no per-status differentiation: `pending_settlement` is treated identically to `closed` and `archived` everywhere `LOCKED_STATUSES` is consumed.

Today, attempting to mark an invoice paid on a `pending_settlement` case fails at the server with `"This case is locked (Pending Settlement). Move it back to Active to make changes."`. The billing UI has no lock awareness at all — the "Mark as Paid" button renders enabled, the payment dialog opens and accepts input, and the rejection surfaces only as a toast error after the round-trip.

An admin-bypass wrapper (`assertCaseWritable`) exists but is defined and never called anywhere in `src/`.

## Detailed Findings

### Case status lock definition

[src/lib/constants/case-status.ts](src/lib/constants/case-status.ts)

- `CASE_STATUSES` (line 1): `['intake', 'pending_imaging', 'active', 'pending_settlement', 'closed', 'archived']`
- `CASE_STATUS_TRANSITIONS` (lines 17–24): `pending_settlement` → `['closed', 'active']`; `active` → `pending_settlement` among others
- `LOCKED_STATUSES` (line 26): `['pending_settlement', 'closed', 'archived']` — flat array, no per-status distinction

### Server-side guard

[src/actions/case-status.ts](src/actions/case-status.ts)

- `assertCaseNotClosed(supabase, caseId)` — lines 10–26. Fetches `case_status` (soft-delete filtered), returns `{ error: 'This case is locked (<Label>). Move it back to Active to make changes.' }` if the status is in `LOCKED_STATUSES` (lines 21–23). This is the only runtime lock check — it is a manually-invoked function, not middleware or RLS.
- `assertCaseWritable(supabase, caseId, options)` — lines 30–40. Wraps `assertCaseNotClosed` with an `allowLockedForAdmin` bypass: if the flag is set and `getCurrentUserWithRole()` returns role `'admin'`, the lock check is skipped. **Grep confirms this function is never invoked outside its own definition** — every caller in the codebase uses `assertCaseNotClosed` directly.
- `updateCaseStatus` — lines 44–134. Validates against `CASE_STATUS_TRANSITIONS` (lines 76–79) unless admin override (lines 55–56, 74–80). Lines 84–97: transitioning into `pending_settlement` or `closed` (non-override path) requires at least one non-void `invoice_type = 'visit'` invoice, else `'A medical invoice is required before changing to this status.'`. Writes `case_status_history` (lines 123–129), revalidates `/patients/${caseId}` and `/patients`.

### Where the lock blocks invoice actions

[src/actions/invoice-status.ts](src/actions/invoice-status.ts) — imports `assertCaseNotClosed` at line 6:

| Action | Line | Guard line |
|---|---|---|
| `transitionInvoiceStatus` (internal helper) | 10–64 | 28 |
| `markInvoicePaid` | 84–176 | **108** |
| `recordPayment` | 180–242 | **202** |
| `issueInvoice` | 68–82 | via helper |
| `voidInvoice` | 244–249 | via helper |
| `markInvoiceOverdue` | 251–253 | via helper |
| `writeOffInvoice` | 255–260 | via helper |

[src/actions/billing.ts](src/actions/billing.ts) — imports at line 12:

| Action | Guard line |
|---|---|
| `createInvoice` | 436 |
| `updateInvoice` | 505 |
| `deleteInvoice` | 576 |

Same pattern is used in ~20 other action files (notes, procedures, documents, all extraction modules, lien, consents).

### Invoice status state machine

[src/lib/constants/invoice-status.ts](src/lib/constants/invoice-status.ts)

- Values (line 4): `draft`, `issued`, `paid`, `void`, `overdue`, `uncollectible`
- Terminal (line 7): `paid`, `void`, `uncollectible`
- `ALLOWED_TRANSITIONS` (lines 9–16):
  - `draft` → `issued`, `void`
  - `issued` → `paid`, `overdue`, `void`
  - `overdue` → `paid`, `uncollectible`
  - `paid` / `void` / `uncollectible` → none
- Helpers `isTerminalStatus` (36–38), `canTransitionTo` (40–42)
- Labels/colors (18–25, 27–34) consumed by [invoice-detail-client.tsx:414-415](src/components/billing/invoice-detail-client.tsx#L414-L415) and [billing-table.tsx:151-155](src/components/billing/billing-table.tsx#L151-L155)

DB CHECK constraint matching these values: [020_invoice_status_changes.sql:44-46](supabase/migrations/020_invoice_status_changes.sql#L44-L46). That migration also data-migrated `pending`→`issued`, `partial`→`paid`, `denied`→`void` (lines 36–41).

Invoice status has **no** `pending_settlement` value and no settlement-related state.

### `markInvoicePaid` internals

[src/actions/invoice-status.ts:84-176](src/actions/invoice-status.ts#L84-L176). Does not use the shared `transitionInvoiceStatus` helper — it duplicates auth (96–97), invoice fetch (99–106, also selecting `total_amount`, `paid_amount`), and the case-locked check (108–109) inline, then adds:

- Transition check against `ALLOWED_TRANSITIONS[currentStatus].includes('paid')` (112–114)
- `balanceDue = total_amount - paid_amount` (118); amount must be `> 0` (121) and must not exceed balance due — overpayment rejected (122–124)
- `isSettledBelowTotal = newPaidTotal < total` (126–127); if true and `settlementReason` is blank → `'Settlement reason is required when marking an invoice paid below its total amount'` (128–132)
- Inserts `payments` row (134–143)
- Updates `invoices`: `paid_amount`, `status = 'paid'`, `settlement_reason` (trimmed reason if below total, else `null`) (145–153)
- Inserts `invoice_status_history` with `reason` + `metadata` JSON containing `payment_amount`, `total_amount`, `paid_amount_after`, `settled_below_total`, `settlement_shortfall` (156–169)
- `revalidatePath('/patients/${case_id}/billing')`

`recordPayment` ([180–242](src/actions/invoice-status.ts#L180-L242)) records a payment without a status change; guarded on `status` being `issued` or `overdue` (205–208), updates only `paid_amount`, writes no history row.

### `settlement_reason` column

[supabase/migrations/20260501_invoice_settlement_reason.sql:7](supabase/migrations/20260501_invoice_settlement_reason.sql#L7) — `alter table public.invoices add column settlement_reason text;` nullable, no default, no CHECK.

Written only by `markInvoicePaid` (line 150). Required only when the payment settles below total. Displayed on the invoice document at [invoice-detail-client.tsx:575-580](src/components/billing/invoice-detail-client.tsx#L575-L580). This is invoice-level and unrelated to the case-level `pending_settlement` status.

### `invoice_status_history` table

[supabase/migrations/020_invoice_status_changes.sql:7-16](supabase/migrations/020_invoice_status_changes.sql#L7-L16). Columns: `id`, `invoice_id`, `previous_status`, `new_status`, `changed_at`, `changed_by_user_id`, `reason`, `metadata jsonb`. Indexes on `invoice_id` and `changed_at` (19–20). RLS enabled (23); `select`/`insert` policies require `auth.role() = 'authenticated'` (25–31). No update/delete policies — comment at line 33 states this is deliberate for HIPAA audit. Backfilled at migration time (48–53). Read via `getInvoiceStatusHistory` (invoice-status.ts:264–275).

History insert failures are only `console.error`'d, not surfaced, and do not roll back the status change ([invoice-status.ts:58-60](src/actions/invoice-status.ts#L58-L60)).

### Client-side lock awareness — present elsewhere, absent in billing

[src/components/patients/case-status-context.tsx](src/components/patients/case-status-context.tsx) — plain React context, default `'intake'` (line 5), `CaseStatusProvider` (7–19), `useCaseStatus()` (21–23). Mounted at [src/app/(dashboard)/patients/[caseId]/layout.tsx:21](src/app/(dashboard)/patients/[caseId]/layout.tsx#L21), wrapping all routes under `/patients/[caseId]/...` including billing.

Standard consumption pattern (e.g. [procedure-table.tsx:49,140-141](src/components/procedures/procedure-table.tsx#L140-L141)):

```ts
const caseStatus = useCaseStatus()
const isLocked = LOCKED_STATUSES.includes(caseStatus as CaseStatus)
```

22 client components consume it: `initial-visit-editor`, `procedure-table`, `document-list`, `qc-review-panel`, `discharge-note-editor`, `case-summary-card`, `procedure-note-editor`, and the six extraction form/review pairs.

[src/components/patients/case-overview.tsx](src/components/patients/case-overview.tsx) uses a prop-based variant instead ([line 80](src/components/patients/case-overview.tsx#L80)), driving a "This case is locked" banner (158–163) and disabling the Upload Document / View Clinical Data / Record Procedure / **Create Invoice** quick-actions (166–178), plus lien/consent generation and case Edit.

**Grep of `src/components/billing/**` and the billing route for `useCaseStatus` / `isLocked` / `LOCKED_STATUSES` returns zero matches.** Neither `invoice-detail-client.tsx` nor `payment-dialog.tsx` is lock-aware.

### Billing UI affordances

[src/components/billing/invoice-detail-client.tsx](src/components/billing/invoice-detail-client.tsx) — `availableTransitions = ALLOWED_TRANSITIONS[currentStatus] ?? []` at line 186 drives button rendering:

| Button | Lines | Render condition | Action |
|---|---|---|---|
| Edit / Delete | 314–325 | `currentStatus === 'draft'` | route / `deleteInvoice` |
| Issue Invoice | 326–334 | `availableTransitions.includes('issued')` | `issueInvoice` |
| **Mark as Paid** | 335–347 | `availableTransitions.includes('paid')` | opens `PaymentDialog` mode `mark-paid` |
| Record Payment | 348–360 | `status === 'issued' \|\| 'overdue'` | opens `PaymentDialog` mode `record-payment` |
| Mark Overdue | 361–371 | `availableTransitions.includes('overdue')` | `markInvoiceOverdue` |
| Void Invoice | 372–382 | `availableTransitions.includes('void')` | dialog → `voidInvoice` (reason required, 626) |
| Write Off | 383–393 | `availableTransitions.includes('uncollectible')` | dialog → `writeOffInvoice` (reason required, 659) |

`PaymentDialog` instance rendered once at 634–641. `isTransitioning` (177) disables buttons during in-flight transitions but is not set by the payment dialog flow.

[src/components/billing/payment-dialog.tsx](src/components/billing/payment-dialog.tsx) — one component, two modes (line 27). Outer wrapper remounts inner keyed on `open` to reset form state (48–52). `balanceDue` (63), amount defaults to full balance (65). Validation (73–78): `amountValid`, `isBelowBalance`, `needsSettlementReason` (mark-paid mode only), `settlementReasonValid`, `canSubmit` (gates submit at 225). Settlement-reason textarea renders only when needed (202–218). `handleSubmit` (86–113) dispatches `markInvoicePaid` (97–101) or `recordPayment` (102). Payment methods hardcoded at line 38: `['Check', 'Card', 'Cash', 'Settlement', 'Other']`.

[src/components/billing/billing-table.tsx](src/components/billing/billing-table.tsx) — list view, no transition buttons. Only Download PDF (63–86) and Delete (draft-only, 164, 181–189). Status badges read-only (148–158). Row click navigates to the detail route (232–236).

[src/components/billing/billing-page-client.tsx](src/components/billing/billing-page-client.tsx) — composition only, no status logic.

### Current behavior: mark paid on a `pending_settlement` case

1. User on `/patients/[caseId]/billing/[invoiceId]`, case is `pending_settlement`.
2. "Mark as Paid" renders **enabled** — gated only by `availableTransitions` and `isTransitioning` ([invoice-detail-client.tsx:335-347](src/components/billing/invoice-detail-client.tsx#L335-L347)). No lock banner anywhere on the billing pages.
3. `PaymentDialog` opens, accepts amount/date/method/reference/notes, submit enabled.
4. `markInvoicePaid` called ([payment-dialog.tsx:98-101](src/components/billing/payment-dialog.tsx#L98-L101)).
5. Server fetches invoice (99–104), calls `assertCaseNotClosed` (108).
6. Returns `{ error: 'This case is locked (Pending Settlement). Move it back to Active to make changes.' }`.
7. Action returns at line 109 — no `payments` row, no invoice update, no history row.
8. Dialog stays open, `toast.error(result.error)` (105–108), no refresh.

Same for `recordPayment` and all other invoice transitions.

## Code References

- `src/lib/constants/case-status.ts:26` — `LOCKED_STATUSES` includes `pending_settlement`
- `src/actions/case-status.ts:10-26` — `assertCaseNotClosed`, the sole lock guard
- `src/actions/case-status.ts:30-40` — `assertCaseWritable` admin bypass, defined but never called
- `src/actions/case-status.ts:84-97` — invoice prerequisite for entering `pending_settlement`
- `src/actions/invoice-status.ts:108` — the guard blocking `markInvoicePaid`
- `src/actions/invoice-status.ts:202` — the guard blocking `recordPayment`
- `src/actions/invoice-status.ts:28` — the guard in `transitionInvoiceStatus` (issue/void/overdue/write-off)
- `src/actions/billing.ts:436,505,576` — guards on create/update/delete invoice
- `src/lib/constants/invoice-status.ts:9-16` — `ALLOWED_TRANSITIONS`
- `src/components/billing/invoice-detail-client.tsx:335-347` — "Mark as Paid" button, no lock awareness
- `src/components/billing/payment-dialog.tsx:73-78` — client validation, no case-status awareness
- `src/components/patients/case-overview.tsx:80,158-178` — the only client-side lock UI touching billing (Create Invoice quick-action)
- `supabase/migrations/020_invoice_status_changes.sql` — invoice status constraint + history table
- `supabase/migrations/20260501_invoice_settlement_reason.sql:7` — `settlement_reason` column

## Architecture Documentation

**Two-layer lock, non-overlapping.** Server: `assertCaseNotClosed` called explicitly at the top of each write action. Client: `useCaseStatus()` + `LOCKED_STATUSES.includes(...)` to disable buttons. There is no shared abstraction between the layers; a component either opts into the client check or it doesn't. Billing components do not.

**Flat lock set.** `LOCKED_STATUSES` is a single array consumed identically by ~25 call sites. Nothing in the codebase differentiates `pending_settlement` from `closed`/`archived` — there is no per-action or per-status allowlist mechanism.

**Two independent state machines.** `CASE_STATUS_TRANSITIONS` (case level) and `ALLOWED_TRANSITIONS` (invoice level) are separate constants with separate validators. They intersect at exactly two points: `assertCaseNotClosed` gating invoice writes, and `updateCaseStatus`'s requirement that a non-void visit invoice exist before entering `pending_settlement`/`closed`.

**Guard-then-write, no transactions.** Actions run auth → fetch → lock check → domain validation → write → audit insert → `revalidatePath`. Audit-insert failures are logged but not rolled back.

**No role checks in invoice actions.** The only identity gate on any invoice-status action is "an authenticated user exists". `getCurrentUserWithRole` is used only inside the unused `assertCaseWritable`.

## Related Research

- [thoughts/shared/research/2026-03-13-invoice-status-change-design.md](thoughts/shared/research/2026-03-13-invoice-status-change-design.md)
- [thoughts/shared/plans/2026-03-13-invoice-status-changes.md](thoughts/shared/plans/2026-03-13-invoice-status-changes.md)
- [thoughts/shared/research/2026-04-22-pending-settlement-notes-docs-freeze.md](thoughts/shared/research/2026-04-22-pending-settlement-notes-docs-freeze.md)
- [thoughts/shared/plans/2026-04-22-pending-settlement-freeze-notes-docs.md](thoughts/shared/plans/2026-04-22-pending-settlement-freeze-notes-docs.md)
- [thoughts/shared/research/2026-04-22-case-close-invoice-check.md](thoughts/shared/research/2026-04-22-case-close-invoice-check.md)
- [thoughts/shared/research/2026-04-22-billing-panel-invoice-download-delete.md](thoughts/shared/research/2026-04-22-billing-panel-invoice-download-delete.md)

## Open Questions

- Whether RLS policies on `invoices` / `payments` independently reference case status (not examined in this pass — the application-layer guard was the focus).
- Why `assertCaseWritable` was written but never wired in; its git history was not traced.
- Whether the case-level `pending_settlement` status and invoice-level `settlement_reason` were intended to relate — no code links them today.
