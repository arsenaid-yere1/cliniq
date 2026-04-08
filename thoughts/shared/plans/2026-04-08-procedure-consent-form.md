---
date: 2026-04-08
author: arsen
status: draft
ticket: (none — feature request)
related_research: thoughts/shared/research/2026-04-06-procedure-consent-form-implementation.md
---

# Procedure Consent Form Implementation Plan

## Overview

Add a Procedure Consent Form feature that lets a provider **generate a blank, pre-populated PRP consent PDF** for a case, have the patient sign it on paper, and **upload the signed copy back** into the case's documents — mirroring the existing lien agreement flow.

This is an intentionally minimal MVP. There is **no** canvas signature capture, **no** wizard, **no** `procedure_consents` table, **no** state machine, and **no** counter-signature automation. The legal artifact is a paper-signed PDF stored in the `documents` table under a new `'procedure_consent'` type.

## Current State Analysis

Consent today is a single boolean field:
- DB: [supabase/migrations/013_prp_procedure_encounter.sql:8](supabase/migrations/013_prp_procedure_encounter.sql#L8) — `consent_obtained boolean` on `procedures`
- UI: [src/components/procedures/record-procedure-dialog.tsx:303-323](src/components/procedures/record-procedure-dialog.tsx#L303-L323) — checkbox
- AI note: [src/lib/claude/generate-procedure-note.ts:161-162](src/lib/claude/generate-procedure-note.ts#L161-L162) — drives boilerplate text

There is no consent PDF, no consent template, no document-type entry for consents.

**The lien agreement flow is the exact pattern to clone**:
- PDF template: [src/lib/pdf/lien-agreement-template.tsx](src/lib/pdf/lien-agreement-template.tsx) — static legal text paragraphs + `react-pdf` Document with clinic header, patient/attorney fields, signature lines
- Render layer: [src/lib/pdf/render-lien-agreement-pdf.ts](src/lib/pdf/render-lien-agreement-pdf.ts) — fetches case/patient/attorney/clinic data, downloads logo as base64, calls `renderToBuffer()`
- Server action: [src/actions/lien.ts](src/actions/lien.ts) — calls renderer, uploads to `case-documents` bucket at `cases/{caseId}/lien-agreement-{ts}.pdf`, inserts `documents` row, returns base64 for client download
- Trigger UI: `generateLienAgreement` called from [src/components/patients/case-overview.tsx:85](src/components/patients/case-overview.tsx#L85) via a button
- Document type enum: [src/lib/validations/document.ts:13](src/lib/validations/document.ts#L13) — `'lien_agreement'` value added
- DB check constraint: [supabase/migrations/024_lien_agreement.sql:6-9](supabase/migrations/024_lien_agreement.sql#L6-L9) — check constraint updated
- Upload sheet dropdown: [src/components/documents/upload-sheet.tsx:369](src/components/documents/upload-sheet.tsx#L369) — `'lien_agreement'` labeled "Lien Agreement (Signed)" for scan-back uploads

### Key Discoveries

- Generated PDFs land in the **`case-documents`** Supabase Storage bucket, not `clinic-assets`. The research document was slightly off here.
- The `documents.document_type` check constraint must be updated via a new migration that drops-and-recreates the constraint (see [024_lien_agreement.sql](supabase/migrations/024_lien_agreement.sql)).
- The Zod `documentTypeEnum` in [src/lib/validations/document.ts:13](src/lib/validations/document.ts#L13) must be kept in sync with the DB check constraint — both list the same values.
- A single enum value handles both the blank-generated copy and the signed scan-back. Lien does the same — no `status`-like differentiation needed.
- Clinic settings (logo, address, phone, fax) come from the `clinic_settings` table. Provider line assembly logic at [render-lien-agreement-pdf.ts:62-94](src/lib/pdf/render-lien-agreement-pdf.ts#L62-L94) handles supervising/treating provider display and is directly reusable.
- The record-procedure-dialog already has a "treatment area + laterality" (via `injection_site` and `laterality` fields) — when the consent is launched from inside the dialog, those values can be passed as an override to prefill the PDF.
- The lien server action has an "assert case not closed" guard ([src/actions/lien.ts:13-14](src/actions/lien.ts#L13-L14)) that should also apply to consents.

## Desired End State

A provider can, from either the case overview page **or** the record-procedure dialog:

1. Click a **"Generate Procedure Consent Form"** button.
2. Receive a PDF download of a fully populated PRP Procedure Consent Form (clinic header, patient identity, procedure description, contraindication checkboxes, risk-acknowledgment lines with initial blanks, benefits/alternatives, post-care, photo authorization, signature blocks).
3. Hand the printed form to the patient to sign on paper.
4. Scan or photograph the signed form and upload it back through the existing document upload sheet, selecting document type **"Procedure Consent (Signed)"**.
5. See the signed consent alongside other documents on the case Documents page.

### Verification

- Generate button renders on both entry points for an open case.
- Generated PDF contains all 17-item PRP consent content, case-specific data, and is stored as a `documents` row with `document_type = 'procedure_consent'`.
- Signed scan-back uploads via the upload sheet land under the same `document_type`.
- All existing lien agreement, PRP procedure, and document flows still work (no regressions).

## What We're NOT Doing

Explicitly out of scope for this plan:

- **No** `procedure_consents` table or state machine (draft/sent/signed/countersigned).
- **No** canvas-based electronic signature capture (`react-signature-canvas`).
- **No** multi-step wizard UI.
- **No** patient-facing remote signing flow (email/SMS link, token-based public route).
- **No** automatic linkage of signed consent → `procedures.consent_obtained` boolean. That checkbox stays manual.
- **No** SHA-256 tamper-evidence hashing, audit trail, or version-locking of template text into the DB row. Template is a code constant; version lives in git.
- **No** template editor UI for clinic admins.
- **No** per-injection re-consent policy or `expires_at` logic.
- **No** witness, translator, or legal-representative signature blocks in the PDF (patient + provider only).
- **No** changes to the AI note generator or existing PRP procedure dialog beyond adding the new trigger button.

These are captured in [thoughts/shared/research/2026-04-06-procedure-consent-form-implementation.md](thoughts/shared/research/2026-04-06-procedure-consent-form-implementation.md) for future expansion.

## Implementation Approach

Clone the lien agreement flow file-for-file, substituting:
- `lien-agreement-template.tsx` → `procedure-consent-template.tsx` (different legal text, different field layout)
- `render-lien-agreement-pdf.ts` → `render-procedure-consent-pdf.ts` (plus accept optional procedure override data)
- `lien.ts` action → `procedure-consents.ts` action (no attorney gate; optional `procedureId`)
- `generateLienAgreement` button in `case-overview.tsx` → add a sibling "Generate Procedure Consent Form" button
- New trigger button inside `record-procedure-dialog.tsx` that passes the current form's procedure fields as overrides

Plus one migration + one Zod enum update + one upload-sheet dropdown entry.

## Phase 1: Enum + Migration

### Overview
Add `'procedure_consent'` as a valid `document_type` in both the DB check constraint and the Zod validation enum.

### Changes Required

#### 1. Migration
**File**: `supabase/migrations/20260408_procedure_consent_document_type.sql` (new)
**Changes**: Drop and recreate `documents_document_type_check` to include `'procedure_consent'`.

```sql
alter table public.documents
  drop constraint documents_document_type_check,
  add constraint documents_document_type_check
    check (document_type in (
      'mri_report',
      'chiro_report',
      'pain_management',
      'pt_report',
      'orthopedic_report',
      'ct_scan',
      'generated',
      'lien_agreement',
      'procedure_consent',
      'other'
    ));
```

#### 2. Zod enum
**File**: [src/lib/validations/document.ts](src/lib/validations/document.ts)
**Changes**: Add `'procedure_consent'` to `documentTypeEnum`.

```ts
export const documentTypeEnum = z.enum([
  'mri_report',
  'chiro_report',
  'pain_management',
  'pt_report',
  'orthopedic_report',
  'ct_scan',
  'generated',
  'lien_agreement',
  'procedure_consent',
  'other',
])
```

#### 3. Generated DB types
**File**: [src/types/database.ts](src/types/database.ts)
**Changes**: Regenerate via `supabase gen types` (or manually add `'procedure_consent'` to the `documents.document_type` union) so the TS types match the new constraint.

### Success Criteria

#### Automated Verification
- [ ] Migration applies cleanly locally: `npx supabase db reset` (or project-standard migration command)
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npx tsc --noEmit` reports no errors in `src/lib/validations/document.ts`

#### Manual Verification
- [ ] Inserting a row with `document_type = 'procedure_consent'` via psql/Supabase Studio succeeds.
- [ ] Inserting a row with an invalid document type still fails with the check constraint error.

---

## Phase 2: PDF Template

### Overview
Create the `@react-pdf/renderer` template for the Procedure Consent Form. Static legal text lives as module-level constants (mirrors `LIEN_PARAGRAPH_*` pattern at [lien-agreement-template.tsx:41-51](src/lib/pdf/lien-agreement-template.tsx#L41-L51)).

### Changes Required

#### 1. Template file
**File**: `src/lib/pdf/procedure-consent-template.tsx` (new)
**Changes**: New React component returning `<Document><Page size="LETTER">` with the following sections (ordering matches the research document's 17-item standard). The component shape, styles, clinic header, and signature line markup should be copy-adapted from [lien-agreement-template.tsx](src/lib/pdf/lien-agreement-template.tsx).

**Exported interface**:
```ts
export interface ProcedureConsentPdfData {
  clinicLogoBase64?: string
  clinicName?: string
  clinicAddress?: string
  clinicPhone?: string
  clinicFax?: string

  patientName: string
  dateOfBirth: string
  caseNumber: string
  dateOfService: string  // today's date — when form was generated

  providerLine: string

  // Procedure-specific (optional — when launched from procedure dialog)
  treatmentArea?: string
  laterality?: 'left' | 'right' | 'bilateral'
  procedureNumber?: number  // 1st, 2nd, 3rd injection in series
}
```

**Sections to render**:

- **Section A — Clinic header & patient identity**
  Clinic logo + address block (reuse `styles.clinicHeader`), then a labeled field block for Patient Name, DOB, Case Number, Date of Service, Provider.

- **Section B — Procedure description** (static text)
  Title: `"INFORMED CONSENT FOR PLATELET-RICH PLASMA (PRP) INJECTION"`
  Paragraph explaining autologous blood draw → centrifugation → re-injection.
  Below: labeled fields for Treatment Area / Laterality / Injection # in Series. When the override data is present these are prefilled; when absent they are blank underline fields for handwritten entry.

- **Section C — Pre-procedure contraindication checklist**
  Heading: `"CONTRAINDICATIONS — please check any that apply"`.
  Rendered as a 2-column list of checkbox glyphs + label pairs. Use an empty square glyph (`☐`) so patients can ink-mark them. Items from the research doc:
  - Active infection at injection site
  - Active cancer / chemo / radiation
  - Blood clotting disorder (thrombocytopenia, hemophilia)
  - Anticoagulants (Eliquis, Xarelto, Coumadin, etc.)
  - Antiplatelet drugs (Plavix, daily aspirin)
  - NSAIDs in past 7–10 days
  - Systemic corticosteroids in past 2 weeks
  - Pregnancy
  - Known allergy to local anesthetic
  - Previous adverse reaction to PRP

- **Section D — Risk acknowledgments** (per-line initial blanks)
  Heading: `"RISKS — please initial each item to acknowledge"`.
  For each risk, render: `"_____  [risk text]"` with a short underline for handwritten initials.
  Items:
  - Local discomfort, swelling, bruising
  - Infection
  - Nerve / vascular injury
  - Allergic / hypersensitivity reaction
  - Post-injection flare (24–72 hrs)
  - No guarantee of relief or cure
  - Possible need for repeat injections
  - PRP investigational status

- **Section E — Benefits & alternatives** (static text + handwritten ack checkbox)
  Paragraphs covering expected benefits and listing alternatives (corticosteroid injection, hyaluronic acid, surgery, PT, conservative care). End with a `☐ I acknowledge I have read and understood this section.` line.

- **Section F — Post-procedure instructions** (static text + ack checkbox)
  - Avoid NSAIDs 4–6 weeks
  - Avoid ice 72 hrs
  - Activity restrictions
  - Follow-up appointment expectation
  End with a `☐ I acknowledge I have read and understood this section.` line.

- **Section G — Photo/video authorization**
  Single opt-in line: `☐ I authorize the use of de-identified photos/videos for clinical documentation and education.`

- **Section H — Signature block**
  Two signature rows (reuse `styles.signatureRow` pattern from lien template):
  - Patient Signature + Printed Name + Date
  - Provider Signature + Credentials + Date

**Module-level constants**: declare `PROCEDURE_DESC_PARAGRAPH`, `BENEFITS_PARAGRAPH`, `POST_CARE_INTRO`, `RISK_ITEMS` (string array), `CONTRAINDICATION_ITEMS` (string array) at the top of the file — same pattern as `LIEN_PARAGRAPH_*`.

**Styles**: Copy the `StyleSheet.create(...)` block from [lien-agreement-template.tsx:19-39](src/lib/pdf/lien-agreement-template.tsx#L19-L39) wholesale and add:
- `sectionHeading: { fontFamily: 'Helvetica-Bold', fontSize: 11, marginTop: 14, marginBottom: 6 }`
- `checklistRow: { flexDirection: 'row', marginBottom: 3 }`
- `checklistItem: { fontSize: 9, flex: 1 }`
- `initialLine: { fontSize: 9, marginBottom: 4 }`

Page should `wrap` so overflow paginates naturally.

### Success Criteria

#### Automated Verification
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] Importing the template in a quick test script and calling `renderToBuffer(<ProcedureConsentPdf data={...} />)` returns a non-empty Buffer with no runtime errors.

#### Manual Verification
- [ ] Rendered PDF (saved locally during dev) shows all sections A–H correctly.
- [ ] Page breaks cleanly (no section split mid-line).
- [ ] Checkbox glyphs and initial lines print cleanly at 100% scale on Letter paper.
- [ ] Clinic logo displays when present; falls back gracefully when absent.
- [ ] With `treatmentArea` / `laterality` / `procedureNumber` set, those fields show the values; when unset, they show blank underline fields.

---

## Phase 3: Render Layer

### Overview
Create the data-fetching wrapper that assembles `ProcedureConsentPdfData` and calls `renderToBuffer()`. Clone [render-lien-agreement-pdf.ts](src/lib/pdf/render-lien-agreement-pdf.ts) structure.

### Changes Required

#### 1. Render layer
**File**: `src/lib/pdf/render-procedure-consent-pdf.ts` (new)
**Changes**: Fetch case + patient + clinic settings, assemble provider line (reuse logic from [render-lien-agreement-pdf.ts:62-94](src/lib/pdf/render-lien-agreement-pdf.ts#L62-L94) verbatim), download clinic logo as base64 (reuse `getMimeType` and `imageToBase64` helpers — copy into the new file), and call `renderToBuffer()`.

```ts
interface RenderProcedureConsentPdfInput {
  caseId: string
  procedureId?: string  // optional — when present, procedure fields prefill
  override?: {
    treatmentArea?: string
    laterality?: 'left' | 'right' | 'bilateral'
    procedureNumber?: number
  }
}

export async function renderProcedureConsentPdf(
  input: RenderProcedureConsentPdfInput,
): Promise<Buffer>
```

Behavior:
- Load the case with patient join (no attorney needed, unlike lien).
- Load `clinic_settings` in parallel.
- If `procedureId` passed, load that `procedures` row and use its `injection_site` → `treatmentArea`, `laterality`, and `procedure_number` as defaults.
- `input.override` takes precedence over DB-loaded procedure values (lets the dialog pass in-flight form state before save).
- Assemble provider line using the same supervising/treating logic as lien.
- Assemble clinic address string using the same pattern as lien ([render-lien-agreement-pdf.ts:111-115](src/lib/pdf/render-lien-agreement-pdf.ts#L111-L115)).
- `dateOfService` = `format(new Date(), 'MM/dd/yyyy')`.
- `caseNumber` = `caseData.case_number` (already on `cases` row).

Keep the file self-contained (copy `getMimeType` + `imageToBase64` helpers from the lien render file rather than extracting a shared util — matches the project's current duplication pattern for these two renderers).

### Success Criteria

#### Automated Verification
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] Calling `renderProcedureConsentPdf({ caseId })` on a seeded test case returns a `Buffer` without throwing.

#### Manual Verification
- [ ] Provider line assembly matches the lien agreement output for the same case.
- [ ] Clinic logo appears in the generated PDF.
- [ ] `procedureId` prefill path populates treatment area / laterality correctly.
- [ ] `override` path wins over the `procedureId`-loaded values.

---

## Phase 4: Server Action

### Overview
Create the server action that orchestrates render → upload → documents row insert → return base64 for download. Clone [src/actions/lien.ts](src/actions/lien.ts).

### Changes Required

#### 1. Server action
**File**: `src/actions/procedure-consents.ts` (new)

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { assertCaseNotClosed } from '@/actions/case-status'

interface GenerateProcedureConsentInput {
  caseId: string
  procedureId?: string
  override?: {
    treatmentArea?: string
    laterality?: 'left' | 'right' | 'bilateral'
    procedureNumber?: number
  }
}

export async function generateProcedureConsent(input: GenerateProcedureConsentInput) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const closedCheck = await assertCaseNotClosed(supabase, input.caseId)
  if (closedCheck.error) return { error: closedCheck.error }

  // Verify case exists
  const { data: caseData, error: caseError } = await supabase
    .from('cases')
    .select('id')
    .eq('id', input.caseId)
    .is('deleted_at', null)
    .single()
  if (caseError || !caseData) return { error: 'Case not found' }

  // Render PDF
  const { renderProcedureConsentPdf } = await import('@/lib/pdf/render-procedure-consent-pdf')
  const pdfBuffer = await renderProcedureConsentPdf({
    caseId: input.caseId,
    procedureId: input.procedureId,
    override: input.override,
  })

  // Upload
  const storagePath = `cases/${input.caseId}/procedure-consent-${Date.now()}.pdf`
  const fileBlob = new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' })

  const { error: uploadError } = await supabase.storage
    .from('case-documents')
    .upload(storagePath, fileBlob, {
      contentType: 'application/pdf',
      upsert: false,
    })
  if (uploadError) return { error: `Failed to upload consent form: ${uploadError.message}` }

  // Insert documents row
  const { error: docError } = await supabase
    .from('documents')
    .insert({
      case_id: input.caseId,
      document_type: 'procedure_consent',
      file_name: 'Procedure Consent Form (Unsigned)',
      file_path: storagePath,
      file_size_bytes: pdfBuffer.length,
      mime_type: 'application/pdf',
      status: 'reviewed',
      uploaded_by_user_id: user.id,
      created_by_user_id: user.id,
      updated_by_user_id: user.id,
    })
  if (docError) return { error: `Failed to save document record: ${docError.message}` }

  const base64 = Buffer.from(pdfBuffer).toString('base64')

  revalidatePath(`/patients/${input.caseId}`)
  revalidatePath(`/patients/${input.caseId}/documents`)

  return { data: { base64 } }
}
```

Field-by-field mirror of `generateLienAgreement` except:
- No attorney gate.
- Accepts optional `procedureId` + `override`.
- `document_type = 'procedure_consent'`.
- `file_name = 'Procedure Consent Form (Unsigned)'` (the signed scan-back uploaded later via upload sheet will have its own filename).
- Storage path: `cases/{caseId}/procedure-consent-{ts}.pdf`.

### Success Criteria

#### Automated Verification
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] Calling the action end-to-end against a local Supabase returns `{ data: { base64 } }` with a non-empty base64 string.
- [ ] A new `documents` row is created with `document_type = 'procedure_consent'`.

#### Manual Verification
- [ ] Action errors cleanly when case is closed (`closedCheck.error` path).
- [ ] Action errors cleanly when case id is invalid.
- [ ] Uploaded file appears in the `case-documents` bucket at the expected path.
- [ ] `revalidatePath` refreshes the documents list on the case page.

---

## Phase 5: Trigger UI — Case Overview Button

### Overview
Add a "Generate Procedure Consent Form" button on the case overview page, next to the existing "Generate Lien Agreement" button.

### Changes Required

#### 1. Case overview component
**File**: [src/components/patients/case-overview.tsx](src/components/patients/case-overview.tsx)
**Changes**: Add an import for `generateProcedureConsent`, add a handler function mirroring the existing `handleGenerateLien` function (base64 → blob → download link click), and add a new button in the same section as "Generate Lien Agreement" (around line 154). No attorney precondition — the button is enabled whenever the case is open.

Handler pattern to mirror (from existing file around lines 80-95):
```ts
async function handleGenerateConsent() {
  setIsGeneratingConsent(true)
  try {
    const result = await generateProcedureConsent({ caseId: caseData.id })
    if ('error' in result && result.error) {
      toast.error(result.error)
      return
    }
    if ('data' in result && result.data) {
      // Decode base64 and trigger download — same pattern as handleGenerateLien
    }
  } finally {
    setIsGeneratingConsent(false)
  }
}
```

Button placement: immediately below or beside the existing "Generate Lien Agreement" button. Label: `"Generate Procedure Consent Form"`.

### Success Criteria

#### Automated Verification
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes

#### Manual Verification
- [ ] Button is visible on the case overview page for an open case.
- [ ] Clicking it downloads the PDF in the browser.
- [ ] Generated consent appears in the case's Documents tab as "Procedure Consent Form (Unsigned)".
- [ ] Button is disabled / errors gracefully when the case is closed.

---

## Phase 6: Trigger UI — Record Procedure Dialog Button

### Overview
Add a secondary "Generate Consent Form" button inside the PRP record-procedure dialog, near the existing `consent_obtained` checkbox. When clicked, it passes the current in-flight form values (`injection_site`, `laterality`, `procedure_number`) to the server action as overrides.

### Changes Required

#### 1. Record procedure dialog
**File**: [src/components/procedures/record-procedure-dialog.tsx](src/components/procedures/record-procedure-dialog.tsx)
**Changes**:
- Import `generateProcedureConsent` from `@/actions/procedure-consents`.
- Add a `Button` adjacent to the existing consent checkbox at [line 303-323](src/components/procedures/record-procedure-dialog.tsx#L303-L323) labeled `"Generate Consent Form"`.
- On click, read current form values via `form.getValues()`, map them to the override shape:
  ```ts
  override: {
    treatmentArea: form.getValues('injection_site') || undefined,
    laterality: form.getValues('laterality') || undefined,
    procedureNumber: form.getValues('procedure_number') ?? undefined,
  }
  ```
- Call `generateProcedureConsent({ caseId, override })`. The `procedureId` stays undefined because the procedure may not have been saved yet — the override supplies the values directly.
- Decode base64 → blob → trigger browser download (same helper pattern as case-overview).
- Show a toast on success/error.

**Important**: Do NOT change the existing `consent_obtained` checkbox behavior. It remains a manual flag. The new button is purely additive — it generates a printable form; it does not flip the checkbox.

### Success Criteria

#### Automated Verification
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes

#### Manual Verification
- [ ] Opening the record-procedure dialog shows the new button next to the consent checkbox.
- [ ] Entering `injection_site = "Knee"`, `laterality = "left"`, `procedure_number = 2` and clicking the button downloads a PDF with those values prefilled in Section B.
- [ ] Clicking the button without filling in any procedure fields downloads a PDF with blank procedure-field lines.
- [ ] The existing `consent_obtained` checkbox still saves its value to the procedure row unchanged.
- [ ] Closing the dialog without saving the procedure does NOT prevent the generated consent from appearing in the documents list (the PDF generation is independent of the procedure save).

---

## Phase 7: Upload Sheet Dropdown Entry

### Overview
Expose the new document type in the upload sheet so users can label scan-back signed consents.

### Changes Required

#### 1. Upload sheet
**File**: [src/components/documents/upload-sheet.tsx](src/components/documents/upload-sheet.tsx)
**Changes**: Add one `<SelectItem>` to the dropdown at [line 362-371](src/components/documents/upload-sheet.tsx#L362-L371):

```tsx
<SelectItem value="procedure_consent">Procedure Consent (Signed)</SelectItem>
```

No extraction wiring needed (unlike MRI/chiro/etc.) — this document type has no AI extraction pipeline.

### Success Criteria

#### Automated Verification
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes

#### Manual Verification
- [ ] Upload sheet dropdown shows "Procedure Consent (Signed)" as an option.
- [ ] Selecting it and uploading a PDF saves a `documents` row with `document_type = 'procedure_consent'`.
- [ ] The uploaded file appears in the case's Documents tab alongside any generated-blank consents.

---

## Testing Strategy

### Unit Tests
No new unit tests required. The project does not currently unit-test the lien agreement flow; following the same precedent for consistency.

### Integration Testing (manual, end-to-end)
1. Open a seeded open case.
2. Click "Generate Procedure Consent Form" on the case overview → verify PDF downloads and appears in Documents tab.
3. Open the record-procedure dialog → fill treatment area/laterality → click the in-dialog "Generate Consent Form" button → verify PDF downloads with those values prefilled.
4. Print the generated form → verify it is legible and all sections render correctly on Letter paper.
5. Scan a hand-signed copy → upload via the upload sheet with type "Procedure Consent (Signed)" → verify it lands in the Documents tab.
6. Close the case → verify both generation entry points error with the "case closed" message.

### Regression Checks
- [ ] Lien agreement generation still works unchanged.
- [ ] Existing record-procedure dialog consent checkbox still saves its boolean.
- [ ] AI procedure-note generation at [generate-procedure-note.ts:161-162](src/lib/claude/generate-procedure-note.ts#L161-L162) still uses the boolean and produces identical output.
- [ ] Existing document upload flows (MRI, chiro, etc.) still work; extraction pipelines still fire.
- [ ] Document type check constraint still rejects unknown values.

## Performance Considerations

- PDF generation happens on the server; `renderToBuffer` is synchronous-ish but fast for a single-page document. No streaming needed.
- No new indexes or queries; reuses the existing `documents` table and its indexes.
- Storage upload reuses the `case-documents` bucket — no new bucket provisioning.

## Migration Notes

- The migration in Phase 1 is additive (extends the check constraint). Existing `documents` rows are unaffected.
- No data backfill required.
- Rollback: drop-and-recreate the check constraint without `'procedure_consent'`. Safe as long as no rows of that type exist yet.
- `supabase gen types` should be re-run after the migration to keep `src/types/database.ts` in sync.

## References

- Research document: [thoughts/shared/research/2026-04-06-procedure-consent-form-implementation.md](thoughts/shared/research/2026-04-06-procedure-consent-form-implementation.md)
- Lien agreement template: [src/lib/pdf/lien-agreement-template.tsx](src/lib/pdf/lien-agreement-template.tsx)
- Lien agreement render: [src/lib/pdf/render-lien-agreement-pdf.ts](src/lib/pdf/render-lien-agreement-pdf.ts)
- Lien server action: [src/actions/lien.ts](src/actions/lien.ts)
- Document type enum: [src/lib/validations/document.ts:13](src/lib/validations/document.ts#L13)
- Document type migration precedent: [supabase/migrations/024_lien_agreement.sql](supabase/migrations/024_lien_agreement.sql)
- Record procedure dialog: [src/components/procedures/record-procedure-dialog.tsx:303-323](src/components/procedures/record-procedure-dialog.tsx#L303-L323)
- Upload sheet dropdown: [src/components/documents/upload-sheet.tsx:362-371](src/components/documents/upload-sheet.tsx#L362-L371)
- Case overview trigger precedent: [src/components/patients/case-overview.tsx:85](src/components/patients/case-overview.tsx#L85)
