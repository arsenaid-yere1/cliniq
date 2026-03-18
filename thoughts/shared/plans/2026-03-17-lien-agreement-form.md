# Lien Agreement Form — Implementation Plan

## Overview

Decouple provider profiles from auth users, build a provider management UI (list/add/edit/delete), add provider assignment to cases, generate a pre-filled NPMD "Authorization and Lien Agreement" PDF from case data, and fix the invoice PDF to use the case's assigned provider. This also introduces a `supervising_provider_id` field on provider profiles to support the lien form's provider line format ("Supervising, MD / Treating, FNP").

## Current State Analysis

### What exists:
- `cases.lien_on_file` boolean field (migration `001`, line 87) — manually toggled via checkbox
- `cases.assigned_provider_id` column referencing `users(id)` — **not exposed in any UI form** (no create/edit)
- 4 PDF templates using `@react-pdf/renderer` (invoice, initial visit, procedure note, discharge note)
- Established pattern for generating + storing PDFs: render → upload to `case-documents` bucket → insert `documents` row (see `discharge-notes.ts:462–498`)
- `documents.document_type` CHECK constraint with 8 values (latest: migration `022`)
- `documentTypeEnum` Zod schema in `src/lib/validations/document.ts:13`
- Document type labels/colors in `document-card.tsx:20–40`, filter options in `document-list.tsx:16–25`, timeline labels in `timeline.ts:138–144`
- Provider profiles table with `user_id NOT NULL` referencing `users(id)` — one profile per auth user (migration `007`)
- Provider info form at `src/components/settings/provider-info-form.tsx` — edits **own** profile only
- `AttorneySelect` component (`src/components/attorneys/attorney-select.tsx`) — good pattern for `ProviderSelect`
- Migration `024` already adds `supervising_provider_id uuid references users(id)` and `lien_agreement` document type

### What's missing:
- Provider profiles are coupled to auth users — can't create providers who don't log in
- No provider management UI (list/add/edit/delete)
- No `assigned_provider_id` in case create wizard or edit dialog
- No lien agreement PDF template
- No auto-set of `lien_on_file` when lien document is generated — only set when signed copy is manually uploaded
- No "Generate Lien Agreement" action in the UI

### Key Discoveries:
- `assigned_provider_id` is NOT settable from any UI — only consumed by billing/PDF code
- Note actions (`initial-visit-notes.ts`, `procedure-notes.ts`, `discharge-notes.ts`) look up provider via `user.id` (logged-in user), should switch to `cases.assigned_provider_id`
- Invoice PDF generation (`billing.ts:423–432`) does NOT store the PDF — returns base64 for client-side download
- Discharge/procedure/initial-visit note finalization DOES store the PDF — pattern to follow (`discharge-notes.ts:462–498`)
- Document type constants are duplicated across 5 files (no shared constant) — we add to each
- The upload sheet (`upload-sheet.tsx:362–368`) only shows uploadable types — `lien_agreement` should NOT appear there
- `quickActions` in `case-overview.tsx:61–66` are navigation links — a generate button needs a different pattern

## Desired End State

1. Provider profiles are decoupled from auth users — `user_id` is nullable, profiles can be created independently
2. Settings → Provider Info tab shows a **list of all providers** with add/edit/delete capabilities
3. Case create wizard and edit dialog include an "Assigned Provider" dropdown
4. `cases.assigned_provider_id` references `provider_profiles.id` (not `users.id`)
5. `supervising_provider_id` references `provider_profiles.id` (not `users.id`)
6. A "Generate Lien Agreement" button on the case overview page generates a pre-filled PDF
7. The generated PDF is stored with `document_type: 'lien_agreement'`
8. `cases.lien_on_file` is automatically set to `true` when the lien agreement is generated
9. The lien form's provider line shows "SupervisingName, Credentials / TreatingName, Credentials"
10. All note/PDF actions use `cases.assigned_provider_id` → `provider_profiles.id` instead of auth `user.id`

### Verification:
- Provider management: can list, create, edit, delete providers from Settings
- Case forms: can select a provider when creating or editing a case
- Navigate to a case with assigned attorney + provider → click "Generate Lien Agreement" → PDF downloads with correct data
- Invoice PDF uses case's assigned provider, not the logged-in user
- Note PDFs use case's assigned provider

