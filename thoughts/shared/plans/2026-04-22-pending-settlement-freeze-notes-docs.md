# Freeze Notes and Documents on Pending Settlement Implementation Plan

## Overview

Add `pending_settlement` to `LOCKED_STATUSES` so every case-scoped write (client gating + server guard) freezes when a case enters Pending Settlement, matching the existing `closed` / `archived` behavior. As part of the same change, close a pre-existing client-side gap by wiring `DocumentCard` row actions (Delete + Download) to the shared lock flag so they freeze on every locked status, including the newly added `pending_settlement`.

## Current State Analysis

- `LOCKED_STATUSES = ['closed', 'archived']` defined in [src/lib/constants/case-status.ts:24](src/lib/constants/case-status.ts#L24) is the single source of truth for the case-lock flag.
- `pending_settlement` is a valid status ([src/lib/constants/case-status.ts:1](src/lib/constants/case-status.ts#L1)) with legal transitions to `closed` and back to `active` ([src/lib/constants/case-status.ts:17-23](src/lib/constants/case-status.ts#L17-L23)) but deliberately excluded from the lock set.
- Client gating pattern `const isLocked = LOCKED_STATUSES.includes(caseStatus as CaseStatus)` is replicated across ~20 components (3 clinical note editors, 7 extraction form/review pairs, document list, procedure table, case overview, case summary card, discharge vitals/tone cards via props).
- Server guard `assertCaseNotClosed` in [src/actions/case-status.ts:9-24](src/actions/case-status.ts#L9-L24) keys off the same constant; called at ~38 sites across 13 action files.
- `DocumentCard` in [src/components/documents/document-card.tsx](src/components/documents/document-card.tsx) does not consume `useCaseStatus()` and does not accept `isLocked`. Its Download and Delete buttons stay enabled even for `closed`/`archived` cases — only the server guard blocks the underlying action.
- `updateCaseStatus` does **not** self-call `assertCaseNotClosed` ([src/actions/case-status.ts:28-100](src/actions/case-status.ts#L28-L100)); status transitions remain legal once locked (e.g., Pending Settlement → Active).
- Unit test at [src/lib/constants/__tests__/case-status.test.ts:89](src/lib/constants/__tests__/case-status.test.ts#L89) pins `pending_settlement` OUT of `LOCKED_STATUSES`. Must flip.
- Server-side guard error message: `'This case is closed. No modifications are allowed until it is reopened.'` — misleading once `pending_settlement` is locked.

## Desired End State

After this plan:

1. `LOCKED_STATUSES` contains `pending_settlement`, `closed`, `archived`.
2. All ~20 consumer components automatically disable their Edit/Generate/Upload/Save/Delete affordances when a case is in Pending Settlement (no component-level code change needed beyond verification — they already derive `isLocked` from the constant).
3. `DocumentCard` rows disable Delete and Download when locked; Preview stays enabled (read-only is safe).
4. Server guard `assertCaseNotClosed` returns an error for Pending Settlement writes, wording updated to reflect "locked" rather than "closed".
5. Unit tests updated to assert `pending_settlement` IS locked, and `assertCaseNotClosed` rejects Pending Settlement.
6. Pending Settlement → Active transition remains legal (unblocks editing again).

### Key Discoveries:
- Single constant flip fans out to all consumers — [src/lib/constants/case-status.ts:24](src/lib/constants/case-status.ts#L24).
- Transition map untouched — Pending Settlement stays reversible via [src/actions/case-status.ts:49-53](src/actions/case-status.ts#L49-L53).
- `DocumentCard` is the only row-level component missing client gating — [src/components/documents/document-card.tsx](src/components/documents/document-card.tsx).
- No database trigger or RLS mirrors `LOCKED_STATUSES` — app-level only; no migration needed.

## What We're NOT Doing

- Not changing the `CASE_STATUSES` enum or `CASE_STATUS_TRANSITIONS` map.
- Not adding a second, narrower lock set (e.g., `EDIT_LOCKED_STATUSES`) — single source of truth stays single.
- Not touching the medical-invoice prerequisite logic inside `updateCaseStatus`.
- Not adding a DB-level CHECK/trigger for `case_status` locking.
- Not changing `case_status_history` logging.
- Not touching the billing `isDraft` gate in [src/components/billing/billing-table.tsx](src/components/billing/billing-table.tsx) (orthogonal — invoice-status driven, not case-status driven).
- Not adding an `isLocked` prop to `UploadSheet` internals (top-level Upload button gate is sufficient since the sheet opens only from it).
- Not migrating existing Pending Settlement cases' data in any way — status semantics change, data stays.

## Implementation Approach

Single commit can land phases 1–3 as code; phase 4 is tests. Keep all phases as separate commits for readable history per the `feedback_plan_commit_split` rule (feat vs docs split). The change is low-risk because:

- The client gating pattern is already uniformly applied — consumers pick up the new lock member for free.
- The server guard is already wired into every write path — no missing call sites.
- The only new client code is in `DocumentCard` (plumbing an `isLocked` prop) + `DocumentList` (passing it down).

---

## Phase 1: Expand `LOCKED_STATUSES` and Update Error Wording

### Overview
Flip the constant and update the server guard's user-facing error to reflect a generic "locked" state.

### Changes Required:

#### 1. Constant
**File**: `src/lib/constants/case-status.ts`
**Changes**: Add `pending_settlement` to `LOCKED_STATUSES`.

```ts
export const LOCKED_STATUSES: CaseStatus[] = ['pending_settlement', 'closed', 'archived']
```

#### 2. Server guard error message
**File**: `src/actions/case-status.ts`
**Changes**: Replace the closed-specific wording with a generic locked-state message.

```ts
export async function assertCaseNotClosed(
  supabase: Awaited<ReturnType<typeof createClient>>,
  caseId: string,
): Promise<{ error: string | null }> {
  const { data } = await supabase
    .from('cases')
    .select('case_status')
    .eq('id', caseId)
    .is('deleted_at', null)
    .single()

  if (data?.case_status && LOCKED_STATUSES.includes(data.case_status as CaseStatus)) {
    const label = CASE_STATUS_CONFIG[data.case_status as CaseStatus].label
    return { error: `This case is locked (${label}). Move it back to Active to make changes.` }
  }
  return { error: null }
}
```

Note: `CASE_STATUS_CONFIG` is already imported at [src/actions/case-status.ts:5](src/actions/case-status.ts#L5). No new imports needed.

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Linting passes: `npm run lint`
- [x] Constant tests pass (after Phase 4 updates): `npm test -- case-status.test.ts`
- [x] Action tests pass (after Phase 4 updates): `npm test -- actions/__tests__/case-status.test.ts`

#### Manual Verification:
- [ ] In dev, move a case to Pending Settlement. Attempt to upload a document via the UI — sheet opens and submits an error toast containing `"locked (Pending Settlement)"`.
- [ ] Transition the same case Pending Settlement → Active via the status dropdown; verify it succeeds (status change action is not itself guarded by `assertCaseNotClosed`).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Wire `DocumentCard` Row Actions to `isLocked`

### Overview
Close the pre-existing client gap: `DocumentCard`'s Delete and Download buttons are always enabled today. Disable both when the case is locked. Preview stays enabled.

### Changes Required:

#### 1. Pass `isLocked` from `DocumentList` to each row
**File**: `src/components/documents/document-list.tsx`
**Changes**: Forward the already-computed `isLocked` to `DocumentCard`.

```tsx
<DocumentCard
  key={doc.id}
  document={doc}
  patientLastName={patientLastName}
  isLocked={isLocked}
  onRemoved={refreshDocuments}
/>
```

#### 2. Accept `isLocked` on `DocumentCard` and apply to Download + Delete
**File**: `src/components/documents/document-card.tsx`
**Changes**: Add `isLocked` to the prop interface. Apply it to the Download button and the Delete (AlertDialogTrigger) button. Leave Preview untouched (read-only is safe).

Prop type update:
```tsx
interface DocumentCardProps {
  document: {
    id: string
    case_id: string
    file_name: string
    file_path: string
    mime_type: string | null
    document_type: string
    status: string
    created_at: string
    content_date: string | null
    procedure_number: number | null
    notes: string | null
    uploaded_by: { full_name: string } | null
  }
  patientLastName: string | null
  isLocked?: boolean
  onRemoved?: () => void
}
```

Component signature update:
```tsx
export function DocumentCard({ document, patientLastName, isLocked = false, onRemoved }: DocumentCardProps) {
```

Download button:
```tsx
<Button
  variant="ghost"
  size="sm"
  disabled={isLocked}
  onClick={handleDownload}
>
  Download
</Button>
```

Delete trigger:
```tsx
<AlertDialog>
  <AlertDialogTrigger asChild>
    <Button
      variant="ghost"
      size="sm"
      disabled={isLocked}
      className="text-destructive hover:text-destructive"
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  </AlertDialogTrigger>
  ...
</AlertDialog>
```

Preview stays unchanged — still gated only by `canPreview` (mime-type).

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Linting passes: `npm run lint`
- [x] Unit tests pass: `npm test`

#### Manual Verification:
- [ ] Case in `active` — DocumentCard Download and Delete buttons enabled; Delete dialog opens.
- [ ] Case in `pending_settlement` — both buttons are visibly disabled; clicking does nothing. Preview still works for PDFs/images.
- [ ] Case in `closed` — same as `pending_settlement`.
- [ ] Case transitioned back to `active` — buttons re-enable after the page/context rerenders (revalidation is already wired in `updateCaseStatus`).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Verification Sweep of Consumer Components

### Overview
No code change expected here — all ~20 existing consumers already use `LOCKED_STATUSES.includes(...)`. This phase is a grep-and-eyeball sweep to confirm every Edit/Generate/Save affordance is actually disabled by a prop/flag derived from the constant, not hard-coded against `'closed'` or `'archived'`. Catch any stragglers.

### Changes Required:

#### 1. Grep sweep
**File**: N/A (verification)
**Commands**:

```sh
# Any hard-coded equality checks against 'closed' or 'archived' that should have used LOCKED_STATUSES instead
rg -n "case_status\s*===\s*'(closed|archived)'" src/
rg -n "caseStatus\s*===\s*'(closed|archived)'" src/

# Any direct use of isClosed/isArchived that bypass LOCKED_STATUSES
rg -n "\bisClosed\b|\bisArchived\b" src/
```

If any hits are found, either:
- Replace with `LOCKED_STATUSES.includes(x as CaseStatus)` and `isLocked`, OR
- Add an inline exclusion comment explaining why the narrow check is intentional (expected: none).

#### 2. Consumer audit list (no edits expected; verify each renders correctly under Pending Settlement)

Components that already derive `isLocked` from the constant — confirm their gated affordances disable on Pending Settlement:

- [src/components/clinical/case-summary-card.tsx:75](src/components/clinical/case-summary-card.tsx#L75)
- [src/components/clinical/chiro-extraction-form.tsx:49](src/components/clinical/chiro-extraction-form.tsx#L49), [chiro-extraction-review.tsx:95](src/components/clinical/chiro-extraction-review.tsx#L95)
- [src/components/clinical/ct-scan-extraction-form.tsx:48](src/components/clinical/ct-scan-extraction-form.tsx#L48), [ct-scan-extraction-review.tsx:54](src/components/clinical/ct-scan-extraction-review.tsx#L54)
- [src/components/clinical/mri-extraction-form.tsx:48](src/components/clinical/mri-extraction-form.tsx#L48), [mri-extraction-review.tsx:52](src/components/clinical/mri-extraction-review.tsx#L52)
- [src/components/clinical/ortho-extraction-form.tsx:48](src/components/clinical/ortho-extraction-form.tsx#L48), [ortho-extraction-review.tsx:80](src/components/clinical/ortho-extraction-review.tsx#L80)
- [src/components/clinical/pm-extraction-form.tsx:48](src/components/clinical/pm-extraction-form.tsx#L48), [pm-extraction-review.tsx:62](src/components/clinical/pm-extraction-review.tsx#L62)
- [src/components/clinical/pt-extraction-form.tsx:45](src/components/clinical/pt-extraction-form.tsx#L45), [pt-extraction-review.tsx:91](src/components/clinical/pt-extraction-review.tsx#L91)
- [src/components/clinical/initial-visit-editor.tsx:320](src/components/clinical/initial-visit-editor.tsx#L320)
- [src/components/discharge/discharge-note-editor.tsx:207](src/components/discharge/discharge-note-editor.tsx#L207)
- [src/components/procedures/procedure-note-editor.tsx:201](src/components/procedures/procedure-note-editor.tsx#L201)
- [src/components/procedures/procedure-table.tsx:132](src/components/procedures/procedure-table.tsx#L132)
- [src/components/patients/case-overview.tsx:79](src/components/patients/case-overview.tsx#L79)
- [src/components/documents/document-list.tsx:63](src/components/documents/document-list.tsx#L63)

### Success Criteria:

#### Automated Verification:
- [x] Grep for hard-coded `'closed'` / `'archived'` equality checks returns no matches in `src/`.
- [x] No new `isClosed` / `isArchived` identifiers outside tests.

#### Manual Verification:
- [ ] Visit a case in Pending Settlement and exercise each tab (Overview, Initial Visit, Clinical extractions, Procedures, Discharge, Documents, Billing). All Generate/Regenerate/Save/Edit/Upload/Delete affordances are disabled. Forms are read-only.
- [ ] Move the case back to Active. All affordances re-enable.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Update Tests to Match New Lock Semantics

### Overview
Flip the pinning test and add coverage for Pending Settlement in both the constant tests and the `assertCaseNotClosed` tests. Update the existing assertion that matches the old `'closed'`-only error string.

### Changes Required:

#### 1. Constant tests
**File**: `src/lib/constants/__tests__/case-status.test.ts`
**Changes**: Flip the `pending_settlement` assertion and add explicit inclusion.

Before:
```ts
describe('LOCKED_STATUSES', () => {
  it('includes closed and archived', () => {
    expect(LOCKED_STATUSES).toContain('closed')
    expect(LOCKED_STATUSES).toContain('archived')
  })

  it('does not include active statuses', () => {
    expect(LOCKED_STATUSES).not.toContain('intake')
    expect(LOCKED_STATUSES).not.toContain('active')
    expect(LOCKED_STATUSES).not.toContain('pending_settlement')
  })
})
```

After:
```ts
describe('LOCKED_STATUSES', () => {
  it('includes pending_settlement, closed, and archived', () => {
    expect(LOCKED_STATUSES).toContain('pending_settlement')
    expect(LOCKED_STATUSES).toContain('closed')
    expect(LOCKED_STATUSES).toContain('archived')
  })

  it('does not include editable statuses', () => {
    expect(LOCKED_STATUSES).not.toContain('intake')
    expect(LOCKED_STATUSES).not.toContain('active')
  })
})
```

#### 2. `assertCaseNotClosed` tests
**File**: `src/actions/__tests__/case-status.test.ts`
**Changes**: Update the existing `closed` / `archived` assertions to match the new error wording, and add a `pending_settlement` case. Existing test at line 46-47 currently does `expect(result.error).toContain('closed')` — this should become `toContain('locked')` to match the new message.

Add a new test after the `archived` case:
```ts
it('returns error for a pending_settlement case', async () => {
  mockTableResults(mockSupabase, {
    cases: { data: { case_status: 'pending_settlement' }, error: null },
  })
  const result = await assertCaseNotClosed(mockSupabase as never, TEST_CASE_ID)
  expect(result.error).toContain('locked')
  expect(result.error).toContain('Pending Settlement')
})
```

Update the two existing assertions:
```ts
// closed case
expect(result.error).toContain('locked')

// archived case
expect(result.error).toContain('locked')
```

#### 3. No new tests for consumer components
All consumer components derive `isLocked` from the constant; the constant-level tests cover the fan-out. No per-component UI tests currently exist for the lock flag, and we're not adding new surface area here.

### Success Criteria:

#### Automated Verification:
- [x] Unit tests pass: `npm test -- case-status.test.ts`
- [x] Action tests pass: `npm test -- actions/__tests__/case-status.test.ts`
- [x] Full suite passes: `npm test`
- [x] Type checking passes: `npm run typecheck`
- [x] Linting passes: `npm run lint`

#### Manual Verification:
- [x] No remaining test expectations assert that `pending_settlement` is NOT locked.

---

## Testing Strategy

### Unit Tests:
- `LOCKED_STATUSES` contains exactly `pending_settlement`, `closed`, `archived`.
- `assertCaseNotClosed` returns an error containing `"locked"` for `pending_settlement`, `closed`, and `archived`; returns no error for `intake`, `active`.
- Error string contains the human-readable status label (e.g., `"Pending Settlement"`).

### Integration Tests:
- Existing action-level tests that cover `createDocument`, note-generation actions, billing writes, etc., already run through `assertCaseNotClosed`. Any test seeding a `pending_settlement` case and calling one of these should now observe an error; if none exist today, no new integration test is required — the unit-level `assertCaseNotClosed` coverage is the single point of decision.

### Manual Testing Steps:
1. Create or pick a case. Ensure a medical (`invoice_type='visit'`) invoice exists so the status transition prerequisite passes.
2. Move the case to Pending Settlement via the status dropdown.
3. Navigate each tab (Overview, Initial Visit, Clinical extractions, Procedures, Discharge, Documents, Billing) and confirm:
   - Generate / Regenerate / Save buttons disabled.
   - Form inputs disabled / read-only.
   - Documents tab: Upload disabled; per-row Download and Delete disabled; Preview still works.
4. Try to bypass client gating by calling a write action (e.g., via dev console fetch to `/api/...` if applicable, or by triggering a hidden mutation) — confirm the server returns the new `"locked (Pending Settlement). Move it back to Active..."` error.
5. Move the case back to Active (Pending Settlement → Active is a legal transition). Confirm all affordances re-enable after revalidation.
6. Repeat steps 3–4 for a `closed` case to confirm no regression in the existing lock behavior.

## Performance Considerations

Negligible. The change is a one-element addition to an in-memory array consulted by `.includes()` — O(n) on a 3-element list. Server guard query pattern is unchanged.

## Migration Notes

No data migration. Semantics change only. Cases currently in `pending_settlement` will, from the moment of deploy, reject new writes until moved back to `active`. Communicate this to users before deploying.

## References

- Research: [thoughts/shared/research/2026-04-22-pending-settlement-notes-docs-freeze.md](../research/2026-04-22-pending-settlement-notes-docs-freeze.md)
- Related research (billing row actions): [thoughts/shared/research/2026-04-22-billing-panel-invoice-download-delete.md](../research/2026-04-22-billing-panel-invoice-download-delete.md)
- Original status-lock design: [thoughts/shared/research/2026-03-14-case-status-design-recommendation.md](../research/2026-03-14-case-status-design-recommendation.md)
- Transition plan that introduced Pending Settlement as non-locked: [thoughts/shared/plans/2026-03-14-case-status-transitions.md](2026-03-14-case-status-transitions.md)
- Constant: [src/lib/constants/case-status.ts:24](src/lib/constants/case-status.ts#L24)
- Server guard: [src/actions/case-status.ts:9-24](src/actions/case-status.ts#L9-L24)
- Consumer list: see "Current State Analysis" above.
