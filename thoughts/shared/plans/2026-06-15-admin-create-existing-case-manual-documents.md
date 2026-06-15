# Admin-Gated Create Existing Case + Manual Documents + Override Status Changes — Implementation Plan

## Overview

Add an **admin-only** capability to (1) create a case at a non-`intake` status (for new or existing patients), (2) attach manually-uploaded **finished PDFs** — including the clinical/billing document kinds the system normally generates (Initial Visit, Pain Management, Procedure, Discharge, Invoice) — to a case regardless of its workflow state, and (3) change case status outside the normal transition rules — bypassing `CASE_STATUS_TRANSITIONS`, the `LOCKED_STATUSES`/`assertCaseNotClosed` write-gate, and the medical-invoice prerequisite.

The change is **additive and non-breaking**: non-admin behavior and the default case-creation flow are unchanged.

**Document model decision (confirmed):** historical docs are **uploaded finished PDFs only** — the admin already has the real Initial Visit / Procedure / Discharge / Invoice PDFs (produced outside the system) and attaches the files for storage + listing. This does **not** create `initial_visit_notes` / `procedure_notes` / `discharge_notes` / `invoices` rows, does not run AI, does not render any PDF, and does **not** affect billing totals or status prerequisites. Each uploaded doc uses its upload timestamp (`created_at`); no original-date field is added.

**Migration scope:** two small CHECK-widening migrations — (a) `documents.document_type` adds upload types (`initial_visit`, `procedure`, `discharge`, `invoice`); `pain_management` already exists; (b) `cases.case_status` adds `pending_imaging` (Phase 6). Both additive; no schema/RLS/trigger changes beyond the CHECKs.

**Also in scope:** a new `pending_imaging` case status to track cases awaiting imaging results after the Initial Visit (Phase 6) — a free, non-locked side-state entered manually.

## Current State Analysis

All findings verified against source (see research doc `thoughts/shared/research/2026-06-15-create-existing-case-manual-documents.md`).

- **Restrictions are TS-only.** `cases`/`documents` RLS = single `FOR ALL USING (auth.role() = 'authenticated')` policy with no `case_status` condition (001_initial_schema.sql:184; 002:121). No trigger forces initial `case_status='intake'`; the column CHECK accepts all 5 enum values. `documents.document_type` CHECK and `case-documents` bucket policies impose no status condition.
- **Case creation** — `createPatientCase` ([src/actions/patients.ts:36-126](../../../src/actions/patients.ts)) hardcodes `case_status: 'intake'` (line 106) and the initial history `new_status: 'intake'` (line 120). Caller cannot set status.
- **Create schema** — `createPatientCaseInputSchema` is a discriminated union over `patientDetailsSchema` (shared by both modes) ([src/lib/validations/patient.ts:11-36](../../../src/lib/validations/patient.ts)). Adding a field to `patientDetailsSchema` makes it available in both `new_patient` and `existing_patient`.
- **Status change** — `updateCaseStatus` ([src/actions/case-status.ts:29-104](../../../src/actions/case-status.ts)) validates against `CASE_STATUS_TRANSITIONS` (50-54) and enforces the medical-invoice prerequisite for `pending_settlement`/`closed` (57-70). `assertCaseNotClosed` (9-25) blocks writes when status ∈ `LOCKED_STATUSES`.
- **Document upload** — `getUploadSession` (documents.ts:115) and `saveDocumentMetadata` (documents.ts:141) both call `assertCaseNotClosed`.
- **Role system exists** — `getCurrentUserWithRole()` / `requireAdmin()` ([src/lib/auth/require-role.ts:30-36](../../../src/lib/auth/require-role.ts)); `users.role ∈ ('admin','provider','staff')`.
- **Admin-to-UI pattern exists** — server page resolves role and passes an `isAdmin` prop to a client component ([src/app/(dashboard)/settings/page.tsx:9-10](../../../src/app/(dashboard)/settings/page.tsx), [src/components/settings/settings-tabs.tsx:76](../../../src/components/settings/settings-tabs.tsx)). The plan reuses this pattern verbatim.
- **Status UI is data-driven** — `status-change-dropdown.tsx` builds its menu from `CASE_STATUS_TRANSITIONS[currentStatus]` and returns `null` if empty (lines 36-37).