## What We're NOT Doing

- Digital/electronic signature capture (wet signatures on printed form)
- Patient-facing or attorney-facing signature workflow
- A separate `lien_documents` table — using existing `documents` table
- Database trigger for auto-setting `lien_on_file` — using application logic
- Multi-provider per case — still one assigned provider per case

## Implementation Approach

Five phases: database migration + data migration, provider management UI, case form integration, PDF template + server action, and UI integration for lien generation. Each phase is independently testable.

---

## Phase 1: Database Migration

### Overview
Decouple `provider_profiles` from auth users. Change FK references so `cases.assigned_provider_id` and `supervising_provider_id` point to `provider_profiles.id` instead of `users.id`. Migrate existing data.

### Changes Required:

#### 1. Replace Migration 024
**File**: `supabase/migrations/024_lien_agreement.sql` (replace existing)

```sql
-- ============================================
-- DECOUPLE PROVIDER PROFILES FROM AUTH USERS
-- ============================================

-- 1. Change user_id FK from CASCADE to SET NULL (don't destroy provider
--    profiles when an auth user is deleted — profiles may be referenced
--    by cases/notes).
alter table public.provider_profiles
  drop constraint provider_profiles_user_id_fkey;
alter table public.provider_profiles
  add constraint provider_profiles_user_id_fkey
    foreign key (user_id) references public.users(id) on delete set null;

-- 2. Make user_id nullable (providers no longer require auth accounts)
alter table public.provider_profiles
  alter column user_id drop not null;

-- 3. Update unique index to allow multiple NULL user_id rows
--    Old index enforced one active profile per user_id, but with nullable
--    user_id we need to only enforce uniqueness when user_id IS NOT NULL.
drop index if exists idx_provider_profiles_user_active;
create unique index idx_provider_profiles_user_active
  on public.provider_profiles (user_id)
  where deleted_at is null and user_id is not null;

-- 4. Repoint supervising_provider_id: users(id) → provider_profiles(id)
--    Current column references users(id) — drop the old FK, then re-add
--    referencing provider_profiles(id) instead.
alter table public.provider_profiles
  drop constraint provider_profiles_supervising_provider_id_fkey;
alter table public.provider_profiles
  add constraint provider_profiles_supervising_provider_id_fkey
    foreign key (supervising_provider_id) references public.provider_profiles(id);

-- 5. Repoint cases.assigned_provider_id: users(id) → provider_profiles(id)
--    First, migrate any existing data (convert user IDs to profile IDs).
--    Currently no cases have assigned_provider_id set, but this is safe
--    for future-proofing if data existed.
update public.cases c
  set assigned_provider_id = pp.id
  from public.provider_profiles pp
  where c.assigned_provider_id = pp.user_id
    and pp.deleted_at is null;

alter table public.cases
  drop constraint cases_assigned_provider_id_fkey;
alter table public.cases
  add constraint cases_assigned_provider_id_fkey
    foreign key (assigned_provider_id) references public.provider_profiles(id);

-- 6. Add lien_agreement to document types
alter table public.documents
  drop constraint documents_document_type_check,
  add constraint documents_document_type_check
    check (document_type in ('mri_report', 'chiro_report', 'pain_management', 'pt_report', 'orthopedic_report', 'ct_scan', 'generated', 'lien_agreement', 'other'));
```

#### 2. Update Zod Schemas

**File**: `src/lib/validations/document.ts:13`
Add `'lien_agreement'` to `documentTypeEnum`.

**File**: `src/lib/validations/settings.ts:18–24`
Update `providerInfoSchema` — remove `supervising_provider_id` (will move to provider management form). Keep the schema focused on the fields the provider management dialog needs:
```typescript
export const providerInfoSchema = z.object({
  display_name: z.string().min(1, 'Provider name is required'),
  credentials: z.string().optional(),
  license_number: z.string().optional(),
  npi_number: z.string().optional(),
  supervising_provider_id: z.string().uuid().optional().or(z.literal('')),
})
```

#### 3. Regenerate TypeScript Types
Run `npx supabase gen types` to update `src/types/database.ts` with:
- `provider_profiles.user_id` now nullable
- `provider_profiles.supervising_provider_id` referencing `provider_profiles.id`
- `cases.assigned_provider_id` FK now pointing to `provider_profiles.id`

