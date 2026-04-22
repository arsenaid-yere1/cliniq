---
date: 2026-04-22T14:48:10-07:00
researcher: arsenaid
git_commit: e21b1bb94ad2ce4d39002cff4073a7d2c3db7f38
branch: main
repository: cliniq
topic: "Add download and delete buttons for invoices in Billing panel"
tags: [research, codebase, billing, invoices, download, delete, invoice-detail-client, billing-table]
status: complete
last_updated: 2026-04-22
last_updated_by: arsenaid
---

# Research: Add download and delete buttons for invoices in Billing panel

**Date**: 2026-04-22T14:48:10-07:00
**Researcher**: arsenaid
**Git Commit**: e21b1bb94ad2ce4d39002cff4073a7d2c3db7f38
**Branch**: main
**Repository**: cliniq

## Research Question
Document the current state of the Billing panel and invoice handling in the codebase, and the existing download + delete patterns that would inform adding download and delete buttons at the invoice-row level (Billing panel / invoice list).

## Summary

Billing panel is a per-case route at `/patients/[caseId]/billing`, composed of a summary card + a TanStack table of invoice rows + a create dialog. Rows are clickable — clicking navigates to `/patients/[caseId]/billing/[invoiceId]`, which is the invoice detail page.

Download and Delete buttons **already exist on the invoice detail page** (`InvoiceDetailClient`), but **not on the Billing panel table rows** (`BillingTable`). The detail-page implementations are:

- **Download PDF**: server action `generateInvoicePdf(invoiceId)` renders via `@react-pdf/renderer`, returns base64; client converts to Blob, creates `<a>`, triggers `.click()`. Filename from `buildDownloadFilename({ lastName, docType, date })`.
- **Delete**: server action `deleteInvoice(invoiceId, caseId)` — soft deletes (`deleted_at = now()`). Guard: only `status === 'draft'` invoices can be deleted; issued+ must be voided. Wrapped in a controlled `AlertDialog` for confirmation. On success, toast + `router.push` back to billing list.

Invoices are stored in Supabase `invoices` table (soft-delete via `deleted_at`); line items in `invoice_line_items`. There is **no storage-backed PDF file** — PDFs are generated on demand, so there is nothing to remove from storage on delete.

The closest pattern analog for a row-level icon-button cluster (preview/download/delete) is `document-card.tsx`, which uses `flex gap-1 shrink-0` with ghost buttons and an `AlertDialogTrigger asChild`-wrapped delete.

## Detailed Findings

### Billing Panel Route & Components

**Route entry**: [src/app/(dashboard)/patients/[caseId]/billing/page.tsx:1-24](src/app/(dashboard)/patients/%5BcaseId%5D/billing/page.tsx)
- Parallel-fetches `listInvoices`, `getBillingSummary`, `getInvoiceFormData`.
- Renders `<BillingPageClient>`.