## Desired End State

An admin user can:
1. On `/patients/new`, optionally pick a starting case status (any of the 5); non-admins never see the control and always get `intake`.
2. On a case page, change status to *any* status via an admin "override" affordance, with the medical-invoice prerequisite and lock-gate skipped; the change is still recorded in `case_status_history`.
3. Upload a manual document to a case in any status (including `closed`/`archived`) — via an admin override on the upload path.

Verification: see Success Criteria per phase.

### Key Discoveries
- `src/lib/validations/patient.ts:11` — `patientDetailsSchema` is the shared base; add `case_status` here once.
- `src/actions/patients.ts:106,120` — the two hardcoded `'intake'` literals to replace.
- `src/actions/case-status.ts:29,57,115` — transition check, invoice prerequisite, lock guard.
- `src/actions/documents.ts:115,141` — the two `assertCaseNotClosed` call sites.
- `src/app/(dashboard)/settings/page.tsx:9` — `getCurrentUserWithRole` server-side resolution pattern to copy.

## What We're NOT Doing

- **No DB migration** — no schema, CHECK, RLS, or trigger changes.
- **No change to non-admin behavior** — default flow stays `intake`-only with full guard enforcement.
- **No relaxing of the global constants** (`CASE_STATUS_TRANSITIONS`, `LOCKED_STATUSES`) — guardrails remain for everyone; admins bypass them per-call, not globally.
- **No new import/seed/bulk pipeline** — single-case creation only.
- **No manual *generation* / manual data-entry of AI-note records** — we do NOT build manual-entry forms for `initial_visit_notes` / `procedure_notes` / `discharge_notes` / `invoices`, and we do NOT render any PDF. Historical clinical/billing docs are uploaded as finished PDF files only.
- **No billing impact** — uploading an "invoice" PDF does NOT create an `invoices` row; `total_billed`/`balance_due` and the medical-invoice status prerequisite are unaffected by uploaded docs.
- **No original-date capture** — uploaded docs use `created_at` (upload time); no `content_date`/service-date field added.
- **No changes to invoice/note state machines** beyond the case-status invoice prerequisite already named.
- **No temporal validation work** — accident/visit/open dates are already unrestricted.

## Implementation Approach

Thread an explicit, server-validated `override`/`asAdmin` capability through the three server actions, gating each bypass behind `requireAdmin()` *inside the action* (never trusting a client flag alone). Surface the controls in the UI only when an `isAdmin` prop (resolved server-side) is true. Server-side role checks are the source of truth; UI gating is convenience only.

Phasing: backend first (actions + schema + tests), then UI, so each layer is independently verifiable.

---

## Phase 1: Allow admin to set case status at creation

### Overview
Add an optional `case_status` to the create schema and honor it in `createPatientCase`, gating any non-`intake` value behind `requireAdmin()`.

### Changes Required

#### 1. Validation schema
**File**: `src/lib/validations/patient.ts`
**Changes**: Add optional `case_status` to the shared `patientDetailsSchema` so both modes accept it. Import the status list from constants to keep the enum single-sourced.

```typescript
import { CASE_STATUSES } from '@/lib/constants/case-status'

export const patientDetailsSchema = z.object({
  // ...existing fields...
  lien_on_file: z.boolean(),
  case_status: z.enum(CASE_STATUSES).optional(), // admin-only; defaults to 'intake' server-side
})
```
(`CASE_STATUSES` is a readonly tuple in `src/lib/constants/case-status.ts:1` — usable directly by `z.enum`.)

#### 2. Server action
**File**: `src/actions/patients.ts`
**Changes**: In `createPatientCase`, resolve role, default status to `'intake'`, and require admin for any other value. Use the resolved status for both the `cases` insert and the initial history row.