#### 4. Update Server Actions for New FK Shape

**File**: `src/actions/settings.ts`

- `listProviderProfiles()` (line 65–75): Update select to include `id` field: `select('id, user_id, display_name, credentials, license_number, npi_number, supervising_provider_id')`
- `updateProviderProfile()` (line 92–137): Refactor to accept a `providerId?: string` parameter. If `providerId` is given, update that profile. If not, create a new one. Remove the `user.id`-based lookup — profiles are no longer tied to the logged-in user.
- Add new actions:
  - `createProviderProfile(data)` — insert into `provider_profiles` with no `user_id` required
  - `deleteProviderProfile(profileId)` — soft-delete (`set deleted_at = now()`)
  - `getProviderProfileById(profileId)` — fetch a single profile by its `id`

**File**: `src/actions/billing.ts`

- `getInvoiceFormData()` (lines 120–131): Change provider lookup from `.eq('user_id', user.id)` to use `cases.assigned_provider_id` → `.eq('id', assignedProviderId)`
- `getInvoiceWithContext()` (lines 460–466): Same change — use `assigned_provider_id` from case, `.eq('id', ...)` on `provider_profiles`
- Line 67 join: Change `provider:users!assigned_provider_id(id, full_name)` to `provider:provider_profiles!assigned_provider_id(id, display_name, credentials)`

