---
date: 2026-04-16T18:26:50Z
researcher: arsenaid
git_commit: ab981f5b89d528b6e157e4d2f31e35b100c312f1
branch: main
repository: cliniq
topic: "User-friendly filenames for document downloads (attorney-bound files)"
tags: [research, codebase, downloads, pdf, filenames, supabase-storage, attorneys]
status: complete
last_updated: 2026-04-16
last_updated_by: arsenaid
---

# Research: User-friendly filenames for document downloads (attorney-bound files)

**Date**: 2026-04-16T18:26:50Z
**Researcher**: arsenaid
**Git Commit**: ab981f5b89d528b6e157e4d2f31e35b100c312f1
**Branch**: main
**Repository**: cliniq

## Research Question
"Help me to implement user-friendly file names for downloads. Those files need to be sent to attorneys."

This research documents the **current** state of how downloadable PDFs are named, stored, and delivered in the cliniq codebase — including every entry point, the data available at each site, and the two distinct download mechanisms currently in use. Per the `/research_codebase` contract, this document describes what exists; it does not propose changes.

## Summary

Every downloadable artifact in the app is a PDF. They fall into two groups based on how the file reaches the browser, and the two groups use different filename mechanisms:

1. **Stored-then-signed-URL downloads** (discharge note, initial visit note, pain evaluation visit note, procedure note, imaging order, chiropractic order, and every document in the Documents tab) — the file is rendered once, uploaded to Supabase Storage at `cases/<caseId>/<slug>-<Date.now()>.pdf`, and later downloaded via `getDocumentDownloadUrl(filePath)`. That function calls `supabase.storage.createSignedUrl(filePath, 3600, { download: true })`. The client opens the signed URL with `window.open(url, '_blank')` — **no `<a download="...">` attribute is set**. The browser-visible filename is therefore derived by the browser from Supabase's `Content-Disposition` header, which is built from the storage object's path key. So the user sees filenames like `discharge-note-1712345678901.pdf` or `procedure-note-<uuid>-<ts>.pdf`.

2. **In-memory base64 → Blob → `<a download>` downloads** (invoice PDF, lien agreement PDF, procedure consent PDF) — the PDF is rendered server-side, returned to the client as base64, decoded to a `Blob`, and programmatically clicked through an anchor with a hardcoded `a.download` string. These filenames are deterministic but do not include patient or case identifiers (e.g., `Authorization-and-Lien-Agreement.pdf`, `Procedure-Consent-Form.pdf`). Invoice is the one exception that interpolates `invoice.invoice_number`: `Invoice-<invoice_number>.pdf`.

The `documents` table does carry a human-readable `file_name` column (e.g., `'Discharge Summary'`, `'Initial Visit Note'`, `'Imaging Orders'`), but that value is **only used as a UI label**; it is never sent to the browser during a download. The storage object key, not the `file_name` column, controls what the browser saves.

Patient name, case number, and visit/accident/procedure dates are all queried during PDF generation (and are in component props at every download site), but none of them flow into the filename on disk or on download today.

## Detailed Findings

### 1. The two download mechanisms

#### Mechanism A — `getDocumentDownloadUrl` + `window.open`