```typescript
import { getCurrentUserWithRole } from '@/lib/auth/require-role'
// ...
const me = await getCurrentUserWithRole()
const requestedStatus = parsed.data.case_status ?? 'intake'
if (requestedStatus !== 'intake' && me?.role !== 'admin') {
  return { error: 'Only an administrator can create a case at a non-intake status.' }
}
// ...in the cases insert:
case_status: requestedStatus,
// ...and set case_close_date when applicable:
case_close_date: (requestedStatus === 'closed' || requestedStatus === 'archived')
  ? new Date().toISOString().split('T')[0]
  : null,
// ...in the history insert:
new_status: requestedStatus,
```
Keep `previous_status` unset on the initial history row (matches current behavior).

### Success Criteria

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run lint`
- [ ] Unit tests pass: `npm test -- patients`
- [ ] New test: non-admin passing `case_status: 'active'` returns the admin error and inserts nothing
- [ ] New test: admin passing `case_status: 'active'` inserts a case with `case_status='active'` and a history row `new_status='active'`
- [ ] New test: omitting `case_status` still creates an `intake` case (regression)

#### Manual Verification:
- [ ] Existing wizard flow (no status field yet) still creates `intake` cases unchanged.

**Implementation Note**: Pause for manual confirmation before Phase 2.

---

## Phase 2: Allow admin override on status changes

### Overview
Let `updateCaseStatus` accept an `override` option that, when the caller is admin, skips the transition validation and the invoice prerequisite. Add an admin bypass to `assertCaseNotClosed` consumers.

### Changes Required

#### 1. `updateCaseStatus`
**File**: `src/actions/case-status.ts`
**Changes**: Add an optional `options` arg; resolve role; when `override && admin`, skip transition + prerequisite checks. History still recorded.

```typescript
import { getCurrentUserWithRole } from '@/lib/auth/require-role'

export async function updateCaseStatus(
  caseId: string,
  newStatus: CaseStatus,
  notes?: string,
  options?: { override?: boolean },
) {
  // ...auth + fetch currentStatus unchanged...
  const me = await getCurrentUserWithRole()
  const isAdminOverride = !!options?.override && me?.role === 'admin'

  if (currentStatus === newStatus) {
    return { error: `Case is already ${CASE_STATUS_CONFIG[newStatus].label}` }
  }

  if (!isAdminOverride) {
    const allowed = CASE_STATUS_TRANSITIONS[currentStatus]
    if (!allowed?.includes(newStatus)) {
      return { error: `Cannot change status from ${CASE_STATUS_CONFIG[currentStatus].label} to ${CASE_STATUS_CONFIG[newStatus].label}` }
    }
  }

  if (!isAdminOverride && (newStatus === 'pending_settlement' || newStatus === 'closed')) {
    // ...existing invoice prerequisite check unchanged...
  }
  // ...build payload, update, insert history (append ' (admin override)' to notes when isAdminOverride)...
}
```
`closeCase`/`reopenCase` wrappers unchanged (they pass no `override`).

#### 2. Admin bypass for the lock guard
**File**: `src/actions/case-status.ts`
**Changes**: Add a small helper so callers can allow a locked case for admins without duplicating role logic.

```typescript
export async function assertCaseWritable(
  supabase: Awaited<ReturnType<typeof createClient>>,
  caseId: string,
  options?: { allowLockedForAdmin?: boolean },
): Promise<{ error: string | null }> {
  if (options?.allowLockedForAdmin) {
    const me = await getCurrentUserWithRole()
    if (me?.role === 'admin') return { error: null }
  }
  return assertCaseNotClosed(supabase, caseId)
}
```
Keep `assertCaseNotClosed` as-is so all existing callers are untouched.

### Success Criteria

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run lint`
- [ ] Unit tests pass: `npm test -- case-status`
- [ ] New test: admin + `override:true` performs an otherwise-illegal transition (e.g. `archived` → `active`) and writes history
- [ ] New test: admin + `override:true` moves to `closed` with no medical invoice present (prerequisite skipped)
- [ ] New test: non-admin + `override:true` still hits the normal transition/prerequisite errors (flag ignored without admin role)
- [ ] Regression: no-override calls (incl. `closeCase`/`reopenCase`) behave exactly as before

