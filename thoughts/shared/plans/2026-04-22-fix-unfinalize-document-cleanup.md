# Fix Unfinalize Leaves Orphaned Document Repository Rows — Implementation Plan

## Overview

Unfinalizing a note flipped the note row back to `draft` but left the generated PDF and its `documents` row live in the repository. Re-finalizing spawned a second document, so repeated finalize/unfinalize cycles accumulated stale PDFs on the case with no back-reference from any note. This plan cascades the soft-delete to the `documents` row + storage object when a note is unfinalized and consolidates the finalize re-entry cleanup into a shared helper.

Status: **implemented** on main (2026-04-22). Commits:
- `115e360` — core cleanup (helper, unfinalize patch, finalize simplification, dialog copy)
- `91beef5` — documents-tab revalidation on finalize/unfinalize

## Current State Analysis (pre-fix)

### Unfinalize Flow
- Three server actions, one per note type, all identical in shape:
  - `unfinalizeInitialVisitNote` — `src/actions/initial-visit-notes.ts:655`
  - `unfinalizeProcedureNote` — `src/actions/procedure-notes.ts:904`
  - `unfinalizeDischargeNote` — `src/actions/discharge-notes.ts:986`
- Each one ran a single UPDATE on the note row: set `status='draft'`, null `finalized_by_user_id` + `finalized_at`.
- None touched the `documents` table.
- None touched the `case-documents` storage bucket.
- Note row kept its `document_id` FK pointing to a still-live `documents` row.

### Finalize Flow
- Each `finalize*Note` action already contained an 18-line "clean up previous document if re-finalizing" block:
  - If `note.document_id` is set, fetch the `documents` row, update `deleted_at = now()`, remove the file from the `case-documents` bucket.
  - Applied only when finalize ran a second time on a note that still had a lingering `document_id`.
- Same block copied verbatim across all three `finalize*` actions.

### Document Table Shape
- `documents` table (`supabase/migrations/002_case_dashboard_tables.sql:4-22`):
  - `case_id`, `document_type` (`'generated'` for note PDFs), `file_path`, `file_size_bytes`, `mime_type`, `status`, audit fields.
  - No `note_id` FK — the linkage lives on the note row via `document_id`.
  - Soft-delete via `deleted_at`.
- Storage bucket: `case-documents`, path pattern `cases/{caseId}/{noteKind}-note-{timestamp}.pdf`.

### UI
- Three unfinalize confirmation dialogs told users "The existing document record will be preserved" — consistent with the code but orphan-producing.
  - `src/components/procedures/procedure-note-editor.tsx:768`
  - `src/components/discharge/discharge-note-editor.tsx:768`
  - `src/components/clinical/initial-visit-editor.tsx:1950`

### Key Discoveries
- Prior research: `thoughts/shared/research/2026-04-22-unfinalize-document-repository-impact.md` documented the orphan behavior before the fix landed.
- The re-finalize cleanup block already proved the cleanup pattern works — reusing it for unfinalize is a straight lift.
- `documents` storage and DB row are soft-deleted separately; no DB trigger cascades into storage. The storage `remove(...)` call is required explicitly.

## Desired End State

When a user unfinalizes a finalized note:
1. The note row flips back to `status='draft'` with `finalized_*` fields + `document_id` nulled.
2. The previously generated `documents` row is soft-deleted (`deleted_at` set, `updated_by_user_id` recorded).
3. The corresponding PDF is removed from the `case-documents` bucket.
4. Re-finalizing generates a fresh PDF and a fresh `documents` row, with no stale predecessors.
5. The confirmation dialog copy matches the new behavior.

Finalize re-entry behavior is preserved (same cleanup semantics), but the cleanup logic is no longer duplicated.

### How to verify
1. Generate + finalize any note type. Confirm a `documents` row exists (`document_type='generated'`, `deleted_at IS NULL`) and a PDF exists in the `case-documents` bucket.
2. Unfinalize the note. Confirm:
   - Note row is back to `draft`, `document_id` is null.
   - `documents` row has `deleted_at` populated.
   - PDF is gone from the bucket.
3. Edit + re-finalize. Confirm a brand-new `documents` row + new PDF appear, and step 1's row is still soft-deleted.
4. Repeat unfinalize → re-finalize cycles; only one live `documents` row should exist per note at any time.

## What We're NOT Doing