**File**: `src/actions/initial-visit-notes.ts`
- `gatherSourceData()` (line 19–22): Change signature from `(supabase, caseId, userId, ...)` to `(supabase, caseId, ...)`. Get `assigned_provider_id` from the case query result, then look up provider via `.eq('id', assignedProviderId)`.
- Line 48: Change `.eq('user_id', userId)` to `.eq('id', caseData.assigned_provider_id)`
- Line 143, 434: Remove `user.id` argument from `gatherSourceData()` calls
- **Graceful fallback**: If `assigned_provider_id` is NULL, skip the provider profile query and render the PDF with no provider info (same as today when a profile doesn't exist). Existing notes (2 initial visit, 1 procedure, 1 discharge) were generated when provider lookup used `user.id` — regenerating them will now use `assigned_provider_id` which is NULL on both cases, so provider info will be absent. This is acceptable.

**File**: `src/actions/procedure-notes.ts`
- Same pattern as initial-visit-notes: remove `userId` param, use `assigned_provider_id` from case, graceful NULL fallback

**File**: `src/actions/discharge-notes.ts`
- Same pattern: remove `userId` param, use `assigned_provider_id` from case, graceful NULL fallback

**File**: `src/lib/pdf/render-invoice-pdf.ts`
- Line 71: Change `.eq('user_id', assignedProviderId)` to `.eq('id', assignedProviderId)`

**File**: `src/lib/pdf/render-lien-agreement-pdf.ts`
- Line 67: Change `.eq('user_id', caseData.assigned_provider_id)` to `.eq('id', caseData.assigned_provider_id)`
- Line 79: Change `.eq('user_id', providerProfile.supervising_provider_id)` to `.eq('id', providerProfile.supervising_provider_id)`

**File**: `src/lib/pdf/render-initial-visit-pdf.ts`
- Change `input.userId` lookup to `input.providerId` and use `.eq('id', input.providerId)`

**File**: `src/lib/pdf/render-procedure-note-pdf.ts`
- Same: switch from `userId` to `providerId`, use `.eq('id', ...)`

**File**: `src/lib/pdf/render-discharge-note-pdf.ts`
- Same: switch from `userId` to `providerId`, use `.eq('id', ...)`

**File**: `src/components/billing/invoice-detail-client.tsx`
- Line 64: Type still works (`assigned_provider_id: string | null`) — but if there's a join to `users`, update to join to `provider_profiles`

#### 5. Update Signature Upload Actions

**File**: `src/actions/settings.ts`

- `uploadProviderSignature()`: Change to accept `profileId: string` instead of using `user.id`. Look up profile via `.eq('id', profileId)`.
- `removeProviderSignature()`: Same — accept `profileId`.
- `getProviderSignatureUrl()`: Accept `profileId`.

### Success Criteria:

#### Automated Verification:
- [x] Migration applies cleanly: `npx supabase db push`
- [x] Type checking passes: `npm run typecheck`
- [x] Existing tests pass: `npm test`
- [x] Linting passes: `npm run lint` (1 pre-existing error in appearance-form.tsx)

#### Manual Verification:
- [ ] Existing FNP provider profile (id: `14d500e1-d637-4923-ad97-e8fd44facd53`) is preserved with `user_id` intact
- [ ] `supervising_provider_id` FK now references `provider_profiles(id)`, not `users(id)`
- [ ] `cases.assigned_provider_id` FK now references `provider_profiles(id)`, not `users(id)`
- [ ] Unique index `idx_provider_profiles_user_active` only enforces when `user_id IS NOT NULL`
- [ ] Can insert a provider profile with `user_id = NULL` (decoupled provider)
- [ ] `user_id` FK is `ON DELETE SET NULL` (not CASCADE) — deleting an auth user nulls out `user_id` instead of deleting the profile

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation.

---

## Phase 2: Provider Management UI

### Overview
Replace the single "edit my profile" form with a provider management interface: list all providers in a table, add/edit/delete via dialogs, with supervising provider selection.

### Changes Required:

#### 1. Provider List Component
**File**: `src/components/settings/provider-list.tsx` (new)

A table/card list showing all provider profiles:
- Columns: Display Name, Credentials, License #, NPI, Supervising Provider, Actions
- "Add Provider" button at top
- Edit/Delete action buttons per row
- Shows supervising provider's display name (resolved from the profiles list)

#### 2. Provider Form Dialog
**File**: `src/components/settings/provider-form-dialog.tsx` (new)

A dialog with the provider form for add/edit. Fields:
- Display Name (required)
- Credentials
- License Number
- NPI Number
- Supervising Provider (select from other providers — exclude self when editing)
- Signature Upload/Remove (reuse pattern from `provider-signature-upload.tsx`, scoped to this profile's `id`)

Reuse the existing `providerInfoSchema` from `src/lib/validations/settings.ts`.

For edit mode: pre-populate with existing data, call `updateProviderProfile(profileId, data)`. Show current signature with remove option.
For add mode: call `createProviderProfile(data)`. Signature upload available after initial save (need profile ID).

#### 3. Replace Provider Info Form
**File**: `src/components/settings/provider-info-form.tsx` — **replace entirely**

Remove the old single-user form. The new export will be `ProviderList` (or re-export from `provider-list.tsx`).

#### 4. Update Settings Tabs
**File**: `src/components/settings/settings-tabs.tsx`

- Remove `providerProfile` prop (no longer fetching "my" profile)
- Keep `providerProfiles` prop (now fetches full profile data, not just `user_id, display_name, credentials`)
- Update the Provider Info tab to render the new `ProviderList` component
- **Remove the "Signature" tab entirely** — signature upload/remove is now part of the provider edit dialog
- Remove `ProviderSignatureUpload` import

#### 5. Update Settings Page
**File**: `src/app/(dashboard)/settings/page.tsx`

- Remove `getProviderProfile()` call
- Update `listProviderProfiles()` call to return full profile data
- Pass updated props to `SettingsTabs`

#### 6. Create ProviderSelect Component
**File**: `src/components/providers/provider-select.tsx` (new)

Follow the `AttorneySelect` pattern (`src/components/attorneys/attorney-select.tsx`):
- Dropdown selecting from `provider_profiles`
- "Add Provider" button opening inline dialog
- Returns `provider_profiles.id` as the value
- Shows `"DisplayName, Credentials"` format
- Used in case forms (Phase 3) and in supervising provider selection

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Linting passes: `npm run lint` (1 pre-existing error in appearance-form.tsx)
- [x] Existing tests pass: `npm test`

#### Manual Verification:
- [ ] Settings → Provider Info shows list of all providers
- [ ] Can add a new provider (no auth user required)
- [ ] Can edit an existing provider
- [ ] Can soft-delete a provider (with confirmation)
- [ ] Supervising provider dropdown shows other providers
- [ ] Existing FNP provider appears in the list
- [ ] Signature upload/remove works within the provider edit dialog
- [ ] Signature tab is removed from settings
- [ ] Note/PDF generation still picks up the correct signature via `provider_profiles.id`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation.

---

## Phase 3: Case Form Integration

### Overview
Add `assigned_provider_id` to case creation wizard and case edit dialog using the new `ProviderSelect` component.

### Changes Required:

#### 1. Update Validation Schemas
**File**: `src/lib/validations/patient.ts`

Add `assigned_provider_id` to `patientDetailsSchema` (line 11–24):
```typescript
assigned_provider_id: z.string().uuid().optional().or(z.literal('')),
```

Add `assigned_provider_id` to `editCaseSchema` (line 45–51):
```typescript
assigned_provider_id: z.string().uuid().optional().or(z.literal('')),
```

#### 2. Update Case Creation Wizard
**File**: `src/components/patients/wizard-step-details.tsx`

Add a "Provider" section (after the Attorney section, line 228):
- Import `ProviderSelect`
- Add a `FormField` for `assigned_provider_id` with `ProviderSelect`
- Label: "Assigned Provider (optional)"

#### 3. Update Case Edit Dialog
**File**: `src/components/patients/case-overview-edit-dialog.tsx`

- Add `assigned_provider_id` to the `caseDetails` interface prop (line 48–54)
- Add `assigned_provider_id` to `defaultValues` (line 82–87)
- Add to `caseData` in `handleSave` (line 108–114)
- Add a `FormField` for `assigned_provider_id` with `ProviderSelect` (after attorney field, line 363)

#### 4. Update Server Actions
**File**: `src/actions/patients.ts`

- `createPatientCase()` (line 73–83): Add `assigned_provider_id: assigned_provider_id || null` to case insert
- `updateCase()` (line 207–212): Add `assigned_provider_id: parsed.data.assigned_provider_id || null` to case update

#### 5. Update Case Overview to Pass Provider ID
**File**: `src/components/patients/case-overview.tsx`

Ensure `assigned_provider_id` is passed to `CaseOverviewEditDialog` in the `caseDetails` prop.

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Linting passes: `npm run lint` (1 pre-existing error)
- [x] Existing tests pass: `npm test`

#### Manual Verification:
- [ ] Case creation wizard shows "Assigned Provider" dropdown
- [ ] Selecting a provider and creating a case saves `assigned_provider_id` correctly
- [ ] Case edit dialog shows current provider and allows changing
- [ ] Provider can be cleared (set to none)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation.

---

## Phase 4: PDF Template + Server Action

### Overview
Create the lien agreement PDF template, render function, and server action to generate + store the document.

### Changes Required:

#### 1. PDF Template
**File**: `src/lib/pdf/lien-agreement-template.tsx` (new)

Data interface:
```typescript
export interface LienAgreementPdfData {
  clinicLogoBase64?: string
  clinicAddress?: string
  clinicPhone?: string
  clinicFax?: string
  attorneyName?: string
  firmName?: string
  patientName: string
  dateOfBirth: string
  dateOfInjury: string
  providerLine: string // e.g., "Stephen Carney, MD / Armine Tadevosyan, FNP"
}
```

Template structure (matching the original NPMD PDF):
- Centered clinic header: logo, address, phone/fax (same pattern as `invoice-template.tsx:111–116`)
- "To Attorney:" line with attorney name
- Patient Name / Date of Birth row
- Date of Injury row
- Provider line: bold label + dynamic provider text
- "AUTHORIZATION AND LIEN AGREEMENT" centered bold title
- 4 paragraphs of static legal text (hardcoded, referencing "NPMD")
- Two signature blocks at bottom

#### 2. Render Function
**File**: `src/lib/pdf/render-lien-agreement-pdf.ts` (new)

Follow pattern from `render-invoice-pdf.ts`. Accepts `{ caseId: string }`.

Data assembly:
1. Parallel fetch: case (with patient + attorney joins), clinic settings
2. Fetch assigned provider profile via `.eq('id', caseData.assigned_provider_id)`
3. If provider has `supervising_provider_id`, fetch supervising profile via `.eq('id', ...)`
4. Build `providerLine`:
   - If supervising exists: `"SupervisingName, Credentials / TreatingName, Credentials"`
   - If no supervising: `"TreatingName, Credentials"`
   - If no assigned provider: `""`
5. Fetch clinic logo as base64
6. Assemble `LienAgreementPdfData` and render via `renderToBuffer`

#### 3. Server Action
**File**: `src/actions/lien.ts` (new)

```typescript
'use server'

export async function generateLienAgreement(caseId: string) {
  // 1. Auth check
  // 2. Verify case exists and is not closed (assertCaseNotClosed)
  // 3. Verify case has an attorney assigned (required for lien)
  // 4. Call renderLienAgreementPdf({ caseId })
  // 5. Upload PDF: `cases/${caseId}/lien-agreement-${Date.now()}.pdf`
  // 6. Insert documents row: document_type 'lien_agreement', status 'reviewed'
  // 7. Update cases set lien_on_file = true
  // 8. revalidatePath
  // 9. Return { data: { documentId, base64 } }
}
```

Follow `discharge-notes.ts:462–498` pattern for steps 5–6.

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Linting passes: `npm run lint`
- [x] No import errors in new files

#### Manual Verification:
- [ ] Generated PDF matches NPMD form layout
- [ ] Provider line shows "Supervising, MD / Treating, FNP" format
- [ ] PDF appears in case documents list
- [ ] `lien_on_file` set to `true`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation.

---

## Phase 5: UI Integration

### Overview
Add "Generate Lien Agreement" button to case overview, update document type labels/colors/filters.

### Changes Required:

#### 1. Update Document Type Labels and Colors
**File**: `src/components/documents/document-card.tsx`
Add `lien_agreement: 'Lien Agreement'` to `docTypeLabels`, `lien_agreement: 'bg-purple-100 text-purple-800 border-purple-200'` to `docTypeColors`.

#### 2. Update Document List Filter Options
**File**: `src/components/documents/document-list.tsx`
Add `{ value: 'lien_agreement', label: 'Lien Agreement' }` to `docTypeOptions`.

#### 3. Update Timeline Labels
**File**: `src/actions/timeline.ts`
Add `lien_agreement: 'Lien Agreement'` to `formatDocType`.

#### 4. Add Generate Button to Case Overview
**File**: `src/components/patients/case-overview.tsx`

Add a "Generate Lien Agreement" button in Case Actions card (alongside `StatusChangeDropdown`):

```typescript
import { FileSignature, Loader2 } from 'lucide-react'
import { generateLienAgreement } from '@/actions/lien'

// State:
const [generatingLien, setGeneratingLien] = useState(false)

// Handler triggers generateLienAgreement(caseData.id), downloads base64 result
// Button disabled when: isLocked || generatingLien || !caseData.attorney_id
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Linting passes: `npm run lint`
- [x] Existing tests pass: `npm test`

#### Manual Verification:
- [ ] "Generate Lien Agreement" button visible in Case Actions
- [ ] Button disabled without attorney assigned
- [ ] Button disabled when case is locked
- [ ] Clicking generates and downloads PDF
- [ ] Document appears in list with purple "Lien Agreement" badge
- [ ] Filter dropdown includes "Lien Agreement"
- [ ] `lien_on_file` updates to true

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation.

---

## Testing Strategy

### Unit Tests:
- Extend `document.test.ts` to validate `'lien_agreement'` as a valid document type
- Test `providerInfoSchema` with all fields (valid, empty, missing)

### Manual Testing Steps:
1. Create providers in Settings → Provider Info (including a supervising provider)
2. Create a case with patient, attorney, and assigned provider
3. Click "Generate Lien Agreement" from case overview
4. Verify PDF content: clinic header, patient/attorney info, provider line, legal text, signature lines
5. Verify document appears in documents list
6. Verify `lien_on_file` is true
7. Try generating without attorney — should show error
8. Try generating on closed case — button disabled
9. Generate invoice PDF — verify it shows assigned provider, not logged-in user
10. Generate notes — verify they use assigned provider

## References

- Research document: `thoughts/shared/research/2026-03-17-lien-form-integration.md`
- PDF template pattern: `src/lib/pdf/invoice-template.tsx`
- PDF store pattern: `src/actions/discharge-notes.ts:462–498`
- ProviderSelect pattern: `src/components/attorneys/attorney-select.tsx`
- Provider profiles schema: `supabase/migrations/007_clinic_provider_settings.sql`
- Document type enum: `src/lib/validations/document.ts:13`
- Case overview component: `src/components/patients/case-overview.tsx`
- Case creation wizard: `src/components/patients/wizard-step-details.tsx`
- Case edit dialog: `src/components/patients/case-overview-edit-dialog.tsx`
