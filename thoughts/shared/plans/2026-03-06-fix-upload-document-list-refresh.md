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

Use Next.js `router.refresh()` to re-run the server component after uploads complete. This is the idiomatic Next.js App Router approach — it re-executes the server component's data fetching without a full page reload, and React reconciles the new server-rendered output with the existing client state.

## Phase 1: Add Refresh After Upload

### Changes Required:

#### 1. Add `onUploadComplete` callback to UploadSheet
**File**: `src/components/documents/upload-sheet.tsx`
**Changes**: Add an optional `onUploadComplete` prop and call it when uploads finish successfully.

```tsx
// Update the props interface (line 34-38):
interface UploadSheetProps {
  caseId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onUploadComplete?: () => void
}

// Update the component signature (line 40):
export function UploadSheet({ caseId, open, onOpenChange, onUploadComplete }: UploadSheetProps) {

// After the toast on line 198-200, call the callback:
if (completedCount > 0) {
  toast.success(`${completedCount} document(s) uploaded`)
  onUploadComplete?.()
}
```

#### 2. Call `router.refresh()` in DocumentList when uploads complete
**File**: `src/components/documents/document-list.tsx`
**Changes**: Import `useRouter`, call `router.refresh()` via the `onUploadComplete` callback.

```tsx
// Add import (top of file):
import { useRouter } from 'next/navigation'

// Inside the component, add router (after line 44):
const router = useRouter()

// Update the UploadSheet usage (line 157):
<UploadSheet
  caseId={caseId}
  open={uploadOpen}
  onOpenChange={setUploadOpen}
  onUploadComplete={() => router.refresh()}
/>
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit`
- [x] Linting passes: `npm run lint`
- [ ] Build succeeds: `npm run build`

#### Manual Verification:
- [ ] Upload a single file → document appears in the list without manual refresh
- [ ] Upload multiple files → all documents appear after uploads complete
- [ ] Upload with errors (all fail) → no unnecessary refresh triggered
- [ ] Filters and search state in DocumentList are preserved after refresh
- [ ] Upload sheet can be reopened and used again after a successful upload cycle

## References

- Next.js router.refresh() docs: re-runs server components without losing client state
- Upload sheet: `src/components/documents/upload-sheet.tsx`
- Document list: `src/components/documents/document-list.tsx`
- Documents page: `src/app/(dashboard)/patients/[caseId]/documents/page.tsx`
