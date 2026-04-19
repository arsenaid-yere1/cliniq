---
date: 2026-04-16
author: arsenaid
git_commit: ab981f5b89d528b6e157e4d2f31e35b100c312f1
branch: main
repository: cliniq
status: validated
validated_on: 2026-04-16
validated_by: arsenaid
related_research: thoughts/shared/research/2026-04-16-user-friendly-download-filenames.md
---

# Plan: User-friendly download filenames (`<LastName>_<DocType>_<Date>.pdf`)

## Goal

Every PDF downloaded from the app should arrive on disk with a filename an attorney can immediately recognize:

```
<LastName>_<DocType>_<YYYY-MM-DD>.pdf
```

- **LastName** = `patients.last_name`, accents stripped (NFD + diacritic strip), everything outside `[A-Za-z0-9-]` removed. E.g., `O'Brien` → `OBrien`, `Van Der Berg` → `VanDerBerg`, `Núñez` → `Nunez`.
- **DocType** = a fixed PascalCase label per document kind (see table below).
- **Date** = the document's **content date** — visit date, procedure date, invoice date, discharge date, accident date — formatted `YYYY-MM-DD`. Fall back to `created_at` (uploaded/generated date) only when the content date is missing; manually uploaded docs have no content date so they use `created_at`.
- **Collisions** — not handled in code; the browser already appends `(1)`, `(2)`, … when a user re-downloads. Confirmed per user decision.

## Decisions locked in

| Question | Decision |
|---|---|
| Last name cleanup | NFD normalize, strip combining marks, then strip all chars outside `[A-Za-z0-9-]`; collapse consecutive `-`; trim leading/trailing `-`; fall back to `Unknown` if empty. |
| Date source | Visit date for notes, procedure date for procedure note, discharge date for discharge note, invoice date for invoices, accident date for lien, procedure date for consents (fall back to today). Manual uploads use `created_at`. |
| Collision handling | Browser-native `(1)`, `(2)` suffixing. No server-side counter. |
| Storage key rename | **No.** Existing storage keys stay as-is. We control the browser filename via `Content-Disposition`. |

## Strategy

Two mechanisms are in play (see [research doc](../research/2026-04-16-user-friendly-download-filenames.md)). We handle them independently:

- **Mechanism A (signed URL)** — pass a filename string to `createSignedUrl`'s `download` option. Supabase supports `download: string` in addition to `download: true`, and it sets `Content-Disposition: attachment; filename="<name>"` on the signed URL response. No migration of storage keys needed.
- **Mechanism B (in-memory base64 + `<a download>`)** — replace the hardcoded `a.download` strings with the computed user-friendly name.

All filename construction goes through **one shared helper** so the format stays consistent across both mechanisms.

## Doc-type labels

Mapped from the internal document shape (action source, `document_type` enum value, or invoice) to the user-visible PascalCase label used in filenames:

| Source | DocType label |
|---|---|
| Discharge note (`discharge-notes.ts`) | `DischargeSummary` |
| Initial visit note, `visit_type = 'initial_visit'` | `InitialVisitNote` |
| Initial visit note, `visit_type = 'pain_evaluation_visit'` | `PainEvaluationVisitNote` |
| Procedure note (`procedure-notes.ts`) | `ProcedureNote<N>` — `N` = `procedures.procedure_number` (1-based sequence within the case). E.g., `Israyelyan_ProcedureNote1_2026-02-17.pdf`. Fallback `1` when null (matches existing fallbacks at `src/actions/procedure-notes.ts:184` and the page loader). |
| Procedure consent (`procedure-consents.ts`) | `ProcedureConsent` |
| Lien agreement (`lien.ts`) | `LienAgreement` |
| Clinical order, `orderType = 'imaging'` | `ImagingOrders` |
| Clinical order, `orderType = 'chiropractic'` | `ChiropracticOrder` |
| Invoice (`billing.ts`) | `MedicalInvoice` when `invoice_type = 'visit'`, `MedicalFacilityInvoice` when `invoice_type = 'facility'` — filename becomes `<LastName>_<MedicalInvoice\|MedicalFacilityInvoice>_<invoice_date>.pdf`. Labels mirror the on-PDF title at `src/components/billing/invoice-detail-client.tsx:403`. Same-day collisions are handled by the browser's `(1)`, `(2)` suffixing. |
| Manually uploaded document, by `document_type` | `mri_report` → `MRIReport`, `chiro_report` → `ChiroReport`, `pain_management` → `PainManagement`, `pt_report` → `PTReport`, `orthopedic_report` → `OrthopedicReport`, `ct_scan` → `CTScan`, `lien_agreement` → `LienAgreement`, `procedure_consent` → `ProcedureConsent`, `generated` → `Generated`, `other` → sanitized original filename (no prefix) |

## Critical files

### New

- `src/lib/filenames/build-download-filename.ts` — pure helper `buildDownloadFilename({ lastName, docType, date })` + `slugifyLastName(name)`. Small, unit-testable, no imports from Supabase or React.
- `src/lib/filenames/__tests__/build-download-filename.test.ts` — covers accents, apostrophes, spaces, empty names, date formatting, invoice variant.

