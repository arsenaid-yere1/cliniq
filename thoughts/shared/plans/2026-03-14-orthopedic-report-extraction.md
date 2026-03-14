---
date: 2026-03-14T00:00:00-07:00
author: Claude
git_commit: 929dd90880d58c37076415bfec3b6a80c3808b49
branch: main
repository: cliniq
topic: "Orthopedic Report Extraction Implementation"
tags: [plan, extraction, orthopedic, epic-2]
status: ready
last_updated: 2026-03-14
last_updated_by: Claude
---

# Plan: Orthopedic Report Extraction

**Research**: `thoughts/shared/research/2026-03-14-orthopedic-report-extraction.md`

## Overview

Add a new extraction type for **orthopedic reports** (surgical evaluations + radiographic reports). Follows the same 6-layer pattern as existing extractors (MRI, chiro, PM, PT).

## Sample Documents

Two PDFs from HAAS Spine & Orthopaedics for the same patient/visit:

1. **Radiographic Report** — Brief X-ray findings: body region, imaging date, narrative findings, disclaimer, provider signature
2. **Orthopedic Surgical Evaluation** — Full evaluation: present complaints, history of injury, past medical history, surgeries/hospitalizations, previous/subsequent complaints, medications, allergies, social/family history, physical examination, diagnostics (references X-ray and MRI), ICD-10 diagnoses, recommendations/referrals with cost estimates

## Extraction Schema Design

The orthopedic extractor should capture the following structured data from a surgical evaluation PDF:

```typescript
{
  // Report metadata
  report_date: string | null           // ISO date
  date_of_injury: string | null        // ISO date
  examining_provider: string | null    // "Sevag Bastian, MD"
  provider_specialty: string | null    // "Orthopedic Surgeon"

  // Patient demographics (as stated in report)
  patient_age: number | null
  patient_sex: string | null           // "male" | "female"
  hand_dominance: string | null        // "right" | "left"

  // Clinical history
  history_of_injury: string | null     // Narrative: MVA details, mechanism
  present_complaints: {
    location: string                   // "left shoulder"
    description: string                // "pain that shoots down to hand with numbness"
    radiation: string | null           // "down to hand"
    pre_existing: boolean              // false = denies pre-existing issues
  }[]

  // Medical history
  past_medical_history: string | null  // Narrative or "noncontributory"
  surgical_history: string | null      // Narrative or "none"
  previous_complaints: string | null   // Prior musculoskeletal issues
  subsequent_complaints: string | null // Post-accident injuries

  // Medications & allergies
  current_medications: {
    name: string                       // "Tylenol OTC"
    details: string | null             // "3-4 times a week"
  }[]
  allergies: string | null             // "NKDA" or list

  // Social/family history
  social_history: string | null        // Smoking, alcohol, etc.
  family_history: string | null        // "noncontributory"

  // Employment
  current_employment: string | null    // "dry cleaning store, front desk"

  // Physical examination
  physical_exam: {
    region: string                     // "Left shoulder"
    rom_summary: string | null         // "essentially full range of motion"
    tenderness: string | null          // "positive supraclavicular and infraclavicular"
    strength: string | null            // "Good strength throughout"
    neurovascular: string | null       // "neurovascularly intact"
    special_tests: string | null       // Any named tests
  }[]

  // Vitals (if present)
  height: string | null                // "5'1\""
  weight: string | null                // "105 pounds"

  // Diagnostics (imaging reviewed)
  diagnostics: {
    modality: string                   // "X-ray" | "MRI"
    body_region: string                // "Left shoulder"
    study_date: string | null          // ISO date
    findings: string                   // Narrative findings
    films_available: boolean           // Whether actual films were reviewed
  }[]

  // Diagnoses
  diagnoses: {
    icd10_code: string | null          // "M54.2"
    description: string                // "Cervicalgia"
  }[]

  // Recommendations / treatment plan
  recommendations: {
    description: string                // "physical therapy for cervical spine and left shoulder"
    type: string | null                // "therapy" | "injection" | "referral" | "monitoring" | "surgery"
    estimated_cost_min: number | null  // 8000
    estimated_cost_max: number | null  // 8000
    body_region: string | null         // "left shoulder"
    follow_up_timeframe: string | null // "3 months"
  }[]

  // AI metadata
  confidence: "high" | "medium" | "low"
  extraction_notes: string | null
}
```

## Implementation Steps

### Step 1: Database Migration (`supabase/migrations/021_orthopedic_extractions.sql`) ✅

**Pattern**: Follow `011_pain_management_extractions.sql`

1. Update `documents` table `document_type` check constraint to add `'orthopedic_report'`
2. Create `orthopedic_extractions` table with columns:
   - Identity: `id`, `document_id` (FK → documents), `case_id` (FK → cases), `schema_version`
   - Scalar fields: `report_date`, `date_of_injury`, `examining_provider`, `provider_specialty`, `patient_age`, `patient_sex`, `hand_dominance`, `height`, `weight`, `current_employment`
   - Narrative fields: `history_of_injury`, `past_medical_history`, `surgical_history`, `previous_complaints`, `subsequent_complaints`, `allergies`, `social_history`, `family_history`
   - JSONB arrays: `present_complaints`, `current_medications`, `physical_exam`, `diagnostics`, `diagnoses`, `recommendations`
   - AI metadata: `ai_model`, `ai_confidence`, `extraction_notes`, `raw_ai_response`
   - Pipeline state: `extraction_status`, `extraction_error`, `extraction_attempts`, `extracted_at`
   - Review workflow: `review_status`, `reviewed_by_user_id`, `reviewed_at`, `provider_overrides`
   - Audit: `created_at`, `updated_at`, `deleted_at`, `created_by_user_id`, `updated_by_user_id`
