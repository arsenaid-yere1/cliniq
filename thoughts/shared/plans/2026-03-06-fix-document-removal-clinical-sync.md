# Fix Document Removal Sync with Clinical Data — Implementation Plan

## Overview

When a document is soft-deleted via `removeDocument`, linked clinical extraction records (`chiro_extractions`, `mri_extractions`) remain alive and visible on the Clinical Data tab. This creates orphaned extractions showing "Unknown document" that can still be approved/rejected, syncing status back to a deleted document. We need to cascade the soft-delete to extraction records and add safety guards.

## Current State Analysis

### Document Removal Flow
- `removeDocument` in `src/actions/documents.ts:127` soft-deletes by setting `deleted_at`
- Only revalidates the documents page — **not** the clinical page
- Does **not** touch `chiro_extractions` or `mri_extractions`

### Clinical Extraction Queries
- `listChiroExtractions` (`src/actions/chiro-extractions.ts:139`) and `listMriExtractions` (`src/actions/mri-extractions.ts:136`) filter by `deleted_at IS NULL` on the extraction table only
- They join `documents` for `file_name`/`file_path` but don't check `documents.deleted_at`
- Result: extractions for soft-deleted documents still appear, showing "Unknown document"

### Sync Direction
- **Extraction → Document**: `syncDocumentReviewed` (chiro line 233, MRI line 230) updates document status to `reviewed` on approval — but has **no `deleted_at` guard**, so it writes to deleted documents
- **Document → Extraction**: No sync exists — this is the gap

### Key Discoveries:
- `removeDocument` returns `case_id` from the updated row (`src/actions/documents.ts:140`)
- Extraction soft-delete pattern already exists in `extractChiroReport` (line 26-31) and `extractMriReport` (line 26-31) — we can follow the same pattern
- Both extraction tables have `document_id` FK and `deleted_at`/`updated_by_user_id` audit fields

## Desired End State

When a document is removed:
1. All linked `chiro_extractions` and `mri_extractions` with matching `document_id` are soft-deleted
2. The clinical page is revalidated so orphaned extractions disappear immediately
3. `syncDocumentReviewed` refuses to update soft-deleted documents

### How to verify:
1. Upload a document, trigger extraction, then remove the document
2. Clinical Data tab should no longer show the extraction
3. Documents tab should reflect the removal
4. No console errors or data integrity issues

## What We're NOT Doing

- Changing the extraction query to filter by document `deleted_at` (cascade handles it)
- Adding hard-delete capability
- Modifying the extraction review UI
- Adding undo/restore functionality for cascaded deletions

## Implementation Approach

Single-phase change touching two files. The fix is small and self-contained.

## Phase 1: Cascade Soft-Delete and Add Guards

### Overview
Modify `removeDocument` to cascade soft-deletes to extraction tables, revalidate the clinical page, and add a `deleted_at` guard to `syncDocumentReviewed`.

### Changes Required:

#### 1. Update `removeDocument` to cascade soft-deletes
**File**: `src/actions/documents.ts`
**Changes**: After soft-deleting the document, soft-delete linked extractions and revalidate the clinical path.

```typescript
export async function removeDocument(documentId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data, error } = await supabase
    .from('documents')
    .update({
      deleted_at: new Date().toISOString(),
      updated_by_user_id: user.id,
    })
    .eq('id', documentId)
    .is('deleted_at', null)
    .select('case_id')
    .single()

  if (error) return { error: error.message }

  // Cascade soft-delete to linked clinical extractions
  const now = new Date().toISOString()
  await Promise.all([
    supabase
      .from('chiro_extractions')
      .update({ deleted_at: now, updated_by_user_id: user.id })
      .eq('document_id', documentId)
      .is('deleted_at', null),
    supabase
      .from('mri_extractions')
      .update({ deleted_at: now, updated_by_user_id: user.id })
      .eq('document_id', documentId)
      .is('deleted_at', null),
  ])

  revalidatePath(`/patients/${data.case_id}/documents`)
  revalidatePath(`/patients/${data.case_id}/clinical`)
  return { data }
}
```

#### 2. Add `deleted_at` guard to `syncDocumentReviewed` (chiro)
**File**: `src/actions/chiro-extractions.ts`
**Changes**: Add `.is('deleted_at', null)` to the update query in `syncDocumentReviewed` (line 246).

```typescript
async function syncDocumentReviewed(
  supabase: Awaited<ReturnType<typeof createClient>>,
  documentId: string,
  userId: string,
) {
  await supabase
    .from('documents')
    .update({
      status: 'reviewed',
      reviewed_by_user_id: userId,
      reviewed_at: new Date().toISOString(),
      updated_by_user_id: userId,
    })
    .eq('id', documentId)
    .is('deleted_at', null)
}
```

#### 3. Add `deleted_at` guard to `syncDocumentReviewed` (MRI)
**File**: `src/actions/mri-extractions.ts`
**Changes**: Identical change — add `.is('deleted_at', null)` to the update query in `syncDocumentReviewed` (line 243).

```typescript
async function syncDocumentReviewed(
  supabase: Awaited<ReturnType<typeof createClient>>,
  documentId: string,
  userId: string,
) {
  await supabase
    .from('documents')
    .update({
      status: 'reviewed',
      reviewed_by_user_id: userId,
      reviewed_at: new Date().toISOString(),
      updated_by_user_id: userId,
    })
    .eq('id', documentId)
    .is('deleted_at', null)
}
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit`
- [x] Linting passes: `npm run lint`
- [x] App builds successfully: `npm run build`

#### Manual Verification:
- [x] Upload a chiro report → trigger extraction → remove the document → Clinical Data tab no longer shows the extraction
- [x] Upload an MRI report → trigger extraction → remove the document → Clinical Data tab no longer shows the extraction
- [x] Upload a document → trigger extraction → approve extraction → document shows "Reviewed" → remove document → extraction disappears from clinical tab
- [x] Upload a document → trigger extraction → remove document → try navigating to clinical tab → no errors, extraction gone
- [x] Existing non-deleted documents and their extractions are unaffected

**Implementation Note**: This is a single-phase plan. After completing all changes and automated verification passes, pause for manual confirmation.

## Testing Strategy

### Manual Testing Steps:
1. Create a case with a chiro report document
2. Trigger extraction, wait for completion
3. Remove the document from the Documents tab
4. Navigate to Clinical Data tab — extraction should be gone
5. Repeat steps 1-4 with an MRI report
6. Verify that approving an extraction for a non-deleted document still works normally
7. Verify that removing a document with no extractions still works normally

## Performance Considerations

The two additional Supabase queries in `removeDocument` run in parallel via `Promise.all` and target rows by indexed `document_id` + `deleted_at` — negligible impact.

## References

- `src/actions/documents.ts` — `removeDocument` at line 127
- `src/actions/chiro-extractions.ts` — `syncDocumentReviewed` at line 233, extraction soft-delete pattern at lines 26-31
- `src/actions/mri-extractions.ts` — `syncDocumentReviewed` at line 230, extraction soft-delete pattern at lines 26-31
