---
date: 2026-03-17T22:42:05Z
researcher: Claude
git_commit: 27664a306102dc95b221196fc13e9d921acdff27
branch: main
repository: cliniq
topic: "How to incorporate the NPMD Authorization and Lien Agreement form into ClinIQ"
tags: [research, codebase, lien, pdf-generation, documents, forms, signatures]
status: complete
last_updated: 2026-03-17
last_updated_by: Claude
---

# Research: Incorporating the NPMD Lien Form into ClinIQ

**Date**: 2026-03-17T22:42:05Z
**Researcher**: Claude
**Git Commit**: 27664a306102dc95b221196fc13e9d921acdff27
**Branch**: main
**Repository**: cliniq

## Research Question
How can we incorporate the NPMD "Authorization and Lien Agreement" form into the ClinIQ application?

## Summary

The lien form is a one-page legal document requiring patient/attorney information and two signatures. ClinIQ already has all the infrastructure needed to support this:

1. **Data**: All fields on the lien form already exist in the database (`patients`, `cases`, `attorneys` tables, plus `cases.lien_on_file` boolean)
2. **PDF generation**: `@react-pdf/renderer` is already used for 4 document types with a consistent template pattern
3. **Document storage**: The `documents` table and `case-documents` storage bucket handle PDF storage/retrieval
4. **Signature capture**: Provider signature upload already exists; the same pattern can extend to patient/attorney signatures

The lien form maps to existing data as follows:

| Lien Form Field | Source in ClinIQ |
|---|---|
| Patient Name | `patients.first_name` + `patients.last_name` |
| Date of Birth | `patients.date_of_birth` |
| Date of Injury | `cases.accident_date` |
| Provider | `provider_profiles.display_name` + `provider_profiles.credentials` |
| Attorney (To) | `attorneys.first_name` + `attorneys.last_name`, `attorneys.firm_name` |

The two elements that **do not yet exist** are:
- **Patient signature capture** (provider signature upload exists at `src/components/settings/provider-signature-upload.tsx` but there is no patient-facing signature mechanism)
- **Attorney signature capture** (attorneys are data records with no user accounts or signature storage)

## Detailed Findings

### Current Lien-Related Code

The `lien_on_file` boolean already exists across the stack:

- **Database**: `cases.lien_on_file boolean default false` (migration `001_initial_schema.sql:87`)
- **Zod validation**: `lien_on_file: z.boolean()` in `src/lib/validations/patient.ts` (both `patientDetailsSchema` and `editCaseSchema`)
- **Patient wizard**: Checkbox shown conditionally when attorney is selected (`src/components/patients/wizard-step-details.tsx`)
- **Case edit dialog**: Checkbox in edit form (`src/components/patients/case-overview-edit-dialog.tsx`)

This boolean currently serves as a manual flag. The lien form PDF generation would complement this by producing the actual signed document.

### Existing PDF Template Pattern

All 4 existing PDF templates follow the same architecture:

1. **Data interface** — TypeScript interface defining all template fields (e.g., `InvoicePdfData`)
2. **Template component** — React component using `@react-pdf/renderer` primitives (`src/lib/pdf/invoice-template.tsx`)
3. **Render function** — Server-side function that assembles data from the database and renders to PDF buffer (`src/lib/pdf/render-invoice-pdf.ts`)
4. **Server action** — Called from the UI to trigger generation and storage (`src/actions/`)

Key conventions from existing templates:
- Clinic logo and signatures passed as base64 strings
- `StyleSheet.create()` for PDF styles
- `LETTER` page size with 50pt padding
- Clinic header centered at top with logo, address, phone, fax
- `fontFamily: 'Helvetica'` / `'Helvetica-Bold'`

### Document Storage System

Generated PDFs are stored via:
- **Storage bucket**: `case-documents` (private, 50MB limit, PDF/JPEG/PNG/WebP/DOCX)
- **Metadata table**: `documents` with fields for `case_id`, `document_type`, `file_name`, `file_path`, `file_size_bytes`, `mime_type`, `status`
- **Current document types**: `mri_report`, `chiro_report`, `pain_management`, `pt_report`, `orthopedic_report`, `ct_scan`, `generated`, `other`

A lien form could use `document_type = 'generated'` (matching other system-generated PDFs) or a new `'lien_agreement'` type could be added.

### Signature Infrastructure

**What exists — Provider signatures**:
- Upload component: `src/components/settings/provider-signature-upload.tsx`
- Storage: `clinic-assets` bucket, path stored in `provider_profiles.signature_storage_path`
- Usage: Base64-encoded and embedded in PDF templates (initial visit, procedure note, discharge note)

