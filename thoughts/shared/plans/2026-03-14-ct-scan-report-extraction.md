---
date: 2026-03-14T12:00:00-07:00
researcher: Claude
git_commit: e394ed5
branch: main
repository: cliniq
topic: "CT Scan Report Type Support"
tags: [plan, extraction, ct-scan, radiology, clinical]
status: complete
last_updated: 2026-03-14
last_updated_by: Claude
---

# Plan: CT Scan Report Extraction Support

**Date**: 2026-03-14
**Git Commit**: e394ed5
**Branch**: main

## Overview

Add `ct_scan` as a new document type with full AI extraction, provider review, and case summary integration. CT scan reports (e.g., cervical spine CT, head CT) are radiology reports structurally similar to MRI reports — they have body regions, findings per anatomical level, impression summaries, and technique descriptions.

The implementation follows the exact same pattern as the orthopedic extraction (the most recently added type), adapted with MRI-like extraction fields since CT and MRI are both radiology imaging reports.

## Extraction Schema Design

CT scan reports share the same structure as MRI reports:
- **Body region** (e.g., "Cervical Spine", "Head", "Lumbar Spine")
- **Scan date**
- **Findings** — per-level observations (e.g., "C5-6: disc space narrowing with opposing osteophytes")
- **Impression summary** — radiologist's final interpretation
- **Technique** — scan parameters (contrast, reconstruction type)
- **Reason for study** — clinical indication

We'll reuse the MRI finding structure (`level`, `description`, `severity`) since CT findings follow the same per-level pattern, and add `technique` and `reason_for_study` fields specific to CT.

## Files to Create/Modify

### New Files (7)

| # | File | Purpose |
|---|---|---|
| 1 | `supabase/migrations/022_ct_scan_extractions.sql` | DB table + document_type constraint update |
| 2 | `src/lib/validations/ct-scan-extraction.ts` | Zod schemas (extraction result + review form) |
| 3 | `src/lib/claude/extract-ct-scan.ts` | Claude API call with CT-specific system prompt |
| 4 | `src/actions/ct-scan-extractions.ts` | Server actions (extract, list, approve, reject, etc.) |
| 5 | `src/components/clinical/ct-scan-extraction-list.tsx` | List component with document grouping (like MRI) |
| 6 | `src/components/clinical/ct-scan-extraction-review.tsx` | Split-pane PDF + form view |
| 7 | `src/components/clinical/ct-scan-extraction-form.tsx` | Editable review form with approve/save/reject |

### Existing Files to Modify (5)

| # | File | Change |
|---|---|---|
| 1 | `src/lib/validations/document.ts` | Add `'ct_scan'` to `documentTypeEnum` |
| 2 | `src/components/documents/upload-sheet.tsx` | Add import, SelectItem, extraction routing |
| 3 | `src/actions/documents.ts` | Add `ct_scan_extractions` to `removeDocument` cascade |
| 4 | `src/app/(dashboard)/patients/[caseId]/clinical/page.tsx` | Add tab + data fetch |
| 5 | `src/actions/case-summaries.ts` + `src/lib/claude/generate-summary.ts` | Fetch CT data + add summary prompt rule |

## Implementation Steps

### Step 1: Database Migration (`022_ct_scan_extractions.sql`)

Create migration file following the MRI extraction table pattern with these columns:

```sql
-- Update document_type constraint to include 'ct_scan'
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_document_type_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_document_type_check
  CHECK (document_type IN ('mri_report','chiro_report','pain_management','pt_report','orthopedic_report','ct_scan','generated','other'));

-- Create ct_scan_extractions table
CREATE TABLE public.ct_scan_extractions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id uuid NOT NULL REFERENCES public.documents(id),
  case_id uuid NOT NULL REFERENCES public.cases(id),
  schema_version integer NOT NULL DEFAULT 1,

  -- Extracted fields (radiology-specific)
  body_region text,
  scan_date date,
  technique text,
  reason_for_study text,
  findings jsonb NOT NULL DEFAULT '[]',       -- Array of { level, description, severity }
  impression_summary text,

  -- AI metadata
  ai_model text,
  ai_confidence text CHECK (ai_confidence IN ('high','medium','low')),
  extraction_notes text,
  raw_ai_response jsonb,

  -- Pipeline state
  extraction_status text NOT NULL DEFAULT 'pending'
    CHECK (extraction_status IN ('pending','processing','completed','failed')),
  extraction_error text,
  extraction_attempts integer NOT NULL DEFAULT 0,
  extracted_at timestamptz,

  -- Review workflow
  review_status text NOT NULL DEFAULT 'pending_review'
    CHECK (review_status IN ('pending_review','approved','edited','rejected')),
  reviewed_by_user_id uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  provider_overrides jsonb NOT NULL DEFAULT '{}',

  -- Audit
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by_user_id uuid REFERENCES auth.users(id),
  updated_by_user_id uuid REFERENCES auth.users(id)
);

-- Indexes
CREATE INDEX idx_ct_scan_extractions_case_id ON public.ct_scan_extractions(case_id);
CREATE INDEX idx_ct_scan_extractions_document_id ON public.ct_scan_extractions(document_id);
CREATE INDEX idx_ct_scan_extractions_review_status ON public.ct_scan_extractions(review_status);
CREATE INDEX idx_ct_scan_extractions_findings ON public.ct_scan_extractions USING gin(findings);

-- Trigger
CREATE TRIGGER update_ct_scan_extractions_updated_at
  BEFORE UPDATE ON public.ct_scan_extractions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE public.ct_scan_extractions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage ct_scan_extractions"
  ON public.ct_scan_extractions FOR ALL
  USING (auth.role() = 'authenticated');
```