- Adding a unique DB constraint on `(note_id)` in `documents` — the shape doesn't match (no `note_id` column on `documents`; linkage is on the note row).
- Hard-deleting storage objects for already-orphaned rows that predate this fix — handled as a separate dedupe pass (see Audit section).
- Adding undo/restore capability for the cascaded soft-delete.
- Adding a new note type or touching the AI generation path.
- Cleaning up orphan storage files for already soft-deleted `documents` rows (would be a separate storage sweep).

## Implementation Approach

One shared helper + three unfinalize actions patched + three finalize actions simplified to call the same helper + three dialog copies updated. Single-phase change.

## Phase 1: Shared Helper

### Overview
Extract the finalize re-entry cleanup block into `softDeleteFinalizedDocument` so both finalize (re-entry) and unfinalize paths can share one implementation.

### Changes

**New file**: `src/lib/supabase/finalize-document.ts`

```typescript
import type { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export async function softDeleteFinalizedDocument(
  supabase: SupabaseServerClient,
  documentId: string | null | undefined,
  userId: string,
): Promise<void> {
  if (!documentId) return

  const { data: doc } = await supabase
    .from('documents')
    .select('id, file_path')
    .eq('id', documentId)
    .is('deleted_at', null)
    .single()

  if (!doc) return

  await supabase
    .from('documents')
    .update({ deleted_at: new Date().toISOString(), updated_by_user_id: userId })
    .eq('id', doc.id)

  if (doc.file_path) {
    await supabase.storage.from('case-documents').remove([doc.file_path])
  }
}
```

Safe to call with null id (no-op). Safe to call on an already-soft-deleted document (select filter makes it a no-op).

### Success Criteria
- File compiles standalone.
- Imported from all three action files.

## Phase 2: Patch Unfinalize Actions

### Overview
Each unfinalize action now (a) fetches the note's `document_id`, (b) calls `softDeleteFinalizedDocument`, (c) runs the existing status-revert UPDATE with `document_id: null` added.

### Changes

For each of:
- `src/actions/initial-visit-notes.ts` — `unfinalizeInitialVisitNote`
- `src/actions/procedure-notes.ts` — `unfinalizeProcedureNote`
- `src/actions/discharge-notes.ts` — `unfinalizeDischargeNote`

Shape:

```typescript
const { data: note } = await supabase
  .from('<note_table>')
  .select('id, document_id')
  .eq(/* scope */)
  .is('deleted_at', null)
  .eq('status', 'finalized')
  .maybeSingle()

if (!note) return { error: 'No finalized note to unfinalize' }

await softDeleteFinalizedDocument(supabase, note.document_id, user.id)

const { error } = await supabase
  .from('<note_table>')
  .update({
    status: 'draft',
    finalized_by_user_id: null,
    finalized_at: null,
    document_id: null,
    updated_by_user_id: user.id,
  })
  .eq('id', note.id)
```

### Success Criteria
- Unfinalize returns an explicit error when no finalized note row is present (previously silently succeeded).
- Note row has `document_id = null` after unfinalize.
- Document + storage object gone.

## Phase 3: Simplify Finalize Re-entry

### Overview
Replace the duplicated 18-line cleanup block in each `finalize*Note` with a single call to the shared helper. Preserves behavior.

### Changes
In each of `finalizeInitialVisitNote`, `finalizeProcedureNote`, `finalizeDischargeNote`:

Before:
```typescript
if (note.document_id) {
  const { data: oldDoc } = await supabase
    .from('documents')
    .select('id, file_path')
    .eq('id', note.document_id)
    .is('deleted_at', null)
    .single()
  if (oldDoc) {
    await supabase.from('documents').update({ ... }).eq('id', oldDoc.id)
    if (oldDoc.file_path) {
      await supabase.storage.from('case-documents').remove([oldDoc.file_path])
    }
  }
}
```

After:
```typescript
await softDeleteFinalizedDocument(supabase, note.document_id, user.id)
```

### Success Criteria
- Existing re-finalize cleanup behavior unchanged.
- Net ~54 lines removed.

## Phase 4: Dialog Copy

### Overview
Dialog text previously promised "existing document record will be preserved" — now inaccurate.

### Changes
Three dialogs, same new copy:
- `src/components/procedures/procedure-note-editor.tsx:768`
- `src/components/discharge/discharge-note-editor.tsx:768`
- `src/components/clinical/initial-visit-editor.tsx:1950`

