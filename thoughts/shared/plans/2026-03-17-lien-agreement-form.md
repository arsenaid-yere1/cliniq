# Lien Agreement Form — Implementation Plan

## Overview

Add the ability to generate a pre-filled NPMD "Authorization and Lien Agreement" PDF from case data, store it as a document, and automatically track lien status. This also introduces a `supervising_provider_id` field on provider profiles to support the lien form's provider line format ("Supervising, MD / Treating, FNP"). Additionally, fix the invoice PDF generation to use the case's assigned provider instead of the logged-in user's provider profile.

## Current State Analysis

### What exists:
- `cases.lien_on_file` boolean field (migration `001`, line 87) — manually toggled via checkbox
- 4 PDF templates using `@react-pdf/renderer` (invoice, initial visit, procedure note, discharge note)
- Established pattern for generating + storing PDFs: render → upload to `case-documents` bucket → insert `documents` row (see `discharge-notes.ts:462–498`)
- `documents.document_type` CHECK constraint with 8 values (latest: migration `022`)
- `documentTypeEnum` Zod schema in `src/lib/validations/document.ts:13`
- Document type labels/colors in `document-card.tsx:20–40`, filter options in `document-list.tsx:16–25`, timeline labels in `timeline.ts:138–144`
- Provider profiles with `display_name` + `credentials` in `provider_profiles` table (migration `007`)
- Provider info form at `src/components/settings/provider-info-form.tsx`

### What's missing:
- No lien agreement PDF template
- No `lien_agreement` document type
- No `supervising_provider_id` on provider profiles
- No auto-set of `lien_on_file` when lien document is generated
- No "Generate Lien Agreement" action in the UI