Function definition: [src/actions/documents.ts:135-143](src/actions/documents.ts#L135-L143)

```ts
export async function getDocumentDownloadUrl(filePath: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.storage
    .from('case-documents')
    .createSignedUrl(filePath, 3600, { download: true })
  if (error) return { error: error.message }
  return { url: data.signedUrl }
}
```

Key behavior:
- Third arg `{ download: true }` sets `Content-Disposition: attachment` on the signed URL response.
- No filename string is passed to `createSignedUrl` (the supported signature is `{ download: true | string }`).
- Callers open the URL with `window.open(result.url, '_blank')` — they do not build an `<a>` element, so `a.download` is never set.
- Consequence: the browser infers the filename from Supabase's `Content-Disposition` header, which mirrors the storage path's terminal segment (e.g., `discharge-note-1712345678901.pdf`). The `documents.file_name` DB column is not consulted during this flow.

A sibling function `getDocumentPreviewUrl` ([src/actions/documents.ts:216-224](src/actions/documents.ts#L216-L224)) uses the same bucket and expiry but omits `{ download: true }` so the PDF renders inline.

#### Mechanism B — Server-generated base64 → Blob → `<a download="...">`

Used by three flows, each with a hardcoded filename:

- Invoice ([src/components/billing/invoice-detail-client.tsx:279-294](src/components/billing/invoice-detail-client.tsx#L279-L294)) — `a.download = \`Invoice-${invoice.invoice_number}.pdf\`` at line 292. This is the **only** place that interpolates a dynamic identifier into the filename.
- Lien agreement ([src/components/patients/case-overview.tsx:80-108](src/components/patients/case-overview.tsx#L80-L108)) — `a.download = 'Authorization-and-Lien-Agreement.pdf'` at line 100.
- Procedure consent (unsigned), two call sites:
  - [src/components/patients/case-overview.tsx:110-134](src/components/patients/case-overview.tsx#L110-L134) — `a.download = 'Procedure-Consent-Form.pdf'` at line 126.
  - [src/components/procedures/record-procedure-dialog.tsx:162-173](src/components/procedures/record-procedure-dialog.tsx#L162-L173) — `a.download = 'Procedure-Consent-Form.pdf'` at line 170.

All three server actions still upload a copy to Supabase Storage and insert a `documents` row in addition to returning base64 (so the file is both downloadable in-memory right now and later accessible through the Documents tab via mechanism A).

### 2. Every download entry point, enumerated

| # | UI component | Trigger file:line | Data passed to download | `a.download` value | Mechanism |
|---|---|---|---|---|---|
| 1 | Discharge note editor | [src/components/discharge/discharge-note-editor.tsx:565-577](src/components/discharge/discharge-note-editor.tsx#L565-L577) | `documentFilePath` storage key | not set | A |
| 2 | Procedure note editor | [src/components/procedures/procedure-note-editor.tsx:586-598](src/components/procedures/procedure-note-editor.tsx#L586-L598) | `documentFilePath` storage key | not set | A |
| 3 | Initial visit editor – main note button | [src/components/clinical/initial-visit-editor.tsx:1859-1872](src/components/clinical/initial-visit-editor.tsx#L1859-L1872) | `documentFilePath` storage key | not set | A |
| 4 | Initial visit editor – clinical order buttons | [src/components/clinical/initial-visit-editor.tsx:2091-2096](src/components/clinical/initial-visit-editor.tsx#L2091-L2096) (handler) and line 2184 (call site) | `order.document.file_path` | not set | A |
| 5 | Document card (Documents tab) | [src/components/documents/document-card.tsx:89-96](src/components/documents/document-card.tsx#L89-L96) (handler), download button line 144 | `document.file_path` | not set | A |
| 6 | Invoice detail page | [src/components/billing/invoice-detail-client.tsx:279-294](src/components/billing/invoice-detail-client.tsx#L279-L294) | base64 via `generateInvoicePdf(invoice.id)` | `` `Invoice-${invoice.invoice_number}.pdf` `` | B |
| 7 | Case overview – lien | [src/components/patients/case-overview.tsx:80-108](src/components/patients/case-overview.tsx#L80-L108) | base64 via `generateLienAgreement(caseData.id)` | `'Authorization-and-Lien-Agreement.pdf'` | B |
| 8 | Case overview – procedure consent | [src/components/patients/case-overview.tsx:110-134](src/components/patients/case-overview.tsx#L110-L134) | base64 via `generateProcedureConsent({ caseId })` | `'Procedure-Consent-Form.pdf'` | B |
| 9 | Record-procedure dialog – consent | [src/components/procedures/record-procedure-dialog.tsx:162-173](src/components/procedures/record-procedure-dialog.tsx#L162-L173) | base64 via `generateProcedureConsent({ caseId, procedureId })` | `'Procedure-Consent-Form.pdf'` | B |

### 3. Storage-path templates and `documents.file_name` values

Every generator writes both a Supabase Storage key (drives the browser filename under mechanism A) and a `documents.file_name` DB value (shown in the UI only).

| Action | Storage path template | `file_name` inserted into `documents` |
|---|---|---|
| [src/actions/discharge-notes.ts:489, 507](src/actions/discharge-notes.ts#L489) | `cases/${caseId}/discharge-note-${Date.now()}.pdf` | `'Discharge Summary'` |
| [src/actions/initial-visit-notes.ts:517, 529-536](src/actions/initial-visit-notes.ts#L517) | `cases/${caseId}/${visitType}-note-${Date.now()}.pdf` (visitType is `initial_visit` or `pain_evaluation_visit`) | `'Initial Visit Note'` or `'Pain Evaluation Visit Note'` |
| [src/actions/procedure-notes.ts:510, 528](src/actions/procedure-notes.ts#L510) | `cases/${caseId}/procedure-note-${procedureId}-${Date.now()}.pdf` | `'PRP Procedure Note'` |
| [src/actions/procedure-consents.ts:43, 60](src/actions/procedure-consents.ts#L43) | `cases/${input.caseId}/procedure-consent-${Date.now()}.pdf` | `'Procedure Consent Form (Unsigned)'` |
| [src/actions/lien.ts:32, 50-51](src/actions/lien.ts#L32) | `cases/${caseId}/lien-agreement-${Date.now()}.pdf` | `'Authorization and Lien Agreement'` |
| [src/actions/clinical-orders.ts:182-195, 213](src/actions/clinical-orders.ts#L182) (same pattern at 349-362 for finalize) | `cases/${caseId}/${orderType}-order-${Date.now()}.pdf` (orderType is `imaging` or `chiropractic`) | `'Imaging Orders'` or `'Chiropractic Therapy Order'` |
| [src/actions/billing.ts:459-468](src/actions/billing.ts#L459-L468) (`generateInvoicePdf`) | — (no storage upload, no `documents` row) | n/a |
| [src/actions/documents.ts:53-84](src/actions/documents.ts#L53-L84) (manual upload `getUploadSession`) + [:86-133](src/actions/documents.ts#L86-L133) (`saveDocumentMetadata`) | `cases/${caseId}/${Date.now()}-${sanitized}` where `sanitized` replaces every char not in `[a-zA-Z0-9._-]` with `_` | `input.fileName` (user-supplied via upload form) |

### 4. Patient / case data available at each generator

All four main note-generating actions use the same patient join:

```ts
patient:patients!inner(first_name, last_name, date_of_birth, gender)
```

Case-level fields queried vary:
- [src/actions/discharge-notes.ts:44-48](src/actions/discharge-notes.ts#L44-L48) — `case_number, accident_type, accident_date, assigned_provider_id`
- [src/actions/initial-visit-notes.ts:88-95](src/actions/initial-visit-notes.ts#L88-L95) — same four + `accident_description`
- [src/actions/procedure-notes.ts:56-59](src/actions/procedure-notes.ts#L56-L59) — same four as discharge
- [src/actions/clinical-orders.ts:18-37](src/actions/clinical-orders.ts#L18-L37) — **only** `cases.id` from the join; `case_number` is not fetched at this layer; a later `renderImagingOrdersPdf`/`renderChiropracticOrderPdf` pass re-queries `cases.patient.date_of_birth` only
- [src/actions/procedure-consents.ts:27-32](src/actions/procedure-consents.ts#L27-L32) — only `cases.id` (existence check)
- [src/actions/lien.ts:17-24](src/actions/lien.ts#L17-L24) — only `cases.attorney_id`
- [src/actions/billing.ts:470-508](src/actions/billing.ts#L470-L508) (`getInvoiceWithContext`) — `cases.*`, `patients.*`, `attorneys.*` in full

### 5. `documents` table schema

Defined in [supabase/migrations/002_case_dashboard_tables.sql:4-22](supabase/migrations/002_case_dashboard_tables.sql#L4-L22). Typed at [src/types/database.ts:961-979](src/types/database.ts#L961-L979).

Relevant columns for filename work:
- `file_name text NOT NULL` — free-text human label.
- `file_path text NOT NULL` — Supabase Storage object key inside the `case-documents` bucket.
- `document_type text` — constrained by CHECK. After [supabase/migrations/20260408_procedure_consent_document_type.sql](supabase/migrations/20260408_procedure_consent_document_type.sql) the allowed values are: `'mri_report'`, `'chiro_report'`, `'pain_management'`, `'pt_report'`, `'orthopedic_report'`, `'ct_scan'`, `'generated'`, `'lien_agreement'`, `'procedure_consent'`, `'other'`.
- `created_at timestamptz DEFAULT now()` (there is no `uploaded_at` column — `created_at` serves that role).

The storage bucket itself is `case-documents`, private, 50 MB limit, configured in [supabase/migrations/003_document_storage.sql](supabase/migrations/003_document_storage.sql).

### 6. Date-field types

Source of truth in [supabase/migrations/001_initial_schema.sql](supabase/migrations/001_initial_schema.sql) and the migrations under `supabase/migrations/2026*`:

- `patients.date_of_birth` — `date NOT NULL` ([001_initial_schema.sql:48](supabase/migrations/001_initial_schema.sql#L48)); typed `string` in `database.ts`.
- `cases.accident_date` — `date` nullable ([001_initial_schema.sql:79](supabase/migrations/001_initial_schema.sql#L79)); typed `string | null`.
- `cases.case_open_date` — `date NOT NULL DEFAULT current_date` ([001_initial_schema.sql:83](supabase/migrations/001_initial_schema.sql#L83)).
- `initial_visit_notes.visit_date` — `date` ([20260411_initial_visit_visit_date.sql](supabase/migrations/20260411_initial_visit_visit_date.sql)); written as `new Date().toISOString().slice(0, 10)` at [src/actions/initial-visit-notes.ts:261](src/actions/initial-visit-notes.ts#L261).
- `discharge_notes.visit_date` — `date` ([20260412_discharge_notes_visit_date.sql](supabase/migrations/20260412_discharge_notes_visit_date.sql)); written as `new Date().toISOString().slice(0, 10)` at [src/actions/discharge-notes.ts:298](src/actions/discharge-notes.ts#L298).
- `procedures.procedure_date` — `date NOT NULL` ([002_case_dashboard_tables.sql:30](supabase/migrations/002_case_dashboard_tables.sql#L30)).

So all "dates that identify the document" are stored as `YYYY-MM-DD` strings in Postgres `date` columns.

### 7. Case-number format

`cases.case_number` is generated by a database default as `PI-YYYY-NNNN` (e.g., `PI-2026-0042`). See [supabase/migrations/001_initial_schema.sql](supabase/migrations/001_initial_schema.sql) — the sequence-backed default for `case_number`.

### 8. Attorney-specific flow (Documents tab → attorney)

There is currently no dedicated "send to attorney" export path in the codebase. Communication to attorneys happens manually: a staff user opens the Documents tab on a case, downloads each needed file, and attaches it outside the app (email/fax). The Documents tab renders each document via [src/components/documents/document-card.tsx](src/components/documents/document-card.tsx), which:
- Shows `document.file_name` as the label (line 119) and in the preview dialog (line 178).
- On "Download" click, calls `getDocumentDownloadUrl(document.file_path)` and `window.open(...)` (lines 89-96, 144).

The `attorneys` table and related UI live at:
- [src/actions/attorneys.ts](src/actions/attorneys.ts)
- [src/components/attorneys/attorney-form.tsx](src/components/attorneys/attorney-form.tsx)
- [src/components/attorneys/attorney-select.tsx](src/components/attorneys/attorney-select.tsx)
- [src/lib/validations/attorney.ts](src/lib/validations/attorney.ts)

Attorney data is joined into case queries (e.g., the invoice flow at [src/actions/billing.ts:470-508](src/actions/billing.ts#L470-L508) pulls `attorney:attorneys(*)`), but attorney identifiers do not appear in any filename or storage path today.

## Code References

- [src/actions/documents.ts:135-143](src/actions/documents.ts#L135-L143) — `getDocumentDownloadUrl`, the single place that creates attachment-mode signed URLs.
- [src/actions/documents.ts:216-224](src/actions/documents.ts#L216-L224) — `getDocumentPreviewUrl`, the inline-mode sibling.
- [src/actions/documents.ts:53-84](src/actions/documents.ts#L53-L84) — `getUploadSession`, defines the `cases/<caseId>/<ts>-<sanitized>` manual-upload path and the `[^a-zA-Z0-9._-]` → `_` sanitizer.
- [src/actions/documents.ts:86-133](src/actions/documents.ts#L86-L133) — `saveDocumentMetadata`, inserts the `file_name` the uploader typed.
- [src/actions/discharge-notes.ts:489, 507](src/actions/discharge-notes.ts#L489) — discharge note storage path + `file_name: 'Discharge Summary'`.
- [src/actions/initial-visit-notes.ts:517, 529-536](src/actions/initial-visit-notes.ts#L517) — initial/pain-eval visit note path + branching `file_name`.
- [src/actions/procedure-notes.ts:510, 528](src/actions/procedure-notes.ts#L510) — procedure note path + `file_name: 'PRP Procedure Note'`.
- [src/actions/procedure-consents.ts:43, 60](src/actions/procedure-consents.ts#L43) — consent path + `file_name: 'Procedure Consent Form (Unsigned)'`.
- [src/actions/lien.ts:32, 50-51](src/actions/lien.ts#L32) — lien path + `file_name: 'Authorization and Lien Agreement'`.
- [src/actions/clinical-orders.ts:182-213](src/actions/clinical-orders.ts#L182-L213) — order path + `file_name` branching on `orderType` (same logic duplicated at 349-362 for finalize).
- [src/actions/billing.ts:459-468](src/actions/billing.ts#L459-L468) — `generateInvoicePdf` returns base64; no storage upload or `documents` row.
- [src/components/billing/invoice-detail-client.tsx:279-294](src/components/billing/invoice-detail-client.tsx#L279-L294) — the only dynamic `a.download` (uses `invoice.invoice_number`).
- [src/components/patients/case-overview.tsx:80-134](src/components/patients/case-overview.tsx#L80-L134) — the two hardcoded `a.download` sites for lien and consent.
- [src/components/procedures/record-procedure-dialog.tsx:162-173](src/components/procedures/record-procedure-dialog.tsx#L162-L173) — third hardcoded `a.download` for consent inside a procedure recording.
- [src/components/discharge/discharge-note-editor.tsx:565-577](src/components/discharge/discharge-note-editor.tsx#L565-L577), [src/components/procedures/procedure-note-editor.tsx:586-598](src/components/procedures/procedure-note-editor.tsx#L586-L598), [src/components/clinical/initial-visit-editor.tsx:1859-1872](src/components/clinical/initial-visit-editor.tsx#L1859-L1872) and [:2091-2096](src/components/clinical/initial-visit-editor.tsx#L2091-L2096), [src/components/documents/document-card.tsx:89-96](src/components/documents/document-card.tsx#L89-L96) — the five mechanism-A download handlers. None set `a.download`.
- [supabase/migrations/002_case_dashboard_tables.sql:4-22](supabase/migrations/002_case_dashboard_tables.sql#L4-L22) — `documents` table DDL (`file_name`, `file_path`, `document_type`, etc.).
- [supabase/migrations/003_document_storage.sql](supabase/migrations/003_document_storage.sql) — `case-documents` bucket config and RLS.
- [src/types/database.ts:961-979](src/types/database.ts#L961-L979) — `documents` TypeScript `Row` type.

## Architecture Documentation

**Storage convention in use today.** The Supabase Storage bucket `case-documents` is partitioned by case: `cases/<caseId>/...`. Generated PDFs use a document-type slug plus `Date.now()` for uniqueness (`discharge-note-<ts>.pdf`, `procedure-note-<procedureId>-<ts>.pdf`, `<orderType>-order-<ts>.pdf`, etc.). Manually uploaded files prefix `Date.now()` to a sanitized form of the user's original filename.

**Two download code paths.** The codebase has settled on two distinct download code paths, chosen per document type:
- Mechanism A (signed URL): documents that live in Storage and are reopened later. This is the path for every note-type PDF and for everything in the Documents tab.
- Mechanism B (in-memory base64 + anchor): documents that are generated on demand from live DB state for a right-now download. This is the path for invoice, lien, and consent. Lien and consent also write a copy to Storage, so they subsequently become available through Mechanism A as well; invoice does not.

**`documents.file_name` as a label, not a filename.** The human-readable string in `documents.file_name` is used in list views, cards, and preview dialogs ([src/components/documents/document-card.tsx:119, 178](src/components/documents/document-card.tsx#L119)). It is **not** threaded into `createSignedUrl`'s `download` option (the function is called with `{ download: true }`, not `{ download: 'My File.pdf' }`), so it does not influence the filename the browser writes to disk. For manual uploads, `file_name` equals what the uploader typed; for generated PDFs, it is a static per-document-type label.

**Data availability at every generator.** Each note-generating action already joins `patients(first_name, last_name, date_of_birth, gender)` and (where relevant) reads `cases.case_number` and `cases.accident_date`. Consent and lien actions, by contrast, do not fetch any patient fields at the action layer — those fields are only resolved deeper inside the renderer functions.

**Every download-button component already has patient + case context.** The client components that host the download buttons (`discharge-note-editor`, `procedure-note-editor`, `initial-visit-editor`, `case-overview`, `record-procedure-dialog`, `invoice-detail-client`) all receive a `caseData` (or equivalent) prop containing at minimum `case_number`, `patient.first_name`, and `patient.last_name`. `DocumentCardProps` is the one exception: it gets only the `documents` row fields and does not receive patient or case context.

## Related Research

- [thoughts/shared/research/2026-03-06-epic-1-story-1.3-patient-document-repository.md](thoughts/shared/research/2026-03-06-epic-1-story-1.3-patient-document-repository.md) — original design of the `documents` table, storage bucket, and upload/review flow.
- [thoughts/shared/research/2026-03-17-lien-form-integration.md](thoughts/shared/research/2026-03-17-lien-form-integration.md) — how lien agreement generation plugs into the same document pipeline.
- [thoughts/shared/research/2026-03-13-invoice-line-items-from-product-catalog.md](thoughts/shared/research/2026-03-13-invoice-line-items-from-product-catalog.md) — invoice PDF generation context.

## Open Questions

- What filename shape do attorneys (and firms the clinic works with) actually expect? The three typical fields are patient last name, case number, and document date — but the exact format/order is a policy choice, not a codebase fact.
- Should the filename reflect the **document date** (visit/procedure/discharge date stored in the row) or the **generation timestamp** currently embedded in the storage path? These can diverge: a discharge note finalized on 2026-04-16 can have a `visit_date` of 2026-04-10.
- Is a separate signed-per-download name acceptable (no storage rename), or does the file on disk inside Supabase Storage also need to match? Supabase's `createSignedUrl` supports `{ download: '<filename>' }` to override the `Content-Disposition` filename at sign time without changing the stored key — but whether to use that vs. actually renaming keys is a product call.