**What would be needed for lien signatures**:

For a clinic-managed workflow (staff generates the form, collects physical signatures, uploads the signed copy):
- No new signature infrastructure needed — use existing document upload

For a digital signature workflow:
- Patient signature field on `cases` or a new `lien_documents` table
- Attorney signature storage (currently attorneys have no signature field)
- A signature pad component (e.g., `react-signature-canvas`) or consent checkbox

### Form Component Patterns Available

The codebase has established patterns for every form scenario needed:

1. **Dialog-based form** — For generating a lien form from the case dashboard (pattern: `case-overview-edit-dialog.tsx`)
2. **PDF preview** — Components exist for in-browser PDF display (`src/components/documents/pdf-viewer.tsx`, `pdf-preview.tsx`)
3. **File upload** — TUS-based resumable upload for signed documents (`src/components/documents/upload-sheet.tsx`)
4. **Server actions** — Consistent `{ data } | { error }` return pattern

## Architecture Documentation

### Implementation Approaches

There are three levels of complexity for incorporating the lien form:

#### Approach A: PDF Generation Only (Simplest)
Generate a pre-filled lien form PDF from case data. Staff prints it, collects wet signatures, and optionally uploads the signed scan.

Components needed:
- `src/lib/pdf/lien-agreement-template.tsx` — New PDF template matching the NPMD form layout
- `src/lib/pdf/render-lien-agreement-pdf.ts` — Render function that pulls case/patient/attorney data
- `src/actions/lien.ts` — Server action to generate and optionally store the PDF
- UI trigger (button on case dashboard or documents page)

#### Approach B: PDF Generation + Upload Tracking (Medium)
Same as A, plus tracking whether the signed lien has been received back.

Additional components:
- New `document_type = 'lien_agreement'` in the documents table CHECK constraint (migration)
- Update `cases.lien_on_file` to `true` automatically when a `lien_agreement` document is uploaded
- Filter/badge on case dashboard showing lien status

#### Approach C: Digital Signatures (Most Complex)
Full digital workflow where patient and attorney sign within the application.

Additional components:
- Signature pad component (new dependency like `react-signature-canvas`)
- Database fields for patient/attorney signature storage
- Lien-specific workflow state (draft → patient_signed → attorney_signed → complete)
- Potentially a separate `lien_documents` table

## Code References

- `supabase/migrations/001_initial_schema.sql:87` — `lien_on_file boolean default false`
- `src/lib/validations/patient.ts` — Zod schemas with `lien_on_file` field
- `src/components/patients/wizard-step-details.tsx` — Lien checkbox UI
- `src/lib/pdf/invoice-template.tsx` — Reference PDF template pattern
- `src/lib/pdf/render-invoice-pdf.ts` — Reference render function pattern
- `src/components/settings/provider-signature-upload.tsx` — Existing signature upload pattern
- `src/components/documents/upload-sheet.tsx` — Document upload component
- `src/components/documents/pdf-viewer.tsx` — PDF preview component
- `src/actions/documents.ts` — Document CRUD server actions

## Historical Context (from thoughts/)

- `thoughts/shared/research/2026-03-05-epic-1-patient-case-management-design.md` — Original design research that established `lien_on_file` as a case-level boolean field
- `thoughts/shared/plans/2026-03-05-epic-1-story-1.1-create-patient-case.md` — Implementation plan that included lien checkbox in the patient creation wizard
- `thoughts/shared/plans/2026-03-08-epic-0-story-0.4-provider-signature.md` — Provider signature capture pattern that could be extended for patient/attorney signatures
- `thoughts/shared/plans/2026-03-13-epic-6-story-6.3-export-invoice-pdf.md` — Invoice PDF generation plan showing the established PDF template workflow

## Open Questions

1. **Which approach do you prefer?** (A: PDF-only, B: PDF + tracking, C: digital signatures)
2. **Should the lien form be auto-generated during case creation** (when attorney is assigned and lien checkbox is checked), or generated on-demand from the case dashboard?
3. **Provider field**: The PDF lists "Stephen Carney, MD / Armine Tadevosyan, FNP" as static text. Should this pull from the assigned provider, or remain hardcoded as clinic providers?
4. **Clinic branding**: The form has the NPMD logo and address. Should these pull from `clinic_settings` (making it dynamic for any clinic), or be hardcoded for NPMD specifically?