### Step 2: Zod Validation Schemas (`ct-scan-extraction.ts`)

Model after `mri-extraction.ts` with additional fields:

```typescript
// Reuse the same finding schema as MRI (level, description, severity)
const findingSchema = z.object({
  level: z.string(),
  description: z.string(),
  severity: z.enum(['mild', 'moderate', 'severe']).nullable(),
})

const ctScanExtractionResultSchema = z.object({
  body_region: z.string().nullable(),
  scan_date: z.string().nullable(),
  technique: z.string().nullable(),
  reason_for_study: z.string().nullable(),
  findings: z.array(findingSchema),
  impression_summary: z.string().nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  extraction_notes: z.string().nullable(),
})

// Response wraps multiple reports (like MRI — one per body region)
const ctScanExtractionResponseSchema = z.object({
  reports: z.array(ctScanExtractionResultSchema).min(1),
})

// Review form schema with required validators
const ctScanReviewFormSchema = z.object({
  body_region: z.string().min(1),
  scan_date: z.string().nullable(),
  technique: z.string().nullable(),
  reason_for_study: z.string().nullable(),
  findings: z.array(z.object({
    level: z.string().min(1),
    description: z.string().min(1),
    severity: z.enum(['mild', 'moderate', 'severe']).nullable(),
  })),
  impression_summary: z.string().nullable(),
})
```

### Step 3: Claude Extraction (`extract-ct-scan.ts`)

Model after `extract-mri.ts` with CT-specific system prompt:

- System prompt tells Claude to extract from CT/CAT scan radiology reports
- Separate report per body region (same as MRI)
- Extract technique description and reason for study
- Per-level findings with severity
- Verbatim impression summary
- Tool name: `extract_ct_scan_data`
- Tool schema mirrors `ctScanExtractionResponseSchema`
- Same `normalizeNullString` pattern
- Model: `claude-sonnet-4-6`

### Step 4: Server Actions (`ct-scan-extractions.ts`)

Clone from `mri-extractions.ts` (since CT uses the same multi-region pattern):

- `extractCtScanReport(documentId)` — enforces `document_type === 'ct_scan'`, same retry logic
- `insertMultiRegionExtractions()` — handles multiple body regions per document (same as MRI)
- `listCtScanExtractions(caseId)` — with document join
- `getCtScanExtraction(extractionId)` — single fetch with document join
- `approveCtScanExtraction(extractionId)` — sets approved + syncs document
- `saveAndApproveCtScanExtraction(extractionId, overrides)` — stores provider_overrides
- `rejectCtScanExtraction(extractionId, reason)` — sets rejected

### Step 5: Update Document Type Enum

**`src/lib/validations/document.ts:13`:**
```typescript
export const documentTypeEnum = z.enum([
  'mri_report', 'chiro_report', 'pain_management', 'pt_report',
  'orthopedic_report', 'ct_scan', 'generated', 'other'
])
```

### Step 6: Update Upload Sheet (`upload-sheet.tsx`)

1. Add import: `import { extractCtScanReport } from '@/actions/ct-scan-extractions'`
2. Add SelectItem: `<SelectItem value="ct_scan">CT Scan Report</SelectItem>`
3. Add extraction routing in `pendingExtractions` push (around line 163):
   ```typescript
   if (documentType === 'ct_scan') {
     pendingExtractions.push({ type: 'ct_scan', documentId: data.id })
   }
   ```
4. Add extraction dispatch in setTimeout block (around line 194):
   ```typescript
   if (ext.type === 'ct_scan') {
     extractCtScanReport(ext.documentId).then(...)
   }
   ```
5. Use multi-region success message like MRI: check `extractionIds.length > 1`

### Step 7: Update Document Removal Cascade (`documents.ts`)

