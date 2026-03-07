# Document Review Status Sync Implementation Plan

## Overview

Auto-sync `documents.status` from `pending_review` to `reviewed` when a provider approves or edits an extraction. This makes the document status badges in the UI meaningful without adding any new user-facing workflows.

## Current State Analysis

Two independent review systems exist with no synchronization:

1. **Document status** (`documents.status`): `pending_review` / `reviewed` — schema exists but no code ever transitions to `reviewed`. All documents permanently show "Pending Review" badges.
2. **Extraction review** (`mri_extractions.review_status` / `chiro_extractions.review_status`): `pending_review` / `approved` / `edited` / `rejected` — fully implemented with approve/edit/reject server actions.

### Key Discoveries:
- Documents are always created with `status: 'pending_review'` ([documents.ts:103](src/actions/documents.ts#L103))
- Document card already renders green "Reviewed" badges — just never gets the status ([document-card.tsx:33-41](src/components/documents/document-card.tsx#L33-L41))
- Extraction approve/reject functions only select `case_id`, not `document_id` ([mri-extractions.ts:183](src/actions/mri-extractions.ts#L183))
- Both extraction tables have `document_id uuid not null references public.documents(id)` — the FK exists
- No schema changes needed — `reviewed_by_user_id`, `reviewed_at`, and `status` columns already exist on `documents`

## Desired End State

When a provider approves or edits an extraction, the parent document's status automatically transitions to `reviewed`. Rejected extractions do not affect document status (the AI failed, not the document).

### Verification:
1. Upload an MRI report → extraction runs → approve extraction → document card shows green "Reviewed" badge
2. Upload a chiro report → extraction runs → save & approve with edits → document card shows green "Reviewed" badge
3. Upload a report → extraction runs → reject extraction → document card still shows amber "Pending Review" badge
4. Document status filter on the documents page works correctly (can filter by `reviewed` / `pending_review`)

## What We're NOT Doing

- No "Mark as Reviewed" button on DocumentCard (separate future story)
- No gating extraction behind document review (Option B from research)
- No three-phase workflow (Option C from research)
- No schema/migration changes
- No UI changes (badges already handle both statuses)

## Implementation Approach

Add a `document_id` to the `.select()` in the 4 approve/edit functions (2 MRI + 2 chiro), then update `documents.status` to `reviewed` after each successful extraction approval. Extract a shared helper to avoid code duplication across the 4 call sites.

## Phase 1: Add Document Status Sync to Extraction Actions

### Overview
Modify the approve and saveAndApprove functions in both `mri-extractions.ts` and `chiro-extractions.ts` to also update the parent document's status to `reviewed`.

### Changes Required:

#### 1. MRI Extraction Actions
**File**: `src/actions/mri-extractions.ts`

**Change 1a**: In `approveMriExtraction` (line 183), change `.select('case_id')` to `.select('case_id, document_id')`, then add a document status update after the extraction update succeeds:

```typescript
// After the existing .single() call and error check:
const { data, error } = await supabase
  .from('mri_extractions')
  .update({
    review_status: 'approved',
    reviewed_by_user_id: user.id,
    reviewed_at: new Date().toISOString(),
    updated_by_user_id: user.id,
  })
  .eq('id', extractionId)
  .is('deleted_at', null)
  .select('case_id, document_id')  // <-- add document_id
  .single()

if (error) return { error: error.message }

// Sync document status
await supabase
  .from('documents')
  .update({
    status: 'reviewed',
    reviewed_by_user_id: user.id,
    reviewed_at: new Date().toISOString(),
    updated_by_user_id: user.id,
  })
  .eq('id', data.document_id)

revalidatePath(`/patients/${data.case_id}/clinical`)
revalidatePath(`/patients/${data.case_id}/documents`)  // <-- add this
return { data }
```

**Change 1b**: Apply the same pattern to `saveAndApproveMriExtraction` (line 212):
- Change `.select('case_id')` → `.select('case_id, document_id')`
- Add the same document status update block after the extraction update
- Add `revalidatePath` for the documents page

#### 2. Chiro Extraction Actions
**File**: `src/actions/chiro-extractions.ts`

**Change 2a**: In `approveChiroExtraction` (line 186), apply the same changes as 1a.

**Change 2b**: In `saveAndApproveChiroExtraction` (line 215), apply the same changes as 1b.

#### 3. Reject Functions — No Changes
The reject functions (`rejectMriExtraction`, `rejectChiroExtraction`) are intentionally left unchanged. A rejected extraction means the AI produced bad data, not that the document itself is wrong.

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `npx tsc --noEmit`
- [x] Linting passes: `npm run lint`
- [x] App builds: `npm run build`

#### Manual Verification:
- [ ] Upload an MRI report → wait for extraction → go to clinical page → approve extraction → navigate to documents page → document shows green "Reviewed" badge
- [ ] Upload a chiro report → wait for extraction → go to clinical page → save & approve with edits → navigate to documents page → document shows green "Reviewed" badge
- [ ] Upload a report → wait for extraction → reject extraction → document still shows amber "Pending Review" badge
- [ ] On documents page, filter by status "Reviewed" → only approved/edited extraction documents appear
- [ ] On documents page, filter by status "Pending Review" → unapproved documents appear
- [ ] Documents of type "Other" (no extraction) remain permanently in "Pending Review" (expected behavior for MVP)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Manual Testing Steps:
1. Upload an MRI PDF → verify document starts as "Pending Review"
2. Wait for extraction toast → navigate to Clinical Data page
3. Approve the extraction → navigate back to Documents page
4. Verify document now shows "Reviewed" in green
5. Repeat steps 1-4 with a chiro report using "Save & Approve" with overrides
6. Upload another report → reject the extraction → verify document stays "Pending Review"
7. Test the status filter dropdown on the documents page

### Edge Cases:
- Multiple extractions for the same document (re-extraction after rejection): The second approval should still sync correctly since it updates by `document_id`
- Document already marked as reviewed (idempotent): The update is a no-op if status is already `reviewed`

## Performance Considerations

- One additional Supabase query per approve/edit action (updating `documents` table)
- This is acceptable since approvals are infrequent, manual user actions
- No indexes needed — updating by primary key (`documents.id`)

## References

- Research: `thoughts/shared/research/2026-03-06-document-review-clinical-data-sync.md`
- Document schema: `supabase/migrations/002_case_dashboard_tables.sql:4-22`
- MRI extraction actions: `src/actions/mri-extractions.ts:168-244`
- Chiro extraction actions: `src/actions/chiro-extractions.ts:171-247`
- Document card UI: `src/components/documents/document-card.tsx:33-41`