3. Indexes on `case_id`, `document_id`, `review_status`, GIN on `diagnoses`
4. RLS policy: authenticated users full access
5. `update_updated_at` trigger

### Step 2: Document Type Enum (`src/lib/validations/document.ts`) ✅

Add `'orthopedic_report'` to the `documentTypeEnum` Zod enum.

### Step 3: Zod Validation Schema (`src/lib/validations/orthopedic-extraction.ts`) ✅

**Pattern**: Follow `pain-management-extraction.ts`

Create two schemas:
- `orthopedicExtractionResultSchema` — validates AI output
- `orthopedicReviewFormSchema` — for the review form (strips confidence/extraction_notes, adds `.min(1)` on required fields)

Export inferred types.

### Step 4: Claude Extractor (`src/lib/claude/extract-orthopedic.ts`) ✅

**Pattern**: Follow `extract-pain-management.ts`

- System prompt tailored for orthopedic surgical evaluations
- Key instructions:
  - Extract all sections including medical history, medications, allergies
  - For diagnostics, summarize referenced imaging (X-ray findings, MRI report references)
  - Extract ICD-10 codes exactly as written
  - Extract treatment costs when stated
  - Handle the common pattern of paired reports (eval + radiology in separate PDFs)
- Tool schema matching the Zod schema
- `normalizeNullString` / `normalizeNullStringsInArray` helpers
- Export `extractOrthopedicFromPdf(pdfBase64: string)`

### Step 5: Server Actions (`src/actions/orthopedic-extractions.ts`) ✅

**Pattern**: Follow `pain-management-extractions.ts`

Six actions:
- `extractOrthopedicReport(documentId)` — main trigger, downloads PDF, calls Claude, saves to DB
- `listOrthopedicExtractions(caseId)` — list for case
- `getOrthopedicExtraction(extractionId)` — single fetch
- `approveOrthopedicExtraction(extractionId)` — approve
- `saveAndApproveOrthopedicExtraction(extractionId, overrides)` — save edits + approve
- `rejectOrthopedicExtraction(extractionId, reason)` — reject

Plus private `syncDocumentReviewed` helper.

### Step 6: UI Components (`src/components/clinical/`) ✅

**Pattern**: Follow `pm-extraction-{list,review,form}.tsx`

1. **`ortho-extraction-list.tsx`** — Card list with provider, report date, diagnosis count, complaint count, confidence/review badges. Click opens review.
2. **`ortho-extraction-review.tsx`** — Split-panel: PDF viewer left, form right. Re-extract button. Resolves overrides vs AI values.
3. **`ortho-extraction-form.tsx`** — Tabbed form:
   - **Overview** tab: report date, DOI, provider, specialty, patient demographics, employment
   - **History** tab: history of injury, present complaints (field array), past medical/surgical history, previous/subsequent complaints, medications (field array), allergies, social/family history
   - **Examination** tab: vitals (height/weight), physical exam regions (field array with ROM summary, tenderness, strength, neurovascular, special tests)
   - **Diagnostics** tab: imaging studies reviewed (field array)
   - **Diagnoses** tab: ICD-10 codes (field array)
   - **Treatment** tab: recommendations (field array with type, cost, body region, follow-up)
   - Action buttons: Approve / Save & Approve / Reject

### Step 7: Upload Dispatch (`src/components/documents/upload-sheet.tsx`) ✅

Add `orthopedic_report` to:
- The document type select options (with label "Orthopedic Report")
- The `pendingExtractions` dispatch logic (fire `extractOrthopedicReport` on upload)

### Step 8: Clinical Page Tab (`src/app/(dashboard)/patients/[caseId]/clinical/page.tsx`) ✅

- Add `listOrthopedicExtractions(caseId)` to the `Promise.all`
- Add "Orthopedic" tab trigger and tab content with `<OrthoExtractionList>`

### Step 9: Document Card Label (`src/components/documents/document-card.tsx`) ✅

Add `orthopedic_report` label mapping (e.g., "Orthopedic Report").

### Step 10: Soft Delete Cascade (`src/actions/documents.ts`) ✅

In `removeDocument`, add cascade soft-delete for `orthopedic_extractions` (alongside existing `chiro_extractions` and `mri_extractions` cascades).

## File Changes Summary

| File | Action |
|---|---|
| `supabase/migrations/021_orthopedic_extractions.sql` | **New** |
| `src/lib/validations/document.ts` | Edit (add enum value) |
| `src/lib/validations/orthopedic-extraction.ts` | **New** |
| `src/lib/claude/extract-orthopedic.ts` | **New** |
| `src/actions/orthopedic-extractions.ts` | **New** |
| `src/components/clinical/ortho-extraction-list.tsx` | **New** |
| `src/components/clinical/ortho-extraction-review.tsx` | **New** |
| `src/components/clinical/ortho-extraction-form.tsx` | **New** |
| `src/components/documents/upload-sheet.tsx` | Edit (add dispatch) |
| `src/app/(dashboard)/patients/[caseId]/clinical/page.tsx` | Edit (add tab) |
| `src/components/documents/document-card.tsx` | Edit (add label) |
| `src/actions/documents.ts` | Edit (add cascade) |
| `src/lib/supabase/database.types.ts` | Regenerate |

## Open Questions

1. **Should the radiographic report (X-ray) be a separate document type or uploaded alongside the eval as a single `orthopedic_report`?** — Recommendation: single type, since X-ray reports from orthopedic surgeons are typically a sub-component of the visit and the eval already references the X-ray findings in its diagnostics section.
2. **Should we add a broader `radiology_report` type later for standalone imaging (CT, X-ray, ultrasound) from non-orthopedic providers?** — Could be a future enhancement if needed.
