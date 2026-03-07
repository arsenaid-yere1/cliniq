# Fix Upload Document List Refresh

## Overview

After uploading files via the UploadSheet, the document list doesn't update until the user manually refreshes the page. This is because the documents page is a server component that fetches documents once at render time, and nothing triggers a re-fetch after upload completes.

## Current State Analysis

- `src/app/(dashboard)/patients/[caseId]/documents/page.tsx` — Server component that calls `listDocuments(caseId)` and passes results as props to `DocumentList`
- `src/components/documents/document-list.tsx` — Client component that receives `documents` as a static prop and renders them. Also hosts the `UploadSheet`.
- `src/components/documents/upload-sheet.tsx` — Client component that handles file uploads via TUS protocol + saves metadata via server action. Has no mechanism to notify the parent that uploads are complete.

### Key Discoveries:
- `UploadSheet` already tracks `completedCount` and shows a toast on completion (line 198-200)
- `DocumentList` already manages `uploadOpen` state for the sheet (line 47)
- Neither component uses `useRouter` — no router import exists in the documents directory

## Desired End State

When one or more files finish uploading successfully, the document list automatically refreshes to show the newly uploaded files without requiring a manual page refresh.

### Verification:
1. Upload a file → it appears in the document list immediately after upload completes
2. Upload multiple files → all appear in the list after uploads finish
3. If all uploads fail, no unnecessary refresh occurs

## What We're NOT Doing

- Not switching to client-side data fetching (SWR/React Query)
- Not adding real-time subscriptions
- Not changing the upload flow itself
- Not adding per-file refresh (only refresh once after all uploads complete)

## Implementation Approach

**Original plan**: Use `router.refresh()` to re-run the server component after uploads complete.

**Problem discovered**: `router.refresh()` was blocked by long-running extraction server actions (`extractMriReport`/`extractChiroReport`) in React's transition queue — even with `setTimeout` and reordering, React tracked them as pending transitions.

**Final approach**: `DocumentList` manages documents as client-side state (initialized from server props) and calls the `listDocuments` server action directly to re-fetch after upload or delete. Extractions are deferred via `setTimeout(fn, 0)` to avoid blocking the refresh.

## Changes Made

### 1. `src/components/documents/upload-sheet.tsx`
- Added `onUploadComplete?: () => void` prop
- Moved extraction calls to `pendingExtractions` array, fired via `setTimeout` after `onUploadComplete`
- This ensures list refresh happens before slow extractions start

### 2. `src/components/documents/document-list.tsx`
- Documents are now client state: `useState(initialDocuments)`
- Added `refreshDocuments` callback that calls `listDocuments(caseId)` directly
- Passed `refreshDocuments` to `UploadSheet` via `onUploadComplete` and to each `DocumentCard` via `onRemoved`

### 3. `src/components/documents/document-card.tsx`
- Added `onRemoved?: () => void` prop
- Called `onRemoved?.()` after successful document removal

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit`
- [x] Linting passes: `npm run lint`

#### Manual Verification:
- [ ] Upload a single file → document appears in the list without manual refresh
- [ ] Upload multiple files → all documents appear after uploads complete
- [ ] Delete a document → it disappears from the list without manual refresh
- [ ] Upload with errors (all fail) → no unnecessary refresh triggered
- [ ] Filters and search state in DocumentList are preserved after refresh
- [ ] Upload sheet can be reopened and used again after a successful upload cycle

## References

- Upload sheet: `src/components/documents/upload-sheet.tsx`
- Document list: `src/components/documents/document-list.tsx`
- Document card: `src/components/documents/document-card.tsx`
- Documents page: `src/app/(dashboard)/patients/[caseId]/documents/page.tsx`