In `removeDocument` (around line 167), add `ct_scan_extractions` to the `Promise.all`:
```typescript
supabase.from('ct_scan_extractions')
  .update({ deleted_at: now, updated_by_user_id: userId })
  .eq('document_id', documentId)
  .is('deleted_at', null)
```

### Step 8: UI Components

**`ct-scan-extraction-list.tsx`** — Clone from `mri-extraction-list.tsx`:
- Include the document grouping logic (multiple body regions per document)
- Card subtitle: `body_region` + `extracted_at` date
- Same badge pattern (confidence, review status, enter manually)

**`ct-scan-extraction-review.tsx`** — Clone from `mri-extraction-review.tsx`:
- Split-pane: PDF viewer left, form right
- Override merging with `provider_overrides ?? raw` pattern
- Re-extract button calling `extractCtScanReport`

**`ct-scan-extraction-form.tsx`** — Clone from `mri-extraction-form.tsx` with additions:
- Fields: `body_region`, `scan_date`, `technique` (textarea), `reason_for_study` (textarea), `impression_summary` (textarea), `findings` (field array with level/description/severity)
- Same approve/save-and-approve/reject action bar

### Step 9: Update Clinical Page (`clinical/page.tsx`)

1. Add import: `import { listCtScanExtractions } from '@/actions/ct-scan-extractions'`
2. Add import: `import { CtScanExtractionList } from '@/components/clinical/ct-scan-extraction-list'`
3. Add to `Promise.all`: `listCtScanExtractions(caseId)`
4. Add tab trigger: `<TabsTrigger value="ct-scan">CT Scan</TabsTrigger>`
5. Add tab content:
   ```tsx
   <TabsContent value="ct-scan">
     <CtScanExtractionList extractions={ctScanExtractions ?? []} caseId={caseId} />
   </TabsContent>
   ```

### Step 10: Integrate with Case Summary

**`src/actions/case-summaries.ts`** — in `gatherSourceData`:
1. Add query to `Promise.all`:
   ```typescript
   supabase.from('ct_scan_extractions')
     .select('body_region, scan_date, technique, reason_for_study, findings, impression_summary, provider_overrides')
     .eq('case_id', caseId)
     .is('deleted_at', null)
     .in('review_status', ['approved', 'edited'])
   ```
2. Add `ctScanExtractions` to `SummaryInputData` interface and return object
3. Include in the empty-check guard

**`src/lib/claude/generate-summary.ts`** — add system prompt rule:
```
Rule 16: CT scan data — incorporate CT findings into imaging_findings alongside MRI data.
CT scans provide bone and structural detail complementary to MRI soft tissue findings.
Cross-reference CT and MRI findings for the same body region to build a complete picture.
```

### Step 11: Regenerate Supabase Types

```bash
npx supabase gen types typescript --local > src/lib/supabase/database.types.ts
```

## Implementation Order

1. [x] Migration (Step 1)
2. [x] Validation schemas (Step 2)
3. [x] Claude extraction (Step 3)
4. [x] Server actions (Step 4)
5. [x] Document type enum (Step 5)
6. [x] Upload sheet (Step 6)
7. [x] Document removal cascade (Step 7)
8. [x] UI components — list, review, form (Step 8)
9. [x] Clinical page (Step 9)
10. [x] Case summary integration (Step 10)
11. [x] Type regeneration (Step 11)

## Testing Checklist

- [ ] Upload a CT scan PDF with type "CT Scan Report"
- [ ] Verify extraction triggers and completes with correct fields
- [ ] Verify multi-region CT scans create separate extraction rows (grouped in list)
- [ ] Review split-pane shows PDF and form correctly
- [ ] Approve, save-and-approve (with edits), and reject all work
- [ ] Re-extract works from review view
- [ ] Document deletion cascades to ct_scan_extractions
- [ ] Case summary includes approved CT scan data
- [ ] CT findings appear in imaging_findings section of summary
- [ ] Encrypted PDF detection works

## Reference: Sample CT Scan Report Structure

From the provided PDF (Henry Mayo Hospital cervical spine CT):
- **Body region**: Cervical Spine
- **Scan date**: 09/20/2025
- **Technique**: "Unenhanced CT examination of the cervical spine... multi channel CT scanner... 2 mm thick axial, sagittal and coronal images"
- **Reason for study**: "neck pain motor vehicle crash 9/8/2025 radiculopathy LUE"
- **Findings**:
  - C1: lateral masses well seated on body of C2, no fracture/dislocation
  - C5-6: disc space narrowing with opposing osteophytes
  - C6-C7: disc space narrowing with opposing osteophytes
  - Sagittal/coronal: straightening of normal cervical curvature
- **Impression**: "No evidence of cervical spine fracture or dislocation"