### Modified

- `src/actions/documents.ts` — `getDocumentDownloadUrl` gains an optional `downloadName` param (default falls back to current `{ download: true }` behavior for any legacy callers). `listDocuments` adds the patient join so callers can derive the filename.
- `src/components/documents/document-card.tsx` — receive `patientLastName` via props, compute filename, pass to `getDocumentDownloadUrl`.
- `src/components/documents/document-list.tsx` (or wherever `DocumentCard` is rendered) — thread `patientLastName` through.
- `src/components/discharge/discharge-note-editor.tsx` — compute filename from `caseData.patient.last_name`, `note.visit_date || note.discharge_date`, pass to `getDocumentDownloadUrl`.
- `src/components/procedures/procedure-note-editor.tsx` — same, using `procedureInfo.procedure_date`.
- `src/components/clinical/initial-visit-editor.tsx` — same at all three download sites; orders use `order.created_at` or initial-visit's `visit_date`.
- `src/components/billing/invoice-detail-client.tsx` — replace hardcoded `Invoice-${invoice_number}.pdf` with the new helper (needs `patientLastName` + `invoice_date` in scope; the invoice detail page already fetches `case.patient` via `getInvoiceWithContext`, so thread it through the client component).
- `src/components/patients/case-overview.tsx` — compute filename for lien + consent; `caseData.patient.last_name` already in scope.
- `src/components/procedures/record-procedure-dialog.tsx` — compute filename for consent; check what patient context exists in this dialog's props (likely needs a prop addition).

## Step-by-step implementation

### Step 1 — Shared helper (start here, it's the crux)

Create `src/lib/filenames/build-download-filename.ts`:

```ts
export function slugifyLastName(raw: string | null | undefined): string {
  if (!raw) return 'Unknown'
  const stripped = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')    // strip combining accents
    .replace(/[^A-Za-z0-9-]/g, '')       // drop spaces, apostrophes, punctuation
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return stripped.length > 0 ? stripped : 'Unknown'
}

export function formatFilenameDate(date: string | Date | null | undefined): string {
  if (!date) return new Date().toISOString().slice(0, 10)
  if (date instanceof Date) return date.toISOString().slice(0, 10)
  // Already YYYY-MM-DD from Postgres date columns
  if (/^\d{4}-\d{2}-\d{2}/.test(date)) return date.slice(0, 10)
  return new Date(date).toISOString().slice(0, 10)
}

export function buildDownloadFilename(opts: {
  lastName: string | null | undefined
  docType: string
  date?: string | Date | null
  extra?: string  // e.g. invoice_number
  extension?: string  // default 'pdf'
}): string {
  const last = slugifyLastName(opts.lastName)
  const parts = [last, opts.docType]
  if (opts.extra) parts.push(opts.extra)
  parts.push(formatFilenameDate(opts.date))
  const ext = opts.extension ?? 'pdf'
  return `${parts.join('_')}.${ext}`
}
```

Unit tests in `src/lib/filenames/__tests__/build-download-filename.test.ts` following the existing `vitest` patterns in `src/lib/validations/__tests__/*.test.ts`. Cases:
- `O'Brien` → `OBrien`
- `Núñez` → `Nunez`
- `Van Der Berg` → `VanDerBerg`
- `"   "` → `Unknown`
- `null` → `Unknown`
- date `'2026-04-10'` passes through
- date `'2026-04-10T12:34:56Z'` → `'2026-04-10'`
- invoice variants: `Smith_MedicalInvoice_2026-04-10.pdf` (visit) and `Smith_MedicalFacilityInvoice_2026-04-10.pdf` (facility)

### Step 2 — Extend `getDocumentDownloadUrl`

In `src/actions/documents.ts`, change the signature:

```ts
export async function getDocumentDownloadUrl(
  filePath: string,
  downloadName?: string,
) {
  const supabase = await createClient()
  const { data, error } = await supabase.storage
    .from('case-documents')
    .createSignedUrl(filePath, 3600, {
      download: downloadName ?? true,
    })
  if (error) return { error: error.message }
  return { url: data.signedUrl }
}
```

Zero breaking change: existing callers pass one arg, still get `{ download: true }` behavior. New callers pass a filename string. Verify by searching for callers after edit — no type breaks because the new param is optional.

### Step 3 — Update all Mechanism-A call sites (6 total)

For each component, compute `filename = buildDownloadFilename({ lastName, docType, date })` at click-handler time and pass it as the second arg to `getDocumentDownloadUrl`.

**3a. `discharge-note-editor.tsx`** (line ~567) — `caseData.patient.last_name`, `note.visit_date ?? note.discharge_date`, docType `'DischargeSummary'`.