**Page client**: [src/components/billing/billing-page-client.tsx:80-107](src/components/billing/billing-page-client.tsx#L80-L107)
- Renders `BillingSummaryCard` + `BillingTable` + `CreateInvoiceDialog`.
- Holds `isCreateDialogOpen` state.

**Table**: [src/components/billing/billing-table.tsx:102-167](src/components/billing/billing-table.tsx#L102-L167)
- TanStack `useReactTable` with columns: `invoice_date`, `invoice_type`, `total_amount`, `paid_amount`, `balance`, `status`.
- Row click ⇒ `router.push(\`/patients/${caseId}/billing/${row.original.id}\`)` ([billing-table.tsx:139-147](src/components/billing/billing-table.tsx#L139-L147)).
- No action column exists today. Top-right has a single `Create Invoice` button ([billing-table.tsx:117-119](src/components/billing/billing-table.tsx#L117-L119)).

**Sidebar link**: [src/components/patients/case-sidebar.tsx:34](src/components/patients/case-sidebar.tsx#L34) — `{ label: 'Billing', href: '/billing', enabled: true }`.

### Invoice Detail Page (existing download + delete)

**Route**: [src/app/(dashboard)/patients/[caseId]/billing/[invoiceId]/page.tsx:1-36](src/app/(dashboard)/patients/%5BcaseId%5D/billing/%5BinvoiceId%5D/page.tsx)
- Parallel-fetches `getInvoiceWithContext`, `getClinicLogoUrl`, `listServiceCatalog`.
- Renders `<InvoiceDetailClient>`.

**Detail client**: [src/components/billing/invoice-detail-client.tsx:162-629](src/components/billing/invoice-detail-client.tsx)
- State: `isEditOpen`, `showDeleteConfirm`, `isDeleting`, `isGeneratingPdf`, `isTransitioning`, `showVoidDialog`, `voidReason`, `showWriteOffDialog`, `writeOffReason`.
- Top action bar ([invoice-detail-client.tsx:270-375](src/components/billing/invoice-detail-client.tsx#L270-L375)): Back, Download PDF, Edit (if draft), Delete (if draft), Issue/Paid/Overdue/Void/WriteOff (by status).

**Download PDF implementation** ([invoice-detail-client.tsx:278-309](src/components/billing/invoice-detail-client.tsx#L278-L309)):
```tsx
const result = await generateInvoicePdf(invoice.id)
const bytes = Uint8Array.from(atob(result.data!), c => c.charCodeAt(0))
const blob = new Blob([bytes], { type: 'application/pdf' })
const url = URL.createObjectURL(blob)
const a = document.createElement('a')
a.href = url
a.download = buildDownloadFilename({
  lastName: invoice.case.patient?.last_name,
  docType: invoice.invoice_type === 'facility' ? 'MedicalFacilityInvoice' : 'MedicalInvoice',
  date: invoice.invoice_date,
})
a.click()
URL.revokeObjectURL(url)
```

**Delete implementation** ([invoice-detail-client.tsx:229-240](src/components/billing/invoice-detail-client.tsx#L229-L240) handler; [316-319](src/components/billing/invoice-detail-client.tsx#L316-L319) trigger; [565-580](src/components/billing/invoice-detail-client.tsx#L565-L580) dialog):
- Delete button only rendered when `isDraft` (`currentStatus === 'draft'`).
- `onClick` sets `showDeleteConfirm=true` — dialog is open-state-controlled (not wrapped in `AlertDialogTrigger`).
- `handleDelete` calls `deleteInvoice(invoice.id, caseId)`, shows toast, on success `router.push(/patients/${caseId}/billing)`.

### Server Actions (billing.ts)

File: [src/actions/billing.ts](src/actions/billing.ts) (575 lines).

| Function | Lines | Purpose |
|---|---|---|
| `listInvoices(caseId)` | [31-43](src/actions/billing.ts#L31-L43) | Fetch invoices for case, filter `deleted_at IS NULL`, order by `invoice_date DESC` |
| `getBillingSummary(caseId)` | [45-56](src/actions/billing.ts#L45-L56) | Return `total_billed`, `total_paid`, `balance_due` from `cases` row |
| `getInvoice(invoiceId)` | [58-73](src/actions/billing.ts#L58-L73) | Single invoice + line items |
| `getInvoiceFormData(caseId)` | [75-357](src/actions/billing.ts#L75-L357) | Pre-populate create-invoice form |
| `createInvoice(caseId, values)` | [359-416](src/actions/billing.ts#L359-L416) | Insert invoice + line items, revalidate `/patients/{caseId}/billing` |
| `updateInvoice(invoiceId, caseId, values)` | [418-490](src/actions/billing.ts#L418-L490) | Only drafts editable; replaces line items |
| `deleteInvoice(invoiceId, caseId)` | [492-523](src/actions/billing.ts#L492-L523) | Soft delete (`deleted_at = now()`); drafts only; case-closed guard; `revalidatePath` |
| `generateInvoicePdf(invoiceId)` | [525-534](src/actions/billing.ts#L525-L534) | Dynamic import of `renderInvoicePdf`; returns base64 |
| `getInvoiceWithContext(invoiceId)` | [536-575](src/actions/billing.ts#L536-L575) | Invoice + line_items + case + patient + attorney + clinic + provider |

**deleteInvoice guards** ([billing.ts:492-523](src/actions/billing.ts#L492-L523)):
1. Auth check — returns `{ error: 'Not authenticated' }`.
2. Fetch invoice — returns `{ error: 'Invoice not found' }` if missing.
3. `assertCaseNotClosed(supabase, invoice.case_id)` — bails with error if case closed.
4. `invoice.status !== 'draft'` ⇒ `{ error: 'Only draft invoices can be deleted. Use void for issued invoices.' }`.
5. Update with `deleted_at: new Date().toISOString()`.
6. `revalidatePath(\`/patients/${caseId}/billing\`)`.

### Status Transitions (not delete, but destructive)

File: [src/actions/invoice-status.ts](src/actions/invoice-status.ts) (122 lines).

- `issueInvoice`, `markInvoicePaid`, `voidInvoice`, `markInvoiceOverdue`, `writeOffInvoice`.
- `voidInvoice` requires `reason`; writes to `invoice_status_history` table.
- Allowed transitions defined in [src/lib/constants/invoice-status.ts:9-16](src/lib/constants/invoice-status.ts#L9-L16):
  - `draft → issued | void`
  - `issued → paid | overdue | void`
  - `overdue → paid | uncollectible`
  - `paid`, `void`, `uncollectible` are terminal.

### PDF Generation

File: [src/lib/pdf/render-invoice-pdf.ts:28-161](src/lib/pdf/render-invoice-pdf.ts#L28-L161)
- Uses `@react-pdf/renderer` `renderToBuffer`.
- Fetches invoice + line items + case + patient + attorney + clinic settings + provider profile.
- Fetches clinic logo from `clinic-assets` storage bucket, converts via `sharp` if non-PNG.
- Renders `InvoicePdf` React component from [src/lib/pdf/invoice-template.tsx](src/lib/pdf/invoice-template.tsx).
- Returns `Buffer` — **no storage persistence**. PDF is regenerated on each download request.

### Database Schema

Invoices table originates in early migrations. Related migration files:
- `supabase/migrations/002_case_dashboard_tables.sql` — initial `invoices` (referenced by [018_fix_billing_totals_trigger.sql](supabase/migrations/018_fix_billing_totals_trigger.sql))
- `supabase/migrations/017_invoice_enhancements.sql`
- `supabase/migrations/018_fix_billing_totals_trigger.sql`
- `supabase/migrations/020_invoice_status_changes.sql` — adds `invoice_status_history`
- `supabase/migrations/20260417_drop_procedures_charge_amount.sql`
- `supabase/migrations/20260423_invoice_line_items_display_order.sql` — adds `display_order` column

Soft-delete convention: all invoice reads filter `.is('deleted_at', null)`.

### Existing Download Patterns

#### Pattern A — Supabase storage signed URL (for files actually stored)
File: [src/actions/documents.ts:178-186](src/actions/documents.ts#L178-L186)
```ts
supabase.storage.from('case-documents')
  .createSignedUrl(filePath, 3600, { download: downloadName ?? true })
```
Used by `document-card.tsx:handleDownload` + `discharge-note-editor.tsx`. Client opens via `window.open(url, '_blank')`.

#### Pattern B — Blob+`a.click()` (for server-rendered PDF with no storage)
File: [src/components/billing/invoice-detail-client.tsx:278-309](src/components/billing/invoice-detail-client.tsx#L278-L309)
This is the pattern invoices already use. No signed URL involved.

#### Filename helper
File: [src/lib/filenames/build-download-filename.ts:19-31](src/lib/filenames/build-download-filename.ts#L19-L31)
```ts
buildDownloadFilename({ lastName, docType, date, extension? })
// → `Smith_MedicalInvoice_2026-04-22.pdf`
```

### Existing Delete Patterns

#### Pattern A — `AlertDialogTrigger asChild` inline
File: [src/components/documents/document-card.tsx:213-233](src/components/documents/document-card.tsx#L213-L233)
```tsx
<AlertDialog>
  <AlertDialogTrigger asChild>
    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
      <Trash2 className="h-4 w-4" />
    </Button>
  </AlertDialogTrigger>
  <AlertDialogContent>...</AlertDialogContent>
</AlertDialog>
```

#### Pattern B — Controlled open state
File: [src/components/billing/invoice-detail-client.tsx:565-580](src/components/billing/invoice-detail-client.tsx#L565-L580)
```tsx
<Button onClick={() => setShowDeleteConfirm(true)}>
<AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
```
Used when click handler must do work beyond opening the dialog.

### Action Button Row Layouts

#### Card row (three-button cluster)
File: [src/components/documents/document-card.tsx:197-234](src/components/documents/document-card.tsx#L197-L234)
```tsx
<div className="flex gap-1 shrink-0">
  <Button variant="ghost" size="sm" onClick={handlePreview}>Preview</Button>
  <Button variant="ghost" size="sm" onClick={handleDownload}>Download</Button>
  <AlertDialog>
    <AlertDialogTrigger asChild>
      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
        <Trash2 className="h-4 w-4" />
      </Button>
    </AlertDialogTrigger>
    ...
  </AlertDialog>
</div>
```

#### Page-level action bar
File: [src/components/billing/invoice-detail-client.tsx:277-374](src/components/billing/invoice-detail-client.tsx#L277-L374)
- Outer: `flex items-center justify-between`
- Inner cluster: `flex items-center gap-2`
- Icons: `h-4 w-4 mr-1`
- Destructive outline buttons: `variant="outline"` + `className="text-destructive"`

### Toast + Feedback

All billing flows use `sonner`:
- `toast.success('Invoice deleted')` — [invoice-detail-client.tsx:236](src/components/billing/invoice-detail-client.tsx#L236)
- `toast.error(result.error)` — error branches
- After success: `router.refresh()` (status transitions) or `router.push` (delete).

## Code References

- [src/app/(dashboard)/patients/[caseId]/billing/page.tsx:1-24](src/app/(dashboard)/patients/%5BcaseId%5D/billing/page.tsx) — Billing route entry
- [src/components/billing/billing-page-client.tsx:80-107](src/components/billing/billing-page-client.tsx#L80-L107) — Top-level billing client
- [src/components/billing/billing-table.tsx:37-94](src/components/billing/billing-table.tsx#L37-L94) — TanStack column defs (no actions column)
- [src/components/billing/billing-table.tsx:139-147](src/components/billing/billing-table.tsx#L139-L147) — Row click navigation to detail
- [src/components/billing/invoice-detail-client.tsx:278-309](src/components/billing/invoice-detail-client.tsx#L278-L309) — Download PDF button
- [src/components/billing/invoice-detail-client.tsx:229-240](src/components/billing/invoice-detail-client.tsx#L229-L240) — `handleDelete` function
- [src/components/billing/invoice-detail-client.tsx:316-319](src/components/billing/invoice-detail-client.tsx#L316-L319) — Delete button (draft-only)
- [src/components/billing/invoice-detail-client.tsx:565-580](src/components/billing/invoice-detail-client.tsx#L565-L580) — Delete confirmation dialog
- [src/actions/billing.ts:492-523](src/actions/billing.ts#L492-L523) — `deleteInvoice` server action
- [src/actions/billing.ts:525-534](src/actions/billing.ts#L525-L534) — `generateInvoicePdf` server action
- [src/lib/constants/invoice-status.ts:9-16](src/lib/constants/invoice-status.ts#L9-L16) — Allowed transitions (delete vs void eligibility)
- [src/lib/filenames/build-download-filename.ts:19-31](src/lib/filenames/build-download-filename.ts#L19-L31) — Filename builder
- [src/components/documents/document-card.tsx:197-234](src/components/documents/document-card.tsx#L197-L234) — Closest row-level action cluster analog

## Architecture Documentation

- **Server actions file layout**: one `src/actions/<domain>.ts` per domain; `'use server'` at top; each action returns `{ data? , error? }` shape. `revalidatePath` is called inside the action (no client-side invalidation).
- **Soft-delete convention**: every domain table has `deleted_at timestamptz NULL`; every read filters `.is('deleted_at', null)`.
- **Invoice mutation guards**: `assertCaseNotClosed()` is the shared case-closed check used by `createInvoice`, `updateInvoice`, `deleteInvoice`.
- **PDF generation**: ephemeral (no storage). The server action returns a base64 Buffer; the client builds a Blob and triggers download. `@react-pdf/renderer` + `sharp` for image conversion.
- **Table UI**: TanStack Table v8 with column defs as a top-level `const`. Rows are clickable via `onClick` on `<TableRow>` (no explicit navigation link inside cells).
- **Confirmation UX**: destructive actions (delete, void, write off) all use shadcn `AlertDialog`. Two subpatterns — inline `AlertDialogTrigger asChild` vs. controlled `open` state + side-effectful `onClick`.
- **Status gating**: destructive UI (Edit/Delete) is conditionally rendered based on `currentStatus === 'draft'`. Non-draft invoices get Void/WriteOff instead.
- **Download naming**: `buildDownloadFilename` is the shared helper used by documents, discharge, and invoices for consistent `{LastName}_{DocType}_{YYYY-MM-DD}.pdf` naming.

## Related Research

- [thoughts/shared/research/2026-04-22-case-close-invoice-check.md](thoughts/shared/research/2026-04-22-case-close-invoice-check.md) — medical-invoice requirement for case closure (touches same `invoices` table)
- [thoughts/shared/research/2026-04-16-user-friendly-download-filenames.md](thoughts/shared/research/2026-04-16-user-friendly-download-filenames.md) — origin of `buildDownloadFilename`

## Open Questions

- Whether the requested row-level buttons should respect the same draft-only guard on Delete (detail page does). The `deleteInvoice` server action already enforces this server-side, so a row button would still need client-side conditional render or disabled state to avoid surprising UX.
- Whether Download should be available in all statuses (detail page currently always renders it — not draft-gated).
- Whether row-level Delete should redirect on success (detail page does `router.push`) or stay on the list and rely on `revalidatePath` (the latter is the natural fit for a row button).