#### Manual Verification:
- [ ] N/A at this layer (covered by Phase 4 UI test).

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Add document types for historical clinical/billing PDFs

### Overview
Extend the `documents.document_type` set so uploaded historical Initial Visit / Procedure / Discharge / Invoice PDFs can be stored and listed under meaningful types. `pain_management` already exists and is reused.

### Changes Required

#### 1. Migration — extend the CHECK constraint
**File**: `supabase/migrations/<timestamp>_historical_document_types.sql` (new)
**Changes**: Drop and re-add `documents_document_type_check` adding the four new values. Mirror the existing pattern in `20260408_procedure_consent_document_type.sql`.

```sql
alter table public.documents
  drop constraint documents_document_type_check,
  add constraint documents_document_type_check
    check (document_type in (
      'mri_report', 'chiro_report', 'pain_management', 'pt_report',
      'orthopedic_report', 'ct_scan', 'generated', 'lien_agreement',
      'procedure_consent', 'other',
      'initial_visit', 'procedure', 'discharge', 'invoice'
    ));
```
Applied via `npx supabase db push` (per project migration workflow — see memory `feedback_supabase_migrations`). Note: `x_ray` is in the zod enum but absent from the current DB CHECK; this migration does not change that pre-existing mismatch (out of scope).

#### 2. Zod enum + UI labels
**File**: `src/lib/validations/document.ts`
**Changes**: Add `'initial_visit'`, `'procedure'`, `'discharge'`, `'invoice'` to `documentTypeEnum` (line 13).
**File**: wherever the upload `document_type` `<Select>` options + list labels are defined (the document type label map used by `upload-sheet.tsx` / `document-list.tsx` / `document-card.tsx`).
**Changes**: Add human labels: `initial_visit` → "Initial Visit", `procedure` → "Procedure", `discharge` → "Discharge", `invoice` → "Invoice". Reuse existing `pain_management` → "Pain Management".

### Success Criteria

#### Automated Verification:
- [ ] Migration applies cleanly: `npx supabase db push`
- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run lint`
- [ ] Unit test: `saveDocumentMetadata` accepts each new `document_type` and inserts the row
- [ ] `listDocuments` filter by each new type returns matching rows

#### Manual Verification:
- [ ] Upload dialog shows the new types in the type dropdown.
- [ ] An uploaded "Initial Visit" PDF appears in the documents list under that label.

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: Allow admin to attach manual documents to any-status case

### Overview
Let the upload path accept an admin override so finished-PDF documents can be uploaded to a `closed`/`archived`/back-entered case.

### Changes Required

#### 1. `getUploadSession` and `saveDocumentMetadata`
**File**: `src/actions/documents.ts`
**Changes**: Accept an optional `allowLocked` flag on both actions and route the guard through `assertCaseWritable`.

```typescript
import { assertCaseWritable, autoAdvanceFromIntake } from '@/actions/case-status'

export async function getUploadSession(data: DocumentUploadMeta, options?: { allowLocked?: boolean }) {
  // ...
  const closedCheck = await assertCaseWritable(supabase, parsed.data.caseId, {
    allowLockedForAdmin: options?.allowLocked,
  })
  if (closedCheck.error) return { error: closedCheck.error }
  // ...
}

export async function saveDocumentMetadata(
  input: { /* ...existing... */ },
  options?: { allowLocked?: boolean },
) {
  // ...
  const closedCheck = await assertCaseWritable(supabase, input.caseId, {
    allowLockedForAdmin: options?.allowLocked,
  })
  if (closedCheck.error) return { error: closedCheck.error }
  await autoAdvanceFromIntake(supabase, input.caseId, user.id) // unchanged: no-op unless intake
  // ...
}
```
`assertCaseWritable` already re-checks the role server-side, so the flag is safe to expose.

### Success Criteria

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run lint`
- [ ] Unit tests pass: `npm test -- documents`
- [ ] New test: admin + `allowLocked:true` gets an upload session for a `closed` case
- [ ] New test: non-admin + `allowLocked:true` on a `closed` case still returns the lock error
- [ ] Regression: default (no options) on a locked case still returns the lock error; on an open case still succeeds

