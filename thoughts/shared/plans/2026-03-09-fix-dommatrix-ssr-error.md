# Fix DOMMatrix SSR Error - Implementation Plan

## Overview

Fix `ReferenceError: DOMMatrix is not defined` error caused by `react-pdf` / `pdfjs-dist` being evaluated during server-side rendering. The library references browser-only APIs (`DOMMatrix`) at module evaluation time, which crashes Node.js.

## Current State Analysis

- `react-pdf` imports `pdfjs-dist` which uses `DOMMatrix` at module load time
- Even with `'use client'` directive, Next.js still evaluates module-level code during SSR
- Additionally, `recharts` (installed but unused) pulls in `d3-interpolate` which also references `DOMMatrix`

### Affected Components:
- `src/components/documents/pdf-viewer.tsx` — imported by 3 extraction review components
- `src/components/documents/pdf-preview.tsx` — imported by `document-card.tsx`

### Import Chain:
- `chiro-extraction-review.tsx` → `PdfViewer`
- `pm-extraction-review.tsx` → `PdfViewer`
- `mri-extraction-review.tsx` → `PdfViewer`
- `document-card.tsx` → `PdfPreview`

## Desired End State

All pages render without `DOMMatrix is not defined` error. PDF components load only on the client side.

### Verification:
- `npm run dev` — no SSR errors
- `npm run build` — builds successfully
- PDF viewing still works in browser

## What We're NOT Doing

- Not rewriting PDF components
- Not adding polyfills for DOMMatrix (fragile, unnecessary)
- Not removing recharts (may be needed later, but should be removed if unused to reduce bundle)

## Implementation Approach

Use `next/dynamic` with `ssr: false` to lazily load the PDF components only on the client. This prevents `react-pdf` module evaluation during SSR entirely.

## Phase 1: Dynamic Import PDF Components

### Changes Required:

#### 1. Update PdfViewer imports in extraction review components

**File**: `src/components/clinical/chiro-extraction-review.tsx`
**Change**: Replace static import with dynamic import

```tsx
// Before:
import { PdfViewer } from '@/components/documents/pdf-viewer'

// After:
import dynamic from 'next/dynamic'
const PdfViewer = dynamic(() => import('@/components/documents/pdf-viewer').then(mod => ({ default: mod.PdfViewer })), { ssr: false })
```

Apply same change to:
- `src/components/clinical/pm-extraction-review.tsx`
- `src/components/clinical/mri-extraction-review.tsx`

#### 2. Update PdfPreview import in document-card

**File**: `src/components/documents/document-card.tsx`
**Change**: Replace static import with dynamic import

```tsx
// Before:
import { PdfPreview } from './pdf-preview'

// After:
import dynamic from 'next/dynamic'
const PdfPreview = dynamic(() => import('./pdf-preview').then(mod => ({ default: mod.PdfPreview })), { ssr: false })
```

### Success Criteria:

#### Automated Verification:
- [x] `npm run build` completes without DOMMatrix errors
- [x] `npm run dev` — pages load without SSR crashes
- [x] TypeScript compiles: `npx tsc --noEmit`

#### Manual Verification:
- [ ] PDF viewer works in extraction review pages (chiro, PM, MRI)
- [ ] PDF preview works in document cards
- [ ] No flash of missing content when PDF components load

## References

- Error: `DOMMatrix is not defined` during SSR
- Root cause: `react-pdf` → `pdfjs-dist` → browser-only API at module eval time
- Secondary: `recharts` → `victory-vendor` → `d3-interpolate` (not imported yet but installed)
