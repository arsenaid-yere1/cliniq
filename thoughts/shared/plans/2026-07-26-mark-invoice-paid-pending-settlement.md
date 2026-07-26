---
date: 2026-07-26
author: arsenaid
git_commit_at_start: 395ec55e18d9bb53f10b3c1da535e7f246e62ea3
branch: main
repository: cliniq
topic: "Allow marking invoices paid while case is in Pending Settlement"
tags: [plan, billing, invoice-status, case-status, pending-settlement]
status: implemented
research: thoughts/shared/research/2026-07-26-mark-invoice-paid-pending-settlement.md
---

# Plan: Allow Marking Invoices Paid in Pending Settlement

**Status**: Implemented and verified 2026-07-26. Typecheck exit 0, 1158/1158 tests passing (71 files). Uncommitted.

Research backing this: [2026-07-26-mark-invoice-paid-pending-settlement.md](../research/2026-07-26-mark-invoice-paid-pending-settlement.md)

## Problem

Settlement money arrives *after* a case moves to `Pending Settlement`. But `pending_settlement` sits in `LOCKED_STATUSES` alongside `closed` and `archived`, and `assertCaseNotClosed` is called at the top of every invoice write action — so `markInvoicePaid` and `recordPayment` both reject with:

> This case is locked (Pending Settlement). Move it back to Active to make changes.

The desired workflow — mark invoice paid in Pending Settlement, then archive the case — was blocked at step one.

## Constraints

1. **The notes/docs freeze on `pending_settlement` is deliberate.** Per [2026-04-22-pending-settlement-freeze-notes-docs.md](2026-04-22-pending-settlement-freeze-notes-docs.md). Must not be reversed.
2. **`LOCKED_STATUSES` is a flat array feeding ~25 call sites** — notes, procedures, documents, all extraction modules, lien, consents, billing. Removing `pending_settlement` from it unlocks everything at once. Rejected.
3. **`closed` and `archived` must keep blocking payments.** Once archived, the case is done.
4. **Archiving already works.** `updateCaseStatus` never guards itself with `assertCaseNotClosed`; it validates against `CASE_STATUS_TRANSITIONS` only, where `pending_settlement → closed → archived` is already legal. No change needed.

## Approach

Narrowest viable carve-out: an **opt-in** flag on the guard, consumed by exactly the two payment actions. Default behavior is byte-identical for every existing caller, so the blast radius is two call sites.

Considered and rejected:
- *Drop `pending_settlement` from `LOCKED_STATUSES`* — violates constraint 1 and 2.
- *Unlock the whole billing surface* — would allow editing/voiding/deleting invoices mid-settlement. Wider than the need.

## Changes

### 1. `src/lib/constants/case-status.ts`

Add a separate list alongside the untouched `LOCKED_STATUSES`:

```ts
export const PAYMENT_ALLOWED_LOCKED_STATUSES: CaseStatus[] = ['pending_settlement']
```

`LOCKED_STATUSES` unchanged — the other ~25 consumers see no difference.

### 2. `src/actions/case-status.ts`

`assertCaseNotClosed` gains an optional third parameter. Opt-in, so all existing callers keep current behavior:

```ts
export async function assertCaseNotClosed(
  supabase, caseId,
  options?: { allowPayment?: boolean },
): Promise<{ error: string | null }> {
  ...
  if (options?.allowPayment && PAYMENT_ALLOWED_LOCKED_STATUSES.includes(status)) {
    return { error: null }
  }
  ...
}
```

### 3. `src/actions/invoice-status.ts`

Two call sites pass the flag. Nothing else in the file does:

- `markInvoicePaid` (~L108)
- `recordPayment` (~L202)

```ts
const closedCheck = await assertCaseNotClosed(supabase, invoice.case_id, { allowPayment: true })
```

`transitionInvoiceStatus` (L28) is deliberately **not** changed — that helper backs `issueInvoice` / `voidInvoice` / `markInvoiceOverdue` / `writeOffInvoice`, which must stay blocked.

### 4. `src/components/billing/invoice-detail-client.tsx`

The billing UI had zero lock awareness — buttons rendered enabled and failed on submit via toast. Wire in the context that the other 22 components already use:

```ts
const caseStatus = useCaseStatus() as CaseStatus
const isLocked = LOCKED_STATUSES.includes(caseStatus)
const paymentsBlocked = isLocked && !PAYMENT_ALLOWED_LOCKED_STATUSES.includes(caseStatus)
const lockedHint = `This case is locked (${lockLabel}). Move it back to Active to make changes.`
```

Button gating:

| Button | Gate |
|---|---|
| Mark as Paid | `isTransitioning \|\| paymentsBlocked` |
| Record Payment | `isTransitioning \|\| paymentsBlocked` |
| Edit / Delete (draft) | `isLocked` |
| Issue Invoice | `isTransitioning \|\| isLocked` |
| Mark Overdue | `isTransitioning \|\| isLocked` |
| Void Invoice | `isTransitioning \|\| isLocked` |
| Write Off | `isTransitioning \|\| isLocked` |

Disabled buttons carry `title={lockedHint}` so they explain themselves rather than failing silently.

### 5. `src/actions/__tests__/invoice-status.test.ts`

10 new tests. The security-relevant ones are the negatives — proving the exception did not leak:

- `markInvoicePaid`: allows in `pending_settlement`; blocks in `closed`; blocks in `archived`; still enforces settlement-reason when paying below total in `pending_settlement`.
- `recordPayment`: allows in `pending_settlement`; blocks in `archived`.
- New `describe('pending_settlement exception is payment-only')` block: `voidInvoice`, `writeOffInvoice`, `markInvoiceOverdue`, `issueInvoice` all still return a `locked` error in `pending_settlement`.

## Verification

```
npx tsc --noEmit          # exit 0
npx vitest run            # 71 files, 1158 passed
```

`invoice-status.test.ts` went 28 → 38 tests.

## Out of scope

Deliberately unchanged, flagged for the user:

- `createInvoice` / `updateInvoice` / `deleteInvoice` (`src/actions/billing.ts:436,505,576`) remain blocked in `pending_settlement`.
- Payments stay blocked once `archived` — **record payment before archiving.**
- No direct `pending_settlement → archived` transition; the path is via `closed`. Adding a direct edge was not requested.
- `assertCaseWritable` (`src/actions/case-status.ts:30-40`) remains defined-but-never-called. Its `allowLockedForAdmin` bypass was not wired in; that's a pre-existing condition, untouched here.
- RLS policies on `invoices` / `payments` were not audited for independent case-status references. Application-layer guard was the focus.

## Follow-ups

- Commit. Per repo convention, split: `feat` for the code change, `docs` for this plan + the research doc.
- `graphify-out/` graph is stale relative to these edits — `graphify . --update` to refresh.