#### Manual Verification:
- [ ] (Covered by Phase 5 UI test.)

**Implementation Note**: Pause for manual confirmation before Phase 5.

---

## Phase 5: Admin UI surfaces

### Overview
Expose the three capabilities in the UI, visible only to admins, reusing the existing `isAdmin`-prop pattern.

### Changes Required

#### 1. New-case wizard — optional status select
**File**: `src/app/(dashboard)/patients/new/page.tsx`
**Changes**: Resolve role server-side and pass `isAdmin` to `<PatientWizard>`.
```typescript
import { getCurrentUserWithRole } from '@/lib/auth/require-role'
const me = await getCurrentUserWithRole()
// <PatientWizard existingPatient={...} isAdmin={me?.role === 'admin'} />
```
**File**: `src/components/patients/patient-wizard.tsx` (+ `wizard-step-details.tsx`)
**Changes**: Accept `isAdmin` prop; when true, render a `case_status` `<Select>` (default `intake`) in the details step; include `case_status` in the values sent to `createPatientCase`. When `isAdmin` is false, the field is absent and the action defaults to `intake`.

#### 2. Case page — admin status override
**File**: `src/app/(dashboard)/patients/[caseId]/page.tsx` (and/or the layout that renders `CaseOverview`)
**Changes**: Resolve `isAdmin` server-side and pass it down to `CaseOverview` → `StatusChangeDropdown`.
**File**: `src/components/patients/status-change-dropdown.tsx`
**Changes**: Accept `isAdmin` prop. When `isAdmin`, render an additional "Override status" submenu listing all `CASE_STATUSES` (minus the current one) and call `updateCaseStatus(caseId, target, undefined, { override: true })`. Normal (non-override) items remain driven by `CASE_STATUS_TRANSITIONS`. Confirmation dialog reused. Component no longer returns `null` for admins when `allowedTransitions` is empty (e.g. on `archived`).
**File**: `src/components/patients/case-overview.tsx`
**Changes**: When `isAdmin`, do not disable the quick-action buttons / show the lock banner as a hard block (or add an "admin can still act" affordance). Minimal version: pass `isAdmin` so the `StatusChangeDropdown` always renders; lock-banner copy may stay.

#### 3. Documents page — admin upload on locked cases
**File**: `src/app/(dashboard)/patients/[caseId]/documents/page.tsx`
**Changes**: Resolve `isAdmin`, pass to `<DocumentList>`.
**File**: `src/components/documents/document-list.tsx` (+ `upload-sheet.tsx`)
**Changes**: Accept `isAdmin`; when true, keep the Upload button enabled even if `isLocked`, and pass `{ allowLocked: true }` through to `getUploadSession`/`saveDocumentMetadata`.