### Key Discoveries:
- Invoice PDF generation (`billing.ts:423–432`) does NOT store the PDF — it returns base64 for client-side download only
- Discharge/procedure/initial-visit note finalization DOES store the PDF — this is the pattern to follow (`discharge-notes.ts:462–498`)
- Document type constants are duplicated across 5 files (no shared constant) — we add to each
- The upload sheet (`upload-sheet.tsx:362–368`) only shows uploadable types — `lien_agreement` should NOT appear there (it's generated, not uploaded)
- `quickActions` in `case-overview.tsx:61–66` are navigation links — a generate button needs a different pattern (click handler, not href)

## Desired End State

1. Provider profiles have an optional `supervising_provider_id` linking to another provider profile's user
2. The provider settings form allows selecting a supervising provider from a dropdown
3. A "Generate Lien Agreement" button on the case overview page generates a pre-filled PDF matching the NPMD form layout
4. The generated PDF is stored in `case-documents` with `document_type: 'lien_agreement'`
5. `cases.lien_on_file` is automatically set to `true` when the lien agreement is generated
6. The lien agreement appears in the documents list with its own filter option, label, and badge color
7. The lien form's provider line shows "SupervisingName, Credentials / TreatingName, Credentials"

### Verification:
- Navigate to a case with an assigned attorney and provider → click "Generate Lien Agreement" → PDF downloads/previews with correct patient/attorney/provider data and NPMD boilerplate text
- The document appears in the case's documents list with type "Lien Agreement"
- `lien_on_file` is set to `true` on the case
- Provider settings page allows selecting a supervising provider

## What We're NOT Doing

- Digital/electronic signature capture (wet signatures on printed form)
- Patient-facing or attorney-facing signature workflow
- A separate `lien_documents` table — using existing `documents` table
- Database trigger for auto-setting `lien_on_file` — using application logic in the server action
- Making the provider pairing available to other PDF templates (lien-specific only)

## Implementation Approach

Three phases: database migration, PDF template + render + action, and UI integration. Each phase is independently testable.

---

## Phase 1: Database Migration

### Overview
Add `supervising_provider_id` to `provider_profiles` and `lien_agreement` to the document type constraint.

### Changes Required:

#### 1. New Migration
**File**: `supabase/migrations/024_lien_agreement.sql` (new)

```sql
-- Add supervising provider to provider profiles
alter table public.provider_profiles
  add column supervising_provider_id uuid references public.users(id);

-- Add lien_agreement to document types
alter table public.documents
  drop constraint documents_document_type_check,
  add constraint documents_document_type_check
    check (document_type in ('mri_report', 'chiro_report', 'pain_management', 'pt_report', 'orthopedic_report', 'ct_scan', 'generated', 'lien_agreement', 'other'));
```

#### 2. Update Zod Schema
**File**: `src/lib/validations/document.ts:13`

Add `'lien_agreement'` to the `documentTypeEnum`:
```typescript
export const documentTypeEnum = z.enum(['mri_report', 'chiro_report', 'pain_management', 'pt_report', 'orthopedic_report', 'ct_scan', 'generated', 'lien_agreement', 'other'])
```

#### 3. Update Provider Info Schema
**File**: `src/lib/validations/settings.ts:18–23`

Add `supervising_provider_id` to `providerInfoSchema`:
```typescript
export const providerInfoSchema = z.object({
  display_name: z.string().min(1, 'Provider name is required'),
  credentials: z.string().optional(),
  license_number: z.string().optional(),
  npi_number: z.string().optional(),
  supervising_provider_id: z.string().uuid().optional().or(z.literal('')),
})
```

#### 4. Update Provider Info Form
**File**: `src/components/settings/provider-info-form.tsx`

- Add `supervising_provider_id` to `defaultValues` (line 29–34)
- Fetch all provider profiles (excluding self) to populate a `<Select>` dropdown
- Add a new `FormField` for "Supervising Provider" select below the existing fields
- The select shows `display_name, credentials` for each provider
- Empty option = no supervising provider

#### 5. Regenerate TypeScript Types
Run `npx supabase gen types` to update `src/types/database.ts` with the new column.

### Success Criteria:

#### Automated Verification:
- [ ] Migration applies cleanly: `npx supabase db push` or `npx supabase migration up`
- [ ] Type checking passes: `npm run typecheck`
- [ ] Existing document validation tests still pass
- [ ] Linting passes: `npm run lint`

#### Manual Verification:
- [ ] Provider settings page shows "Supervising Provider" dropdown
- [ ] Selecting and saving a supervising provider persists correctly
- [ ] Clearing the supervising provider selection works

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation.

---

## Phase 2: PDF Template + Render Function + Server Action

### Overview
Create the lien agreement PDF template matching the NPMD form layout, a render function to assemble data, and a server action to generate + store it.

### Changes Required:

#### 1. PDF Template
**File**: `src/lib/pdf/lien-agreement-template.tsx` (new)

Data interface:
```typescript
export interface LienAgreementPdfData {
  // Clinic header
  clinicLogoBase64?: string
  clinicAddress?: string
  clinicPhone?: string
  clinicFax?: string

  // Addressee
  attorneyName?: string
  firmName?: string

  // Patient/case fields
  patientName: string
  dateOfBirth: string
  dateOfInjury: string

  // Provider line (e.g., "Stephen Carney, MD / Armine Tadevosyan, FNP")
  providerLine: string
}
```

Template structure (matching the original PDF):
- Centered clinic header: logo, address, phone/fax (same pattern as `invoice-template.tsx:111–116`)
- "To Attorney:" line with attorney name
- Patient Name / Date of Birth row
- Date of Injury row
- Provider line: bold label + dynamic provider text
- "AUTHORIZATION AND LIEN AGREEMENT" centered bold title
- 4 paragraphs of static legal text (hardcoded, referencing "NPMD")
- Two signature blocks at bottom:
  - "PATIENT SIGNATURE _________________________ DATE _______________"
  - "ATTORNEY SIGNATURE ________________________ DATE _______________"

#### 2. Render Function
**File**: `src/lib/pdf/render-lien-agreement-pdf.ts` (new)

Follow the pattern from `render-invoice-pdf.ts`. Accepts `{ caseId: string }`.

Data assembly:
1. Parallel fetch: case (with patient + attorney joins), clinic settings, assigned provider's profile
2. If provider has `supervising_provider_id`, fetch the supervising provider's profile
3. Build `providerLine`:
   - If supervising exists: `"SupervisingName, Credentials / TreatingName, Credentials"`
   - If no supervising: `"TreatingName, Credentials"`
   - If no assigned provider: `""`
4. Fetch clinic logo as base64 (same helper pattern as `render-invoice-pdf.ts:74–85`)
5. Assemble `LienAgreementPdfData` and render via `renderToBuffer`

#### 3. Server Action
**File**: `src/actions/lien.ts` (new)

```typescript
'use server'

export async function generateLienAgreement(caseId: string) {
  // 1. Auth check
  // 2. Verify case exists and is not closed (assertCaseNotClosed)
  // 3. Verify case has an attorney assigned (required for lien)
  // 4. Call renderLienAgreementPdf({ caseId })
  // 5. Upload PDF to storage: `cases/${caseId}/lien-agreement-${Date.now()}.pdf`
  // 6. Insert documents row:
  //    - document_type: 'lien_agreement'
  //    - file_name: 'Authorization and Lien Agreement'
  //    - status: 'reviewed' (system-generated)
  // 7. Update cases set lien_on_file = true
  // 8. revalidatePath for documents and case overview pages
  // 9. Return { data: { documentId, base64 } } for immediate download
}
```

Follow the established pattern from `discharge-notes.ts:462–498` for steps 4–6.

### Success Criteria:

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run lint`
- [ ] No import errors in new files

#### Manual Verification:
- [ ] Call `generateLienAgreement(caseId)` for a case with patient, attorney, and assigned provider
- [ ] Generated PDF matches the NPMD form layout (header, fields, legal text, signature lines)
- [ ] Provider line shows "Supervising, MD / Treating, FNP" format
- [ ] PDF appears in the case's documents list
- [ ] `lien_on_file` is set to `true` on the case

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation.

---

## Phase 3: UI Integration

### Overview
Add a "Generate Lien Agreement" button to the case overview, update document type labels/colors/filters across all relevant components.

### Changes Required:

#### 1. Update Document Type Labels and Colors
**File**: `src/components/documents/document-card.tsx`

Add to `docTypeLabels` (after line 27):
```typescript
lien_agreement: 'Lien Agreement',
```

Add to `docTypeColors` (after line 38):
```typescript
lien_agreement: 'bg-purple-100 text-purple-800 border-purple-200',
```

#### 2. Update Document List Filter Options
**File**: `src/components/documents/document-list.tsx`

Add to `docTypeOptions` array (after line 24):
```typescript
{ value: 'lien_agreement', label: 'Lien Agreement' },
```

#### 3. Update Timeline Labels
**File**: `src/actions/timeline.ts`

Add to `formatDocType` labels (after line 142):
```typescript
lien_agreement: 'Lien Agreement',
```

#### 4. Add Generate Button to Case Overview
**File**: `src/components/patients/case-overview.tsx`

Add a "Generate Lien Agreement" button in the Case Actions card. Because this is an async operation (not navigation), it cannot use the `quickActions` array pattern. Instead, add it as a standalone button after the `quickActions.map()` block, alongside `<StatusChangeDropdown>` at line 109.

```typescript
import { FileSignature, Loader2 } from 'lucide-react'
import { generateLienAgreement } from '@/actions/lien'

// Inside the component, add state:
const [generatingLien, setGeneratingLien] = useState(false)

// Handler:
async function handleGenerateLien() {
  if (!caseData.attorney_id) {
    toast.error('An attorney must be assigned before generating a lien agreement')
    return
  }
  setGeneratingLien(true)
  const result = await generateLienAgreement(caseData.id)
  setGeneratingLien(false)
  if ('error' in result && result.error) {
    toast.error(result.error)
    return
  }
  // Trigger download from base64
  if ('data' in result && result.data?.base64) {
    const bytes = atob(result.data.base64)
    const arr = new Uint8Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
    const blob = new Blob([arr], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'Authorization-and-Lien-Agreement.pdf'
    a.click()
    URL.revokeObjectURL(url)
  }
  toast.success('Lien agreement generated')
}
```

Button placement — inside the `<div className="flex gap-3 flex-wrap">` at line 93, after the `StatusChangeDropdown`:
```tsx
<Button
  variant="outline"
  onClick={handleGenerateLien}
  disabled={isLocked || generatingLien || !caseData.attorney_id}
>
  {generatingLien ? (
    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
  ) : (
    <FileSignature className="h-4 w-4 mr-2" />
  )}
  Generate Lien Agreement
</Button>
```

#### 5. Add Toast Import
Ensure `toast` from sonner and the `useRouter` hook are available in `case-overview.tsx` (add imports if not already present).

### Success Criteria:

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run lint`
- [ ] Existing tests pass: `npm test`

#### Manual Verification:
- [ ] "Generate Lien Agreement" button appears in Case Actions card
- [ ] Button is disabled when no attorney is assigned
- [ ] Button is disabled when case is locked (closed/archived)
- [ ] Clicking the button generates and downloads the PDF
- [ ] PDF appears in the documents list with purple "Lien Agreement" badge
- [ ] Filter dropdown includes "Lien Agreement" option
- [ ] `lien_on_file` updates to true after generation
- [ ] Generating a second lien creates a new document (no conflict)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation.

---

## Phase 4: Fix Invoice PDF Provider Lookup

### Overview
The invoice PDF currently pulls the logged-in user's provider profile (`render-invoice-pdf.ts:55–59`) instead of the case's assigned provider. Fix this to use `cases.assigned_provider_id`.

### Changes Required:

#### 1. Update Provider Query in Render Function
**File**: `src/lib/pdf/render-invoice-pdf.ts`

Current code (lines 55–59):
```typescript
supabase
  .from('provider_profiles')
  .select('display_name, credentials')
  .eq('user_id', user.id)  // BUG: uses logged-in user, not case's assigned provider
  .is('deleted_at', null)
  .maybeSingle(),
```

The fix: after fetching the invoice+case data, use `caseData.assigned_provider_id` to look up the provider profile. Since `assigned_provider_id` is on the case (not available until the first query returns), the provider query must move out of the initial `Promise.all` and run after:

```typescript
// After invoiceResult is available:
const assignedProviderId = caseData?.assigned_provider_id as string | null

let providerProfile = null
if (assignedProviderId) {
  const { data } = await supabase
    .from('provider_profiles')
    .select('display_name, credentials')
    .eq('user_id', assignedProviderId)
    .is('deleted_at', null)
    .maybeSingle()
  providerProfile = data
}
```

This can run in parallel with the clinic logo fetch since both depend on the first query but not on each other.

### Success Criteria:

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run lint`

#### Manual Verification:
- [ ] Generate an invoice PDF while logged in as a different user than the case's assigned provider
- [ ] Verify the PDF shows the assigned provider's name/credentials, not the logged-in user's
- [ ] Verify PDF still works when case has no assigned provider (shows no provider)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation.

---

## Testing Strategy

### Unit Tests:
- Extend `document.test.ts` to validate `'lien_agreement'` as a valid document type
- Test `providerInfoSchema` with `supervising_provider_id` (valid UUID, empty string, undefined)

### Manual Testing Steps:
1. Set up provider profile with supervising provider selected
2. Create a case with patient, attorney, and assigned provider
3. Click "Generate Lien Agreement" from case overview
4. Verify PDF content: clinic header, patient/attorney info, provider line, legal text, signature lines
5. Verify document appears in documents list
6. Verify `lien_on_file` is true
7. Try generating without an attorney assigned — should show error
8. Try generating on a closed case — should be disabled

## References

- Research document: `thoughts/shared/research/2026-03-17-lien-form-integration.md`
- PDF template pattern: `src/lib/pdf/invoice-template.tsx`
- PDF store pattern: `src/actions/discharge-notes.ts:462–498`
- Provider profiles: `supabase/migrations/007_clinic_provider_settings.sql`
- Document type enum: `src/lib/validations/document.ts:13`
- Case overview component: `src/components/patients/case-overview.tsx`