**3b. `procedure-note-editor.tsx`** (line ~586) — `caseData.patient.last_name`, `procedureInfo.procedure_date`, docType `` `ProcedureNote${procedureInfo.procedure_number}` `` (the sequence number is suffixed onto the DocType token itself so underscore separators stay intact; `procedureInfo.procedure_number` is already typed as `number` with a `?? 1` fallback at the page loader — see `src/components/procedures/procedure-note-editor.tsx:116` and `src/app/(dashboard)/patients/[caseId]/procedures/[procedureId]/note/page.tsx:84`).

**3c. `initial-visit-editor.tsx`** — three sites:
- Main note button (~line 1859): `caseData.patient.last_name`, `note.visit_date`, docType depends on `visitType` (`'InitialVisitNote'` vs `'PainEvaluationVisitNote'`).
- Clinical order button (~line 2184) via `handleDownload(order.document.file_path)`: refactor `handleDownload` to also take `{ orderType, orderDate }`. Date source = `order.created_at` (orders have no dedicated date field). DocType from `orderType`.

**3d. `document-card.tsx`** — the tricky one: no patient context in props today. Add `patientLastName: string` to `DocumentCardProps`, then propagate from the parent list. Filename uses `document.document_type` → DocType lookup table, and `document.created_at` for the date (manual uploads have no content date). For `document_type === 'other'`, fall back to `slugify(document.file_name without extension)` as DocType so users still get `Smith_<OriginalName>_<Date>.pdf`.

All three parent pages that render the doc list (`patients/[caseId]/documents/page.tsx`, any others) already fetch the case row; add `patient:patients!inner(last_name)` to those queries and pass down.

### Step 4 — Update Mechanism-B call sites (3 total)

Replace the hardcoded `a.download` string in each:

**4a. `invoice-detail-client.tsx:292`**

```ts
a.download = buildDownloadFilename({
  lastName: invoice.case.patient.last_name,
  docType: invoice.invoice_type === 'facility' ? 'MedicalFacilityInvoice' : 'MedicalInvoice',
  date: invoice.invoice_date,
})
```

Requires that `invoice.case.patient.last_name`, `invoice.invoice_type`, and `invoice.invoice_date` reach the client component. `getInvoiceWithContext` already joins `case.patient(*)` and `invoice_type` is part of the base invoice row — just widen the prop type in `InvoiceDetailClient` as needed. The DocType label mirrors the on-PDF title rendered at `src/components/billing/invoice-detail-client.tsx:403` so filename and document header stay in sync.

**4b. `case-overview.tsx:100`** (lien)

```ts
a.download = buildDownloadFilename({
  lastName: caseData.patient.last_name,
  docType: 'LienAgreement',
  date: caseData.accident_date,
})
```

**4c. `case-overview.tsx:126` + `record-procedure-dialog.tsx:170`** (consent)

```ts
a.download = buildDownloadFilename({
  lastName: caseData.patient.last_name,
  docType: 'ProcedureConsent',
  date: procedureDate ?? new Date(),  // procedure-dialog has procedure.procedure_date; case-overview fallback = today
})
```

For `record-procedure-dialog.tsx`, confirm via reading the file whether `patient.last_name` is in scope; if not, add a `patientLastName` prop and pass from the dialog's parent (which is inside a case page, so it already has access).

### Step 5 — Tests

- `src/lib/filenames/__tests__/build-download-filename.test.ts` — pure helper tests (step 1).
- Update existing `src/actions/__tests__/documents.test.ts` if it covers `getDocumentDownloadUrl` to assert the `downloadName` is forwarded to `createSignedUrl`. Search for the existing test file first; only add coverage if the test already touches this function — don't add tests for untested surface area.
- No component-level tests planned; download flows aren't tested today.

### Step 6 — Manual verification

For each of the 9 download entry points (research doc §2), click download with a test patient whose last name contains an accent (e.g., create a patient `Núñez` for testing) and verify:
- Browser save dialog shows `Nunez_<DocType>_<Date>.pdf`.
- File on disk matches.
- Re-clicking download produces `Nunez_<DocType>_<Date> (1).pdf` (browser collision).

## What's deliberately out of scope

- No rename of existing storage keys. `file_path` in Storage stays `cases/<caseId>/discharge-note-<ts>.pdf` — only the browser-facing name changes via `Content-Disposition`.
- No migration of the `documents.file_name` column. It continues to serve as a UI label.
- No bulk "send to attorney" export (zip, multi-select). Current downloads are one-at-a-time.
- No changes to the `case_number` format.
- No change to invoice's PDF not being stored in `documents` — invoice keeps its in-memory-only generation.

## Success criteria

- [ ] `buildDownloadFilename` covered by unit tests for every edge case listed in step 1.
- [ ] All 9 download entry points from the research doc produce the new filename format.
- [ ] No storage-key rename; no migration.
- [ ] `getDocumentDownloadUrl(filePath)` (no second arg) still works for any caller we missed — backwards compatible.
- [ ] Accented last names arrive ASCII-only on disk.
- [ ] Manual verification checklist in step 6 passes.

## Open items before implementation

None. All decisions locked in. Ready to implement on request.