### Success Criteria

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run lint`
- [ ] Full test suite passes: `npm test`
- [ ] Build succeeds: `npm run build`

#### Manual Verification:
- [ ] As **admin**: `/patients/new` shows a status select; creating a case as `active` lands on the case page in `active`.
- [ ] As **non-admin**: no status select appears; new cases are `intake`.
- [ ] As **admin**: on an `archived`/`closed` case, "Override status" lets you move to any status; change succeeds with no medical invoice and is recorded in history.
- [ ] As **non-admin**: status dropdown only offers the normal transitions; locked-case write actions stay disabled.
- [ ] As **admin**: upload finished PDFs typed Initial Visit / Procedure / Discharge / Invoice / Pain Management to a `closed` case successfully; each appears in the documents list under its label.
- [ ] As **non-admin**: upload remains disabled on a locked case.
- [ ] Uploaded "invoice" PDF does NOT change the case `balance_due`/`total_billed` and does NOT satisfy the medical-invoice status prerequisite (confirms billing is untouched).

**Implementation Note**: Final manual confirmation closes the plan.

---

## Phase 6: New `pending_imaging` case status

### Overview
Add a new case status `pending_imaging` ("Pending Imaging") to track cases awaiting imaging results after the Initial Visit. It is a **free side-state**: reachable from `intake` and `active`, and returns to `active`. It is **not locked** (the case stays writable so providers can upload imaging and keep working) and is entered **manually** via the existing Change Status dropdown — no auto-trigger.

This phase is independent of Phases 1–5 and can ship separately. It interacts with the admin override (Phase 2) only in that admins can additionally reach it from any status.

### Changes Required

#### 1. Status constants
**File**: `src/lib/constants/case-status.ts`
**Changes**: Add the value, its config, and wire transitions. Not added to `LOCKED_STATUSES`.

```typescript
export const CASE_STATUSES = ['intake', 'pending_imaging', 'active', 'pending_settlement', 'closed', 'archived'] as const

// CASE_STATUS_CONFIG — add:
pending_imaging: { label: 'Pending Imaging', color: 'bg-purple-100 text-purple-800 border-purple-200', variant: 'secondary' },

// CASE_STATUS_TRANSITIONS — add pending_imaging as a target of intake & active, and its own row:
intake:             ['pending_imaging', 'active', 'closed'],
active:             ['pending_imaging', 'pending_settlement', 'closed'],
pending_imaging:    ['active', 'closed'],
// pending_settlement, closed, archived unchanged

// LOCKED_STATUSES unchanged: ['pending_settlement', 'closed', 'archived']
```
(Position in the `CASE_STATUSES` tuple is cosmetic for ordering; placing it after `intake` reads naturally. `CaseStatus` type updates automatically.)

#### 2. DB CHECK constraint
**File**: `supabase/migrations/<timestamp>_case_status_pending_imaging.sql` (new)
**Changes**: Widen the `cases.case_status` CHECK to include the new value. (Original constraint is in `001_initial_schema.sql:81`.)

```sql
alter table public.cases
  drop constraint if exists cases_case_status_check,
  add constraint cases_case_status_check
    check (case_status in (
      'intake', 'pending_imaging', 'active', 'pending_settlement', 'closed', 'archived'
    ));
```
Apply via `npx supabase db push`. Confirm the exact existing constraint name first (`\d public.cases` or grep the migration); adjust the `drop constraint` name to match. `case_status_history` has no enum CHECK on its status columns (text), so no change there. Additive only — no existing rows affected.

#### 3. Generated DB types
**File**: `src/types/database.ts`
**Changes**: Regenerate via `npx supabase gen types` (or hand-add `'pending_imaging'` to the `case_status` union if types are maintained manually). Verify `cases.Row['case_status']` includes it.

#### 4. UI — badges auto-propagate; add explicit "pending" visibility
The sidebar badge, overview lock banner, status dropdown, and per-case status badges all read from `CASE_STATUS_CONFIG` / `CASE_STATUS_TRANSITIONS`, so the new status renders and becomes selectable automatically. **`pending_imaging` is kept OUT of the active-case count** — it is surfaced as its own "pending" bucket, per the two additions below.

**(a) People list — new "Pending Imaging" count column.**
**File**: `src/actions/patients.ts` — `listPatients` normalize (lines 185-217).
**Changes**: `active_case_count` continues to count `['intake','active','pending_settlement']` (do NOT add `pending_imaging`). Add a new derived field `pending_imaging_case_count` = number of the patient's cases with `case_status === 'pending_imaging'`.
```typescript
const pendingImagingCount = cases.filter((c) => c.case_status === 'pending_imaging').length
// return: ...active_case_count, pending_imaging_case_count: pendingImagingCount, ...
```
**File**: `src/components/patients/people-list-page-client.tsx`
**Changes**: Add `pending_imaging_case_count` to the `PatientRow` interface (line 24) and a new column after "Active Cases" (line 71) rendering a badge with the Pending Imaging color; show the count (e.g. badge hidden or muted when 0).

**(b) Case list — status filter (incl. Pending Imaging).**
**File**: the case-list client that renders `PatientListTable` (the component that owns `globalFilter` for `listPatientCases` results) and/or `src/components/patients/patient-list-page-client.tsx`.
**Changes**: Add a status `<Select>` filter built from `CASE_STATUSES` + an "All" option; filter the rows client-side by `case_status` (mirrors the existing client-side `globalFilter` pattern). `PatientListTable` already renders the status badge from config, so `pending_imaging` rows display correctly once present. No server change needed (filter client-side over the already-fetched list); if the list is large, optionally thread a `status` arg into `listPatientCases` instead.

### Success Criteria

#### Automated Verification:
- [ ] Migration applies cleanly: `npx supabase db push`
- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run lint`
- [ ] Unit tests pass: `npm test -- case-status`
- [ ] Updated `case-status.test.ts`: `intake → pending_imaging`, `active → pending_imaging`, and `pending_imaging → active` are allowed; `pending_imaging` is NOT in `LOCKED_STATUSES`
- [ ] `patients.test.ts`: `listPatients` returns `pending_imaging_case_count` and excludes `pending_imaging` from `active_case_count`
- [ ] Regression: existing transition tests still pass (no removed transitions)