New text:
> "This will re-open the note for editing and remove the current finalized PDF from the document repository. Re-finalizing will generate a fresh PDF. Continue?"

### Success Criteria
- Copy matches behavior. User is warned before a destructive soft-delete.

## Phase 5: Revalidate Documents Tab on Finalize/Unfinalize

### Overview
Finalize and unfinalize previously revalidated only the note's own page (`/patients/[caseId]/procedures/[id]/note`, `/patients/[caseId]/discharge`, or `/patients/[caseId]`). The patient documents tab at `/patients/[caseId]/documents` served stale SSR output until something unrelated revalidated it. After a fresh finalize the PDF wouldn't show up on the documents list; after an unfinalize the now-soft-deleted row would linger.

### Changes
Add one line to each of the six lifecycle call sites:

```typescript
revalidatePath(`/patients/${caseId}/documents`)
```

Sites:
- `src/actions/procedure-notes.ts` — `finalizeProcedureNote` + `unfinalizeProcedureNote`
- `src/actions/discharge-notes.ts` — `finalizeDischargeNote` + `unfinalizeDischargeNote`
- `src/actions/initial-visit-notes.ts` — `finalizeInitialVisitNote` + `unfinalizeInitialVisitNote`

### Success Criteria
- After finalize, the documents tab shows the new PDF without a hard refresh.
- After unfinalize, the documents tab drops the removed PDF without a hard refresh.

## Testing Strategy

### Manual
- Full finalize → unfinalize → re-finalize cycle per note type (initial visit, procedure, discharge).
- Verify `documents` table state and `case-documents` bucket contents at each step.
- Verify dialog warns before removal.
- Verify `case_closed` cases still block unfinalize via `assertCaseNotClosed`.

### Automated
- No existing unfinalize tests. Not in scope for this fix; could be added later under `src/actions/__tests__/`.

## Audit / Migration (one-time, before this fix goes out)

Pre-existing orphans from prior unfinalize-without-cleanup cycles may linger. Run before relying on the invariant.

Detect:

```sql
SELECT d.id, d.case_id, d.file_path, d.file_name, d.created_at
FROM documents d
WHERE d.document_type = 'generated'
  AND d.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM initial_visit_notes n WHERE n.document_id = d.id)
  AND NOT EXISTS (SELECT 1 FROM procedure_notes     n WHERE n.document_id = d.id)
  AND NOT EXISTS (SELECT 1 FROM discharge_notes     n WHERE n.document_id = d.id)
ORDER BY d.created_at DESC;
```

Cleanup (after review of the above):

```sql
UPDATE documents
SET deleted_at = now(), updated_at = now()
WHERE document_type = 'generated'
  AND deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM initial_visit_notes n WHERE n.document_id = documents.id)
  AND NOT EXISTS (SELECT 1 FROM procedure_notes     n WHERE n.document_id = documents.id)
  AND NOT EXISTS (SELECT 1 FROM discharge_notes     n WHERE n.document_id = documents.id);
```

Note: SQL soft-deletes the rows only. Storage objects for those paths remain in the `case-documents` bucket and would need a separate storage sweep if strict parity is required.

## Files Touched

- `src/lib/supabase/finalize-document.ts` — new helper
- `src/actions/initial-visit-notes.ts` — unfinalize patched, finalize simplified
- `src/actions/procedure-notes.ts` — unfinalize patched, finalize simplified
- `src/actions/discharge-notes.ts` — unfinalize patched, finalize simplified
- `src/components/clinical/initial-visit-editor.tsx` — dialog copy
- `src/components/discharge/discharge-note-editor.tsx` — dialog copy
- `src/components/procedures/procedure-note-editor.tsx` — dialog copy

## Related

- Research: `thoughts/shared/research/2026-04-22-unfinalize-document-repository-impact.md`
- Ships on commits: `115e360` (core), `91beef5` (documents-tab revalidate)
- Pre-existing finalize/lifecycle plans touched peripherally (no edits required):
  - `thoughts/shared/plans/2026-03-09-epic-3-story-3.1-initial-visit-note.md`
  - `thoughts/shared/plans/2026-03-11-epic-4-story-4.3-generate-prp-procedure-note.md`
  - `thoughts/shared/plans/2026-03-12-epic-5-story-5.1-generate-discharge-summary.md`