#### Manual Verification:
- [ ] On an `active` case, Change Status offers "Pending Imaging"; selecting it moves the case and records history.
- [ ] A `pending_imaging` case is still writable — documents can be uploaded and notes edited (no lock banner).
- [ ] From `pending_imaging`, Change Status offers "Active" to return.
- [ ] The Pending Imaging badge renders with its color in the sidebar, overview, and case list.
- [ ] People list shows a "Pending Imaging" count column; a patient with one `pending_imaging` case shows 1 there and that case is NOT included in the Active Cases count.
- [ ] Case list status filter includes "Pending Imaging" and filtering to it shows only those cases.

**Implementation Note**: Independent phase — may be implemented and verified on its own.

---

## Testing Strategy

### Unit Tests
- `src/actions/__tests__/patients.test.ts` — admin/non-admin `case_status` at creation; default-intake regression.
- `src/actions/__tests__/case-status.test.ts` — admin override skips transition + invoice prerequisite; non-admin flag ignored; wrappers unchanged; history always written.
- `src/actions/__tests__/documents.test.ts` (or existing) — admin `allowLocked` upload on locked case; non-admin denied; default behavior unchanged; new historical `document_type` values accepted.
- `src/lib/constants/__tests__/case-status.test.ts` — `pending_imaging` transitions (intake/active → pending_imaging → active), not locked; existing transitions preserved.
- Mock `getCurrentUserWithRole` per existing test patterns to vary role.

### Integration / Manual
- Cover the Phase 5 manual matrix (admin vs non-admin × create / status / upload, incl. the new historical doc types and the billing-untouched check).

## Performance Considerations
Each gated action adds at most one `getCurrentUserWithRole()` query (single-row `users` lookup) only when an override/non-default path is taken. Negligible.

## Migration Notes
One migration only (Phase 3): extend the `documents.document_type` CHECK constraint to add `initial_visit`, `procedure`, `discharge`, `invoice`. It is additive (only widens allowed values) — no existing rows change, no data backfill, and it is independently reversible. No other schema/RLS/trigger change. Apply via `npx supabase db push`. All other behavior changes are additive optional parameters + admin-only UI.

## References
- Research: `thoughts/shared/research/2026-06-15-create-existing-case-manual-documents.md`
- Role pattern: `src/lib/auth/require-role.ts:30`, `src/app/(dashboard)/settings/page.tsx:9-10`, `src/components/settings/settings-tabs.tsx:76`
- Create action: `src/actions/patients.ts:36-126`
- Status action: `src/actions/case-status.ts:29-104`
- Upload action: `src/actions/documents.ts:96-176`
- Status UI: `src/components/patients/status-change-dropdown.tsx:36-37`
